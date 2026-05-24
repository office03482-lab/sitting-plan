"""Supabase-native timetable repository for production-safe routes."""

from __future__ import annotations

from datetime import datetime
import logging
import re
import time
from typing import Any, Iterable

from fastapi import HTTPException, status

from app.services.supabase_admin import get_supabase_admin_client

logger = logging.getLogger(__name__)

TIMETABLE_SCHEMA = "scheduling"
TIMETABLE_TABLE = "timetable_entries"

NO_TEACHER_SESSION_TYPES = {"break_time", "self_study"}
SESSION_TYPE_TO_DB = {
    "regular_class": "regular_class",
    "extra_class": "extra_class",
    "exam": "exam",
    "lab": "lab",
    "activity": "activity",
    "doubt_session": "activity",
    "break_time": "activity",
    "self_study": "activity",
}
LOOKUP_CACHE_TTL_SECONDS = 30.0
_SUBJECT_LOOKUP_CACHE: dict[tuple[str, tuple[str, ...]], tuple[float, dict[str, dict[str, Any]]]] = {}
_STAFF_LOOKUP_CACHE: dict[tuple[str, tuple[str, ...]], tuple[float, dict[str, dict[str, Any]]]] = {}
_ROOM_LOOKUP_CACHE: dict[tuple[str, tuple[str, ...]], tuple[float, dict[str, dict[str, Any]]]] = {}
_TIMETABLE_LIST_CACHE: dict[tuple[str, str, str, str, str], tuple[float, list[dict[str, Any]]]] = {}


def _clear_timetable_caches() -> None:
    _TIMETABLE_LIST_CACHE.clear()


def normalize_session_type_for_db(session_type: str | None) -> str:
    normalized = str(session_type or "regular_class").strip().lower()
    return SESSION_TYPE_TO_DB.get(normalized, "regular_class")


def resolve_ui_session_type(row: dict[str, Any]) -> str:
    metadata = row.get("metadata") or {}
    if isinstance(metadata, dict):
        ui_value = str(metadata.get("ui_session_type") or "").strip().lower()
        if ui_value:
            return ui_value
    return str(row.get("session_type") or "regular_class").strip().lower() or "regular_class"


def is_no_teacher_session(session_type: str | None) -> bool:
    return str(session_type or "").strip().lower() in NO_TEACHER_SESSION_TYPES


def get_timetable_table_query(supabase: Any | None = None) -> Any:
    client = supabase or get_supabase_admin_client()
    return client.schema(TIMETABLE_SCHEMA).table(TIMETABLE_TABLE)


def validate_timetable_schema_resolution() -> None:
    """
    Fail fast if PostgREST cannot resolve the scheduling.timetable_entries relation.
    """
    logger.info(
        "timetable.schema_resolution_check.start schema=%s table=%s",
        TIMETABLE_SCHEMA,
        TIMETABLE_TABLE,
    )
    try:
        get_timetable_table_query().select("id").limit(1).execute()
    except Exception as exc:
        raise RuntimeError(
            "Supabase/PostgREST could not resolve timetable table "
            f"{TIMETABLE_SCHEMA}.{TIMETABLE_TABLE}. "
            "Expected query path is client.schema('scheduling').table('timetable_entries'). "
            "A common cause is accidentally querying 'public.scheduling.timetable_entries' "
            "by passing a schema-qualified table name into .table(...), or a stale/misconfigured "
            "PostgREST exposed schema cache."
        ) from exc
    logger.info(
        "timetable.schema_resolution_check.ok schema=%s table=%s",
        TIMETABLE_SCHEMA,
        TIMETABLE_TABLE,
    )


def _sanitize_lookup_ids(values: Iterable[str]) -> list[str]:
    normalized = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "None":
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _normalize_batch_label(value: Any) -> str:
    return str(value or "").strip()


def _split_batch_label(value: Any) -> tuple[str, str]:
    normalized = _normalize_batch_label(value)
    if not normalized:
        return "", ""
    if "|" in normalized:
        left, right = normalized.split("|", 1)
        return left.strip(), right.strip() or "A"
    if "-" in normalized:
        left, right = normalized.split("-", 1)
        return left.strip(), right.strip() or "A"
    spaced_match = re.match(r"^(.*\S)\s+([A-Za-z0-9]{1,3})$", normalized)
    if spaced_match:
        return spaced_match.group(1).strip(), spaced_match.group(2).strip() or "A"
    return normalized, "A"


