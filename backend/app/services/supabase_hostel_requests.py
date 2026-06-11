"""Supabase-native hostel request lifecycle helpers."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_students import get_students_by_ids

HOSTEL_SCHEMA = "hostel"


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _client():
    return get_supabase_admin_client()


def _table(name: str):
    return _client().schema(HOSTEL_SCHEMA).table(name)


def _load_hostels_map(school_id: str) -> dict[str, dict[str, Any]]:
    rows = list(_table("hostels").select("*").eq("school_id", school_id).execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_rooms_map(school_id: str) -> dict[str, dict[str, Any]]:
    rows = list(_table("hostel_rooms").select("*").eq("school_id", school_id).execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_profiles_map(profile_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = [item for item in {_normalize(value) for value in profile_ids} if item]
    if not ids:
        return {}
    rows = list(_client().table("profiles").select("id,full_name,display_name,email").in_("id", ids).execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _profile_name(profile: dict[str, Any] | None) -> str | None:
    if not isinstance(profile, dict):
        return None
    return _normalize(profile.get("display_name") or profile.get("full_name") or profile.get("email")) or None


def _student_map(school_id: str, student_ids: list[str]) -> dict[str, dict[str, Any]]:
    students = get_students_by_ids(school_id, student_ids)
    return {_normalize(student.get("id")): dict(student) for student in students}


def _serialize_request(
    request_row: dict[str, Any],
    *,
    students_map: dict[str, dict[str, Any]],
    hostels_map: dict[str, dict[str, Any]],
    rooms_map: dict[str, dict[str, Any]],
    active_allocations_by_student: dict[str, dict[str, Any]],
    reviewed_profiles_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    student_id = _normalize(request_row.get("student_id"))
    student = students_map.get(student_id, {})
    hostel_id = _normalize(request_row.get("hostel_id"))
    allocation = active_allocations_by_student.get(student_id)
    room_id = _normalize((allocation or {}).get("hostel_room_id") or request_row.get("preferred_room_id"))
    reviewed_by_profile_id = _normalize(request_row.get("reviewed_by_profile_id"))

    room = rooms_map.get(room_id, {})
    hostel = hostels_map.get(_normalize((allocation or {}).get("hostel_id") or hostel_id), {})
    return {
        "id": request_row.get("id"),
        "student_id": student.get("id") or student_id,
        "student_name": student.get("name") or "",
        "roll_number": student.get("roll_number") or "",
        "batch": student.get("batch") or "",
        "class_name": student.get("class_name"),
        "section": student.get("section"),
        "reference_name": student.get("reference_name"),
        "reference_number": student.get("reference_number"),
        "reference_remark": student.get("reference_remark"),
        "hostel_id": hostel.get("id") or hostel_id,
        "hostel_name": _normalize(hostel.get("name")),
        "room_id": room.get("id") or None,
        "room_number": room.get("room_number"),
        "requested_notes": request_row.get("requested_notes"),
        "status": _normalize(request_row.get("status")) or "pending",
        "assigned_bed_label": (allocation or {}).get("bed_label"),
        "reviewed_by": _profile_name(reviewed_profiles_map.get(reviewed_by_profile_id)),
        "review_notes": request_row.get("review_notes"),
        "requested_at": request_row.get("created_at"),
        "reviewed_at": request_row.get("updated_at") if reviewed_by_profile_id else None,
    }


def _load_active_allocation_for_student(school_id: str, student_id: str) -> dict[str, Any] | None:
    rows = list(
        _table("hostel_allocations")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("allocation_status", "active")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else None


def _recalculate_room_occupancy(school_id: str, room_id: str | None) -> None:
    if not room_id:
        return
    client = get_supabase_admin_client()
    count_response = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_allocations")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("hostel_room_id", room_id)
        .eq("allocation_status", "active")
        .eq("is_active", True)
        .limit(0)
        .execute()
    )
    occupied_beds = count_response.count or 0
    client.schema(HOSTEL_SCHEMA).table("hostel_rooms").update({"occupied_beds": occupied_beds}).eq("school_id", school_id).eq("id", room_id).execute()


def _update_student_hostel_metadata(
    school_id: str,
    student_id: str,
    *,
    hostel_required: bool,
    preferred_hostel_id: str | None,
    hostel_request_status: str,
    assigned_hostel_id: str | None,
    assigned_room_id: str | None,
    assigned_bed_label: str | None,
    hostel_notes: str | None,
) -> None:
    student_rows = list(_client().table("students").select("metadata").eq("school_id", school_id).eq("id", student_id).limit(1).execute().data or [])
    if not student_rows:
        raise HTTPException(status_code=404, detail="Student not found")
    metadata = student_rows[0].get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    metadata = dict(metadata)
    metadata.update(
        {
            "preferred_hostel_id": preferred_hostel_id,
            "hostel_request_status": hostel_request_status,
            "assigned_hostel_id": assigned_hostel_id,
            "assigned_room_id": assigned_room_id,
            "assigned_bed_label": assigned_bed_label,
            "hostel_notes": hostel_notes,
        }
    )
    _client().table("students").update(
        {
            "hostel_required": hostel_required,
            "metadata": metadata,
        }
    ).eq("school_id", school_id).eq("id", student_id).execute()


def _pick_room_or_raise(school_id: str, hostel_id: str, preferred_room_id: str | None = None) -> dict[str, Any]:
    query = _table("hostel_rooms").select("*").eq("school_id", school_id).eq("hostel_id", hostel_id).eq("is_active", True)
    rows = list(query.order("room_number", desc=False).execute().data or [])
    if preferred_room_id:
        rows = [row for row in rows if _normalize(row.get("id")) == preferred_room_id]
    for row in rows:
        if int(row.get("occupied_beds") or 0) < int(row.get("total_beds") or 0):
            return dict(row)
    raise HTTPException(status_code=400, detail="No hostel room available for allocation")


def list_hostel_requests(school_id: str, status_filter: Optional[str] = None) -> list[dict[str, Any]]:
    query = _table("hostel_requests").select("*").eq("school_id", school_id).eq("is_active", True)
    if status_filter:
        query = query.eq("status", status_filter)
    request_rows = [dict(row) for row in list(query.order("created_at", desc=True).execute().data or [])]

    student_ids = [_normalize(row.get("student_id")) for row in request_rows]
    students_map = _student_map(school_id, student_ids)
    hostels_map = _load_hostels_map(school_id)
    rooms_map = _load_rooms_map(school_id)

    allocation_rows = [
        dict(row)
        for row in list(
            _table("hostel_allocations")
            .select("*")
            .eq("school_id", school_id)
            .eq("allocation_status", "active")
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
    ]
    active_allocations_by_student = {_normalize(row.get("student_id")): row for row in allocation_rows}
    reviewed_profiles_map = _load_profiles_map([_normalize(row.get("reviewed_by_profile_id")) for row in request_rows])

    return [
        _serialize_request(
            row,
            students_map=students_map,
            hostels_map=hostels_map,
            rooms_map=rooms_map,
            active_allocations_by_student=active_allocations_by_student,
            reviewed_profiles_map=reviewed_profiles_map,
        )
        for row in request_rows
    ]


def _get_request_detail(school_id: str, request_id: str) -> dict[str, Any]:
    items = list_hostel_requests(school_id)
    for item in items:
        if _normalize(item.get("id")) == request_id:
            return item
    raise HTTPException(status_code=404, detail="Hostel request not found")


def create_or_update_hostel_request(
    school_id: str,
    student_id: str,
    *,
    hostel_id: str,
    requested_notes: str | None,
) -> dict[str, Any]:
    student = _student_map(school_id, [student_id]).get(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    hostel = _load_hostels_map(school_id).get(hostel_id)
    if not hostel or not bool(hostel.get("is_active", True)):
        raise HTTPException(status_code=404, detail="Hostel not found")

    active_allocation = _load_active_allocation_for_student(school_id, student_id)
    if active_allocation:
        raise HTTPException(status_code=400, detail="Hostel already allocated for this student")

    existing_rows = list(
        _table("hostel_requests")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    request_id = ""
    if existing_rows and _normalize(existing_rows[0].get("status")) == "pending":
        request_id = existing_rows[0]["id"]
        _table("hostel_requests").update(
            {
                "hostel_id": hostel_id,
                "preferred_room_id": None,
                "requested_notes": requested_notes,
                "status": "pending",
                "review_notes": None,
                "reviewed_by_profile_id": None,
            }
        ).eq("school_id", school_id).eq("id", request_id).execute()
    else:
        inserted = _table("hostel_requests").insert(
            {
                "school_id": school_id,
                "student_id": student_id,
                "hostel_id": hostel_id,
                "requested_notes": requested_notes,
                "status": "pending",
                "is_active": True,
            }
        ).execute()
        inserted_rows = list(inserted.data or [])
        if not inserted_rows:
            raise HTTPException(status_code=500, detail="Failed to create hostel request")
        request_id = _normalize(inserted_rows[0].get("id"))

    _update_student_hostel_metadata(
        school_id,
        student_id,
        hostel_required=True,
        preferred_hostel_id=hostel_id,
        hostel_request_status="pending",
        assigned_hostel_id=None,
        assigned_room_id=None,
        assigned_bed_label=None,
        hostel_notes=requested_notes,
    )
    return _get_request_detail(school_id, request_id)


def approve_hostel_request(
    school_id: str,
    request_id: str,
    *,
    actor_profile_id: str | None,
    hostel_id: str | None = None,
    room_id: str | None = None,
    review_notes: str | None = None,
) -> dict[str, Any]:
    rows = list(_table("hostel_requests").select("*").eq("school_id", school_id).eq("id", request_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    request_row = dict(rows[0])
    student_id = _normalize(request_row.get("student_id"))
    target_hostel_id = hostel_id or _normalize(request_row.get("hostel_id"))
    room = _pick_room_or_raise(school_id, target_hostel_id, preferred_room_id=room_id)

    active_allocation = _load_active_allocation_for_student(school_id, student_id)
    if active_allocation:
        raise HTTPException(status_code=400, detail="Hostel request already approved")

    bed_label = f"Bed {int(room.get('occupied_beds') or 0) + 1}"
    _table("hostel_requests").update(
        {
            "hostel_id": target_hostel_id,
            "preferred_room_id": room.get("id"),
            "status": "approved",
            "review_notes": review_notes,
            "reviewed_by_profile_id": actor_profile_id or None,
        }
    ).eq("school_id", school_id).eq("id", request_id).execute()
    _table("hostel_allocations").insert(
        {
            "school_id": school_id,
            "student_id": student_id,
            "hostel_id": target_hostel_id,
            "hostel_room_id": room.get("id"),
            "bed_label": bed_label,
            "allocation_status": "active",
            "notes": review_notes,
            "is_active": True,
        }
    ).execute()
    _recalculate_room_occupancy(school_id, room.get("id"))
    _update_student_hostel_metadata(
        school_id,
        student_id,
        hostel_required=True,
        preferred_hostel_id=target_hostel_id,
        hostel_request_status="approved",
        assigned_hostel_id=target_hostel_id,
        assigned_room_id=_normalize(room.get("id")),
        assigned_bed_label=bed_label,
        hostel_notes=request_row.get("requested_notes"),
    )
    return _get_request_detail(school_id, request_id)


def move_hostel_allocation(
    school_id: str,
    request_id: str,
    *,
    actor_profile_id: str | None,
    hostel_id: str | None = None,
    room_id: str | None = None,
    review_notes: str | None = None,
) -> dict[str, Any]:
    rows = list(_table("hostel_requests").select("*").eq("school_id", school_id).eq("id", request_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    request_row = dict(rows[0])
    if _normalize(request_row.get("status")) != "approved":
        raise HTTPException(status_code=400, detail="Only approved hostel allocations can be moved")

    student_id = _normalize(request_row.get("student_id"))
    current_allocation = _load_active_allocation_for_student(school_id, student_id)
    if not current_allocation:
        raise HTTPException(status_code=400, detail="No active hostel allocation found")

    target_hostel_id = hostel_id or _normalize(current_allocation.get("hostel_id")) or _normalize(request_row.get("hostel_id"))
    room = _pick_room_or_raise(school_id, target_hostel_id, preferred_room_id=room_id)

    old_room_id = current_allocation.get("hostel_room_id")
    _table("hostel_allocations").update(
        {
            "allocation_status": "moved",
            "is_active": False,
            "end_date": date.today().isoformat(),
        }
    ).eq("school_id", school_id).eq("id", current_allocation["id"]).execute()
    _recalculate_room_occupancy(school_id, old_room_id)

    bed_label = f"Bed {int(room.get('occupied_beds') or 0) + 1}"
    _table("hostel_allocations").insert(
        {
            "school_id": school_id,
            "student_id": student_id,
            "hostel_id": target_hostel_id,
            "hostel_room_id": room.get("id"),
            "bed_label": bed_label,
            "allocation_status": "active",
            "notes": review_notes,
            "is_active": True,
        }
    ).execute()
    _recalculate_room_occupancy(school_id, room.get("id"))
    _table("hostel_requests").update(
        {
            "hostel_id": target_hostel_id,
            "preferred_room_id": room.get("id"),
            "status": "approved",
            "review_notes": review_notes,
            "reviewed_by_profile_id": actor_profile_id or None,
        }
    ).eq("school_id", school_id).eq("id", request_id).execute()
    _update_student_hostel_metadata(
        school_id,
        student_id,
        hostel_required=True,
        preferred_hostel_id=target_hostel_id,
        hostel_request_status="approved",
        assigned_hostel_id=target_hostel_id,
        assigned_room_id=_normalize(room.get("id")),
        assigned_bed_label=bed_label,
        hostel_notes=request_row.get("requested_notes"),
    )
    return _get_request_detail(school_id, request_id)


def reject_hostel_request(
    school_id: str,
    request_id: str,
    *,
    actor_profile_id: str | None,
    review_notes: str | None = None,
) -> dict[str, Any]:
    rows = list(_table("hostel_requests").select("*").eq("school_id", school_id).eq("id", request_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    request_row = dict(rows[0])
    student_id = _normalize(request_row.get("student_id"))

    active_allocation = _load_active_allocation_for_student(school_id, student_id)
    released_room_id: str | None = None
    if active_allocation:
        released_room_id = active_allocation.get("hostel_room_id")
        _table("hostel_allocations").update(
            {
                "allocation_status": "released",
                "is_active": False,
                "end_date": date.today().isoformat(),
            }
        ).eq("school_id", school_id).eq("id", active_allocation["id"]).execute()
    _recalculate_room_occupancy(school_id, released_room_id)

    _table("hostel_requests").update(
        {
            "status": "rejected",
            "review_notes": review_notes,
            "reviewed_by_profile_id": actor_profile_id or None,
        }
    ).eq("school_id", school_id).eq("id", request_id).execute()
    _update_student_hostel_metadata(
        school_id,
        student_id,
        hostel_required=bool(request_row.get("requested_notes") or request_row.get("hostel_id")),
        preferred_hostel_id=None,
        hostel_request_status="rejected",
        assigned_hostel_id=None,
        assigned_room_id=None,
        assigned_bed_label=None,
        hostel_notes=request_row.get("requested_notes"),
    )
    return _get_request_detail(school_id, request_id)


def vacate_hostel_allocation(
    school_id: str,
    request_id: str,
    *,
    actor_profile_id: str | None,
) -> dict[str, Any]:
    rows = list(_table("hostel_requests").select("*").eq("school_id", school_id).eq("id", request_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    request_row = dict(rows[0])
    student_id = _normalize(request_row.get("student_id"))
    active_allocation = _load_active_allocation_for_student(school_id, student_id)
    if not active_allocation:
        raise HTTPException(status_code=400, detail="Only approved hostel allocations can be vacated")

    vacated_room_id = active_allocation.get("hostel_room_id")
    _table("hostel_allocations").update(
        {
            "allocation_status": "released",
            "is_active": False,
            "end_date": date.today().isoformat(),
            "notes": "Vacated",
        }
    ).eq("school_id", school_id).eq("id", active_allocation["id"]).execute()
    _recalculate_room_occupancy(school_id, vacated_room_id)
    _table("hostel_requests").update(
        {
            "status": "approved",
            "review_notes": "Vacated",
            "reviewed_by_profile_id": actor_profile_id or None,
        }
    ).eq("school_id", school_id).eq("id", request_id).execute()
    _update_student_hostel_metadata(
        school_id,
        student_id,
        hostel_required=True,
        preferred_hostel_id=_normalize(request_row.get("hostel_id")) or None,
        hostel_request_status="approved",
        assigned_hostel_id=None,
        assigned_room_id=None,
        assigned_bed_label=None,
        hostel_notes=request_row.get("requested_notes"),
    )
    return _get_request_detail(school_id, request_id)
