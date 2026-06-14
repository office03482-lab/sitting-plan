"""Teacher assistant grounded in LMS, tests, analytics, and timetable data."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.services.supabase_ai_tutor import (
    _find_matching_assignments,
    _find_matching_lessons,
    _find_matching_recordings,
    _log_audit_entry,
    _normalize,
    _normalize_json_object,
    _normalize_optional_uuid,
    _public_table,
    _schema_table,
)
from app.services.supabase_analytics import get_batch_analytics, get_school_analytics, get_student_analytics, get_test_analytics
from app.services.supabase_attendance import create_notification
from app.services.supabase_lms import list_courses
from app.services.supabase_online_tests import list_results, list_tests
from app.services.supabase_timetable import list_timetable_entries

MODULE_KEY = "teacher_ai"
AI_SCHEMA = "ai"
ATTENDANCE_SCHEMA = "attendance"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value or fallback)
    except (TypeError, ValueError):
        return fallback


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value or fallback)
    except (TypeError, ValueError):
        return fallback


def _role_scope(role_key: str) -> str:
    normalized = _normalize(role_key).lower()
    if normalized in {"teacher", "school_admin", "platform_admin", "admin"}:
        return normalized or "teacher"
    raise HTTPException(status_code=403, detail="Only teachers and admins can use Teacher AI")


def _teacher_profile(profile_id: str | None) -> dict[str, Any]:
    if not profile_id:
        return {}
    rows = list(
        _public_table("profiles")
        .select("id,full_name,display_name,email")
        .eq("id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else {}


def _load_batch(school_id: str, batch_id: str | None) -> dict[str, Any]:
    if not batch_id:
        return {}
    rows = list(
        _public_table("batches")
        .select("id,name,class_name,section")
        .eq("school_id", school_id)
        .eq("id", batch_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else {}


def _load_subject(subject_id: str | None) -> dict[str, Any]:
    if not subject_id:
        return {}
    rows = list(
        _public_table("subjects")
        .select("id,name,class_name")
        .eq("id", subject_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else {}


def _load_holidays(school_id: str, *, days: int = 45) -> list[dict[str, Any]]:
    start_date = (_utc_now().date() - timedelta(days=5)).isoformat()
    end_date = (_utc_now().date() + timedelta(days=max(days, 1))).isoformat()
    rows = list(
        _schema_table(ATTENDANCE_SCHEMA, "holidays")
        .select("holiday_date,title,description")
        .eq("school_id", school_id)
        .gte("holiday_date", start_date)
        .lte("holiday_date", end_date)
        .order("holiday_date")
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _question_bank(school_id: str, *, subject_id: str | None, batch_id: str | None, topic: str | None, limit: int = 24) -> list[dict[str, Any]]:
    test_rows = list_tests(school_id, student_batch_id=batch_id or None, limit=12)
    test_ids = [_normalize(row.get("id")) for row in test_rows if _normalize(row.get("id"))]
    if not test_ids:
        return []
    query = (
        _schema_table("online_tests", "test_questions")
        .select("id,test_id,section_id,prompt_text,question_type,difficulty_level,marks,metadata")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .eq("is_active", True)
        .in_("test_id", test_ids)
        .limit(max(limit, 1))
    )
    rows = [dict(row) for row in list(query.execute().data or [])]
    topic_text = _normalize(topic).lower()
    subject_name = _normalize(_load_subject(subject_id).get("name")).lower() if subject_id else ""
    filtered: list[dict[str, Any]] = []
    for row in rows:
        candidate = " ".join(
            [
                _normalize(row.get("prompt_text")),
                _normalize(_normalize_json_object(row.get("metadata")).get("chapter_name")),
                _normalize(_normalize_json_object(row.get("metadata")).get("topic_name")),
                subject_name,
            ]
        ).lower()
        if topic_text and topic_text not in candidate:
            continue
        filtered.append(row)
    return filtered or rows[:limit]


def _top_topics_from_question_bank(question_rows: list[dict[str, Any]]) -> list[str]:
    counter: Counter[str] = Counter()
    for row in question_rows:
        metadata = _normalize_json_object(row.get("metadata"))
        for key in ("chapter_name", "topic_name", "unit_name"):
            value = _normalize(metadata.get(key))
            if value:
                counter[value] += 1
    return [item for item, _ in counter.most_common(5)]


def _teacher_batch_context(school_id: str, *, batch_id: str | None) -> dict[str, Any]:
    batch = _load_batch(school_id, batch_id)
    analytics = get_batch_analytics(school_id, batch_id) if batch_id else {}
    return {
        "batch": batch,
        "analytics": analytics,
    }


def _insight_summary(school_id: str, *, batch_id: str | None) -> dict[str, Any]:
    analytics = get_batch_analytics(school_id, batch_id) if batch_id else get_school_analytics(school_id)
    topper_list = list(analytics.get("topper_list") or analytics.get("top_students") or [])[:5]
    weak_students = list(analytics.get("weak_students") or [])[:5]
    attendance_concerns = list(analytics.get("attendance_concerns") or analytics.get("at_risk_students") or [])[:5]
    return {
        "topper_list": topper_list,
        "weak_students": weak_students,
        "attendance_concerns": attendance_concerns,
    }


def _persist_job(
    school_id: str,
    *,
    profile_id: str | None,
    batch_id: str | None,
    subject_id: str | None,
    job_type: str,
    title: str,
    prompt: str | None,
    context_snapshot: dict[str, Any],
    result_payload: dict[str, Any],
    metadata: dict[str, Any],
) -> str:
    response = _schema_table(AI_SCHEMA, "teacher_assistant_jobs").insert(
        {
            "school_id": school_id,
            "profile_id": _normalize_optional_uuid(profile_id),
            "target_batch_id": _normalize_optional_uuid(batch_id),
            "target_subject_id": _normalize_optional_uuid(subject_id),
            "job_type": job_type,
            "title": title,
            "prompt": prompt,
            "context_snapshot": context_snapshot,
            "result_payload": result_payload,
            "status": "generated",
            "metadata": metadata,
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist teacher AI job")
    return _normalize(rows[0].get("id"))


def _persist_generated_paper(
    school_id: str,
    *,
    job_id: str,
    profile_id: str | None,
    batch_id: str | None,
    subject_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    response = _schema_table(AI_SCHEMA, "generated_papers").insert(
        {
            "school_id": school_id,
            "job_id": _normalize_optional_uuid(job_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "batch_id": _normalize_optional_uuid(batch_id),
            "subject_id": _normalize_optional_uuid(subject_id),
            "paper_type": payload.get("paper_type") or "unit_test",
            "title": payload.get("title") or "AI Generated Paper",
            "duration_minutes": _safe_int(payload.get("duration_minutes"), 60),
            "total_marks": _safe_float(payload.get("total_marks"), 0),
            "question_payload": payload.get("questions") or [],
            "instructions": payload.get("instructions"),
            "metadata": payload.get("metadata") or {},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    return dict(rows[0]) if rows else {}


def _persist_generated_assignment(
    school_id: str,
    *,
    job_id: str,
    profile_id: str | None,
    batch_id: str | None,
    subject_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    response = _schema_table(AI_SCHEMA, "generated_assignments").insert(
        {
            "school_id": school_id,
            "job_id": _normalize_optional_uuid(job_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "batch_id": _normalize_optional_uuid(batch_id),
            "subject_id": _normalize_optional_uuid(subject_id),
            "assignment_type": payload.get("assignment_type") or "homework",
            "title": payload.get("title") or "AI Generated Assignment",
            "difficulty_level": payload.get("difficulty_level") or "medium",
            "estimated_minutes": _safe_int(payload.get("estimated_minutes"), 30),
            "task_payload": payload.get("tasks") or [],
            "instructions": payload.get("instructions"),
            "metadata": payload.get("metadata") or {},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    return dict(rows[0]) if rows else {}


def _persist_generated_report(
    school_id: str,
    *,
    job_id: str,
    profile_id: str | None,
    student_id: str | None,
    payload: dict[str, Any],
    analytics_snapshot: dict[str, Any],
) -> dict[str, Any]:
    response = _schema_table(AI_SCHEMA, "generated_reports").insert(
        {
            "school_id": school_id,
            "job_id": _normalize_optional_uuid(job_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "student_id": _normalize_optional_uuid(student_id),
            "report_type": payload.get("report_type") or "progress_report",
            "title": payload.get("title") or "AI Generated Report Comments",
            "summary": payload.get("summary"),
            "remarks": payload.get("remarks"),
            "improvement_suggestions": payload.get("improvement_suggestions") or [],
            "score_payload": payload.get("score_payload") or {},
            "analytics_snapshot": analytics_snapshot,
            "metadata": payload.get("metadata") or {},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    return dict(rows[0]) if rows else {}


def _question_template(question_type: str, difficulty: str, marks: float, prompt: str, source: str) -> dict[str, Any]:
    return {
        "question_type": question_type,
        "difficulty": difficulty,
        "marks": marks,
        "prompt": prompt,
        "source": source,
    }


def _lesson_task(slot: dict[str, Any], chapter: str, objective: str) -> dict[str, Any]:
    return {
        "day_of_week": slot.get("day_of_week"),
        "start_time": slot.get("start_time"),
        "end_time": slot.get("end_time"),
        "subject": slot.get("subject") or slot.get("subject_name"),
        "class_name": slot.get("class_name"),
        "chapter": chapter,
        "objective": objective,
        "activity": f"Introduce {chapter} and guide class discussion around {objective.lower()}",
    }


def generate_question_paper(school_id: str, *, role_key: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _role_scope(role_key)
    batch_id = _normalize(payload.get("batch_id")) or None
    subject_id = _normalize(payload.get("subject_id")) or None
    topic = _normalize(payload.get("topic")) or None
    paper_type = _normalize(payload.get("paper_type")) or "unit_test"
    difficulty = _normalize(payload.get("difficulty_level")) or "medium"
    title = _normalize(payload.get("title")) or f"{paper_type.replace('_', ' ').title()} Paper"
    question_count = min(max(_safe_int(payload.get("question_count"), 10), 4), 30)
    batch = _load_batch(school_id, batch_id)
    subject = _load_subject(subject_id)
    question_rows = _question_bank(school_id, subject_id=subject_id, batch_id=batch_id, topic=topic, limit=question_count * 3)
    fallback_topics = _top_topics_from_question_bank(question_rows)
    selected_topic = topic or (fallback_topics[0] if fallback_topics else subject.get("name") or "Core Topics")
    lessons = _find_matching_lessons(school_id, None, selected_topic)[:3]
    tests = list_tests(school_id, student_batch_id=batch_id or None, limit=5)

    question_types = list(payload.get("question_types") or ["mcq", "subjective", "numerical", "hots"])
    questions: list[dict[str, Any]] = []
    marks_total = 0.0
    for index in range(question_count):
        source_row = question_rows[index % len(question_rows)] if question_rows else {}
        source_prompt = _normalize(source_row.get("prompt_text")) or f"{selected_topic}: Explain concept pattern {index + 1}."
        metadata = _normalize_json_object(source_row.get("metadata"))
        chapter = _normalize(metadata.get("chapter_name")) or selected_topic
        q_type = str(question_types[index % len(question_types)]).lower()
        marks = 1.0 if q_type == "mcq" else 5.0 if q_type == "numerical" else 4.0 if q_type == "hots" else 3.0
        prompt_text = {
            "mcq": f"{chapter}: Based on the concept below, choose the correct answer. {source_prompt}",
            "subjective": f"{chapter}: Write a structured answer for the following concept. {source_prompt}",
            "numerical": f"{chapter}: Solve the numerical carefully and show working. {source_prompt}",
            "hots": f"{chapter}: Apply higher-order thinking and justify your answer. {source_prompt}",
        }.get(q_type, source_prompt)
        questions.append(_question_template(q_type, difficulty, marks, prompt_text, "question_bank"))
        marks_total += marks

    instructions = [
        "Attempt all compulsory questions first.",
        "Show full steps for numerical questions.",
        "Use clear reasoning for HOTS and subjective answers.",
    ]
    result_payload = {
        "paper_type": paper_type,
        "title": title,
        "topic": selected_topic,
        "difficulty_level": difficulty,
        "duration_minutes": _safe_int(payload.get("duration_minutes"), 60),
        "total_marks": round(marks_total, 2),
        "questions": questions,
        "instructions": "\n".join(instructions),
        "context_signals": {
            "lesson_hits": [row.get("lesson_title") or row.get("title") for row in lessons],
            "previous_tests": [row.get("title") for row in tests],
        },
        "metadata": {
            "batch_name": batch.get("name"),
            "subject_name": subject.get("name"),
            "class_name": batch.get("class_name"),
        },
    }
    context_snapshot = {
        "batch": batch,
        "subject": subject,
        "question_bank_count": len(question_rows),
        "top_topics": fallback_topics,
        "lesson_hits": lessons,
        "previous_tests": tests,
    }
    job_id = _persist_job(
        school_id,
        profile_id=profile_id,
        batch_id=batch_id,
        subject_id=subject_id,
        job_type="question_paper",
        title=title,
        prompt=_normalize(payload.get("prompt")) or selected_topic,
        context_snapshot=context_snapshot,
        result_payload=result_payload,
        metadata={"paper_type": paper_type, "difficulty_level": difficulty},
    )
    paper_row = _persist_generated_paper(
        school_id,
        job_id=job_id,
        profile_id=profile_id,
        batch_id=batch_id,
        subject_id=subject_id,
        payload=result_payload,
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="teacher_ai.question_paper.generated", payload={"job_id": job_id, "paper_type": paper_type})
    return {
        "job_id": job_id,
        "paper_id": paper_row.get("id"),
        **result_payload,
        "generated_at": _utc_now_iso(),
    }


def generate_assignment(school_id: str, *, role_key: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _role_scope(role_key)
    batch_id = _normalize(payload.get("batch_id")) or None
    subject_id = _normalize(payload.get("subject_id")) or None
    topic = _normalize(payload.get("topic")) or None
    assignment_type = _normalize(payload.get("assignment_type")) or "homework"
    difficulty = _normalize(payload.get("difficulty_level")) or "medium"
    title = _normalize(payload.get("title")) or f"{assignment_type.replace('_', ' ').title()} Set"
    task_count = min(max(_safe_int(payload.get("task_count"), 8), 3), 20)
    batch = _load_batch(school_id, batch_id)
    subject = _load_subject(subject_id)
    selected_topic = topic or subject.get("name") or "Current Chapter"
    lessons = _find_matching_lessons(school_id, None, selected_topic)[:3]
    prior_assignments = _find_matching_assignments(school_id, None, selected_topic)[:3]
    tasks: list[dict[str, Any]] = []
    for index in range(task_count):
        lesson = lessons[index % len(lessons)] if lessons else {}
        lesson_title = _normalize(lesson.get("lesson_title") or lesson.get("title")) or selected_topic
        task_kind = ["revise", "solve", "write", "practice"][index % 4]
        tasks.append(
            {
                "task_no": index + 1,
                "task_type": assignment_type,
                "difficulty_level": difficulty,
                "prompt": f"{task_kind.title()} {lesson_title} with focus on {selected_topic}.",
                "expected_outcome": "Accurate concept application with neat working.",
            }
        )
    result_payload = {
        "assignment_type": assignment_type,
        "title": title,
        "difficulty_level": difficulty,
        "estimated_minutes": _safe_int(payload.get("estimated_minutes"), max(task_count * 6, 20)),
        "tasks": tasks,
        "instructions": "Complete all tasks in sequence. Attempt revision and practice questions neatly.",
        "metadata": {
            "batch_name": batch.get("name"),
            "subject_name": subject.get("name"),
            "topic": selected_topic,
        },
    }
    context_snapshot = {
        "batch": batch,
        "subject": subject,
        "lesson_hits": lessons,
        "prior_assignments": prior_assignments,
    }
    job_id = _persist_job(
        school_id,
        profile_id=profile_id,
        batch_id=batch_id,
        subject_id=subject_id,
        job_type="assignment",
        title=title,
        prompt=_normalize(payload.get("prompt")) or selected_topic,
        context_snapshot=context_snapshot,
        result_payload=result_payload,
        metadata={"assignment_type": assignment_type, "difficulty_level": difficulty},
    )
    assignment_row = _persist_generated_assignment(
        school_id,
        job_id=job_id,
        profile_id=profile_id,
        batch_id=batch_id,
        subject_id=subject_id,
        payload=result_payload,
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="teacher_ai.assignment.generated", payload={"job_id": job_id, "assignment_type": assignment_type})
    return {
        "job_id": job_id,
        "assignment_id": assignment_row.get("id"),
        **result_payload,
        "generated_at": _utc_now_iso(),
    }


def generate_lesson_plan(school_id: str, *, role_key: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _role_scope(role_key)
    teacher_id = _normalize(payload.get("teacher_id")) or None
    class_name = _normalize(payload.get("class_name")) or None
    plan_scope = _normalize(payload.get("plan_scope")) or "daily"
    topic = _normalize(payload.get("topic")) or "Current Unit"
    timetable_rows = list_timetable_entries(school_id, teacher_id=teacher_id, class_name=class_name)
    lessons = _find_matching_lessons(school_id, None, topic)[:5]
    holidays = _load_holidays(school_id, days=35)
    top_topics = [row.get("lesson_title") or row.get("title") for row in lessons if row.get("lesson_title") or row.get("title")]
    slot_count = 5 if plan_scope == "weekly" else 12 if plan_scope == "monthly" else 2
    slots = timetable_rows[:slot_count]
    plan_rows: list[dict[str, Any]] = []
    for index, slot in enumerate(slots):
        chapter = top_topics[index % len(top_topics)] if top_topics else topic
        plan_rows.append(_lesson_task(slot, chapter, f"Build conceptual clarity in {chapter}"))
    holiday_notes = [f"{row.get('holiday_date')}: {row.get('title') or row.get('description') or 'Holiday'}" for row in holidays[:5]]
    title = _normalize(payload.get("title")) or f"{plan_scope.title()} Lesson Plan"
    result_payload = {
        "plan_scope": plan_scope,
        "title": title,
        "topic": topic,
        "schedule": plan_rows,
        "holiday_notes": holiday_notes,
        "teaching_goals": [
            "Cover syllabus progression without duplicating timetable scheduling.",
            "Reserve one segment for doubt clearing and recap.",
            "Link practice or homework with LMS and test readiness.",
        ],
        "generated_at": _utc_now_iso(),
    }
    context_snapshot = {
        "teacher_id": teacher_id,
        "class_name": class_name,
        "timetable_rows": slots,
        "lesson_hits": lessons,
        "holidays": holidays,
    }
    job_id = _persist_job(
        school_id,
        profile_id=profile_id,
        batch_id=None,
        subject_id=None,
        job_type="lesson_plan",
        title=title,
        prompt=_normalize(payload.get("prompt")) or topic,
        context_snapshot=context_snapshot,
        result_payload=result_payload,
        metadata={"plan_scope": plan_scope},
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="teacher_ai.lesson_plan.generated", payload={"job_id": job_id, "plan_scope": plan_scope})
    return {"job_id": job_id, **result_payload}


def _student_row(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,full_name,class_name,section,batch_id,profile_id")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


def generate_report_comments(school_id: str, *, role_key: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _role_scope(role_key)
    student_id = _normalize(payload.get("student_id")) or None
    if not student_id:
        raise HTTPException(status_code=400, detail="student_id is required")
    student = _student_row(school_id, student_id)
    analytics = get_student_analytics(school_id, student_id)
    batch_insights = _insight_summary(school_id, batch_id=_normalize(student.get("batch_id")) or None)
    test_rows = list_results(school_id, student_id=student_id, limit=6)
    latest_test = test_rows[0] if test_rows else {}
    test_analytics = get_test_analytics(school_id, _normalize(latest_test.get("test_id"))) if latest_test.get("test_id") else {}
    overall = _safe_float(analytics.get("overall_percentage"))
    accuracy = _safe_float(analytics.get("accuracy"))
    weak_topics = list(analytics.get("weak_topics") or [])[:3]
    strong_topics = list(analytics.get("strong_topics") or [])[:3]
    score_value = payload.get("score")
    max_score = payload.get("max_score")
    manual_percent = (_safe_float(score_value) / max(_safe_float(max_score), 1)) * 100 if score_value is not None and max_score is not None else overall
    remarks = (
        "Shows strong conceptual understanding but needs improvement in numerical problem solving."
        if manual_percent >= 75 and weak_topics
        else "Needs structured revision, targeted practice, and closer follow-up on weak concepts."
        if manual_percent < 60
        else "Is progressing steadily and will benefit from more accuracy-focused practice."
    )
    improvement = [
        f"Revise weak topic: {item}" for item in weak_topics
    ] or ["Attempt one more revision worksheet this week.", "Review teacher notes before the next class assessment."]
    parent_note = (
        f"{student.get('full_name')} is currently averaging {round(manual_percent, 2)}% and should focus on {', '.join(weak_topics) or 'revision consistency'}."
    )
    summary = {
        "weak_students": batch_insights.get("weak_students"),
        "topper_list": batch_insights.get("topper_list"),
        "attendance_concerns": batch_insights.get("attendance_concerns"),
    }
    result_payload = {
        "report_type": _normalize(payload.get("report_type")) or "progress_report",
        "title": _normalize(payload.get("title")) or f"{student.get('full_name')} Progress Comments",
        "summary": parent_note,
        "remarks": remarks,
        "improvement_suggestions": improvement,
        "score_payload": {
            "score": score_value,
            "max_score": max_score,
            "effective_percentage": round(manual_percent, 2),
            "accuracy": accuracy,
        },
        "analytics_snapshot": {
            "overall_percentage": overall,
            "weak_topics": weak_topics,
            "strong_topics": strong_topics,
            "latest_test": latest_test,
            "test_analytics": test_analytics,
            "batch_insights": summary,
        },
        "teacher_note": _normalize(payload.get("teacher_note")) or "",
        "generated_at": _utc_now_iso(),
    }
    job_id = _persist_job(
        school_id,
        profile_id=profile_id,
        batch_id=_normalize(student.get("batch_id")) or None,
        subject_id=None,
        job_type="report_comments",
        title=result_payload["title"],
        prompt=_normalize(payload.get("prompt")) or remarks,
        context_snapshot={"student": student, "analytics": analytics, "test_rows": test_rows[:3], "batch_insights": summary},
        result_payload=result_payload,
        metadata={"report_type": result_payload["report_type"]},
    )
    report_row = _persist_generated_report(
        school_id,
        job_id=job_id,
        profile_id=profile_id,
        student_id=student_id,
        payload=result_payload,
        analytics_snapshot=result_payload["analytics_snapshot"],
    )
    try:
        create_notification(
            school_id,
            message=f"Teacher AI generated progress comments for {student.get('full_name')}.",
            notification_type="teacher_ai",
            metadata={"job_id": job_id, "student_id": student_id, "report_id": report_row.get("id")},
        )
    except Exception:
        pass
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="teacher_ai.report_comments.generated", payload={"job_id": job_id, "student_id": student_id})
    return {
        "job_id": job_id,
        "report_id": report_row.get("id"),
        **result_payload,
    }