def _expand_timetable_batches(class_name: Any) -> list[tuple[str, str]]:
    normalized_values = [item.strip() for item in _normalize_batch_label(class_name).split(",") if item.strip()]
    seen: set[tuple[str, str]] = set()
    expanded: list[tuple[str, str]] = []
    for value in normalized_values:
        normalized_class_name, normalized_section = _split_batch_label(value)
        if not normalized_class_name:
            continue
        entry = (normalized_class_name, normalized_section or "A")
        if entry in seen:
            continue
        seen.add(entry)
        expanded.append(entry)
    return expanded


def _sync_timetable_entry_batches(school_id: str, timetable_entry_id: str, class_name: Any) -> None:
    supabase = get_supabase_admin_client()
    (
        supabase
        .schema(TIMETABLE_SCHEMA)
        .table("timetable_entry_batches")
        .delete()
        .eq("timetable_entry_id", timetable_entry_id)
        .execute()
    )

    batch_rows = [
        {
            "timetable_entry_id": timetable_entry_id,
            "school_id": school_id,
            "class_name": normalized_class_name,
            "section": normalized_section,
        }
        for normalized_class_name, normalized_section in _expand_timetable_batches(class_name)
    ]
    if not batch_rows:
        return
    (
        supabase
        .schema(TIMETABLE_SCHEMA)
        .table("timetable_entry_batches")
        .insert(batch_rows)
        .execute()
    )


def _fetch_subject_lookup(school_id: str, subject_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(subject_ids)
    if not ids:
        return {}
    cache_key = (school_id, tuple(ids))
    cached = _SUBJECT_LOOKUP_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] <= LOOKUP_CACHE_TTL_SECONDS:
        return cached[1]
    response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name, class_name, batch_id, metadata, is_active")
        .eq("school_id", school_id)
        .in_("id", ids)
        .execute()
    )
    lookup = {str(item["id"]): item for item in list(response.data or [])}
    _SUBJECT_LOOKUP_CACHE[cache_key] = (now, lookup)
    return lookup


def _resolve_subject_id_for_timetable(school_id: str, class_name: Any, subject_name: Any) -> str | None:
    normalized_subject = _normalize_batch_label(subject_name)
    if not normalized_subject:
        return None

    expanded_batches = _expand_timetable_batches(class_name)
    first_class_name = expanded_batches[0][0] if expanded_batches else ""
    response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name, class_name, metadata")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .ilike("name", normalized_subject)
        .limit(25)
        .execute()
    )
    candidates = list(response.data or [])
    if not candidates:
        return None

    normalized_class_key = first_class_name.strip().casefold()
    for row in candidates:
        row_class_name = _normalize_batch_label(row.get("class_name")).casefold()
        if normalized_class_key and row_class_name == normalized_class_key:
            return str(row.get("id"))
    return str(candidates[0].get("id")) if candidates[0].get("id") else None


def _fetch_staff_lookup(school_id: str, staff_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(staff_ids)
    if not ids:
        return {}
    cache_key = (school_id, tuple(ids))
    cached = _STAFF_LOOKUP_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] <= LOOKUP_CACHE_TTL_SECONDS:
        return cached[1]
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("staff_members")
        .select("id, full_name, employee_code, department, designation, is_active")
        .eq("school_id", school_id)
        .in_("id", ids)
        .execute()
    )
    lookup = {str(item["id"]): item for item in list(response.data or [])}
    _STAFF_LOOKUP_CACHE[cache_key] = (now, lookup)
    return lookup


def _fetch_room_lookup(school_id: str, room_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(room_ids)
    if not ids:
        return {}
    cache_key = (school_id, tuple(ids))
    cached = _ROOM_LOOKUP_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] <= LOOKUP_CACHE_TTL_SECONDS:
        return cached[1]
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("rooms")
        .select("id, name")
        .eq("school_id", school_id)
        .in_("id", ids)
        .execute()
    )
    lookup = {str(item["id"]): item for item in list(response.data or [])}
    _ROOM_LOOKUP_CACHE[cache_key] = (now, lookup)
    return lookup


