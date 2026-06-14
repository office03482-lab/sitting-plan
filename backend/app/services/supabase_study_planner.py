"""AI-powered academic planner built on top of existing ERP, LMS, tests, and analytics data."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_analytics import (
    _get_student_by_profile_id,
    get_batch_analytics,
    get_platform_analytics,
    get_school_analytics,
    get_student_analytics,
)
from app.services.supabase_lms import _list_parent_linked_students, get_progress_dashboard, list_assignments, list_courses
from app.services.supabase_online_tests import list_results, list_tests

MODULE_KEY = "study_planner"
ANALYTICS_SCHEMA = "analytics"
ATTENDANCE_SCHEMA = "attendance"
ACADEMIC_SCHEMA = "academic"
LMS_SCHEMA = "lms"
SCHEDULING_SCHEMA = "scheduling"

DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _today_local() -> date:
    return _utc_now().date()


def _day_name(value: date) -> str:
    return DAY_NAMES[value.weekday()]


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


def _safe_percentage(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100, 2)


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


def _get_student(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


def _list_school_students(school_id: str) -> list[dict[str, Any]]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_student_attendance_rows(school_id: str, student_id: str, *, days: int = 30) -> list[dict[str, Any]]:
    start_date = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ATTENDANCE_SCHEMA, "student_attendance")
        .select("attendance_date,status,subject_id,metadata")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .gte("attendance_date", start_date)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_live_attendance_rows(school_id: str, student_id: str, *, days: int = 30) -> list[dict[str, Any]]:
    start_iso = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ACADEMIC_SCHEMA, "live_class_attendance")
        .select("session_id,join_timestamp,leave_timestamp,total_duration_seconds,attendance_percentage,attendance_status,metadata")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .gte("created_at", start_iso)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_student_progress_rows(school_id: str, student_id: str) -> list[dict[str, Any]]:
    rows = list(
        _schema_table(LMS_SCHEMA, "student_progress")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_assignment_submissions(school_id: str, student_id: str) -> list[dict[str, Any]]:
    rows = list(
        _schema_table(LMS_SCHEMA, "assignment_submissions")
        .select("assignment_id,status,submitted_at,graded_at")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_timetable_rows(school_id: str, student: dict[str, Any], *, on_date: date | None = None) -> list[dict[str, Any]]:
    query = (
        _schema_table(SCHEDULING_SCHEMA, "timetable_entries")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    class_name = _normalize(student.get("class_name"))
    if class_name:
        query = query.ilike("class_name", f"%{class_name}%")
    rows = [dict(row) for row in list(query.execute().data or [])]
    if on_date is not None:
        day_of_week = _day_name(on_date)
        rows = [row for row in rows if _normalize(row.get("day_of_week")).lower() == day_of_week]
    return rows


def _load_recent_live_sessions(school_id: str, student: dict[str, Any]) -> list[dict[str, Any]]:
    timetable_ids = [_normalize(row.get("id")) for row in _load_timetable_rows(school_id, student)]
    if not timetable_ids:
        return []
    rows = list(
        _schema_table(ACADEMIC_SCHEMA, "live_class_sessions")
        .select("*")
        .eq("school_id", school_id)
        .in_("timetable_entry_id", timetable_ids)
        .is_("deleted_at", "null")
        .order("session_date", desc=True)
        .limit(12)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _study_active_dates(
    progress_rows: list[dict[str, Any]],
    result_rows: list[dict[str, Any]],
    live_rows: list[dict[str, Any]],
    submission_rows: list[dict[str, Any]],
) -> set[str]:
    active_dates: set[str] = set()
    for row in progress_rows:
        value = _normalize(row.get("updated_at") or row.get("last_accessed_at") or row.get("completed_at"))
        if value:
            active_dates.add(value[:10])
    for row in result_rows:
        value = _normalize(row.get("created_at") or row.get("published_at"))
        if value:
            active_dates.add(value[:10])
    for row in live_rows:
        value = _normalize(row.get("join_timestamp"))
        if value:
            active_dates.add(value[:10])
    for row in submission_rows:
        value = _normalize(row.get("submitted_at") or row.get("graded_at"))
        if value:
            active_dates.add(value[:10])
    return active_dates


def _compute_streak(active_dates: set[str]) -> int:
    streak = 0
    current_day = _today_local()
    while current_day.isoformat() in active_dates:
        streak += 1
        current_day -= timedelta(days=1)
    return streak


def _badge_payload(streak_count: int, completion_percentage: float, attendance_percentage: float) -> list[str]:
    badges: list[str] = []
    if streak_count >= 3:
        badges.append("Consistency Starter")
    if streak_count >= 7:
        badges.append("7-Day Streak")
    if completion_percentage >= 75:
        badges.append("Task Finisher")
    if attendance_percentage >= 90:
        badges.append("Attendance Champion")
    return badges


def _achievement_level(streak_count: int, completion_percentage: float) -> str:
    score = streak_count * 8 + completion_percentage
    if score >= 140:
        return "Scholar"
    if score >= 100:
        return "Advanced"
    if score >= 60:
        return "Focused"
    return "Starter"


def _risk_level(attendance_percentage: float, completion_percentage: float, weak_topics: list[str]) -> str:
    if attendance_percentage < 60 or completion_percentage < 40:
        return "high"
    if attendance_percentage < 75 or completion_percentage < 60 or len(weak_topics) >= 3:
        return "medium"
    return "low"


def _task(
    *,
    task_type: str,
    title: str,
    description: str,
    estimated_minutes: int,
    priority: int,
    subject_name: str | None = None,
    chapter_name: str | None = None,
    recommended_resource_type: str | None = None,
    recommended_resource_id: str | None = None,
    recommended_resource_url: str | None = None,
    source_module: str | None = None,
    source_entity_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "task_type": task_type,
        "title": title,
        "description": description,
        "subject_name": subject_name,
        "chapter_name": chapter_name,
        "recommended_resource_type": recommended_resource_type,
        "recommended_resource_id": _normalize_optional_uuid(recommended_resource_id) if recommended_resource_id else None,
        "recommended_resource_url": recommended_resource_url,
        "estimated_minutes": max(int(estimated_minutes), 0),
        "priority": max(min(int(priority), 5), 1),
        "status": "pending",
        "source_module": source_module,
        "source_entity_id": _normalize_optional_uuid(source_entity_id) if source_entity_id else None,
        "metadata": metadata or {},
    }


def _persist_plan_snapshot(
    school_id: str,
    student_id: str,
    profile_id: str | None,
    scope: str,
    plan_date: date,
    plan_payload: dict[str, Any],
) -> str:
    existing = list(
        _schema_table(ANALYTICS_SCHEMA, "study_plans")
        .select("id")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("scope", scope)
        .eq("plan_date", plan_date.isoformat())
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    row = {
        "school_id": school_id,
        "student_id": student_id,
        "generated_by_profile_id": _normalize_optional_uuid(profile_id),
        "scope": scope,
        "plan_date": plan_date.isoformat(),
        "exam_mode": plan_payload.get("exam_mode"),
        "total_estimated_minutes": _safe_int(plan_payload.get("total_estimated_minutes")),
        "completion_percentage": _safe_float(plan_payload.get("completion_percentage")),
        "streak_count": _safe_int(plan_payload.get("streak_count")),
        "badges": list(plan_payload.get("badges") or []),
        "milestones": list(plan_payload.get("milestones") or []),
        "summary": _normalize_json_object(plan_payload.get("summary")),
        "metadata": _normalize_json_object(plan_payload.get("metadata")),
        "is_active": True,
        "deleted_at": None,
    }
    if existing:
        plan_id = _normalize(existing[0].get("id"))
        _schema_table(ANALYTICS_SCHEMA, "study_plans").update(row).eq("id", plan_id).execute()
    else:
        response = _schema_table(ANALYTICS_SCHEMA, "study_plans").insert(row).execute()
        rows = list(response.data or [])
        if not rows:
            raise HTTPException(status_code=500, detail="Failed to persist study plan snapshot")
        plan_id = _normalize(rows[0].get("id"))

    _schema_table(ANALYTICS_SCHEMA, "study_tasks").update(
        {"is_active": False, "deleted_at": _utc_now_iso()}
    ).eq("plan_id", plan_id).is_("deleted_at", "null").execute()

    task_payload = []
    for task in list(plan_payload.get("tasks") or []):
        task_payload.append(
            {
                "school_id": school_id,
                "plan_id": plan_id,
                "student_id": student_id,
                "task_type": task.get("task_type") or "revision",
                "title": task.get("title") or "Study task",
                "description": task.get("description"),
                "subject_name": task.get("subject_name"),
                "chapter_name": task.get("chapter_name"),
                "recommended_resource_type": task.get("recommended_resource_type"),
                "recommended_resource_id": _normalize_optional_uuid(task.get("recommended_resource_id")),
                "recommended_resource_url": task.get("recommended_resource_url"),
                "estimated_minutes": _safe_int(task.get("estimated_minutes")),
                "priority": _safe_int(task.get("priority") or 1),
                "status": task.get("status") or "pending",
                "source_module": task.get("source_module"),
                "source_entity_id": _normalize_optional_uuid(task.get("source_entity_id")),
                "metadata": _normalize_json_object(task.get("metadata")),
                "is_active": True,
            }
        )
    if task_payload:
        _schema_table(ANALYTICS_SCHEMA, "study_tasks").insert(task_payload).execute()
    return plan_id


def _replace_recommendations(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    student_id: str | None,
    recommendation_scope: str,
    items: list[dict[str, Any]],
) -> None:
    query = (
        _schema_table(ANALYTICS_SCHEMA, "recommendations")
        .update({"is_active": False, "deleted_at": _utc_now_iso()})
        .eq("school_id", school_id)
        .eq("role_key", role_key)
        .eq("recommendation_scope", recommendation_scope)
        .is_("deleted_at", "null")
    )
    if student_id:
        query = query.eq("student_id", student_id)
    elif profile_id:
        query = query.eq("profile_id", profile_id)
    query.execute()

    if not items:
        return

    payload = []
    for item in items:
        payload.append(
            {
                "school_id": school_id,
                "student_id": _normalize_optional_uuid(student_id),
                "profile_id": _normalize_optional_uuid(profile_id),
                "role_key": role_key,
                "recommendation_scope": recommendation_scope,
                "recommendation_type": item.get("recommendation_type") or "lesson",
                "title": item.get("title") or "Recommendation",
                "summary": item.get("summary"),
                "payload": _normalize_json_object(item.get("payload")),
                "score": _safe_float(item.get("score")),
                "generated_at": _utc_now_iso(),
                "metadata": _normalize_json_object(item.get("metadata")),
                "is_active": True,
            }
        )
    _schema_table(ANALYTICS_SCHEMA, "recommendations").insert(payload).execute()


def _build_student_plan_payload(
    school_id: str,
    student: dict[str, Any],
    *,
    on_date: date,
    scope: str,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    student_id = _normalize(student.get("id"))
    analytics = get_student_analytics(school_id, student_id, actor_profile_id=actor_profile_id)
    progress_dashboard = get_progress_dashboard(school_id, student=student)
    assignments = list_assignments(school_id, student=student)
    test_results = list_results(school_id, student_id=student_id, limit=20)
    available_tests = list_tests(school_id, student_batch_id=_normalize(student.get("batch_id")) or None, limit=8)
    progress_rows = _load_student_progress_rows(school_id, student_id)
    live_attendance_rows = _load_live_attendance_rows(school_id, student_id)
    attendance_rows = _load_student_attendance_rows(school_id, student_id)
    submission_rows = _load_assignment_submissions(school_id, student_id)
    timetable_rows = _load_timetable_rows(school_id, student, on_date=on_date)
    recent_live_sessions = _load_recent_live_sessions(school_id, student)

    weak_topics = list(analytics.get("weak_topics") or [])[:3]
    strong_topics = list(analytics.get("strong_topics") or [])[:3]
    subject_performance = list(analytics.get("subject_percentages") or [])
    weak_subjects = [item.get("subject_name") for item in subject_performance[:2] if item.get("subject_name")]
    chapter_performance = list(analytics.get("chapter_percentages") or [])
    recurring_mistakes = [item.get("chapter_name") for item in chapter_performance[:3] if _safe_float(item.get("percentage")) < 60]

    progress_items = list(progress_dashboard.get("progress_items") or [])
    incomplete_progress = [
        item for item in progress_items if not bool(item.get("is_completed")) or _safe_float(item.get("watch_percentage")) < 75
    ]
    enrolled_courses = list(progress_dashboard.get("enrolled_courses") or [])
    recommended_lessons = list(progress_dashboard.get("ai_insights", {}).get("recommended_lessons") or [])
    recommended_tests = list(progress_dashboard.get("ai_insights", {}).get("recommended_tests") or [])

    due_assignments = [
        item for item in assignments
        if _normalize(item.get("status")).lower() in {"published", "closed"}
        and not item.get("submission")
    ][:3]

    missed_live_sessions = [
        session for session in recent_live_sessions
        if session.get("recording_url")
        and any(_normalize(row.get("session_id")) == _normalize(session.get("id")) and _safe_float(row.get("attendance_percentage")) < 75 for row in live_attendance_rows)
    ]

    tasks: list[dict[str, Any]] = []

    for topic in weak_topics[:2]:
        tasks.append(
            _task(
                task_type="revision",
                title=f"Revise {topic}",
                description=f"Strengthen the weak topic {topic} with short concept review and formula recall.",
                estimated_minutes=35,
                priority=1,
                subject_name=weak_subjects[0] if weak_subjects else None,
                chapter_name=topic,
                source_module="analytics",
                metadata={"reason": "weak_topic"},
            )
        )

    for lesson_title in recommended_lessons[:1]:
        tasks.append(
            _task(
                task_type="lecture",
                title=f"Watch {lesson_title}",
                description="Continue the highest-impact LMS lesson recommended by the analytics engine.",
                estimated_minutes=45,
                priority=2,
                recommended_resource_type="lesson",
                source_module="lms",
                metadata={"reason": "recommended_lesson"},
            )
        )

    for assignment in due_assignments[:1]:
        tasks.append(
            _task(
                task_type="assignment",
                title=f"Complete {assignment.get('title')}",
                description=f"Finish the pending assignment due on {_normalize(assignment.get('due_at'))[:10] or 'the upcoming schedule'}.",
                estimated_minutes=40,
                priority=2,
                recommended_resource_type="assignment",
                recommended_resource_id=_normalize(assignment.get("id")) or None,
                source_module="lms",
                source_entity_id=_normalize(assignment.get("id")) or None,
                metadata={"reason": "pending_assignment"},
            )
        )

    recommended_test_title = recommended_tests[0] if recommended_tests else (_normalize((available_tests[0] if available_tests else {}).get("title")) or "")
    if recommended_test_title:
        target_test = next((item for item in available_tests if _normalize(item.get("title")) == recommended_test_title), None)
        tasks.append(
            _task(
                task_type="test",
                title=f"Attempt {recommended_test_title}",
                description="Take a focused practice test to improve retention and exam speed.",
                estimated_minutes=50,
                priority=3,
                recommended_resource_type="test",
                recommended_resource_id=_normalize((target_test or {}).get("id")) or None,
                source_module="online_tests",
                source_entity_id=_normalize((target_test or {}).get("id")) or None,
                metadata={"reason": "recommended_test"},
            )
        )

    if missed_live_sessions:
        missed_session = missed_live_sessions[0]
        tasks.append(
            _task(
                task_type="live_class",
                title="Catch up with missed live class",
                description=f"Watch the recording for the missed {missed_session.get('provider')} session and review notes.",
                estimated_minutes=35,
                priority=3,
                recommended_resource_type="recording",
                recommended_resource_url=missed_session.get("recording_url"),
                source_module="live_classes",
                source_entity_id=_normalize(missed_session.get("id")) or None,
                metadata={"reason": "missed_live_class"},
            )
        )

    if not tasks and incomplete_progress:
        fallback_item = incomplete_progress[0]
        tasks.append(
            _task(
                task_type="practice",
                title="Resume incomplete learning task",
                description="Continue your most recently accessed incomplete lesson to maintain consistency.",
                estimated_minutes=30,
                priority=2,
                source_module="lms",
                metadata={"reason": "fallback_incomplete_progress"},
            )
        )

    tasks = tasks[:5]
    total_estimated_minutes = sum(_safe_int(task.get("estimated_minutes")) for task in tasks)

    attendance_present_days = len([row for row in attendance_rows if _normalize(row.get("status")).lower() == "present"])
    attendance_percentage = _safe_percentage(attendance_present_days, max(len(attendance_rows), 1))
    active_dates = _study_active_dates(progress_rows, test_results, live_attendance_rows, submission_rows)
    streak_count = _compute_streak(active_dates)
    completion_percentage = round(sum(_safe_float(item.get("course_completion_percentage")) for item in progress_items) / len(progress_items), 2) if progress_items else 0.0
    watch_completion_percentage = round(sum(_safe_float(item.get("watch_percentage")) for item in progress_items) / len(progress_items), 2) if progress_items else 0.0
    live_attendance_percentage = round(sum(_safe_float(row.get("attendance_percentage")) for row in live_attendance_rows) / len(live_attendance_rows), 2) if live_attendance_rows else 0.0

    badges = _badge_payload(streak_count, completion_percentage, attendance_percentage)
    level = _achievement_level(streak_count, completion_percentage)
    risk = _risk_level(attendance_percentage, completion_percentage, weak_topics)

    milestones = [
        f"{len(tasks)} focused tasks generated for {_day_name(on_date).title()}",
        f"Current level: {level}",
        f"{len(enrolled_courses)} enrolled courses tracked",
    ]

    exam_mode = _normalize(_normalize_json_object(student.get("metadata")).get("preferred_exam_mode")) or (
        "board_exams" if "board" in " ".join(weak_subjects).lower() else "custom_school_exams"
    )

    summary = {
        "student_id": student_id,
        "student_name": _normalize(student.get("full_name")) or "Student",
        "scope": scope,
        "plan_date": on_date.isoformat(),
        "exam_mode": exam_mode,
        "attendance_percentage": attendance_percentage,
        "live_class_attendance_percentage": live_attendance_percentage,
        "course_completion_percentage": completion_percentage,
        "watch_completion_percentage": watch_completion_percentage,
        "study_consistency": streak_count,
        "weak_topics": weak_topics,
        "strong_topics": strong_topics,
        "weak_subjects": [item for item in weak_subjects if item],
        "recurring_mistakes": [item for item in recurring_mistakes if item],
        "expected_study_time_label": f"{total_estimated_minutes // 60}h {total_estimated_minutes % 60}m" if total_estimated_minutes >= 60 else f"{total_estimated_minutes}m",
    }

    payload = {
        "role": "student",
        "scope": scope,
        "plan_date": on_date.isoformat(),
        "exam_mode": exam_mode,
        "target_student_id": student_id,
        "target_student_name": _normalize(student.get("full_name")) or "Student",
        "total_estimated_minutes": total_estimated_minutes,
        "completion_percentage": completion_percentage,
        "streak_count": streak_count,
        "badges": badges,
        "milestones": milestones,
        "achievement_level": level,
        "risk_level": risk,
        "tasks": tasks,
        "summary": summary,
        "metadata": {
            "attendance_rows": len(attendance_rows),
            "live_attendance_rows": len(live_attendance_rows),
            "results_count": len(test_results),
            "available_tests": len(available_tests),
            "timetable_today_count": len(timetable_rows),
        },
        "generated_at": _utc_now_iso(),
    }
    return payload


def _week_payload_from_today(today_payload: dict[str, Any]) -> dict[str, Any]:
    today_date = date.fromisoformat(_normalize(today_payload.get("plan_date")))
    tomorrow_date = today_date + timedelta(days=1)
    tasks = list(today_payload.get("tasks") or [])
    tomorrow_tasks = [dict(task, title=f"Follow-up: {task.get('title')}") for task in tasks[:3]]
    weekly_focus = [task.get("title") for task in tasks[:4]]
    monthly_focus = [
        *list(today_payload.get("summary", {}).get("weak_topics") or [])[:2],
        *list(today_payload.get("summary", {}).get("weak_subjects") or [])[:2],
    ]
    monthly_focus = [item for item in monthly_focus if item]
    return {
        "role": today_payload.get("role"),
        "target_student_id": today_payload.get("target_student_id"),
        "target_student_name": today_payload.get("target_student_name"),
        "today_plan": today_payload,
        "tomorrow_plan": {
            **today_payload,
            "scope": "tomorrow",
            "plan_date": tomorrow_date.isoformat(),
            "tasks": tomorrow_tasks,
            "summary": {
                **_normalize_json_object(today_payload.get("summary")),
                "plan_date": tomorrow_date.isoformat(),
            },
        },
        "weekly_plan": {
            "scope": "week",
            "weekly_focus": weekly_focus,
            "weekly_hours_target": round((_safe_int(today_payload.get("total_estimated_minutes")) * 5) / 60, 1),
            "revision_sessions": len([task for task in tasks if task.get("task_type") == "revision"]) * 2,
        },
        "monthly_plan": {
            "scope": "month",
            "monthly_focus": monthly_focus,
            "exam_mode": today_payload.get("exam_mode"),
            "milestone_target": "Improve weak topics by one performance band before the next exam cycle",
        },
        "streak_count": _safe_int(today_payload.get("streak_count")),
        "badges": list(today_payload.get("badges") or []),
        "milestones": list(today_payload.get("milestones") or []),
        "generated_at": _utc_now_iso(),
    }


def _teacher_risk_dashboard(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    students = _list_school_students(school_id)
    student_payloads = [_build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=actor_profile_id) for student in students[:50]]
    ranked = sorted(
        student_payloads,
        key=lambda item: (
            {"high": 3, "medium": 2, "low": 1}.get(_normalize(item.get("risk_level")).lower(), 0),
            -_safe_float(item.get("completion_percentage")),
        ),
        reverse=True,
    )
    at_risk_students = [
        {
            "student_id": item.get("target_student_id"),
            "student_name": item.get("target_student_name"),
            "risk_level": item.get("risk_level"),
            "completion_percentage": item.get("completion_percentage"),
            "streak_count": item.get("streak_count"),
            "weak_topics": list(_normalize_json_object(item.get("summary")).get("weak_topics") or [])[:3],
        }
        for item in ranked[:8]
    ]
    low_engagement_students = [
        item for item in at_risk_students if _safe_int(item.get("streak_count")) <= 1 or _safe_float(item.get("completion_percentage")) < 50
    ][:8]

    cluster_counter: Counter[str] = Counter()
    for item in student_payloads:
        for topic in list(_normalize_json_object(item.get("summary")).get("weak_topics") or [])[:3]:
            cluster_counter[_normalize(topic)] += 1
    weak_topic_clusters = [
        {"topic_name": topic, "student_count": count}
        for topic, count in cluster_counter.most_common(5)
        if topic
    ]

    recommendation_items = [
        {
            "recommendation_type": "risk_alert",
            "title": f"Support {item['student_name']}",
            "summary": f"{item['student_name']} is {item['risk_level']} risk with {item['completion_percentage']}% planner completion.",
            "score": 100 - _safe_float(item.get("completion_percentage")),
            "payload": item,
            "metadata": {"group": "at_risk_student"},
        }
        for item in at_risk_students[:5]
    ]
    _replace_recommendations(
        school_id,
        role_key="teacher",
        profile_id=actor_profile_id,
        student_id=None,
        recommendation_scope="teacher",
        items=recommendation_items,
    )
    return {
        "role": "teacher",
        "at_risk_students": at_risk_students,
        "low_engagement_students": low_engagement_students,
        "weak_topic_clusters": weak_topic_clusters,
        "generated_at": _utc_now_iso(),
    }


def _parent_dashboard(school_id: str, linked_students: list[dict[str, Any]], *, actor_profile_id: str | None = None) -> dict[str, Any]:
    plans = [_build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=actor_profile_id) for student in linked_students]
    child_summaries = []
    for item in plans:
        summary = _normalize_json_object(item.get("summary"))
        child_summaries.append(
            {
                "student_id": item.get("target_student_id"),
                "student_name": item.get("target_student_name"),
                "study_consistency": item.get("streak_count"),
                "completion_percentage": item.get("completion_percentage"),
                "missed_tasks": max(len(list(item.get("tasks") or [])) - round((len(list(item.get("tasks") or [])) * _safe_float(item.get("completion_percentage")) / 100)), 0),
                "risk_alert": item.get("risk_level"),
                "weak_topics": list(summary.get("weak_topics") or [])[:3],
            }
        )
    recommendation_items = [
        {
            "recommendation_type": "risk_alert",
            "title": f"Check {child['student_name']}'s study rhythm",
            "summary": f"{child['student_name']} has {child['completion_percentage']}% completion and {child['study_consistency']} active streak days.",
            "score": 100 - _safe_float(child.get("completion_percentage")),
            "payload": child,
            "metadata": {"group": "parent_view"},
        }
        for child in child_summaries[:5]
    ]
    _replace_recommendations(
        school_id,
        role_key="parent",
        profile_id=actor_profile_id,
        student_id=None,
        recommendation_scope="parent",
        items=recommendation_items,
    )
    return {
        "role": "parent",
        "children": child_summaries,
        "plans": plans,
        "generated_at": _utc_now_iso(),
    }


def get_today_planner(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None = None,
) -> dict[str, Any]:
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        student = _get_student_by_profile_id(school_id, profile_id)
        payload = _build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=profile_id)
        _persist_plan_snapshot(school_id, _normalize(student.get("id")), profile_id, "today", _today_local(), payload)
        _replace_recommendations(
            school_id,
            role_key="student",
            profile_id=profile_id,
            student_id=_normalize(student.get("id")),
            recommendation_scope="student",
            items=[
                {
                    "recommendation_type": task.get("task_type"),
                    "title": task.get("title"),
                    "summary": task.get("description"),
                    "payload": task,
                    "score": 100 - (_safe_int(task.get("priority")) * 10),
                    "metadata": {"group": "today_plan"},
                }
                for task in list(payload.get("tasks") or [])[:5]
            ],
        )
        _log_audit_entry(school_id=school_id, profile_id=profile_id, action="study_planner.today.generated", payload={"student_id": student.get("id")})
        return payload
    if normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        return _parent_dashboard(school_id, linked_students, actor_profile_id=profile_id)
    if normalized_role in {"teacher", "school_admin", "platform_admin", "admin"}:
        dashboard = _teacher_risk_dashboard(school_id, actor_profile_id=profile_id)
        _log_audit_entry(school_id=school_id, profile_id=profile_id, action="study_planner.teacher_today.generated", payload={"role": normalized_role})
        return dashboard
    raise HTTPException(status_code=403, detail="Unsupported role for study planner")


def get_week_planner(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None = None,
) -> dict[str, Any]:
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        student = _get_student_by_profile_id(school_id, profile_id or "")
        today_payload = _build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=profile_id)
        week_payload = _week_payload_from_today(today_payload)
        tomorrow_payload = dict(week_payload.get("tomorrow_plan") or {})
        _persist_plan_snapshot(school_id, _normalize(student.get("id")), profile_id, "today", _today_local(), today_payload)
        _persist_plan_snapshot(school_id, _normalize(student.get("id")), profile_id, "tomorrow", _today_local() + timedelta(days=1), tomorrow_payload)
        _persist_plan_snapshot(
            school_id,
            _normalize(student.get("id")),
            profile_id,
            "week",
            _today_local(),
            {
                **today_payload,
                "scope": "week",
                "tasks": list(today_payload.get("tasks") or []),
                "summary": _normalize_json_object(week_payload.get("weekly_plan")),
                "total_estimated_minutes": _safe_int(today_payload.get("total_estimated_minutes")) * 5,
            },
        )
        _persist_plan_snapshot(
            school_id,
            _normalize(student.get("id")),
            profile_id,
            "month",
            _today_local(),
            {
                **today_payload,
                "scope": "month",
                "tasks": list(today_payload.get("tasks") or []),
                "summary": _normalize_json_object(week_payload.get("monthly_plan")),
                "total_estimated_minutes": _safe_int(today_payload.get("total_estimated_minutes")) * 20,
            },
        )
        return week_payload
    if normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        child_payloads = []
        for student in linked_students:
            today_payload = _build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=profile_id)
            child_payloads.append(_week_payload_from_today(today_payload))
        return {"role": "parent", "children": child_payloads, "generated_at": _utc_now_iso()}
    if normalized_role in {"teacher", "school_admin", "platform_admin", "admin"}:
        teacher_payload = _teacher_risk_dashboard(school_id, actor_profile_id=profile_id)
        teacher_payload["weekly_plan"] = {
            "cluster_focus": [item.get("topic_name") for item in list(teacher_payload.get("weak_topic_clusters") or [])[:3]],
            "intervention_count": len(list(teacher_payload.get("at_risk_students") or [])),
        }
        teacher_payload["monthly_plan"] = {
            "school_snapshot": get_school_analytics(school_id, actor_profile_id=profile_id),
            "platform_snapshot": get_platform_analytics(actor_profile_id=profile_id) if normalized_role == "platform_admin" else None,
        }
        return teacher_payload
    raise HTTPException(status_code=403, detail="Unsupported role for study planner")


def get_study_recommendations(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None = None,
) -> dict[str, Any]:
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        student = _get_student_by_profile_id(school_id, profile_id or "")
        today_payload = _build_student_plan_payload(school_id, student, on_date=_today_local(), scope="today", actor_profile_id=profile_id)
        items = [
            {
                "recommendation_type": task.get("task_type"),
                "title": task.get("title"),
                "summary": task.get("description"),
                "score": 100 - (_safe_int(task.get("priority")) * 10),
                "payload": task,
            }
            for task in list(today_payload.get("tasks") or [])
        ]
        _replace_recommendations(
            school_id,
            role_key="student",
            profile_id=profile_id,
            student_id=_normalize(student.get("id")),
            recommendation_scope="student",
            items=items,
        )
        return {
            "role": "student",
            "weak_topics": list(_normalize_json_object(today_payload.get("summary")).get("weak_topics") or []),
            "weak_subjects": list(_normalize_json_object(today_payload.get("summary")).get("weak_subjects") or []),
            "recurring_mistakes": list(_normalize_json_object(today_payload.get("summary")).get("recurring_mistakes") or []),
            "recommendations": items,
            "generated_at": _utc_now_iso(),
        }
    if normalized_role == "parent":
        return _parent_dashboard(school_id, _list_parent_linked_students(school_id, profile_id, user_email), actor_profile_id=profile_id)
    if normalized_role in {"teacher", "school_admin", "platform_admin", "admin"}:
        dashboard = _teacher_risk_dashboard(school_id, actor_profile_id=profile_id)
        if normalized_role in {"school_admin", "platform_admin", "admin"}:
            dashboard["school_view"] = get_school_analytics(school_id, actor_profile_id=profile_id)
        if normalized_role == "platform_admin":
            dashboard["platform_view"] = get_platform_analytics(actor_profile_id=profile_id)
        return dashboard
    raise HTTPException(status_code=403, detail="Unsupported role for study planner")


def create_learning_goal(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    payload: dict[str, Any],
    user_email: str | None = None,
) -> dict[str, Any]:
    normalized_role = _normalize(role_key).lower()
    target_student_id = _normalize_optional_uuid(payload.get("target_student_id"))

    if normalized_role == "student":
        student = _get_student_by_profile_id(school_id, profile_id or "")
        target_student_id = _normalize(student.get("id"))
    elif normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        linked_ids = {_normalize(item.get("id")) for item in linked_students}
        if not target_student_id or target_student_id not in linked_ids:
            raise HTTPException(status_code=403, detail="Parents can create goals only for linked students")
    elif normalized_role not in {"teacher", "school_admin", "platform_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Unsupported role for learning goals")

    if not target_student_id:
        raise HTTPException(status_code=400, detail="target_student_id is required")
    target_student = _get_student(school_id, target_student_id)
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="Goal title is required")

    insert_payload = {
        "school_id": school_id,
        "student_id": target_student_id,
        "created_by_profile_id": _normalize_optional_uuid(profile_id),
        "goal_type": _normalize(payload.get("goal_type")) or "daily",
        "exam_mode": _normalize(payload.get("exam_mode")) or None,
        "title": title,
        "description": payload.get("description"),
        "target_date": _normalize(payload.get("target_date")) or None,
        "target_value": _safe_float(payload.get("target_value")) if payload.get("target_value") is not None else None,
        "current_value": _safe_float(payload.get("current_value")),
        "status": _normalize(payload.get("status")) or "active",
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
    }
    response = _schema_table(ANALYTICS_SCHEMA, "learning_goals").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create learning goal")
    created = dict(rows[0])
    _replace_recommendations(
        school_id,
        role_key=normalized_role or "student",
        profile_id=profile_id,
        student_id=target_student_id,
        recommendation_scope="student" if normalized_role == "student" else "teacher",
        items=[
            {
                "recommendation_type": "goal",
                "title": title,
                "summary": payload.get("description") or f"Goal created for {_normalize(target_student.get('full_name'))}",
                "score": 95,
                "payload": created,
            }
        ],
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="study_planner.goal_created",
        payload={"student_id": target_student_id, "goal_type": created.get("goal_type")},
    )
    return {
        "id": _normalize(created.get("id")),
        "school_id": _normalize(created.get("school_id")),
        "student_id": _normalize(created.get("student_id")),
        "student_name": _normalize(target_student.get("full_name")),
        "goal_type": _normalize(created.get("goal_type")),
        "exam_mode": created.get("exam_mode"),
        "title": _normalize(created.get("title")),
        "description": created.get("description"),
        "target_date": created.get("target_date"),
        "target_value": _safe_float(created.get("target_value")) if created.get("target_value") is not None else None,
        "current_value": _safe_float(created.get("current_value")),
        "status": _normalize(created.get("status")) or "active",
        "metadata": _normalize_json_object(created.get("metadata")),
        "created_at": created.get("created_at"),
        "updated_at": created.get("updated_at"),
    }
