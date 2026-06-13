"""Supabase-native live classes service."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_attendance import create_notification
from app.services.supabase_lms import _get_student_by_profile_id, _list_parent_linked_students
from app.services.supabase_timetable import get_timetable_entry

LIVE_CLASSES_MODULE_KEY = "live_classes"
ACADEMIC_SCHEMA = "academic"
SCHEDULING_SCHEMA = "scheduling"
LMS_SCHEMA = "lms"

SUPPORTED_PROVIDERS = {"zoom", "google_meet", "microsoft_teams", "jitsi_meet"}
MANAGEABLE_STATUSES = {"scheduled", "live", "ended", "cancelled"}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _academic_table(name: str):
    return _client().schema(ACADEMIC_SCHEMA).table(name)


def _scheduling_table(name: str):
    return _client().schema(SCHEDULING_SCHEMA).table(name)


def _lms_table(name: str):
    return _client().schema(LMS_SCHEMA).table(name)


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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _to_iso_datetime(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    text = _normalize(value)
    return text or None


def _to_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    parsed = date.fromisoformat(_normalize(value))
    return parsed


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    row: dict[str, Any] = {
        "school_id": _normalize_optional_uuid(school_id),
        "profile_id": _normalize_optional_uuid(profile_id),
        "action": action,
        "module_key": LIVE_CLASSES_MODULE_KEY,
        "payload": payload or {},
    }
    entity_uuid = _normalize_optional_uuid(entity_id)
    if entity_uuid:
        row["entity_id"] = entity_uuid
    _public_table("audit_logs").insert(row).execute()


def _get_timetable_row(school_id: str, timetable_entry_id: str) -> dict[str, Any]:
    rows = list(
        _scheduling_table("timetable_entries")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", timetable_entry_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Linked timetable entry not found")
    return dict(rows[0])


def _get_profile_row(profile_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("profiles")
        .select("id,full_name,email")
        .eq("id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else {}


def _get_staff_member_by_profile_id(school_id: str, profile_id: str | None) -> dict[str, Any]:
    if not profile_id:
        return {}
    rows = list(
        _public_table("staff_members")
        .select("id,profile_id,full_name")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else {}


def _sync_timetable_live_fields(school_id: str, timetable_entry_id: str, payload: dict[str, Any]) -> None:
    timetable_row = _get_timetable_row(school_id, timetable_entry_id)
    metadata = _normalize_json_object(timetable_row.get("metadata"))
    provider = _normalize(payload.get("provider") or metadata.get("online_provider") or metadata.get("online_platform") or "google_meet").lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported live class provider")
    metadata["online_provider"] = provider
    metadata["online_platform"] = provider

    update_payload = {
        "session_mode": payload.get("session_mode") or timetable_row.get("session_mode") or "online",
        "online_link": payload.get("meeting_link") or payload.get("online_link") or timetable_row.get("online_link"),
        "meeting_id": payload.get("meeting_id") or timetable_row.get("meeting_id"),
        "meeting_password": payload.get("meeting_password") or timetable_row.get("meeting_password"),
        "recording_url": payload.get("recording_url") or timetable_row.get("recording_url"),
        "metadata": metadata,
    }
    (
        _scheduling_table("timetable_entries")
        .update(update_payload)
        .eq("school_id", school_id)
        .eq("id", timetable_entry_id)
        .execute()
    )


def _compute_expected_duration_seconds(session_row: dict[str, Any], timetable_row: dict[str, Any]) -> int:
    scheduled_start = session_row.get("scheduled_start_at")
    scheduled_end = session_row.get("scheduled_end_at")
    if scheduled_start and scheduled_end:
        try:
            start_dt = datetime.fromisoformat(str(scheduled_start).replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(str(scheduled_end).replace("Z", "+00:00"))
            return max(int((end_dt - start_dt).total_seconds()), 0)
        except ValueError:
            pass

    start_time = str(timetable_row.get("start_time") or "")[:8]
    end_time = str(timetable_row.get("end_time") or "")[:8]
    if not start_time or not end_time:
        return 0
    start_parts = [int(part) for part in start_time.split(":")[:2]]
    end_parts = [int(part) for part in end_time.split(":")[:2]]
    return max(((end_parts[0] * 60 + end_parts[1]) - (start_parts[0] * 60 + start_parts[1])) * 60, 0)


def _attendance_band(duration_seconds: int, expected_seconds: int) -> tuple[float, str]:
    if expected_seconds <= 0:
        return 0.0, "absent"
    percentage = round((duration_seconds / expected_seconds) * 100, 2)
    if percentage >= 75:
        return min(percentage, 100.0), "present"
    if percentage >= 50:
        return min(percentage, 100.0), "partial"
    return max(percentage, 0.0), "absent"


def _serialize_attendance(row: dict[str, Any], participant_name: str = "") -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "attendance_id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "session_id": _normalize(row.get("session_id")),
        "profile_id": _normalize(row.get("profile_id")) or None,
        "student_id": _normalize(row.get("student_id")) or None,
        "participant_name": participant_name,
        "role_key": _normalize(row.get("role_key")) or "student",
        "join_timestamp": row.get("join_timestamp"),
        "leave_timestamp": row.get("leave_timestamp"),
        "total_duration_seconds": int(row.get("total_duration_seconds") or 0),
        "attendance_percentage": float(row.get("attendance_percentage") or 0),
        "attendance_status": _normalize(row.get("attendance_status")) or "absent",
        "metadata": _normalize_json_object(row.get("metadata")),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_recording(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "session_id": _normalize(row.get("session_id")),
        "course_id": _normalize(row.get("course_id")) or None,
        "module_id": _normalize(row.get("module_id")) or None,
        "lesson_id": _normalize(row.get("lesson_id")) or None,
        "title": _normalize(row.get("title")),
        "recording_url": row.get("recording_url"),
        "notes_url": row.get("notes_url"),
        "duration_seconds": int(row.get("duration_seconds") or 0),
        "published_at": row.get("published_at"),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _fetch_attendance_rows(session_id: str) -> list[dict[str, Any]]:
    rows = list(
        _academic_table("live_class_attendance")
        .select("*")
        .eq("session_id", session_id)
        .is_("deleted_at", "null")
        .order("join_timestamp")
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _summarize_session_metrics(session_id: str) -> tuple[float, float, int]:
    rows = _fetch_attendance_rows(session_id)
    if not rows:
        return 0.0, 0.0, 0
    present_like = [row for row in rows if _normalize(row.get("attendance_status")) in {"present", "partial"}]
    attendance_rate = round((len(present_like) / len(rows)) * 100, 2) if rows else 0.0
    average_watch = round(sum(int(row.get("total_duration_seconds") or 0) for row in rows) / len(rows), 2)
    participation = len(rows)
    return attendance_rate, average_watch, participation


def _serialize_session(row: dict[str, Any], timetable_entry: dict[str, Any] | None = None) -> dict[str, Any]:
    attendance_rate, average_watch, participation = _summarize_session_metrics(_normalize(row.get("id")))
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "timetable_entry_id": _normalize(row.get("timetable_entry_id")),
        "course_id": _normalize(row.get("course_id")) or None,
        "module_id": _normalize(row.get("module_id")) or None,
        "lesson_id": _normalize(row.get("lesson_id")) or None,
        "session_date": row.get("session_date"),
        "provider": _normalize(row.get("provider")) or "google_meet",
        "provider_session_id": row.get("provider_session_id"),
        "meeting_link": row.get("meeting_link"),
        "meeting_id": row.get("meeting_id"),
        "meeting_password": row.get("meeting_password"),
        "scheduled_start_at": row.get("scheduled_start_at"),
        "scheduled_end_at": row.get("scheduled_end_at"),
        "actual_start_at": row.get("actual_start_at"),
        "actual_end_at": row.get("actual_end_at"),
        "status": _normalize(row.get("status")) or "scheduled",
        "notes_url": row.get("notes_url"),
        "recording_url": row.get("recording_url"),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "timetable_entry": timetable_entry,
        "attendance_rate": attendance_rate,
        "average_watch_time_seconds": average_watch,
        "participation_count": participation,
    }


def _get_session_row(school_id: str, session_id: str) -> dict[str, Any]:
    rows = list(
        _academic_table("live_class_sessions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", session_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Live class session not found")
    return dict(rows[0])


def _ensure_provider(provider: str) -> str:
    normalized = _normalize(provider).lower() or "google_meet"
    if normalized not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported live class provider")
    return normalized


def _ensure_status(status_value: str) -> str:
    normalized = _normalize(status_value).lower()
    if normalized not in MANAGEABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported live class status")
    return normalized


def _list_timetable_rows(school_id: str, entry_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not entry_ids:
        return {}
    rows = list(
        _scheduling_table("timetable_entries")
        .select("*")
        .eq("school_id", school_id)
        .in_("id", entry_ids)
        .execute()
        .data
        or []
    )
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _session_matches_student(session_row: dict[str, Any], timetable_row: dict[str, Any], student: dict[str, Any]) -> bool:
    session_batch = _normalize(timetable_row.get("batch_id"))
    student_batch = _normalize(student.get("batch_id"))
    if session_batch and student_batch:
        return session_batch == student_batch
    class_name = _normalize(timetable_row.get("class_name")).casefold()
    student_class = _normalize(student.get("class_name")).casefold()
    if class_name and student_class and student_class in class_name:
        return True
    return False


def list_live_classes(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None = None,
    status_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = (
        _academic_table("live_class_sessions")
        .select("*")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("session_date", desc=True)
        .range(offset, max(offset + limit - 1, offset))
    )
    if status_filter:
        query = query.eq("status", _ensure_status(status_filter))
    rows = [dict(row) for row in list(query.execute().data or [])]
    timetable_lookup = _list_timetable_rows(school_id, [_normalize(row.get("timetable_entry_id")) for row in rows])

    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        student = _get_student_by_profile_id(school_id, profile_id)
        rows = [
            row
            for row in rows
            if _session_matches_student(row, timetable_lookup.get(_normalize(row.get("timetable_entry_id")), {}), student)
        ]
    elif normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        linked_ids = {_normalize(item.get("id")) for item in linked_students}
        attendance_rows = _academic_table("live_class_attendance").select("session_id,student_id").eq("school_id", school_id).is_("deleted_at", "null").execute()
        allowed_session_ids = {
            _normalize(row.get("session_id"))
            for row in list(attendance_rows.data or [])
            if _normalize(row.get("student_id")) in linked_ids
        }
        rows = [row for row in rows if _normalize(row.get("id")) in allowed_session_ids]
    elif normalized_role == "teacher":
        if not profile_id:
            raise HTTPException(status_code=403, detail="Teacher profile context is missing")
        staff_member = _get_staff_member_by_profile_id(school_id, profile_id)
        teacher_staff_id = _normalize(staff_member.get("id"))
        rows = [
            row
            for row in rows
            if teacher_staff_id
            and _normalize((timetable_lookup.get(_normalize(row.get("timetable_entry_id")), {}) or {}).get("staff_member_id")) == teacher_staff_id
        ]

    sessions: list[dict[str, Any]] = []
    for row in rows:
        timetable_view = get_timetable_entry(school_id, _normalize(row.get("timetable_entry_id")))
        sessions.append(_serialize_session(row, timetable_view))
    return sessions


def create_live_class(
    school_id: str,
    profile_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    timetable_entry_id = _normalize_optional_uuid(payload.get("timetable_entry_id"))
    if not timetable_entry_id:
        raise HTTPException(status_code=400, detail="Timetable entry is required")
    timetable_row = _get_timetable_row(school_id, timetable_entry_id)
    session_date = _to_date(payload.get("session_date"))
    provider = _ensure_provider(_normalize(payload.get("provider") or payload.get("online_provider") or "google_meet"))
    meeting_link = payload.get("meeting_link") or payload.get("online_link") or timetable_row.get("online_link")

    scheduled_start_at = _to_iso_datetime(payload.get("scheduled_start_at"))
    scheduled_end_at = _to_iso_datetime(payload.get("scheduled_end_at"))

    row = {
        "school_id": school_id,
        "timetable_entry_id": timetable_entry_id,
        "course_id": _normalize_optional_uuid(payload.get("course_id")),
        "module_id": _normalize_optional_uuid(payload.get("module_id")),
        "lesson_id": _normalize_optional_uuid(payload.get("lesson_id")),
        "session_date": session_date.isoformat(),
        "provider": provider,
        "provider_session_id": _normalize(payload.get("provider_session_id")) or None,
        "meeting_link": meeting_link,
        "meeting_id": _normalize(payload.get("meeting_id")) or None,
        "meeting_password": _normalize(payload.get("meeting_password")) or None,
        "scheduled_start_at": scheduled_start_at,
        "scheduled_end_at": scheduled_end_at,
        "status": "scheduled",
        "notes_url": payload.get("notes_url"),
        "recording_url": payload.get("recording_url"),
        "created_by_profile_id": _normalize_optional_uuid(profile_id),
        "metadata": _normalize_json_object(payload.get("metadata")),
    }
    created = (
        _academic_table("live_class_sessions")
        .upsert(row, on_conflict="school_id,timetable_entry_id,session_date")
        .execute()
    )
    rows = list(created.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to save live class session")
    created_row = dict(rows[0])
    _sync_timetable_live_fields(
        school_id,
        timetable_entry_id,
        {
            "provider": provider,
            "meeting_link": meeting_link,
            "meeting_id": row.get("meeting_id"),
            "meeting_password": row.get("meeting_password"),
            "recording_url": row.get("recording_url"),
            "session_mode": "online",
        },
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="live_classes.session_created",
        entity_id=_normalize(created_row.get("id")),
        payload={"timetable_entry_id": timetable_entry_id, "provider": provider, "session_date": session_date.isoformat()},
    )
    create_notification(
        school_id=school_id,
        title="Live class scheduled",
        message=f"Live class scheduled for {session_date.isoformat()} via {provider.replace('_', ' ').title()}",
        notification_type="system",
        profile_id=_normalize_optional_uuid(profile_id),
        payload={"module": "live_classes", "event": "scheduled", "session_id": _normalize(created_row.get("id"))},
    )
    return _serialize_session(created_row, get_timetable_entry(school_id, timetable_entry_id))


def get_live_class(school_id: str, session_id: str) -> dict[str, Any]:
    row = _get_session_row(school_id, session_id)
    return _serialize_session(row, get_timetable_entry(school_id, _normalize(row.get("timetable_entry_id"))))


def start_live_class(school_id: str, session_id: str, profile_id: str | None) -> dict[str, Any]:
    row = _get_session_row(school_id, session_id)
    updated = (
        _academic_table("live_class_sessions")
        .update(
            {
                "status": "live",
                "actual_start_at": row.get("actual_start_at") or _utc_now_iso(),
                "started_by_profile_id": _normalize_optional_uuid(profile_id),
            }
        )
        .eq("id", session_id)
        .eq("school_id", school_id)
        .execute()
    )
    result = dict((list(updated.data or []) or [row])[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="live_classes.session_started", entity_id=session_id)
    create_notification(
        school_id=school_id,
        title="Live class started",
        message="Class is live now.",
        notification_type="system",
        profile_id=_normalize_optional_uuid(profile_id),
        payload={"module": "live_classes", "event": "started", "session_id": session_id},
    )
    return _serialize_session(result, get_timetable_entry(school_id, _normalize(result.get("timetable_entry_id"))))


def end_live_class(school_id: str, session_id: str, profile_id: str | None) -> dict[str, Any]:
    row = _get_session_row(school_id, session_id)
    updated = (
        _academic_table("live_class_sessions")
        .update(
            {
                "status": "ended",
                "actual_end_at": _utc_now_iso(),
                "ended_by_profile_id": _normalize_optional_uuid(profile_id),
            }
        )
        .eq("id", session_id)
        .eq("school_id", school_id)
        .execute()
    )
    result = dict((list(updated.data or []) or [row])[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="live_classes.session_ended", entity_id=session_id)
    return _serialize_session(result, get_timetable_entry(school_id, _normalize(result.get("timetable_entry_id"))))


def join_live_class(
    school_id: str,
    session_id: str,
    *,
    profile_id: str | None,
    role_key: str,
) -> dict[str, Any]:
    if not profile_id:
        raise HTTPException(status_code=403, detail="Authenticated profile context is required")
    _get_session_row(school_id, session_id)
    student_id: str | None = None
    if _normalize(role_key).lower() == "student":
        student_id = _normalize(_get_student_by_profile_id(school_id, profile_id).get("id")) or None

    existing_rows = list(
        _academic_table("live_class_attendance")
        .select("*")
        .eq("school_id", school_id)
        .eq("session_id", session_id)
        .eq("profile_id", profile_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    now_iso = _utc_now_iso()
    if existing_rows:
        row = dict(existing_rows[0])
        if row.get("leave_timestamp"):
            updated = (
                _academic_table("live_class_attendance")
                .update({"leave_timestamp": None, "join_timestamp": row.get("join_timestamp") or now_iso})
                .eq("id", row.get("id"))
                .execute()
            )
            row = dict((list(updated.data or []) or [row])[0])
        return _serialize_attendance(row, participant_name=_normalize(_get_profile_row(profile_id).get("full_name")))

    created = (
        _academic_table("live_class_attendance")
        .insert(
            {
                "school_id": school_id,
                "session_id": session_id,
                "profile_id": profile_id,
                "student_id": student_id,
                "role_key": _normalize(role_key).lower() or "student",
                "join_timestamp": now_iso,
                "metadata": {"joined_via": "erp"},
            }
        )
        .execute()
    )
    rows = list(created.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create live class attendance")
    row = dict(rows[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="live_classes.joined", entity_id=session_id)
    return _serialize_attendance(row, participant_name=_normalize(_get_profile_row(profile_id).get("full_name")))


def leave_live_class(
    school_id: str,
    session_id: str,
    *,
    profile_id: str | None,
) -> dict[str, Any]:
    if not profile_id:
        raise HTTPException(status_code=403, detail="Authenticated profile context is required")
    rows = list(
        _academic_table("live_class_attendance")
        .select("*")
        .eq("school_id", school_id)
        .eq("session_id", session_id)
        .eq("profile_id", profile_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Live class attendance record not found")
    row = dict(rows[0])
    if row.get("leave_timestamp"):
        return _serialize_attendance(row, participant_name=_normalize(_get_profile_row(profile_id).get("full_name")))

    session_row = _get_session_row(school_id, session_id)
    timetable_row = _get_timetable_row(school_id, _normalize(session_row.get("timetable_entry_id")))
    join_ts = datetime.fromisoformat(str(row.get("join_timestamp")).replace("Z", "+00:00"))
    leave_ts = _utc_now()
    total_seconds = max(int((leave_ts - join_ts).total_seconds()), 0)
    expected_seconds = _compute_expected_duration_seconds(session_row, timetable_row)
    percentage, attendance_status = _attendance_band(total_seconds, expected_seconds)

    updated = (
        _academic_table("live_class_attendance")
        .update(
            {
                "leave_timestamp": leave_ts.isoformat(),
                "total_duration_seconds": total_seconds,
                "attendance_percentage": percentage,
                "attendance_status": attendance_status,
            }
        )
        .eq("id", row.get("id"))
        .execute()
    )
    result = dict((list(updated.data or []) or [row])[0])
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="live_classes.left",
        entity_id=session_id,
        payload={"attendance_status": attendance_status, "attendance_percentage": percentage},
    )
    return _serialize_attendance(result, participant_name=_normalize(_get_profile_row(profile_id).get("full_name")))


def get_live_class_attendance(
    school_id: str,
    session_id: str,
    *,
    role_key: str = "",
    profile_id: str | None = None,
    user_email: str | None = None,
) -> list[dict[str, Any]]:
    _get_session_row(school_id, session_id)
    rows = _fetch_attendance_rows(session_id)
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        linked_ids = {_normalize(item.get("id")) for item in linked_students}
        rows = [row for row in rows if _normalize(row.get("student_id")) in linked_ids]
    profile_lookup = {
        _normalize(row.get("id")): dict(row)
        for row in list(
            _public_table("profiles")
            .select("id,full_name")
            .in_("id", [_normalize(item.get("profile_id")) for item in rows if item.get("profile_id")])
            .execute()
            .data
            or []
        )
    } if rows else {}
    student_lookup = {
        _normalize(row.get("id")): dict(row)
        for row in list(
            _public_table("students")
            .select("id,full_name")
            .in_("id", [_normalize(item.get("student_id")) for item in rows if item.get("student_id")])
            .execute()
            .data
            or []
        )
    } if rows else {}
    items: list[dict[str, Any]] = []
    for row in rows:
        participant_name = _normalize((student_lookup.get(_normalize(row.get("student_id"))) or {}).get("full_name"))
        if not participant_name:
            participant_name = _normalize((profile_lookup.get(_normalize(row.get("profile_id"))) or {}).get("full_name"))
        items.append(_serialize_attendance(row, participant_name=participant_name))
    return items


def _append_lms_resource(
    *,
    school_id: str,
    session_id: str,
    course_id: str | None,
    lesson_id: str | None,
    title: str,
    resource_url: str | None,
    text_content: str | None,
    resource_type: str,
    metadata: dict[str, Any],
) -> None:
    lesson_uuid = _normalize_optional_uuid(lesson_id)
    course_uuid = _normalize_optional_uuid(course_id)
    if not lesson_uuid or not course_uuid:
        return
    _lms_table("lesson_resources").insert(
        {
            "school_id": school_id,
            "course_id": course_uuid,
            "lesson_id": lesson_uuid,
            "resource_type": resource_type,
            "title": title,
            "resource_url": resource_url,
            "text_content": text_content,
            "metadata": {
                **metadata,
                "source": "live_classes",
                "session_id": session_id,
            },
            "is_downloadable": True,
        }
    ).execute()


def upload_live_class_recording(
    school_id: str,
    session_id: str,
    profile_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    session_row = _get_session_row(school_id, session_id)
    row = {
        "school_id": school_id,
        "session_id": session_id,
        "course_id": _normalize_optional_uuid(payload.get("course_id") or session_row.get("course_id")),
        "module_id": _normalize_optional_uuid(payload.get("module_id") or session_row.get("module_id")),
        "lesson_id": _normalize_optional_uuid(payload.get("lesson_id") or session_row.get("lesson_id")),
        "title": _normalize(payload.get("title")) or "Live class recording",
        "recording_url": payload.get("recording_url"),
        "notes_url": payload.get("notes_url"),
        "duration_seconds": int(payload.get("duration_seconds") or 0),
        "published_at": _utc_now_iso(),
        "metadata": _normalize_json_object(payload.get("metadata")),
    }
    if not row["recording_url"]:
        raise HTTPException(status_code=400, detail="Recording URL is required")
    created = _academic_table("live_class_recordings").insert(row).execute()
    rows = list(created.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to save live class recording")
    recording_row = dict(rows[0])

    _academic_table("live_class_sessions").update(
        {
            "recording_url": row["recording_url"],
            "notes_url": row["notes_url"] or session_row.get("notes_url"),
        }
    ).eq("id", session_id).eq("school_id", school_id).execute()

    _sync_timetable_live_fields(
        school_id,
        _normalize(session_row.get("timetable_entry_id")),
        {
            "recording_url": row["recording_url"],
            "provider": session_row.get("provider"),
            "meeting_link": session_row.get("meeting_link"),
            "meeting_id": session_row.get("meeting_id"),
            "meeting_password": session_row.get("meeting_password"),
        },
    )

    _append_lms_resource(
        school_id=school_id,
        session_id=session_id,
        course_id=_normalize(recording_row.get("course_id")) or None,
        lesson_id=_normalize(recording_row.get("lesson_id")) or None,
        title=_normalize(recording_row.get("title")) or "Live class recording",
        resource_url=recording_row.get("recording_url"),
        text_content=None,
        resource_type="recording",
        metadata=_normalize_json_object(recording_row.get("metadata")),
    )
    if recording_row.get("notes_url"):
        _append_lms_resource(
            school_id=school_id,
            session_id=session_id,
            course_id=_normalize(recording_row.get("course_id")) or None,
            lesson_id=_normalize(recording_row.get("lesson_id")) or None,
            title=f"{_normalize(recording_row.get('title')) or 'Live class'} notes",
            resource_url=recording_row.get("notes_url"),
            text_content=None,
            resource_type="notes",
            metadata=_normalize_json_object(recording_row.get("metadata")),
        )

    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="live_classes.recording_uploaded",
        entity_id=_normalize(recording_row.get("id")),
        payload={"session_id": session_id, "lesson_id": recording_row.get("lesson_id")},
    )
    create_notification(
        school_id=school_id,
        title="Live class recording available",
        message=_normalize(recording_row.get("title")) or "Recording is now available.",
        notification_type="system",
        profile_id=_normalize_optional_uuid(profile_id),
        payload={"module": "live_classes", "event": "recording_uploaded", "session_id": session_id},
    )
    return _serialize_recording(recording_row)