def _ensure_system_staff_member(school_id: str, session_type: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    employee_code = "SYS_BREAK" if session_type == "break_time" else "SYS_SELF_STUDY"
    full_name = "BREAK TIME" if session_type == "break_time" else "SELF STUDY"
    existing = (
        supabase
        .table("staff_members")
        .select("id, full_name")
        .eq("school_id", school_id)
        .eq("employee_code", employee_code)
        .limit(1)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        return rows[0]

    created = (
        supabase
        .table("staff_members")
        .insert({
            "school_id": school_id,
            "employee_code": employee_code,
            "full_name": full_name,
            "staff_type": "teaching",
            "department": "system",
            "designation": "System",
            "employment_status": "active",
            "is_active": False,
            "metadata": {"system_generated": True, "ui_session_type": session_type},
        })
        .select("id, full_name")
        .single()
        .execute()
    )
    if not created.data:
        raise HTTPException(status_code=500, detail="Failed to provision system staff member")
    return dict(created.data)


def _is_outside_date_range(row: dict[str, Any], reference_date: str) -> bool:
    start_date = row.get("start_date")
    end_date = row.get("end_date")
    if not start_date and not end_date:
        return False
    ref = str(reference_date)[:10]
    if start_date and ref < str(start_date)[:10]:
        return True
    if end_date and ref > str(end_date)[:10]:
        return True
    return False


def serialize_timetable_row(
    row: dict[str, Any],
    *,
    teacher_name: str | None = None,
    room_name: str | None = None,
    subject_name: str | None = None,
) -> dict[str, Any]:
    ui_session_type = resolve_ui_session_type(row)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    subject_value = str((metadata or {}).get("subject") or subject_name or "").strip()
    return {
        "id": row.get("id"),
        "teacher_id": row.get("staff_member_id"),
        "room_id": row.get("room_id"),
        "school_id": row.get("school_id"),
        "session_mode": row.get("session_mode") or "offline",
        "session_type": ui_session_type,
        "extra_class_scope": metadata.get("extra_class_scope"),
        "online_platform": metadata.get("online_platform"),
        "online_link": row.get("online_link"),
        "notes": row.get("notes"),
        "day_of_week": row.get("day_of_week"),
        "start_time": str(row.get("start_time") or "")[:5],
        "end_time": str(row.get("end_time") or "")[:5],
        "class_name": row.get("class_name") or "",
        "subject": subject_value,
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "start_date": row.get("start_date"),
        "end_date": row.get("end_date"),
        "teacher_name": teacher_name,
        "room_name": room_name,
    }


def list_timetable_entries(
    school_id: str,
    *,
    day_of_week: str | None = None,
    teacher_id: str | None = None,
    class_name: str | None = None,
    room_id: str | None = None,
    reference_date: str | None = None,
) -> list[dict[str, Any]]:
    cache_key = (
        school_id,
        day_of_week or "",
        teacher_id or "",
        (class_name or "").strip().casefold(),
        room_id or "",
        reference_date or "",
    )
    cached = _TIMETABLE_LIST_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] <= LOOKUP_CACHE_TTL_SECONDS:
        return [dict(item) for item in cached[1]]
    query = (
        get_timetable_table_query()
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if day_of_week:
        query = query.eq("day_of_week", day_of_week)
    if teacher_id:
        query = query.eq("staff_member_id", teacher_id)
    if class_name:
        query = query.ilike("class_name", f"%{class_name.strip()}%")
    if room_id:
        query = query.eq("room_id", room_id)
    response = query.order("day_of_week").order("start_time").execute()
    rows = list(response.data or [])
    if reference_date:
        rows = [r for r in rows if not _is_outside_date_range(r, reference_date)]
    staff_lookup = _fetch_staff_lookup(school_id, [row.get("staff_member_id") for row in rows])
    room_lookup = _fetch_room_lookup(school_id, [row.get("room_id") for row in rows])
    subject_lookup = _fetch_subject_lookup(school_id, [row.get("subject_id") for row in rows])
    serialized_rows = [
        serialize_timetable_row(
            row,
            teacher_name=(staff_lookup.get(str(row.get("staff_member_id"))) or {}).get("full_name"),
            room_name=(room_lookup.get(str(row.get("room_id"))) or {}).get("name"),
            subject_name=(subject_lookup.get(str(row.get("subject_id"))) or {}).get("name"),
        )
        for row in rows
    ]
    _TIMETABLE_LIST_CACHE[cache_key] = (now, serialized_rows)
    return [dict(item) for item in serialized_rows]


def get_timetable_entry(school_id: str, entry_id: str) -> dict[str, Any]:
    response = (
        get_timetable_table_query()
        .select("*")
        .eq("id", entry_id)
        .eq("school_id", school_id)
        .single()
        .execute()
    )
    row = response.data
    if not row:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    staff_lookup = _fetch_staff_lookup(school_id, [row.get("staff_member_id")])
    room_lookup = _fetch_room_lookup(school_id, [row.get("room_id")])
    subject_lookup = _fetch_subject_lookup(school_id, [row.get("subject_id")])
    return serialize_timetable_row(
        row,
        teacher_name=(staff_lookup.get(str(row.get("staff_member_id"))) or {}).get("full_name"),
        room_name=(room_lookup.get(str(row.get("room_id"))) or {}).get("name"),
        subject_name=(subject_lookup.get(str(row.get("subject_id"))) or {}).get("name"),
    )


def _build_timetable_response(
    school_id: str,
    row: dict[str, Any],
    *,
    teacher_name: str | None = None,
    room_name: str | None = None,
    subject_name: str | None = None,
) -> dict[str, Any]:
    resolved_teacher_name = teacher_name
    if resolved_teacher_name is None and row.get("staff_member_id"):
        resolved_teacher_name = (_fetch_staff_lookup(school_id, [row.get("staff_member_id")]).get(str(row.get("staff_member_id"))) or {}).get("full_name")

    resolved_room_name = room_name
    if resolved_room_name is None and row.get("room_id"):
        resolved_room_name = (_fetch_room_lookup(school_id, [row.get("room_id")]).get(str(row.get("room_id"))) or {}).get("name")

    resolved_subject_name = subject_name
    if resolved_subject_name is None and row.get("subject_id"):
        resolved_subject_name = (_fetch_subject_lookup(school_id, [row.get("subject_id")]).get(str(row.get("subject_id"))) or {}).get("name")

    return serialize_timetable_row(
        row,
        teacher_name=resolved_teacher_name,
        room_name=resolved_room_name,
        subject_name=resolved_subject_name,
    )


def _check_room_exists(school_id: str, room_id: str | None) -> str | None:
    if not room_id:
        return None
    supabase = get_supabase_admin_client()
    result = (
        supabase
        .table("rooms")
        .select("id")
        .eq("id", room_id)
        .eq("school_id", school_id)
        .limit(1)
        .execute()
    )
    if not list(result.data or []):
        raise HTTPException(status_code=404, detail="Room not found")
    return room_id


def check_teacher_conflicts(
    school_id: str,
    teacher_id: str,
    day_of_week: str,
    start_time: str,
    end_time: str,
    *,
    exclude_entry_id: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        get_timetable_table_query()
        .select("*")
        .eq("school_id", school_id)
        .eq("staff_member_id", teacher_id)
        .eq("day_of_week", day_of_week)
        .eq("is_active", True)
    )
    response = query.execute()
    rows = [row for row in list(response.data or []) if str(row.get("id")) != str(exclude_entry_id or "")]
    conflicts = []
    for row in rows:
        existing_start = str(row.get("start_time") or "")[:5]
        existing_end = str(row.get("end_time") or "")[:5]
        if start_time < existing_end and end_time > existing_start:
            conflicts.append(row)
    return conflicts


def create_timetable_entry(school_id: str, entry_data: dict[str, Any]) -> dict[str, Any]:
    ui_session_type = str(entry_data.get("session_type") or "regular_class").strip().lower()
    room_id = _check_room_exists(school_id, entry_data.get("room_id"))
    teacher_id = entry_data.get("teacher_id")
    teacher_name: str | None = None
    if is_no_teacher_session(ui_session_type):
        system_teacher = _ensure_system_staff_member(school_id, ui_session_type)
        teacher_id = system_teacher["id"]
        teacher_name = system_teacher.get("full_name")
    elif not teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is required")

    if not is_no_teacher_session(ui_session_type):
        teacher_lookup = _fetch_staff_lookup(school_id, [str(teacher_id)])
        teacher_name = (teacher_lookup.get(str(teacher_id)) or {}).get("full_name") or "Teacher"
        conflicts = check_teacher_conflicts(
            school_id,
            str(teacher_id),
            str(entry_data["day_of_week"]),
            str(entry_data["start_time"]),
            str(entry_data["end_time"]),
        )
        if conflicts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Teacher conflict: {teacher_name} is already assigned during this time",
            )

    metadata = {
        "subject": entry_data.get("subject"),
        "ui_session_type": ui_session_type,
        "extra_class_scope": entry_data.get("extra_class_scope"),
        "online_platform": entry_data.get("online_platform"),
    }
    payload = {
        "school_id": school_id,
        "staff_member_id": teacher_id,
        "room_id": room_id,
        "day_of_week": entry_data.get("day_of_week"),
        "start_time": entry_data.get("start_time"),
        "end_time": entry_data.get("end_time"),
        "class_name": entry_data.get("class_name"),
        "section": None,
        "subject_id": _resolve_subject_id_for_timetable(school_id, entry_data.get("class_name"), entry_data.get("subject")),
        "session_mode": entry_data.get("session_mode") or "offline",
        "session_type": normalize_session_type_for_db(ui_session_type),
        "online_link": entry_data.get("online_link"),
        "notes": entry_data.get("notes"),
        "metadata": metadata,
        "is_active": bool(entry_data.get("is_active", True)),
        "start_date": entry_data.get("start_date"),
        "end_date": entry_data.get("end_date"),
    }
    created = (
        get_timetable_table_query()
        .insert(payload)
        .execute()
    )
    created_rows = created.data if isinstance(created.data, list) else ([created.data] if created.data else [])
    if not created_rows:
        raise HTTPException(status_code=500, detail="Timetable entry save returned no row")
    created_row = created_rows[0]
    created_id = created_row.get("id")
    if not created_id:
        raise HTTPException(status_code=500, detail="Timetable entry save returned no id")
    _sync_timetable_entry_batches(school_id, str(created_id), payload.get("class_name"))
    _clear_timetable_caches()
    return _build_timetable_response(
        school_id,
        created_row,
        teacher_name=teacher_name,
        subject_name=entry_data.get("subject"),
    )


def update_timetable_entry(school_id: str, entry_id: str, entry_data: dict[str, Any]) -> dict[str, Any]:
    existing = get_timetable_entry(school_id, entry_id)
    next_session_type = str(entry_data.get("session_type") or existing.get("session_type") or "regular_class").strip().lower()
    next_teacher_id = entry_data.get("teacher_id", existing.get("teacher_id"))
    next_room_id = entry_data.get("room_id", existing.get("room_id"))
    next_day = entry_data.get("day_of_week", existing.get("day_of_week"))
    next_start = entry_data.get("start_time", existing.get("start_time"))
    next_end = entry_data.get("end_time", existing.get("end_time"))

    room_id = _check_room_exists(school_id, next_room_id)
    if is_no_teacher_session(next_session_type):
        next_teacher_id = _ensure_system_staff_member(school_id, next_session_type)["id"]
    elif not next_teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is required")

    if not is_no_teacher_session(next_session_type):
        conflicts = check_teacher_conflicts(
            school_id,
            str(next_teacher_id),
            str(next_day),
            str(next_start),
            str(next_end),
            exclude_entry_id=entry_id,
        )
        if conflicts:
            teacher_lookup = _fetch_staff_lookup(school_id, [str(next_teacher_id)])
            teacher_name = (teacher_lookup.get(str(next_teacher_id)) or {}).get("full_name") or "Teacher"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Teacher conflict: {teacher_name} is already assigned during this time",
            )

    metadata = {
        "subject": entry_data.get("subject", existing.get("subject")),
        "ui_session_type": next_session_type,
        "extra_class_scope": entry_data.get("extra_class_scope", existing.get("extra_class_scope")),
        "online_platform": entry_data.get("online_platform", existing.get("online_platform")),
    }
    payload = {
        "staff_member_id": next_teacher_id,
        "room_id": room_id,
        "day_of_week": next_day,
        "start_time": next_start,
        "end_time": next_end,
        "class_name": entry_data.get("class_name", existing.get("class_name")),
        "subject_id": _resolve_subject_id_for_timetable(
            school_id,
            entry_data.get("class_name", existing.get("class_name")),
            entry_data.get("subject", existing.get("subject")),
        ),
        "session_mode": entry_data.get("session_mode", existing.get("session_mode")),
        "session_type": normalize_session_type_for_db(next_session_type),
        "online_link": entry_data.get("online_link", existing.get("online_link")),
        "notes": entry_data.get("notes", existing.get("notes")),
        "metadata": metadata,
        "is_active": bool(entry_data.get("is_active", existing.get("is_active", True))),
        "start_date": entry_data.get("start_date", existing.get("start_date")),
        "end_date": entry_data.get("end_date", existing.get("end_date")),
    }
    updated = (
        get_timetable_table_query()
        .update(payload)
        .eq("id", entry_id)
        .eq("school_id", school_id)
        .execute()
    )
    updated_rows = updated.data if isinstance(updated.data, list) else ([updated.data] if updated.data else [])
    if not updated_rows:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    _sync_timetable_entry_batches(school_id, entry_id, payload.get("class_name"))
    _clear_timetable_caches()
    return get_timetable_entry(school_id, entry_id)


def delete_timetable_entry(school_id: str, entry_id: str) -> dict[str, Any]:
    updated = (
        get_timetable_table_query()
        .update({"is_active": False})
        .eq("id", entry_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(updated.data or []):
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    _clear_timetable_caches()
    return {"message": "Timetable entry deleted successfully"}


def delete_all_timetable_entries(school_id: str) -> dict[str, Any]:
    existing = (
        get_timetable_table_query()
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        (
            get_timetable_table_query()
            .update({"is_active": False})
            .eq("school_id", school_id)
            .eq("is_active", True)
            .execute()
        )
        _clear_timetable_caches()
    return {"message": f"{len(rows)} timetable entries deleted successfully"}
