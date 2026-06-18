"""Grounded AI tutor service built on LMS, tests, analytics, planner, and live classes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.ai_provider import AIProviderError, generate_json
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_analytics import _get_student_by_profile_id, get_student_analytics
from app.services.supabase_lms import (
    _get_student,
    _list_parent_linked_students,
    get_progress_dashboard,
    list_assignments,
    list_courses,
)
from app.services.supabase_online_tests import list_results, list_tests

MODULE_KEY = "ai_tutor"
AI_SCHEMA = "ai"
ACADEMIC_SCHEMA = "academic"
LMS_SCHEMA = "lms"
ANALYTICS_SCHEMA = "analytics"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _ai_table(name: str):
    return _public_table(f"ai_{name}")


def _lms_table(name: str):
    return _public_table(f"lms_{name}")


def _analytics_table(name: str):
    return _public_table(f"analytics_{name}")


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return str(UUID(text))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=400, detail="Expected a valid UUID value") from exc


def _normalize_json_object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    _public_table("audit_logs").insert(
        {
            "school_id": _normalize_optional_uuid(school_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "action": action,
            "module_key": MODULE_KEY,
            "payload": payload or {},
        }
    ).execute()


def _role_scope(role_key: str) -> str:
    normalized = _normalize(role_key).lower()
    if normalized in {"teacher", "school_admin", "platform_admin", "admin"}:
        return "teacher"
    return "student"


def _topic_match_score(candidate: str, topic: str) -> int:
    candidate_text = _normalize(candidate).lower()
    topic_text = _normalize(topic).lower()
    if not candidate_text or not topic_text:
        return 0
    if topic_text in candidate_text:
        return len(topic_text) + 10
    score = 0
    for token in topic_text.split():
        if token and token in candidate_text:
            score += len(token)
    return score


def _find_matching_lessons(school_id: str, student: dict[str, Any] | None, topic: str) -> list[dict[str, Any]]:
    course_rows = list_courses(school_id, student=student) if student else list_courses(school_id, include_inactive=True)
    matches: list[tuple[int, dict[str, Any]]] = []
    for course in course_rows:
        for module in course.get("modules") or []:
            for lesson in module.get("lessons") or []:
                candidate_text = " ".join(
                    [
                        _normalize(lesson.get("title")),
                        _normalize(lesson.get("description")),
                        _normalize(lesson.get("content_text")),
                        _normalize(module.get("title")),
                        _normalize(course.get("title")),
                    ]
                )
                score = _topic_match_score(candidate_text, topic)
                if score > 0:
                    matches.append(
                        (
                            score,
                            {
                                "course_id": course.get("id"),
                                "course_title": course.get("title"),
                                "module_id": module.get("id"),
                                "module_title": module.get("title"),
                                "lesson_id": lesson.get("id"),
                                "lesson_title": lesson.get("title"),
                                "lesson_description": lesson.get("description"),
                                "lesson_type": lesson.get("lesson_type"),
                                "video_url": lesson.get("video_url"),
                                "resources": list(lesson.get("resources") or []),
                            },
                        )
                    )
    matches.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in matches[:5]]


def _find_matching_assignments(school_id: str, student: dict[str, Any] | None, topic: str) -> list[dict[str, Any]]:
    assignments = list_assignments(school_id, student=student) if student else list_assignments(school_id, include_inactive=True)
    matches: list[tuple[int, dict[str, Any]]] = []
    for assignment in assignments:
        candidate_text = " ".join(
            [
                _normalize(assignment.get("title")),
                _normalize(assignment.get("description")),
            ]
        )
        score = _topic_match_score(candidate_text, topic)
        if score > 0:
            matches.append((score, dict(assignment)))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in matches[:5]]


def _find_matching_recordings(school_id: str, topic: str) -> list[dict[str, Any]]:
    rows = list(
        _schema_table(ACADEMIC_SCHEMA, "live_class_recordings")
        .select("id,title,recording_url,notes_url,lesson_id,module_id,course_id,metadata,published_at")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("published_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )
    matches: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        candidate_text = " ".join(
            [
                _normalize(row.get("title")),
                _normalize(_normalize_json_object(row.get("metadata")).get("topic")),
                _normalize(_normalize_json_object(row.get("metadata")).get("chapter_name")),
            ]
        )
        score = _topic_match_score(candidate_text, topic)
        if score > 0:
            matches.append((score, dict(row)))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in matches[:3]]


def _find_matching_recommendations(school_id: str, student_id: str | None, topic: str) -> list[dict[str, Any]]:
    query = (
        _analytics_table("recommendations")
        .select("id,recommendation_type,title,summary,payload,score,generated_at")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("generated_at", desc=True)
        .limit(30)
    )
    if student_id:
        query = query.eq("student_id", student_id)
    rows = list(query.execute().data or [])
    matches: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        candidate_text = " ".join([_normalize(row.get("title")), _normalize(row.get("summary"))])
        score = _topic_match_score(candidate_text, topic)
        if score > 0:
            matches.append((score, dict(row)))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in matches[:5]]


def _find_matching_study_plan(school_id: str, student_id: str | None, topic: str) -> list[dict[str, Any]]:
    if not student_id:
        return []
    rows = list(
        _analytics_table("study_plans")
        .select("id,scope,plan_date,summary,metadata,generated_at")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .order("plan_date", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    matches: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        summary = _normalize_json_object(row.get("summary"))
        candidate_text = " ".join(
            [
                _normalize(summary.get("weak_topics")),
                _normalize(summary.get("weak_subjects")),
                _normalize(summary.get("recurring_mistakes")),
            ]
        )
        score = _topic_match_score(candidate_text, topic)
        if score > 0:
            matches.append((score, dict(row)))
    matches.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in matches[:3]]


def _attendance_signal(school_id: str, student_id: str | None) -> dict[str, Any]:
    if not student_id:
        return {"attendance_percentage": 0.0, "present_count": 0, "total_count": 0}
    rows = list(
        _client()
        .schema("attendance")
        .table("student_attendance")
        .select("status,attendance_date")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .order("attendance_date", desc=True)
        .limit(30)
        .execute()
        .data
        or []
    )
    total_count = len(rows)
    if not total_count:
        return {"attendance_percentage": 0.0, "present_count": 0, "total_count": 0}
    present_count = sum(1 for row in rows if _normalize(row.get("status")).lower() in {"present", "late", "excused"})
    return {
        "attendance_percentage": round((present_count / total_count) * 100, 2),
        "present_count": present_count,
        "total_count": total_count,
    }


def _resolve_student_context(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    target_student_id: str | None,
) -> dict[str, Any] | None:
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        return _get_student_by_profile_id(school_id, profile_id)
    if normalized_role == "parent":
        linked = _list_parent_linked_students(school_id, profile_id, user_email)
        if not linked:
            raise HTTPException(status_code=404, detail="No linked students found for this parent")
        if target_student_id:
            matched = [item for item in linked if _normalize(item.get("id")) == target_student_id]
            if not matched:
                raise HTTPException(status_code=403, detail="Parents can use the tutor only for linked students")
            return matched[0]
        return linked[0]
    if target_student_id:
        return _get_student(school_id, target_student_id)
    return None


def _difficulty_band(analytics: dict[str, Any] | None, topic: str) -> str:
    analytics = analytics or {}
    weak_topics = [str(item or "").strip().lower() for item in list(analytics.get("weak_topics") or [])]
    strong_topics = [str(item or "").strip().lower() for item in list(analytics.get("strong_topics") or [])]
    topic_key = _normalize(topic).lower()
    overall_percentage = _safe_float(analytics.get("overall_percentage"))
    if topic_key in weak_topics or overall_percentage < 60:
        return "support"
    if topic_key in strong_topics or overall_percentage >= 80:
        return "advanced"
    return "balanced"


def _topic_profile(analytics: dict[str, Any] | None, topic: str) -> dict[str, Any]:
    analytics = analytics or {}
    topic_key = _normalize(topic).lower()
    chapter_rows = list(analytics.get("chapter_percentages") or [])
    matched_row = next(
        (
            row
            for row in chapter_rows
            if topic_key in _normalize(row.get("chapter_name")).lower()
            or topic_key in _normalize(row.get("topic_name")).lower()
        ),
        None,
    )
    return {
        "matched": matched_row is not None,
        "percentage": _safe_float((matched_row or {}).get("percentage")),
        "attempts_count": _safe_int((matched_row or {}).get("attempts_count")),
    }


def _build_context_snapshot(
    school_id: str,
    *,
    role_key: str,
    topic: str,
    student: dict[str, Any] | None,
) -> dict[str, Any]:
    analytics = get_student_analytics(school_id, _normalize(student.get("id"))) if student else {}
    progress = get_progress_dashboard(school_id, student=student) if student else {"progress_items": [], "enrolled_courses": [], "ai_insights": {}}
    assignments = _find_matching_assignments(school_id, student, topic)
    lessons = _find_matching_lessons(school_id, student, topic)
    recordings = _find_matching_recordings(school_id, topic)
    results = list_results(school_id, student_id=_normalize(student.get("id")), limit=10) if student else []
    tests = list_tests(school_id, student_batch_id=_normalize(student.get("batch_id")) or None, limit=10) if student else list_tests(school_id, include_inactive=False, limit=10)
    recommendations = _find_matching_recommendations(school_id, _normalize(student.get("id")) if student else None, topic)
    planner_hits = _find_matching_study_plan(school_id, _normalize(student.get("id")) if student else None, topic)
    attendance_signal = _attendance_signal(school_id, _normalize(student.get("id")) if student else None)
    topic_perf = _topic_profile(analytics, topic)
    difficulty_band = _difficulty_band(analytics, topic)
    previous_test_count = len(
        [
            row
            for row in results
            if _topic_match_score(" ".join([_normalize(row.get("metadata")), _normalize(row.get("test_id"))]), topic) > 0
        ]
    )
    if not previous_test_count:
        previous_test_count = len(results)

    return {
        "role_scope": _role_scope(role_key),
        "topic": topic,
        "class_level": _normalize((student or {}).get("class_name")) or None,
        "student_id": _normalize((student or {}).get("id")) or None,
        "student_name": _normalize((student or {}).get("full_name")) or None,
        "weak_topic_history": list(analytics.get("weak_topics") or [])[:5],
        "strong_topic_history": list(analytics.get("strong_topics") or [])[:5],
        "previous_test_count": previous_test_count,
        "difficulty_band": difficulty_band,
        "topic_performance": topic_perf,
        "recommended_lessons": lessons,
        "recommended_recordings": recordings,
        "recommended_assignments": assignments,
        "recommended_tests": recommendations or list(progress.get("ai_insights", {}).get("recommended_tests") or [])[:3],
        "planner_hits": planner_hits,
        "latest_results": results[:5],
        "available_tests": tests[:5],
        "progress_summary": {
            "enrolled_courses": len(list(progress.get("enrolled_courses") or [])),
            "progress_items": len(list(progress.get("progress_items") or [])),
        },
        "attendance_summary": attendance_signal,
        "analytics_summary": {
            "overall_percentage": _safe_float(analytics.get("overall_percentage")),
            "accuracy": _safe_float(analytics.get("accuracy")),
            "speed": _safe_float(analytics.get("speed")),
            "rank": analytics.get("rank"),
            "percentile": analytics.get("percentile"),
        },
    }


def _explanation_sections(topic: str, context: dict[str, Any]) -> dict[str, Any]:
    band = _normalize(context.get("difficulty_band")).lower() or "balanced"
    class_level = _normalize(context.get("class_level")) or "current class"
    lesson = next(iter(context.get("recommended_lessons") or []), {})
    recording = next(iter(context.get("recommended_recordings") or []), {})
    if band == "support":
        explanation = (
            f"{topic} ko {class_level} level par simple tareeke se samjho: pehle basic idea samjho, phir 2-3 daily life examples dekho, aur phir short recap karo. "
            f"Is topic me tumhari previous performance ko dekhkar focus foundation clear karne par rakha gaya hai."
        )
        examples = [
            f"{topic} ko do cheezon ke beech relation samajhne wali concept map ki tarah dekho.",
            "Har definition ke baad ek chhota real-world example bolo ya likho.",
            "Confusing terms ko pair-wise compare karo.",
        ]
        revision_plan = [
            f"10 min: {topic} ka basic definition recap",
            "15 min: solved example ya teacher note review",
            "10 min: 3 short practice questions",
        ]
        challenge_questions = []
    elif band == "advanced":
        explanation = (
            f"{topic} par tumhari base understanding strong lagti hai, isliye explanation ko higher-order reasoning par shift kiya gaya hai. "
            f"Core definition ke baad exception cases, compare-and-contrast, aur exam-trap patterns cover karo."
        )
        examples = [
            f"{topic} ko alternate frameworks ya edge cases ke through compare karo.",
            "Ek concept ko dusre connected chapter se link karke justify karo.",
            "Why-not style reasoning likho: galat option kyun galat hai.",
        ]
        revision_plan = [
            "10 min: concept map redraw",
            "15 min: challenge-level MCQ set",
            "10 min: mistake log update",
        ]
        challenge_questions = [
            f"Explain why a common shortcut in {topic} can fail in a tricky question.",
            f"Build a compare-and-contrast answer for {topic} versus a nearby concept.",
        ]
    else:
        explanation = (
            f"{topic} ke liye balanced explanation diya gaya hai: pehle idea, phir structure, phir application. "
            f"Goal yeh hai ki concept samajh bhi aaye aur test me use bhi ho."
        )
        examples = [
            f"{topic} ka one-line rule likho.",
            "Us rule ka ek standard example solve karo.",
            "Phir ek slightly twisted example attempt karo.",
        ]
        revision_plan = [
            "12 min: theory recap",
            "12 min: mixed practice",
            "8 min: self-check summary",
        ]
        challenge_questions = [
            f"State one misconception students commonly make in {topic}.",
        ]

    key_points = [
        f"{topic} ka core idea identify karo.",
        "Terms aur symbols ko confuse mat karo.",
        "Application ke time step order maintain karo.",
    ]
    if lesson:
        key_points.append(f"Recommended LMS lesson: {_normalize(lesson.get('lesson_title'))}")
    if recording:
        key_points.append(f"Recommended live class recording: {_normalize(recording.get('title'))}")

    fallback = {
        "explanation": explanation,
        "key_points": key_points,
        "examples": examples,
        "revision_plan": revision_plan,
        "challenge_questions": challenge_questions,
    }
    prompt = (
        "You are the Aspire ERP AI Tutor. Return strict JSON with keys "
        "explanation, key_points, examples, revision_plan, challenge_questions. "
        "Keep the explanation concise, grounded in the supplied student context, and exam-friendly.\n"
        f"Topic: {topic}\n"
        f"Difficulty band: {_normalize(context.get('difficulty_band'))}\n"
        f"Class level: {_normalize(context.get('class_level'))}\n"
        f"Weak topics: {list(context.get('weak_topic_history') or [])[:4]}\n"
        f"Strong topics: {list(context.get('strong_topic_history') or [])[:4]}\n"
        f"Attendance summary: {context.get('attendance_summary')}\n"
        f"Analytics summary: {context.get('analytics_summary')}\n"
        f"Recommended lesson titles: {[item.get('lesson_title') for item in list(context.get('recommended_lessons') or [])[:3]]}\n"
        f"Use this grounded fallback as the baseline and improve only the phrasing:\n{fallback}"
    )
    try:
        generated = generate_json(prompt)
    except AIProviderError:
        return fallback

    merged = dict(fallback)
    if _normalize(generated.get("explanation")):
        merged["explanation"] = _normalize(generated.get("explanation"))
    for key in ("key_points", "examples", "revision_plan", "challenge_questions"):
        values = generated.get(key)
        if isinstance(values, list):
            cleaned = [_normalize(item) for item in values if _normalize(item)]
            if cleaned:
                merged[key] = cleaned
    return merged


def _practice_payload(topic: str, context: dict[str, Any]) -> dict[str, Any]:
    band = _normalize(context.get("difficulty_band")).lower() or "balanced"
    if band == "support":
        questions = [
            {"level": "easy", "question": f"Define {topic} in one or two lines."},
            {"level": "easy", "question": f"Give one simple example related to {topic}."},
            {"level": "medium", "question": f"Explain one common mistake students make in {topic}."},
        ]
    elif band == "advanced":
        questions = [
            {"level": "medium", "question": f"Differentiate the key cases within {topic}."},
            {"level": "hard", "question": f"Solve a trap-style reasoning question based on {topic}."},
            {"level": "hard", "question": f"Write a challenge explanation connecting {topic} with a related chapter."},
        ]
    else:
        questions = [
            {"level": "easy", "question": f"State the basic rule behind {topic}."},
            {"level": "medium", "question": f"Apply {topic} in a standard exam-style example."},
            {"level": "medium", "question": f"Identify and correct one misconception in {topic}."},
        ]
    return {
        "practice_questions": questions,
        "answer_strategy": [
            "Question ko concept bucket me classify karo.",
            "Relevant rule ya pattern yaad karo.",
            "Last step me answer ko reason ke saath verify karo.",
        ],
    }


def _revision_payload(topic: str, context: dict[str, Any]) -> dict[str, Any]:
    lesson = next(iter(context.get("recommended_lessons") or []), {})
    flash_cards = [
        {"front": f"What is the core idea of {topic}?", "back": "Write the shortest possible accurate definition in your own words."},
        {"front": f"What is a common error in {topic}?", "back": "Confusing the rule with an exception or skipping the reasoning step."},
        {"front": f"How should you revise {topic} before a test?", "back": "Concept recap, one solved example, one fresh practice question."},
    ]
    formula_sheet = [
        f"{topic}: write the main rule or relation here.",
        "List any symbol conventions or conditions.",
        "Note one exception or caution line.",
    ]
    return {
        "chapter_summary": [
            f"{topic} ka concept base pehle clear karo.",
            "Then examples ke through apply karo.",
            "Finally traps aur exceptions revise karo.",
        ],
        "flash_cards": flash_cards,
        "formula_sheet": formula_sheet,
        "revision_notes": [
            f"LMS lesson to revisit: {_normalize(lesson.get('lesson_title')) or 'No direct lesson match found'}",
            "Weak-topic reasoning ko short bullet notes me convert karo.",
            "One-page recap banao jo test se pehle revise ho sake.",
        ],
    }


def _persist_context(
    school_id: str,
    *,
    student_id: str | None,
    profile_id: str | None,
    role_key: str,
    topic: str,
    mode: str,
    class_level: str | None,
    weak_topic_match: bool,
    context_snapshot: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> str:
    response = _ai_table("ai_learning_context").insert(
        {
            "school_id": school_id,
            "student_id": _normalize_optional_uuid(student_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "role_key": _normalize(role_key) or "student",
            "topic": topic,
            "mode": mode,
            "class_level": class_level,
            "weak_topic_match": weak_topic_match,
            "context_snapshot": context_snapshot,
            "metadata": metadata or {},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist AI learning context")
    return _normalize(rows[0].get("id"))


def _persist_recommendation(
    school_id: str,
    *,
    student_id: str | None,
    profile_id: str | None,
    context_id: str,
    recommendation_type: str,
    title: str,
    summary: str,
    priority: int,
    payload: dict[str, Any],
) -> str:
    response = _ai_table("ai_recommendations").insert(
        {
            "school_id": school_id,
            "student_id": _normalize_optional_uuid(student_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "context_id": _normalize_optional_uuid(context_id),
            "recommendation_type": recommendation_type,
            "title": title,
            "summary": summary,
            "priority": priority,
            "recommendation_payload": payload,
            "metadata": {"source": MODULE_KEY},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist AI recommendation")
    return _normalize(rows[0].get("id"))


def _persist_conversation(
    school_id: str,
    *,
    student_id: str | None,
    profile_id: str | None,
    role_key: str,
    mode: str,
    topic: str,
    user_prompt: str,
    response_text: str,
    context_id: str | None,
    recommendation_id: str | None,
    attachments: list[dict[str, Any]],
    response_payload: dict[str, Any],
    teacher_prompt: str | None,
) -> str:
    response = _ai_table("ai_conversations").insert(
        {
            "school_id": school_id,
            "student_id": _normalize_optional_uuid(student_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "context_id": _normalize_optional_uuid(context_id),
            "recommendation_id": _normalize_optional_uuid(recommendation_id),
            "role_key": _normalize(role_key) or "student",
            "mode": mode,
            "topic": topic,
            "user_prompt": user_prompt,
            "response_text": response_text,
            "attachments": attachments,
            "response_payload": response_payload,
            "teacher_prompt": teacher_prompt,
            "metadata": {"source": MODULE_KEY},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist AI conversation")
    return _normalize(rows[0].get("id"))


def _topic_from_payload(payload: dict[str, Any]) -> str:
    return (
        _normalize(payload.get("topic"))
        or _normalize(payload.get("question"))
        or _normalize(payload.get("prompt"))
        or _normalize(payload.get("problem_statement"))
    )


def _attachments_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    attachments: list[dict[str, Any]] = []
    if _normalize(payload.get("image_url")):
        attachments.append({"type": "image_url", "value": _normalize(payload.get("image_url"))})
    if _normalize(payload.get("image_reference")):
        attachments.append({"type": "image_reference", "value": _normalize(payload.get("image_reference"))})
    if _normalize(payload.get("voice_reference")):
        attachments.append({"type": "voice_reference", "value": _normalize(payload.get("voice_reference"))})
    return attachments


def list_ai_conversations(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    target_student_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    normalized_target_student_id = _normalize(target_student_id) or None
    student = _resolve_student_context(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=normalized_target_student_id,
    )
    query = (
        _ai_table("ai_conversations")
        .select("id,school_id,student_id,profile_id,role_key,mode,topic,user_prompt,response_text,teacher_prompt,attachments,metadata,created_at")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(max(1, min(limit, 100)))
    )
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        if not student:
            return []
        query = query.eq("student_id", _normalize(student.get("id")))
    elif normalized_target_student_id:
        query = query.eq("student_id", normalized_target_student_id)

    rows = list(query.execute().data or [])
    student_names: dict[str, str] = {}
    if rows:
        student_ids = sorted({_normalize(row.get("student_id")) for row in rows if _normalize(row.get("student_id"))})
        if student_ids:
            student_rows = list(
                _public_table("students")
                .select("id,full_name")
                .eq("school_id", school_id)
                .in_("id", student_ids)
                .execute()
                .data
                or []
            )
            student_names = {_normalize(row.get("id")): _normalize(row.get("full_name")) for row in student_rows}

    return [
        {
            **dict(row),
            "student_name": student_names.get(_normalize(row.get("student_id"))) or None,
            "attachments": _normalize_json_list(row.get("attachments")),
            "metadata": _normalize_json_object(row.get("metadata")),
        }
        for row in rows
    ]


def _tutor_response(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    mode: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    topic = _topic_from_payload(payload)
    if not topic:
        raise HTTPException(status_code=400, detail="topic or question is required")
    target_student_id = _normalize(payload.get("target_student_id")) or None
    student = _resolve_student_context(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=target_student_id,
    )
    context = _build_context_snapshot(school_id, role_key=role_key, topic=topic, student=student)
    explanation_block = _explanation_sections(topic, context)
    practice_block = _practice_payload(topic, context)
    revision_block = _revision_payload(topic, context)

    response_text = explanation_block["explanation"]
    if mode == "practice":
        response_text = f"Practice set for {topic} generated using your recent performance and recommended lesson path."
    elif mode == "revision":
        response_text = f"Revision pack for {topic} generated from your lesson, test, and weak-topic history."

    context_id = _persist_context(
        school_id,
        student_id=_normalize((student or {}).get("id")) or None,
        profile_id=profile_id,
        role_key=role_key,
        topic=topic,
        mode=mode,
        class_level=_normalize(context.get("class_level")) or None,
        weak_topic_match=bool(context.get("topic_performance", {}).get("matched")),
        context_snapshot=context,
        metadata={"requested_mode": mode},
    )
    recommendation_payload = {
        "recommended_lessons": context.get("recommended_lessons"),
        "recommended_recordings": context.get("recommended_recordings"),
        "recommended_assignments": context.get("recommended_assignments"),
        "recommended_tests": context.get("recommended_tests"),
    }
    recommendation_id = _persist_recommendation(
        school_id,
        student_id=_normalize((student or {}).get("id")) or None,
        profile_id=profile_id,
        context_id=context_id,
        recommendation_type="lesson" if context.get("recommended_lessons") else "revision",
        title=f"{topic} personalized path",
        summary="Grounded recommendations generated from LMS, tests, analytics, study planner, and live classes.",
        priority=1,
        payload=recommendation_payload,
    )
    response_payload = {
        "mode": mode,
        "topic": topic,
        "student_profile": {
            "student_id": _normalize((student or {}).get("id")) or None,
            "student_name": _normalize((student or {}).get("full_name")) or None,
            "class_level": context.get("class_level"),
            "difficulty_band": context.get("difficulty_band"),
        },
        "personalization": {
            "weak_topic_history": context.get("weak_topic_history"),
            "strong_topic_history": context.get("strong_topic_history"),
            "previous_test_count": context.get("previous_test_count"),
            "topic_performance": context.get("topic_performance"),
        },
        "explanation": explanation_block["explanation"],
        "key_points": explanation_block["key_points"],
        "examples": explanation_block["examples"],
        "revision_plan": explanation_block["revision_plan"],
        "challenge_questions": explanation_block["challenge_questions"],
        "practice_questions": practice_block["practice_questions"],
        "answer_strategy": practice_block["answer_strategy"],
        "chapter_summary": revision_block["chapter_summary"],
        "revision_notes": revision_block["revision_notes"],
        "flash_cards": revision_block["flash_cards"],
        "formula_sheet": revision_block["formula_sheet"],
        "recommended_lessons": context.get("recommended_lessons"),
        "recommended_recordings": context.get("recommended_recordings"),
        "recommended_assignments": context.get("recommended_assignments"),
        "recommended_tests": context.get("recommended_tests"),
        "planner_hits": context.get("planner_hits"),
        "analytics_summary": context.get("analytics_summary"),
        "attendance_summary": context.get("attendance_summary"),
        "generated_at": _utc_now_iso(),
    }
    conversation_id = _persist_conversation(
        school_id,
        student_id=_normalize((student or {}).get("id")) or None,
        profile_id=profile_id,
        role_key=role_key,
        mode=mode,
        topic=topic,
        user_prompt=_normalize(payload.get("question") or payload.get("prompt") or payload.get("problem_statement") or topic),
        response_text=response_text,
        context_id=context_id,
        recommendation_id=recommendation_id,
        attachments=_attachments_from_payload(payload),
        response_payload=response_payload,
        teacher_prompt=_normalize(payload.get("teacher_prompt")) or None,
    )
    response_payload["conversation_id"] = conversation_id
    response_payload["context_id"] = context_id
    response_payload["recommendation_id"] = recommendation_id
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action=f"ai_tutor.{mode}.generated",
        payload={"topic": topic, "student_id": _normalize((student or {}).get("id")) or None},
    )
    return response_payload


def tutor_chat(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return _tutor_response(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, mode="chat", payload=payload)


def tutor_explain(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return _tutor_response(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, mode="explain", payload=payload)


def tutor_practice(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return _tutor_response(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, mode="practice", payload=payload)


def tutor_revision(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return _tutor_response(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, mode="revision", payload=payload)
