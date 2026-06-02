"""Supabase-native invigilator management repository.

Uses `staff_members` table with `staff_type = 'invigilator'` for invigilator
records, and `room_invigilators` for room assignments.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_rooms import _serialize_room


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_date(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = _normalize(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text[:10] if len(text) >= 10 else text


def _get_metadata(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    if isinstance(metadata, str):
        import json
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    return metadata


def _serialize_invigilator(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _get_metadata(row)
    return {
        "id": row.get("id"),
        "staff_id": _normalize(row.get("employee_code")),
        "name": _normalize(row.get("full_name")),
        "email": _normalize(row.get("email")) or None,
        "phone": _normalize(row.get("phone")) or None,
        "department": _normalize(row.get("department")) or None,
        "designation": _normalize(row.get("designation")) or _normalize(metadata.get("designation")) or None,
        "joining_date": _normalize_date(row.get("joining_date")),
        "shift_timing": _normalize(metadata.get("shift_timing")) or None,
        "metadata": metadata,
        "photoDataUrl": metadata.get("photoDataUrl"),
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _base_query(*, extra_select: str = "*"):
    return (
        get_supabase_admin_client()
        .table("staff_members")
        .select(extra_select)
        .eq("staff_type", "invigilator")
    )


def _serialize_room_assignment(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "room_id": row.get("room_id"),
        "invigilator_id": row.get("invigilator_id"),
        "exam_id": row.get("exam_id"),
        "notes": row.get("notes"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _enrich_assignments_with_relations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        assignment = _serialize_room_assignment(row)
        if row.get("invigilator"):
            assignment["invigilator"] = _serialize_invigilator(row["invigilator"])
        if row.get("room"):
            assignment["room"] = _serialize_room(row["room"])
        result.append(assignment)
    return result


def list_invigilators(
    school_id: str,
    *,
    is_active: bool | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = _base_query().eq("school_id", school_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    response = (
        query
        .order("full_name")
        .order("created_at")
        .range(skip, skip + limit - 1)
        .execute()
    )
    rows = list(response.data or [])
    return [_serialize_invigilator(row) for row in rows]


def get_invigilator(school_id: str, invigilator_id: str | int) -> dict[str, Any]:
    response = (
        _base_query()
        .eq("school_id", school_id)
        .eq("id", invigilator_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Invigilator not found")
    return _serialize_invigilator(rows[0])


def create_invigilator(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    staff_id = _normalize(payload.get("staff_id")) or _normalize(payload.get("employee_code"))
    if not staff_id:
        raise HTTPException(status_code=400, detail="Staff ID is required")
    name = _normalize(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Invigilator name is required")

    existing = (
        _base_query(extra_select="id")
        .eq("school_id", school_id)
        .eq("employee_code", staff_id)
        .limit(1)
        .execute()
    )
    if list(existing.data or []):
        raise HTTPException(
            status_code=400,
            detail=f"Invigilator with staff ID '{staff_id}' already exists",
        )

    designation = _normalize(payload.get("designation")) or None
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(metadata)
    if designation:
        metadata["designation"] = designation
    shift_timing = _normalize(payload.get("shift_timing")) or _normalize(metadata.get("shift_timing")) or None
    if shift_timing:
        metadata["shift_timing"] = shift_timing
    photo_data_url = payload.get("photoDataUrl")
    if photo_data_url:
        metadata["photoDataUrl"] = photo_data_url

    row = {
        "school_id": school_id,
        "staff_type": "invigilator",
        "employee_code": staff_id,
        "full_name": name,
        "email": _normalize(payload.get("email")) or None,
        "phone": _normalize(payload.get("phone")) or None,
        "department": _normalize(payload.get("department")) or None,
        "designation": designation,
        "joining_date": _normalize_date(payload.get("joining_date")),
        "metadata": metadata,
        "is_active": bool(payload.get("is_active", True)),
    }
    response = get_supabase_admin_client().table("staff_members").insert(row).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create invigilator")
    return _serialize_invigilator(rows[0])


def update_invigilator(
    school_id: str, invigilator_id: str | int, payload: dict[str, Any]
) -> dict[str, Any]:
    current = get_invigilator(school_id, invigilator_id)

    update_payload: dict[str, Any] = {}
    metadata = _get_metadata(current)

    if "staff_id" in payload:
        next_staff_id = _normalize(payload["staff_id"])
        if not next_staff_id:
            raise HTTPException(status_code=400, detail="Staff ID cannot be empty")
        existing = (
            _base_query(extra_select="id")
            .eq("school_id", school_id)
            .eq("employee_code", next_staff_id)
            .neq("id", invigilator_id)
            .limit(1)
            .execute()
        )
        if list(existing.data or []):
            raise HTTPException(
                status_code=400,
                detail=f"Invigilator with staff ID '{next_staff_id}' already exists",
            )
        update_payload["employee_code"] = next_staff_id

    if "name" in payload:
        name_val = _normalize(payload["name"])
        if name_val:
            update_payload["full_name"] = name_val
    if "email" in payload:
        update_payload["email"] = _normalize(payload["email"]) or None
    if "phone" in payload:
        update_payload["phone"] = _normalize(payload["phone"]) or None
    if "department" in payload:
        update_payload["department"] = _normalize(payload["department"]) or None
    if "designation" in payload:
        desig = _normalize(payload["designation"]) or None
        update_payload["designation"] = desig
        if desig:
            metadata["designation"] = desig
        elif "designation" in metadata:
            del metadata["designation"]
    if "joining_date" in payload:
        update_payload["joining_date"] = _normalize_date(payload["joining_date"])
    if "shift_timing" in payload:
        shift_timing = _normalize(payload["shift_timing"]) or None
        if shift_timing:
            metadata["shift_timing"] = shift_timing
        else:
            metadata.pop("shift_timing", None)
    if "photoDataUrl" in payload:
        photo_data_url = payload.get("photoDataUrl")
        if photo_data_url:
            metadata["photoDataUrl"] = photo_data_url
        else:
            metadata.pop("photoDataUrl", None)
    if "metadata" in payload and isinstance(payload["metadata"], dict):
        metadata = dict(payload["metadata"])
    if "is_active" in payload:
        update_payload["is_active"] = bool(payload["is_active"])

    update_payload["metadata"] = metadata

    if not update_payload:
        return current

    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .update(update_payload)
        .eq("id", invigilator_id)
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        return _serialize_invigilator(rows[0])
    return get_invigilator(school_id, invigilator_id)


def delete_invigilator(school_id: str, invigilator_id: str | int) -> dict[str, Any]:
    get_invigilator(school_id, invigilator_id)
    get_supabase_admin_client().table("room_invigilators").update(
        {"is_active": False}
    ).eq("invigilator_id", invigilator_id).eq("school_id", school_id).execute()
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .update({"is_active": False})
        .eq("id", invigilator_id)
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Invigilator not found")
    return {"message": "Invigilator deleted successfully"}


def get_room_assignments(
    school_id: str,
    *,
    room_id: str | int | None = None,
    invigilator_id: str | int | None = None,
    is_active: bool | None = True,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*, invigilator:invigilator_id(*), room:room_id(*)")
        .eq("school_id", school_id)
    )
    if room_id is not None:
        query = query.eq("room_id", room_id)
    if invigilator_id is not None:
        query = query.eq("invigilator_id", invigilator_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)

    response = (
        query
        .order("created_at")
        .range(skip, skip + limit - 1)
        .execute()
    )
    rows = list(response.data or [])
    return _enrich_assignments_with_relations(rows)


def create_room_assignment(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    room_id = payload.get("room_id")
    invigilator_id = payload.get("invigilator_id")

    if not room_id or not invigilator_id:
        raise HTTPException(status_code=400, detail="room_id and invigilator_id are required")

    room_resp = (
        get_supabase_admin_client()
        .table("rooms")
        .select("id")
        .eq("id", room_id)
        .eq("school_id", school_id)
        .limit(1)
        .execute()
    )
    if not list(room_resp.data or []):
        raise HTTPException(status_code=404, detail="Room not found")

    get_invigilator(school_id, invigilator_id)

    existing_resp = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*")
        .eq("room_id", room_id)
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    existing_rows = list(existing_resp.data or [])
    if existing_rows:
        existing = existing_rows[0]
        update_data: dict[str, Any] = {
            "invigilator_id": invigilator_id,
        }
        if "exam_id" in payload:
            update_data["exam_id"] = payload["exam_id"]
        if "notes" in payload:
            update_data["notes"] = payload["notes"]
        response = (
            get_supabase_admin_client()
            .table("room_invigilators")
            .update(update_data)
            .eq("id", existing["id"])
            .execute()
        )
        rows = list(response.data or [])
        if rows:
            return _serialize_room_assignment(rows[0])
        raise HTTPException(status_code=500, detail="Failed to update room assignment")

    row = {
        "school_id": school_id,
        "room_id": room_id,
        "invigilator_id": invigilator_id,
        "exam_id": payload.get("exam_id"),
        "notes": payload.get("notes"),
        "is_active": True,
    }
    response = get_supabase_admin_client().table("room_invigilators").insert(row).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create room assignment")
    return _serialize_room_assignment(rows[0])


def get_room_invigilators(school_id: str, room_id: str | int) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*, invigilator:invigilator_id(*)")
        .eq("room_id", room_id)
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    rows = list(response.data or [])
    result = []
    for row in rows:
        invig_data = row.get("invigilator")
        if invig_data:
            result.append(_serialize_invigilator(invig_data))
    return result


def update_room_assignment(
    school_id: str, assignment_id: str | int, payload: dict[str, Any]
) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*")
        .eq("id", assignment_id)
        .eq("school_id", school_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    current = rows[0]

    update_payload: dict[str, Any] = {}

    if "invigilator_id" in payload and payload["invigilator_id"] is not None:
        new_invigilator_id = payload["invigilator_id"]
        get_invigilator(school_id, new_invigilator_id)
        dup_check = (
            get_supabase_admin_client()
            .table("room_invigilators")
            .select("id")
            .eq("room_id", current["room_id"])
            .eq("invigilator_id", new_invigilator_id)
            .neq("id", assignment_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if list(dup_check.data or []):
            raise HTTPException(
                status_code=400,
                detail="New invigilator is already assigned to this room",
            )
        update_payload["invigilator_id"] = new_invigilator_id

    if "exam_id" in payload:
        update_payload["exam_id"] = payload["exam_id"]
    if "notes" in payload:
        update_payload["notes"] = payload["notes"]
    if "is_active" in payload:
        update_payload["is_active"] = bool(payload["is_active"])

    if not update_payload:
        return _serialize_room_assignment(current)

    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .update(update_payload)
        .eq("id", assignment_id)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        return _serialize_room_assignment(rows[0])
    return _serialize_room_assignment(current)


def delete_room_assignment(school_id: str, assignment_id: str | int) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*")
        .eq("id", assignment_id)
        .eq("school_id", school_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")

    get_supabase_admin_client().table("room_invigilators").update(
        {"is_active": False}
    ).eq("id", assignment_id).execute()
    return {"message": "Invigilator assignment removed from room"}


def delete_all_room_assignments(school_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    rows = list(response.data or [])
    count = len(rows)
    if not count:
        return {"message": "No active invigilator assignments found", "deleted_count": 0}

    get_supabase_admin_client().table("room_invigilators").update(
        {"is_active": False}
    ).eq("school_id", school_id).eq("is_active", True).execute()
    return {
        "message": "All invigilator assignments removed successfully",
        "deleted_count": count,
    }


def get_invigilator_with_rooms(school_id: str, invigilator_id: str | int) -> dict[str, Any]:
    invigilator = get_invigilator(school_id, invigilator_id)

    response = (
        get_supabase_admin_client()
        .table("room_invigilators")
        .select("*, invigilator:invigilator_id(*), room:room_id(*)")
        .eq("invigilator_id", invigilator_id)
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(response.data or [])
    room_assignments = _enrich_assignments_with_relations(rows)

    invigilator["room_assignments"] = room_assignments
    return invigilator
