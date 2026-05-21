"""Supabase-native timetable repository for production-safe routes."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from fastapi import HTTPException, status

from app.services.supabase_admin import get_supabase_admin_client

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


def _sanitize_lookup_ids(values: Iterable[str]) -> list[str]:
    normalized = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "None":
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _fetch_staff_lookup(school_id: str, staff_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(staff_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("staff_members")
        .select("id, full_name, employee_code, department, designation, is_active")
        .eq("school_id", school_id)
        .in_("id", ids)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


def _fetch_room_lookup(school_id: str, room_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(room_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("rooms")
        .select("id, name")
        .eq("school_id", school_id)
        .in_("id", ids)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


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


def serialize_timetable_row(
    row: dict[str, Any],
    *,
    teacher_name: str | None = None,
    room_name: str | None = None,
) -> dict[str, Any]:
    ui_session_type = resolve_ui_session_type(row)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    subject_value = str((metadata or {}).get("subject") or row.get("subject") or "").strip()
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
) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    query = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
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
    staff_lookup = _fetch_staff_lookup(school_id, [row.get("staff_member_id") for row in rows])
    room_lookup = _fetch_room_lookup(school_id, [row.get("room_id") for row in rows])
    return [
        serialize_timetable_row(
            row,
            teacher_name=(staff_lookup.get(str(row.get("staff_member_id"))) or {}).get("full_name"),
            room_name=(room_lookup.get(str(row.get("room_id"))) or {}).get("name"),
        )
        for row in rows
    ]


def get_timetable_entry(school_id: str, entry_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
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
    return serialize_timetable_row(
        row,
        teacher_name=(staff_lookup.get(str(row.get("staff_member_id"))) or {}).get("full_name"),
        room_name=(room_lookup.get(str(row.get("room_id"))) or {}).get("name"),
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
    supabase = get_supabase_admin_client()
    query = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
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
    if is_no_teacher_session(ui_session_type):
        teacher_id = _ensure_system_staff_member(school_id, ui_session_type)["id"]
    elif not teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is required")

    if not is_no_teacher_session(ui_session_type):
        conflicts = check_teacher_conflicts(
            school_id,
            str(teacher_id),
            str(entry_data["day_of_week"]),
            str(entry_data["start_time"]),
            str(entry_data["end_time"]),
        )
        if conflicts:
            teacher_lookup = _fetch_staff_lookup(school_id, [str(teacher_id)])
            teacher_name = (teacher_lookup.get(str(teacher_id)) or {}).get("full_name") or "Teacher"
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
        "subject": entry_data.get("subject"),
        "subject_id": None,
        "session_mode": entry_data.get("session_mode") or "offline",
        "session_type": normalize_session_type_for_db(ui_session_type),
        "online_link": entry_data.get("online_link"),
        "notes": entry_data.get("notes"),
        "metadata": metadata,
        "is_active": bool(entry_data.get("is_active", True)),
    }
    supabase = get_supabase_admin_client()
    created = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
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
    return get_timetable_entry(school_id, str(created_id))


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
        "subject": entry_data.get("subject", existing.get("subject")),
        "session_mode": entry_data.get("session_mode", existing.get("session_mode")),
        "session_type": normalize_session_type_for_db(next_session_type),
        "online_link": entry_data.get("online_link", existing.get("online_link")),
        "notes": entry_data.get("notes", existing.get("notes")),
        "metadata": metadata,
        "is_active": bool(entry_data.get("is_active", existing.get("is_active", True))),
    }
    supabase = get_supabase_admin_client()
    updated = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
        .update(payload)
        .eq("id", entry_id)
        .eq("school_id", school_id)
        .execute()
    )
    updated_rows = updated.data if isinstance(updated.data, list) else ([updated.data] if updated.data else [])
    if not updated_rows:
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    return get_timetable_entry(school_id, entry_id)


def delete_timetable_entry(school_id: str, entry_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    updated = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
        .update({"is_active": False})
        .eq("id", entry_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(updated.data or []):
        raise HTTPException(status_code=404, detail="Timetable entry not found")
    return {"message": "Timetable entry deleted successfully"}


def delete_all_timetable_entries(school_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    existing = (
        supabase
        .schema("scheduling")
        .table("timetable_entries")
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        (
            supabase
            .schema("scheduling")
            .table("timetable_entries")
            .update({"is_active": False})
            .eq("school_id", school_id)
            .eq("is_active", True)
            .execute()
        )
    return {"message": f"{len(rows)} timetable entries deleted successfully"}
