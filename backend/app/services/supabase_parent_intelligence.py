"""Parent intelligence portal built on existing academic and analytics data."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.ai_provider import AIProviderError, generate_text
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_analytics import get_student_analytics
from app.services.supabase_hostel_requests import list_hostel_requests
from app.services.supabase_lms import _list_parent_linked_students, get_progress_dashboard, list_assignments
from app.services.supabase_online_tests import list_results, list_tests

MODULE_KEY = "parent_intelligence"
ANALYTICS_SCHEMA = "analytics"
ATTENDANCE_SCHEMA = "attendance"
ACADEMIC_SCHEMA = "academic"
HOSTEL_SCHEMA = "hostel"
LMS_SCHEMA = "lms"
SCHEDULING_SCHEMA = "scheduling"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _analytics_table(name: str):
    return _public_table(f"analytics_{name}")


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


def _ai_summary_text(prompt: str, fallback: str) -> str:
    try:
        text = generate_text(prompt)
        return _normalize(text) or fallback
    except AIProviderError:
        return fallback


def _parse_iso_datetime(value: Any) -> datetime | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


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
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section,guardian_name,guardian_phone,metadata")
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


def _load_student_attendance_rows(school_id: str, student_id: str, *, days: int) -> list[dict[str, Any]]:
    start_date = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ATTENDANCE_SCHEMA, "student_attendance")
        .select("attendance_date,status")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .gte("attendance_date", start_date)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_live_attendance_rows(school_id: str, student_id: str, *, days: int) -> list[dict[str, Any]]:
    start_iso = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ACADEMIC_SCHEMA, "live_class_attendance")
        .select("session_id,attendance_percentage,attendance_status,total_duration_seconds,join_timestamp,leave_timestamp")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .gte("created_at", start_iso)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_recent_timetable_rows(school_id: str, student: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        query = (
            _schema_table(SCHEDULING_SCHEMA, "timetable_entries")
            .select("id,class_name,subject_id,teacher_name,start_time,end_time,day_of_week")
            .eq("school_id", school_id)
            .eq("is_active", True)
        )
        class_name = _normalize(student.get("class_name"))
        if class_name:
            query = query.ilike("class_name", f"%{class_name}%")
        rows = list(query.limit(12).execute().data or [])
        return [dict(row) for row in rows]
    except Exception:
        return []


def _load_study_plans(school_id: str, student_id: str, *, days: int = 30) -> list[dict[str, Any]]:
    start_date = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _analytics_table("study_plans")
            .select("scope,plan_date,completion_percentage,summary")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .gte("plan_date", start_date)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _load_hostel_status(school_id: str, student_id: str) -> dict[str, Any] | None:
    requests = [item for item in list_hostel_requests(school_id) if _normalize(item.get("student_id")) == student_id]
    if not requests:
        return None
    requests.sort(key=lambda item: _normalize(item.get("requested_at")), reverse=True)
    return dict(requests[0])


def _load_discipline_records(school_id: str, student_id: str) -> list[dict[str, Any]]:
    candidate_tables = [
        ("academic", "discipline_records"),
        ("academic", "student_discipline_records"),
        ("public", "discipline_records"),
    ]
    for schema_name, table_name in candidate_tables:
        try:
            if schema_name == "public":
                response = (
                    _public_table(table_name)
                    .select("*")
                    .eq("school_id", school_id)
                    .eq("student_id", student_id)
                    .limit(20)
                    .execute()
                )
            else:
                response = (
                    _schema_table(schema_name, table_name)
                    .select("*")
                    .eq("school_id", school_id)
                    .eq("student_id", student_id)
                    .limit(20)
                    .execute()
                )
            return [dict(row) for row in list(response.data or [])]
        except Exception:
            continue
    return []


def _average_result_percentage(result_rows: list[dict[str, Any]]) -> float:
    if not result_rows:
        return 0.0
    return round(sum(_safe_float(item.get("percentage")) for item in result_rows) / len(result_rows), 2)


def _attendance_summary(attendance_rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(attendance_rows)
    present = len([item for item in attendance_rows if _normalize(item.get("status")).lower() == "present"])
    late = len([item for item in attendance_rows if _normalize(item.get("status")).lower() == "late"])
    absent = max(total - present - late, 0)
    percentage = _safe_percentage(present + (late * 0.5), max(total, 1))
    return {
        "total_days": total,
        "present_days": present,
        "late_days": late,
        "absent_days": absent,
        "attendance_percentage": percentage,
    }


def _engagement_summary(
    *,
    live_rows: list[dict[str, Any]],
    progress_dashboard: dict[str, Any],
    assignments: list[dict[str, Any]],
    study_plans: list[dict[str, Any]],
) -> dict[str, Any]:
    progress_items = list(progress_dashboard.get("progress_items") or [])
    average_watch = (
        round(sum(_safe_float(item.get("watch_percentage")) for item in progress_items) / len(progress_items), 2)
        if progress_items
        else 0.0
    )
    assignment_completion = _safe_percentage(
        len([item for item in assignments if item.get("submission")]),
        max(len(assignments), 1),
    ) if assignments else 100.0
    live_percentage = (
        round(sum(_safe_float(item.get("attendance_percentage")) for item in live_rows) / len(live_rows), 2)
        if live_rows
        else 0.0
    )
    planner_completion = (
        round(sum(_safe_float(item.get("completion_percentage")) for item in study_plans) / len(study_plans), 2)
        if study_plans
        else 0.0
    )
    return {
        "average_watch_percentage": average_watch,
        "assignment_completion_percentage": assignment_completion,
        "live_attendance_percentage": live_percentage,
        "study_planner_completion_percentage": planner_completion,
    }


def _trend_metrics(
    *,
    attendance_rows: list[dict[str, Any]],
    result_rows: list[dict[str, Any]],
    live_rows: list[dict[str, Any]],
    days: int,
) -> dict[str, float]:
    start_date = _today_local() - timedelta(days=max(days, 1) - 1)
    scoped_attendance = [
        item for item in attendance_rows
        if (_parse_iso_datetime(f"{_normalize(item.get('attendance_date'))}T00:00:00+00:00") or _utc_now()).date() >= start_date
    ]
    scoped_results = [
        item for item in result_rows
        if ((_parse_iso_datetime(item.get("published_at")) or _parse_iso_datetime(item.get("created_at")) or _utc_now()).date() >= start_date)
    ]
    scoped_live = [
        item for item in live_rows
        if ((_parse_iso_datetime(item.get("join_timestamp")) or _utc_now()).date() >= start_date)
    ]
    attendance_percentage = _attendance_summary(scoped_attendance).get("attendance_percentage", 0.0)
    marks_percentage = _average_result_percentage(scoped_results)
    engagement_percentage = (
        round(sum(_safe_float(item.get("attendance_percentage")) for item in scoped_live) / len(scoped_live), 2)
        if scoped_live
        else 0.0
    )
    return {
        "marks": round(marks_percentage, 2),
        "attendance": round(_safe_float(attendance_percentage), 2),
        "engagement": round(engagement_percentage, 2),
    }


def _risk_level(academic_health_score: float) -> str:
    if academic_health_score < 45:
        return "high"
    if academic_health_score < 70:
        return "medium"
    return "low"


def _communication_actions(student: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "action_type": "contact_teacher",
            "label": "Contact Teacher",
            "student_id": _normalize(student.get("id")),
            "channel": "portal_message",
        },
        {
            "action_type": "request_meeting",
            "label": "Request Meeting",
            "student_id": _normalize(student.get("id")),
            "channel": "meeting_request",
        },
    ]


def _replace_parent_insights(
    school_id: str,
    *,
    parent_profile_id: str | None,
    student_id: str,
    insights: list[dict[str, Any]],
) -> None:
    (
        _analytics_table("parent_insights")
        .update({"is_active": False, "deleted_at": _utc_now_iso()})
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("parent_profile_id", _normalize_optional_uuid(parent_profile_id))
        .is_("deleted_at", "null")
        .execute()
    )
    if not insights:
        return
    payload = []
    for item in insights:
        payload.append(
            {
                "school_id": school_id,
                "parent_profile_id": _normalize_optional_uuid(parent_profile_id),
                "student_id": student_id,
                "insight_type": item.get("insight_type") or "academic_health",
                "title": item.get("title") or "Parent insight",
                "summary": item.get("summary") or "Insight generated",
                "severity": item.get("severity") or "info",
                "trend_window_days": _safe_int(item.get("trend_window_days") or 30),
                "payload": _normalize_json_object(item.get("payload")),
                "generated_at": _utc_now_iso(),
                "metadata": _normalize_json_object(item.get("metadata")),
                "is_active": True,
            }
        )
        _analytics_table("parent_insights").insert(payload).execute()


def _upsert_student_risk_score(
    school_id: str,
    *,
    parent_profile_id: str | None,
    student_id: str,
    payload: dict[str, Any],
) -> None:
    rows = list(
        _analytics_table("student_risk_scores")
        .select("id")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    data = {
        "parent_profile_id": _normalize_optional_uuid(parent_profile_id),
        "attendance_score": _safe_float(payload.get("attendance_score")),
        "test_performance_score": _safe_float(payload.get("test_performance_score")),
        "learning_consistency_score": _safe_float(payload.get("learning_consistency_score")),
        "engagement_score": _safe_float(payload.get("engagement_score")),
        "hostel_score": _safe_float(payload.get("hostel_score")),
        "academic_health_score": _safe_float(payload.get("academic_health_score")),
        "risk_level": payload.get("risk_level") or "low",
        "risk_factors": list(payload.get("risk_factors") or []),
        "trend_7d": _normalize_json_object(payload.get("trend_7d")),
        "trend_30d": _normalize_json_object(payload.get("trend_30d")),
        "trend_90d": _normalize_json_object(payload.get("trend_90d")),
        "alerts_snapshot": list(payload.get("alerts_snapshot") or []),
        "last_calculated_at": _utc_now_iso(),
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
        "deleted_at": None,
    }
    if rows:
        _analytics_table("student_risk_scores").update(data).eq("id", _normalize(rows[0].get("id"))).execute()
    else:
        _analytics_table("student_risk_scores").insert(
            {"school_id": school_id, "student_id": student_id, **data}
        ).execute()


def _replace_parent_alerts(
    school_id: str,
    *,
    parent_profile_id: str | None,
    student_id: str,
    alerts: list[dict[str, Any]],
) -> None:
    (
        _analytics_table("parent_alerts")
        .update({"is_active": False, "deleted_at": _utc_now_iso()})
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("parent_profile_id", _normalize_optional_uuid(parent_profile_id))
        .is_("deleted_at", "null")
        .eq("status", "open")
        .execute()
    )
    if not alerts:
        return
    payload = []
    for item in alerts:
        payload.append(
            {
                "school_id": school_id,
                "parent_profile_id": _normalize_optional_uuid(parent_profile_id),
                "student_id": student_id,
                "alert_type": item.get("alert_type") or "attendance_warning",
                "title": item.get("title") or "Parent alert",
                "message": item.get("message") or "Alert generated",
                "severity": item.get("severity") or "warning",
                "status": item.get("status") or "open",
                "alert_payload": _normalize_json_object(item.get("alert_payload")),
                "generated_at": _utc_now_iso(),
                "communication_actions": list(item.get("communication_actions") or []),
                "metadata": _normalize_json_object(item.get("metadata")),
                "is_active": True,
            }
        )
        _analytics_table("parent_alerts").insert(payload).execute()


def _load_student_attendance_rows_batch(school_id: str, student_ids: list[str], *, days: int) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    start_date = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ATTENDANCE_SCHEMA, "student_attendance")
        .select("attendance_date,status,student_id")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .gte("attendance_date", start_date)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        sid = _normalize(row.get("student_id"))
        grouped.setdefault(sid, []).append(dict(row))
    return grouped


def _load_live_attendance_rows_batch(school_id: str, student_ids: list[str], *, days: int) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    start_iso = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ACADEMIC_SCHEMA, "live_class_attendance")
        .select("session_id,attendance_percentage,attendance_status,total_duration_seconds,join_timestamp,leave_timestamp,student_id")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .is_("deleted_at", "null")
        .gte("created_at", start_iso)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        sid = _normalize(row.get("student_id"))
        grouped.setdefault(sid, []).append(dict(row))
    return grouped


def _load_results_batch(school_id: str, student_ids: list[str], *, limit: int = 20) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    from app.services.supabase_online_tests import _table as _ot_table
    rows = list(
        _ot_table("test_results")
        .select("*")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        sid = _normalize(row.get("student_id"))
        grouped.setdefault(sid, []).append(dict(row))
    for sid in grouped:
        grouped[sid] = grouped[sid][:limit]
    return grouped


def _load_study_plans_batch(school_id: str, student_ids: list[str], *, days: int = 30) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    start_date = (_today_local() - timedelta(days=max(days, 1) - 1)).isoformat()
    try:
        rows = list(
            _analytics_table("study_plans")
            .select("*")
            .eq("school_id", school_id)
            .in_("student_id", student_ids)
            .is_("deleted_at", "null")
            .gte("plan_date", start_date)
            .execute()
            .data
            or []
        )
    except Exception:
        return {}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        sid = _normalize(row.get("student_id"))
        grouped.setdefault(sid, []).append(dict(row))
    return grouped


def _load_discipline_records_batch(school_id: str, student_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    candidate_tables = [
        ("academic", "discipline_records"),
        ("academic", "student_discipline_records"),
        ("public", "discipline_records"),
    ]
    for schema_name, table_name in candidate_tables:
        try:
            if schema_name == "public":
                response = (
                    _public_table(table_name)
                    .select("*")
                    .eq("school_id", school_id)
                    .in_("student_id", student_ids)
                    .limit(200)
                    .execute()
                )
            else:
                response = (
                    _schema_table(schema_name, table_name)
                    .select("*")
                    .eq("school_id", school_id)
                    .in_("student_id", student_ids)
                    .limit(200)
                    .execute()
                )
            grouped: dict[str, list[dict[str, Any]]] = {}
            for row in list(response.data or []):
                sid = _normalize(row.get("student_id"))
                grouped.setdefault(sid, []).append(dict(row))
            return grouped
        except Exception:
            continue
    return {}


def _batch_student_parent_payloads(
    school_id: str,
    students: list[dict[str, Any]],
    *,
    parent_profile_id: str | None,
) -> list[dict[str, Any]]:
    if not students:
        return []
    student_ids = [_normalize(s.get("id")) for s in students if _normalize(s.get("id"))]
    if not student_ids:
        return []

    attendance_map = _load_student_attendance_rows_batch(school_id, student_ids, days=90)
    live_map = _load_live_attendance_rows_batch(school_id, student_ids, days=90)
    results_map = _load_results_batch(school_id, student_ids, limit=20)
    study_plans_map = _load_study_plans_batch(school_id, student_ids, days=30)
    discipline_map = _load_discipline_records_batch(school_id, student_ids)

    all_hostel_requests = list_hostel_requests(school_id)
    hostel_map: dict[str, dict[str, Any] | None] = {}
    for sid in student_ids:
        matching = [item for item in all_hostel_requests if _normalize(item.get("student_id")) == sid]
        if matching:
            matching.sort(key=lambda item: _normalize(item.get("requested_at")), reverse=True)
            hostel_map[sid] = dict(matching[0])
        else:
            hostel_map[sid] = None

    return [
        _student_parent_payload(
            school_id, student,
            parent_profile_id=parent_profile_id,
            _attendance_rows=attendance_map.get(sid, []),
            _live_rows=live_map.get(sid, []),
            _result_rows=results_map.get(sid, []),
            _study_plans=study_plans_map.get(sid, []),
            _discipline_rows=discipline_map.get(sid, []),
            _hostel_status=hostel_map.get(sid),
        )
        for student, sid in zip(students, student_ids)
    ]


def _student_parent_payload(
    school_id: str,
    student: dict[str, Any],
    *,
    parent_profile_id: str | None,
    _attendance_rows: list[dict[str, Any]] | None = None,
    _live_rows: list[dict[str, Any]] | None = None,
    _result_rows: list[dict[str, Any]] | None = None,
    _study_plans: list[dict[str, Any]] | None = None,
    _discipline_rows: list[dict[str, Any]] | None = None,
    _hostel_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    student_id = _normalize(student.get("id"))
    attendance_rows = _attendance_rows if _attendance_rows is not None else _load_student_attendance_rows(school_id, student_id, days=90)
    live_rows = _live_rows if _live_rows is not None else _load_live_attendance_rows(school_id, student_id, days=90)
    result_rows = _result_rows if _result_rows is not None else list_results(school_id, student_id=student_id, limit=20)
    analytics = get_student_analytics(school_id, student_id)
    progress_dashboard = get_progress_dashboard(school_id, student=student)
    assignments = list_assignments(school_id, student=student)
    study_plans = _study_plans if _study_plans is not None else _load_study_plans(school_id, student_id, days=30)
    hostel_status = _hostel_status if _hostel_status is not None else _load_hostel_status(school_id, student_id)
    discipline_rows = _discipline_rows if _discipline_rows is not None else _load_discipline_records(school_id, student_id)
    timetable_rows = _load_recent_timetable_rows(school_id, student)
    upcoming_tests = [
        item for item in list_tests(school_id, student_batch_id=_normalize(student.get("batch_id")) or None, limit=10)
        if _parse_iso_datetime(item.get("starts_at")) and (_parse_iso_datetime(item.get("starts_at")) or _utc_now()).date() <= (_today_local() + timedelta(days=7))
    ]

    attendance_summary = _attendance_summary(attendance_rows)
    engagement_summary = _engagement_summary(
        live_rows=live_rows,
        progress_dashboard=progress_dashboard,
        assignments=assignments,
        study_plans=study_plans,
    )
    attendance_score = round(_safe_float(attendance_summary.get("attendance_percentage")), 2)
    test_performance_score = round(_safe_float(analytics.get("overall_percentage") or _average_result_percentage(result_rows)), 2)
    learning_consistency_score = round(
        (
            _safe_float(engagement_summary.get("study_planner_completion_percentage")) * 0.4
            + _safe_float(engagement_summary.get("average_watch_percentage")) * 0.3
            + _safe_float(engagement_summary.get("assignment_completion_percentage")) * 0.3
        ),
        2,
    )
    engagement_score = round(
        (
            _safe_float(engagement_summary.get("live_attendance_percentage")) * 0.45
            + _safe_float(engagement_summary.get("average_watch_percentage")) * 0.25
            + _safe_float(engagement_summary.get("assignment_completion_percentage")) * 0.30
        ),
        2,
    )
    hostel_score = 100.0
    if hostel_status:
        status_value = _normalize(hostel_status.get("status")).lower()
        if status_value in {"rejected", "vacated"}:
            hostel_score = 40.0
        elif status_value in {"pending", "waiting"}:
            hostel_score = 70.0
    academic_health_score = round(
        (
            attendance_score * 0.25
            + test_performance_score * 0.30
            + learning_consistency_score * 0.20
            + engagement_score * 0.20
            + hostel_score * 0.05
        ),
        2,
    )
    trend_7d = _trend_metrics(attendance_rows=attendance_rows, result_rows=result_rows, live_rows=live_rows, days=7)
    trend_30d = _trend_metrics(attendance_rows=attendance_rows, result_rows=result_rows, live_rows=live_rows, days=30)
    trend_90d = _trend_metrics(attendance_rows=attendance_rows, result_rows=result_rows, live_rows=live_rows, days=90)
    risk_factors: list[str] = []
    if attendance_score < 75:
        risk_factors.append("low_attendance")
    if test_performance_score < 60:
        risk_factors.append("falling_marks")
    if _safe_float(engagement_summary.get("assignment_completion_percentage")) < 60:
        risk_factors.append("incomplete_assignments")
    missed_classes = len([item for item in live_rows if _normalize(item.get("attendance_status")).lower() == "absent"])
    if missed_classes >= 3:
        risk_factors.append("missed_classes")
    if hostel_score < 100:
        risk_factors.append("hostel_issues")
    if discipline_rows:
        risk_factors.append("discipline_records")
    risk_level = _risk_level(academic_health_score)

    insights: list[dict[str, Any]] = []
    marks_delta = round(trend_30d.get("marks", 0.0) - trend_90d.get("marks", 0.0), 2)
    if marks_delta <= -10:
        insights.append(
            {
                "insight_type": "performance",
                "title": "Performance decline detected",
                "summary": f"{_normalize(student.get('full_name'))} performance dropped {abs(marks_delta):.0f}% compared to the longer trend window.",
                "severity": "warning",
                "trend_window_days": 30,
                "payload": {"marks_delta": marks_delta},
            }
        )
    if missed_classes:
        insights.append(
            {
                "insight_type": "engagement",
                "title": "Live class attendance needs attention",
                "summary": f"Student missed {missed_classes} live classes in the recent review window.",
                "severity": "warning" if missed_classes >= 3 else "info",
                "trend_window_days": 7,
                "payload": {"missed_classes": missed_classes},
            }
        )
    planner_completion = _safe_float(engagement_summary.get("study_planner_completion_percentage"))
    if planner_completion >= 70:
        insights.append(
            {
                "insight_type": "academic_health",
                "title": "Revision consistency is improving",
                "summary": "Study planner completion is trending in a healthy direction this month.",
                "severity": "positive",
                "trend_window_days": 30,
                "payload": {"study_planner_completion_percentage": planner_completion},
            }
        )
    weak_topics = list(analytics.get("weak_topics") or [])[:3]
    if weak_topics:
        insights.append(
            {
                "insight_type": "performance",
                "title": "Weak topics detected",
                "summary": f"Focus on {', '.join(weak_topics)} for the next revision cycle.",
                "severity": "info",
                "trend_window_days": 30,
                "payload": {"weak_topics": weak_topics},
            }
        )

    alerts: list[dict[str, Any]] = []
    if attendance_score < 75:
        alerts.append(
            {
                "alert_type": "attendance_warning",
                "title": "Attendance warning",
                "message": f"Attendance is {attendance_score:.0f}%, which is below the healthy threshold.",
                "severity": "warning" if attendance_score >= 60 else "critical",
                "alert_payload": {"attendance_score": attendance_score},
                "communication_actions": _communication_actions(student),
            }
        )
    if marks_delta <= -10 or test_performance_score < 55:
        alerts.append(
            {
                "alert_type": "academic_decline",
                "title": "Academic decline alert",
                "message": "Recent academic performance needs a teacher-parent review.",
                "severity": "critical" if test_performance_score < 45 else "warning",
                "alert_payload": {"test_performance_score": test_performance_score, "marks_delta": marks_delta},
                "communication_actions": _communication_actions(student),
            }
        )
    overdue_assignments = [item for item in assignments if _normalize(item.get("status")).lower() == "closed" and not item.get("submission")]
    if overdue_assignments:
        alerts.append(
            {
                "alert_type": "assignment_overdue",
                "title": "Assignment overdue alert",
                "message": f"{len(overdue_assignments)} assignments still need submission or follow-up.",
                "severity": "warning",
                "alert_payload": {"overdue_count": len(overdue_assignments)},
                "communication_actions": _communication_actions(student),
            }
        )
    if upcoming_tests:
        next_test = upcoming_tests[0]
        alerts.append(
            {
                "alert_type": "upcoming_exam",
                "title": "Upcoming exam alert",
                "message": f"Upcoming test: {_normalize(next_test.get('title')) or 'Scheduled test'}",
                "severity": "info",
                "alert_payload": {"test_id": next_test.get("id"), "starts_at": next_test.get("starts_at")},
                "communication_actions": _communication_actions(student),
            }
        )
    if hostel_status and hostel_score < 100:
        alerts.append(
            {
                "alert_type": "hostel_issue",
                "title": "Hostel issue alert",
                "message": f"Hostel status is currently {_normalize(hostel_status.get('status')) or 'pending'}.",
                "severity": "warning",
                "alert_payload": hostel_status,
                "communication_actions": _communication_actions(student),
            }
        )
    if missed_classes >= 3:
        alerts.append(
            {
                "alert_type": "missed_classes",
                "title": "Missed classes alert",
                "message": f"Student missed {missed_classes} live classes recently.",
                "severity": "warning",
                "alert_payload": {"missed_classes": missed_classes},
                "communication_actions": _communication_actions(student),
            }
        )

    _replace_parent_insights(school_id, parent_profile_id=parent_profile_id, student_id=student_id, insights=insights)
    _replace_parent_alerts(school_id, parent_profile_id=parent_profile_id, student_id=student_id, alerts=alerts)
    _upsert_student_risk_score(
        school_id,
        parent_profile_id=parent_profile_id,
        student_id=student_id,
        payload={
            "attendance_score": attendance_score,
            "test_performance_score": test_performance_score,
            "learning_consistency_score": learning_consistency_score,
            "engagement_score": engagement_score,
            "hostel_score": hostel_score,
            "academic_health_score": academic_health_score,
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "trend_7d": trend_7d,
            "trend_30d": trend_30d,
            "trend_90d": trend_90d,
            "alerts_snapshot": alerts,
            "metadata": {"discipline_records_count": len(discipline_rows), "timetable_entries_count": len(timetable_rows)},
        },
    )

    return {
        "student_id": student_id,
        "student_name": _normalize(student.get("full_name")) or "Student",
        "class_name": _normalize(student.get("class_name")) or None,
        "section": _normalize(student.get("section")) or None,
        "academic_health_score": academic_health_score,
        "attendance_score": attendance_score,
        "test_performance_score": test_performance_score,
        "learning_consistency_score": learning_consistency_score,
        "engagement_score": engagement_score,
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "attendance_summary": attendance_summary,
        "engagement_summary": engagement_summary,
        "trend_7d": trend_7d,
        "trend_30d": trend_30d,
        "trend_90d": trend_90d,
        "insights": insights,
        "alerts": alerts,
        "weak_topics": weak_topics,
        "strong_topics": list(analytics.get("strong_topics") or [])[:3],
        "suggestions": list(analytics.get("suggestions") or []),
        "hostel_status": hostel_status,
        "discipline_records_count": len(discipline_rows),
        "communication_actions": _communication_actions(student),
        "generated_at": _utc_now_iso(),
    }


def _resolve_parent_students(school_id: str, profile_id: str | None, user_email: str | None) -> list[dict[str, Any]]:
    linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
    if not linked_students:
        raise HTTPException(status_code=404, detail="No linked students found for this parent context")
    return linked_students


def get_parent_dashboard(school_id: str, *, profile_id: str | None, user_email: str | None) -> dict[str, Any]:
    linked_students = _resolve_parent_students(school_id, profile_id, user_email)
    children = _batch_student_parent_payloads(school_id, linked_students, parent_profile_id=profile_id)
    overall_health = round(sum(_safe_float(item.get("academic_health_score")) for item in children) / max(len(children), 1), 2)
    overall_risk = "high" if any(item.get("risk_level") == "high" for item in children) else "medium" if any(item.get("risk_level") == "medium" for item in children) else "low"
    payload = {
        "role": "parent",
        "children_count": len(children),
        "academic_health_score": overall_health,
        "risk_level": overall_risk,
        "children": children,
        "generated_at": _utc_now_iso(),
    }
    payload["ai_summary"] = _ai_summary_text(
        (
            "You are the Aspire ERP Parent Intelligence assistant. Write a short family-facing summary in 2 sentences.\n"
            "Use attendance, tests, LMS progress, assignments, and live-class engagement where present. Avoid generic parenting advice.\n"
            f"Overall health: {overall_health}\n"
            f"Risk level: {overall_risk}\n"
            f"Children snapshot: {[{'student_name': item.get('student_name'), 'risk_level': item.get('risk_level'), 'weak_topics': item.get('weak_topics')} for item in children[:3]]}"
        ),
        "Keep a close eye on attendance, weak topics, and the current risk pattern across linked students this week.",
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="parent_intelligence.dashboard.generated",
        payload={"children_count": len(children)},
    )
    return payload


def get_parent_insights(school_id: str, *, profile_id: str | None, user_email: str | None) -> dict[str, Any]:
    linked_students = _resolve_parent_students(school_id, profile_id, user_email)
    children = _batch_student_parent_payloads(school_id, linked_students, parent_profile_id=profile_id)
    items = []
    for child in children:
        for insight in list(child.get("insights") or []):
            items.append(
                {
                    "student_id": child.get("student_id"),
                    "student_name": child.get("student_name"),
                    **insight,
                }
            )
    payload = {
        "role": "parent",
        "insights": items,
        "children": [
            {
                "student_id": child.get("student_id"),
                "student_name": child.get("student_name"),
                "academic_health_score": child.get("academic_health_score"),
                "weak_topics": child.get("weak_topics"),
                "suggestions": child.get("suggestions"),
                "communication_actions": child.get("communication_actions"),
            }
            for child in children
        ],
        "generated_at": _utc_now_iso(),
    }
    payload["ai_summary"] = _ai_summary_text(
        (
            "You are the Aspire ERP Parent Intelligence assistant. Write a concise insight summary for parents.\n"
            "Use attendance, tests, LMS progress, assignments, and live-class engagement where present. Avoid generic parenting advice.\n"
            f"Insights: {items[:5]}"
        ),
        "Use these insights to guide the next revision cycle and teacher follow-up conversation.",
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="parent_intelligence.insights.generated")
    return payload


def get_parent_risk_scores(school_id: str, *, profile_id: str | None, user_email: str | None) -> dict[str, Any]:
    linked_students = _resolve_parent_students(school_id, profile_id, user_email)
    children = _batch_student_parent_payloads(school_id, linked_students, parent_profile_id=profile_id)
    payload = {
        "role": "parent",
        "children": [
            {
                "student_id": child.get("student_id"),
                "student_name": child.get("student_name"),
                "academic_health_score": child.get("academic_health_score"),
                "attendance_score": child.get("attendance_score"),
                "test_performance_score": child.get("test_performance_score"),
                "learning_consistency_score": child.get("learning_consistency_score"),
                "engagement_score": child.get("engagement_score"),
                "risk_level": child.get("risk_level"),
                "risk_factors": child.get("risk_factors"),
                "trend_7d": child.get("trend_7d"),
                "trend_30d": child.get("trend_30d"),
                "trend_90d": child.get("trend_90d"),
            }
            for child in children
        ],
        "generated_at": _utc_now_iso(),
    }
    payload["ai_summary"] = _ai_summary_text(
        (
            "You are the Aspire ERP Parent Intelligence assistant. Write a concise risk summary for parents.\n"
            "Use attendance, tests, LMS progress, assignments, and live-class engagement where present. Avoid generic parenting advice.\n"
            f"Risk payload: {payload['children'][:3]}"
        ),
        "The current risk view points to attendance, performance, and engagement as the main areas to monitor.",
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="parent_intelligence.risk.generated")
    return payload


def get_parent_alerts(school_id: str, *, profile_id: str | None, user_email: str | None) -> dict[str, Any]:
    linked_students = _resolve_parent_students(school_id, profile_id, user_email)
    children = _batch_student_parent_payloads(school_id, linked_students, parent_profile_id=profile_id)
    student_ids = [_normalize(child.get("student_id")) for child in children if _normalize(child.get("student_id"))]
    query = (
        _analytics_table("parent_alerts")
        .select("*")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .in_("student_id", student_ids or ["00000000-0000-0000-0000-000000000000"])
        .order("generated_at", desc=True)
    )
    if profile_id:
        query = query.eq("parent_profile_id", _normalize_optional_uuid(profile_id))
    rows = [dict(row) for row in list(query.execute().data or [])]
    student_lookup = {_normalize(child.get("student_id")): child for child in children}
    alerts = []
    for row in rows:
        child = student_lookup.get(_normalize(row.get("student_id"))) or {}
        alerts.append(
            {
                "id": _normalize(row.get("id")),
                "student_id": _normalize(row.get("student_id")),
                "student_name": child.get("student_name") or "Student",
                "alert_type": _normalize(row.get("alert_type")) or "parent_alert",
                "title": _normalize(row.get("title")) or "Parent alert",
                "message": row.get("message") or "Alert generated",
                "severity": _normalize(row.get("severity")) or "warning",
                "status": _normalize(row.get("status")) or "open",
                "alert_payload": _normalize_json_object(row.get("alert_payload")),
                "communication_actions": list(row.get("communication_actions") or []),
                "generated_at": row.get("generated_at"),
            }
        )
    payload = {"role": "parent", "alerts": alerts, "generated_at": _utc_now_iso()}
    payload["ai_summary"] = _ai_summary_text(
        (
            "You are the Aspire ERP Parent Intelligence assistant. Write a short summary of the latest parent alerts.\n"
            "Use attendance, tests, LMS progress, assignments, and live-class engagement where present. Avoid generic parenting advice.\n"
            f"Alerts: {alerts[:5]}"
        ),
        "Review the latest alerts in priority order and coordinate the next parent-teacher action where needed.",
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="parent_intelligence.alerts.generated")
    return payload


def acknowledge_parent_alert(
    school_id: str,
    *,
    profile_id: str | None,
    user_email: str | None,
    alert_id: str,
) -> dict[str, Any]:
    del user_email
    rows = list(
        _analytics_table("parent_alerts")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", alert_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Parent alert not found")
    _analytics_table("parent_alerts").update(
        {
            "status": "acknowledged",
            "acknowledged_at": _utc_now_iso(),
            "acknowledged_by_profile_id": _normalize_optional_uuid(profile_id),
        }
    ).eq("id", alert_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="parent_intelligence.alert.acknowledged",
        payload={"alert_id": alert_id},
    )
    return {"message": "Alert acknowledged", "alert_id": alert_id}


def contact_teacher(
    school_id: str,
    *,
    profile_id: str | None,
    student_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    student = _get_student(school_id, student_id)
    message = _normalize(payload.get("message"))
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="parent_intelligence.contact_teacher",
        payload={
            "student_id": student_id,
            "student_name": _normalize(student.get("full_name")),
            "message": message,
        },
    )
    return {
        "message": "Teacher contact request logged",
        "student_id": student_id,
        "student_name": _normalize(student.get("full_name")),
    }


def request_parent_meeting(
    school_id: str,
    *,
    profile_id: str | None,
    student_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    student = _get_student(school_id, student_id)
    preferred_date = payload.get("preferred_date")
    note = _normalize(payload.get("note"))
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="parent_intelligence.request_meeting",
        payload={
            "student_id": student_id,
            "student_name": _normalize(student.get("full_name")),
            "preferred_date": preferred_date,
            "note": note,
        },
    )
    return {
        "message": "Meeting request logged",
        "student_id": student_id,
        "student_name": _normalize(student.get("full_name")),
        "preferred_date": preferred_date,
    }
