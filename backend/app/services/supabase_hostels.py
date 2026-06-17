"""Supabase-native hostel repository using hostel schema."""
from __future__ import annotations
import re
import time
from typing import Any
from fastapi import HTTPException
from app.services.supabase_admin import get_supabase_admin_client


HOSTEL_SCHEMA = "hostel"


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _execute_with_retry(action, *, attempts: int = 3, delay_seconds: float = 0.35):
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as exc:
            last_error = exc
            if attempt >= attempts:
                raise
            time.sleep(delay_seconds * attempt)
    if last_error:
        raise last_error
    raise RuntimeError("Retry helper exhausted without result")


def _serialize_hostel_room(row: dict[str, Any]) -> dict[str, Any]:
    total_beds = int(row.get("total_beds") or 0)
    occupied_beds = int(row.get("occupied_beds") or 0)
    return {
        "id": row.get("id"),
        "hostel_id": row.get("hostel_id"),
        "room_number": _normalize(row.get("room_number")),
        "total_beds": total_beds,
        "occupied_beds": occupied_beds,
        "available_beds": max(total_beds - occupied_beds, 0),
        "is_active": bool(row.get("is_active", True)),
    }


def _serialize_hostel(row: dict[str, Any], rooms: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    active_rooms = [r for r in (rooms or []) if r.get("is_active")]
    total_capacity = sum(int(r.get("total_beds") or 0) for r in active_rooms)
    occupied_beds = sum(int(r.get("occupied_beds") or 0) for r in active_rooms)
    return {
        "id": row.get("id"),
        "name": _normalize(row.get("name")),
        "hostel_code": _normalize(row.get("hostel_code")) or None,
        "hostel_head": _normalize(row.get("hostel_head")) or None,
        "warden_name": _normalize(row.get("warden_name")) or None,
        "gender_category": _normalize(row.get("gender_category")) or None,
        "address": _normalize(row.get("address")) or None,
        "is_active": bool(row.get("is_active", True)),
        "total_capacity": total_capacity,
        "occupied_beds": occupied_beds,
        "available_beds": max(total_capacity - occupied_beds, 0),
        "total_rooms": len(active_rooms),
        "rooms": [_serialize_hostel_room(r) for r in active_rooms],
    }


def _normalize_hostel_code(value: Any) -> str:
    normalized = _normalize(value).upper()
    if not normalized:
        return ""
    normalized = re.sub(r"[^A-Z0-9]+", "-", normalized).strip("-")
    return normalized


def _generate_next_hostel_code(school_id: str) -> str:
    client = get_supabase_admin_client()
    response = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("hostel_code")
        .eq("school_id", school_id)
        .execute()
    )
    max_value = 0
    for row in list(response.data or []):
        code = _normalize(row.get("hostel_code")).upper()
        match = re.fullmatch(r"HST-(\d+)", code)
        if match:
            max_value = max(max_value, int(match.group(1)))
    return f"HST-{max_value + 1:04d}"


def _translate_hostel_write_error(exc: Exception) -> HTTPException | None:
    message = str(exc)
    if "hostels_school_hostel_code_key" in message or "duplicate key value" in message:
        return HTTPException(status_code=409, detail="Hostel code already exists")
    return None


def list_hostels(school_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        return []

    hostel_ids = [h["id"] for h in hostels]
    room_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .in_("hostel_id", hostel_ids)
        .execute()
    )
    rooms_by_hostel: dict[str, list[dict[str, Any]]] = {}
    for r in list(room_rows.data or []):
        rooms_by_hostel.setdefault(str(r["hostel_id"]), []).append(r)

    return [_serialize_hostel(h, rooms_by_hostel.get(str(h["id"]))) for h in hostels]


def get_hostel(school_id: str, hostel_id: str) -> dict[str, Any]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        raise HTTPException(status_code=404, detail="Hostel not found")
    hostel = hostels[0]

    room_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel["id"])
        .execute()
    )
    return _serialize_hostel(hostel, list(room_rows.data or []))


def list_hostel_rooms(school_id: str, hostel_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("id")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not list(hostel_rows.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    room_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel_id)
        .eq("is_active", True)
        .order("room_number")
        .execute()
    )
    return [_serialize_hostel_room(row) for row in list(room_rows.data or [])]


def create_hostel(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    name = _normalize(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Hostel name is required")
    explicit_hostel_code = _normalize_hostel_code(payload.get("hostel_code"))
    hostel_code = explicit_hostel_code or _generate_next_hostel_code(school_id)

    response = None
    for _ in range(3):
        hostel_data = {
            "school_id": school_id,
            "hostel_code": hostel_code,
            "name": name,
            "hostel_head": _normalize(payload.get("hostel_head")) or None,
            "warden_name": _normalize(payload.get("warden_name")) or None,
            "gender_category": _normalize(payload.get("gender_category")) or None,
            "address": _normalize(payload.get("address")) or None,
            "is_active": bool(payload.get("is_active", True)),
        }
        try:
            response = client.schema(HOSTEL_SCHEMA).table("hostels").insert(hostel_data).execute()
            break
        except Exception as exc:
            translated = _translate_hostel_write_error(exc)
            if explicit_hostel_code or not translated or translated.status_code != 409:
                if translated:
                    raise translated from exc
                raise
            hostel_code = _generate_next_hostel_code(school_id)

    if response is None:
        raise HTTPException(status_code=409, detail="Unable to allocate a unique hostel code")

    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create hostel")
    hostel = rows[0]

    generated_room_count = max(int(payload.get("total_rooms") or 0), 0)
    rooms = payload.get("rooms") or []

    if generated_room_count:
        room_rows = [
            {
                "school_id": school_id,
                "hostel_id": hostel["id"],
                "room_number": f"Room {i}",
                "total_beds": 2,
                "occupied_beds": 0,
                "is_active": True,
            }
            for i in range(1, generated_room_count + 1)
        ]
    elif rooms:
        room_rows = [
            {
                "school_id": school_id,
                "hostel_id": hostel["id"],
                "room_number": _normalize(r.get("room_number")),
                "total_beds": max(int(r.get("total_beds") or 2), 1),
                "occupied_beds": 0,
                "is_active": True,
            }
            for r in rooms
            if _normalize(r.get("room_number"))
        ]
    else:
        room_rows = []

    if room_rows:
        client.schema(HOSTEL_SCHEMA).table("hostel_rooms").insert(room_rows).execute()

    room_response = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel["id"])
        .execute()
    )
    return _serialize_hostel(hostel, list(room_response.data or []))


def update_hostel(school_id: str, hostel_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    if not list(existing.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    update_data = {}
    for key in ("name", "hostel_head", "warden_name", "gender_category", "address", "is_active", "hostel_code"):
        if key in payload:
            val = payload[key]
            if key == "is_active":
                update_data[key] = bool(val)
            elif key == "hostel_code":
                normalized_code = _normalize_hostel_code(val)
                if not normalized_code:
                    raise HTTPException(status_code=400, detail="Hostel code cannot be empty")
                update_data[key] = normalized_code
            elif val is not None:
                update_data[key] = _normalize(val)
            else:
                update_data[key] = None

    if update_data:
        try:
            client.schema(HOSTEL_SCHEMA).table("hostels").update(update_data).eq("school_id", school_id).eq("id", hostel_id).execute()
        except Exception as exc:
            translated = _translate_hostel_write_error(exc)
            if translated:
                raise translated from exc
            raise

    return get_hostel(school_id, hostel_id)


def delete_hostel(school_id: str, hostel_id: str) -> dict[str, str]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    if not list(existing.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    active_allocations = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_allocations")
        .select("id")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel_id)
        .eq("allocation_status", "active")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if active_allocations:
        raise HTTPException(status_code=400, detail="Cannot delete hostel with active allocations")

    active_requests = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_requests")
        .select("id")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel_id)
        .eq("is_active", True)
        .in_("status", ["pending", "approved"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if active_requests:
        raise HTTPException(status_code=400, detail="Cannot delete hostel with active requests")

    client.schema(HOSTEL_SCHEMA).table("hostels").update({"is_active": False}).eq("school_id", school_id).eq("id", hostel_id).execute()
    client.schema(HOSTEL_SCHEMA).table("hostel_rooms").update({"is_active": False}).eq("school_id", school_id).eq("hostel_id", hostel_id).execute()

    return {"message": "Hostel deleted successfully"}


def add_room(school_id: str, hostel_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    if not list(existing.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    room_number = _normalize(payload.get("room_number"))
    if not room_number:
        raise HTTPException(status_code=400, detail="Room number is required")

    room_data = {
        "school_id": school_id,
        "hostel_id": hostel_id,
        "room_number": room_number,
        "total_beds": int(payload.get("total_beds") or 2),
        "occupied_beds": 0,
        "is_active": True,
    }
    response = client.schema(HOSTEL_SCHEMA).table("hostel_rooms").insert(room_data).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to add room")

    return _serialize_hostel_room(rows[0])


def sync_room_occupancy(school_id: str, room_id: str) -> None:
    if not room_id:
        return
    client = get_supabase_admin_client()
    count_response = _execute_with_retry(lambda: (
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
    ))
    occupied_beds = count_response.count or 0
    _execute_with_retry(
        lambda: client.schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .update({"occupied_beds": occupied_beds})
        .eq("school_id", school_id)
        .eq("id", room_id)
        .execute()
    )


def update_room(school_id: str, hostel_id: str, room_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel_id)
        .eq("id", room_id)
        .limit(1)
        .execute()
    )
    rows = list(existing.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Room not found")
    current = rows[0]

    room_number = _normalize(payload.get("room_number"))
    total_beds = payload.get("total_beds")
    if total_beds is not None:
        total_beds = int(total_beds)
        if total_beds < int(current.get("occupied_beds") or 0):
            raise HTTPException(status_code=400, detail="Total beds cannot be less than occupied beds")

    update_data: dict[str, Any] = {}
    if room_number:
        update_data["room_number"] = room_number
    if total_beds is not None:
        update_data["total_beds"] = total_beds
    if "is_active" in payload:
        update_data["is_active"] = bool(payload["is_active"])

    if update_data:
        client.schema(HOSTEL_SCHEMA).table("hostel_rooms").update(update_data).eq("school_id", school_id).eq("id", room_id).execute()

    updated = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", room_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return _serialize_hostel_room(updated[0] if updated else current)


def delete_room(school_id: str, hostel_id: str, room_id: str) -> dict[str, str]:
    client = get_supabase_admin_client()
    existing = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("hostel_id", hostel_id)
        .eq("id", room_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Room not found")

    active = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_allocations")
        .select("id")
        .eq("school_id", school_id)
        .eq("hostel_room_id", room_id)
        .eq("allocation_status", "active")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if active:
        raise HTTPException(status_code=400, detail="Cannot delete room with active allocations")

    client.schema(HOSTEL_SCHEMA).table("hostel_rooms").update({"is_active": False}).eq("school_id", school_id).eq("id", room_id).execute()
    return {"message": "Room deleted successfully"}


# ==================== Report Data Functions ====================


def get_occupancy_report_data(school_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        return []

    hostel_ids = [h["id"] for h in hostels]
    room_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .in_("hostel_id", hostel_ids)
        .execute()
    )
    rooms_by_hostel: dict[str, list[dict[str, Any]]] = {}
    for r in list(room_rows.data or []):
        rooms_by_hostel.setdefault(str(r["hostel_id"]), []).append(r)

    rows: list[dict[str, Any]] = []
    for hostel in hostels:
        rooms = rooms_by_hostel.get(str(hostel["id"]), [])
        active_rooms = [r for r in rooms if r.get("is_active")]
        total_capacity = sum(int(r.get("total_beds") or 0) for r in active_rooms)
        occupied_beds = sum(int(r.get("occupied_beds") or 0) for r in active_rooms)
        available_beds = max(total_capacity - occupied_beds, 0)
        rows.append({
            "hostel_name": str(hostel.get("name") or "").strip(),
            "gender_category": str(hostel.get("gender_category") or "").strip() or "N/A",
            "total_rooms": len(active_rooms),
            "total_capacity": total_capacity,
            "occupied_beds": occupied_beds,
            "available_beds": available_beds,
            "occupancy_percentage": round((occupied_beds / total_capacity * 100), 2) if total_capacity else 0,
            "hostel_head": str(hostel.get("hostel_head") or "").strip() or "N/A",
            "warden_name": str(hostel.get("warden_name") or "").strip() or "N/A",
        })
    rows.append({
        "hostel_name": "GRAND TOTAL",
        "gender_category": "",
        "total_rooms": sum(r["total_rooms"] for r in rows),
        "total_capacity": sum(r["total_capacity"] for r in rows),
        "occupied_beds": sum(r["occupied_beds"] for r in rows),
        "available_beds": sum(r["available_beds"] for r in rows),
        "occupancy_percentage": round((sum(r["occupied_beds"] for r in rows) / sum(r["total_capacity"] for r in rows) * 100), 2) if sum(r["total_capacity"] for r in rows) else 0,
        "hostel_head": "",
        "warden_name": "",
    })
    return rows


def get_allocation_report_data(school_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    allocation_rows = list(
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_allocations")
        .select("*")
        .eq("school_id", school_id)
        .eq("allocation_status", "active")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    if not allocation_rows:
        return []

    student_ids = list({str(a.get("student_id")) for a in allocation_rows if a.get("student_id")})
    hostel_ids = list({str(a.get("hostel_id")) for a in allocation_rows if a.get("hostel_id")})
    room_ids = list({str(a.get("hostel_room_id")) for a in allocation_rows if a.get("hostel_room_id")})

    from app.services.supabase_students import get_students_by_ids
    students_map = {str(s.get("id")): s for s in get_students_by_ids(school_id, student_ids)}

    hostel_rows = list(
        client.schema(HOSTEL_SCHEMA).table("hostels").select("*").eq("school_id", school_id)
        .in_("id", hostel_ids).execute().data or []
    )
    hostels_map = {str(h["id"]): h for h in hostel_rows}

    room_rows = list(
        client.schema(HOSTEL_SCHEMA).table("hostel_rooms").select("*").eq("school_id", school_id)
        .in_("id", room_ids).execute().data or []
    )
    rooms_map = {str(r["id"]): r for r in room_rows}

    rows: list[dict[str, Any]] = []
    for alloc in allocation_rows:
        student = students_map.get(str(alloc.get("student_id")), {})
        hostel = hostels_map.get(str(alloc.get("hostel_id")), {})
        room = rooms_map.get(str(alloc.get("hostel_room_id")), {})
        rows.append({
            "student_name": str(student.get("full_name") or student.get("name") or "").strip(),
            "roll_number": str(student.get("roll_number") or "").strip(),
            "batch": str(student.get("batch_name") or student.get("batch") or "").strip(),
            "hostel_name": str(hostel.get("name") or "").strip(),
            "room_number": str(room.get("room_number") or "").strip(),
            "bed_label": str(alloc.get("bed_label") or "").strip() or "N/A",
            "hostel_head": str(hostel.get("hostel_head") or "").strip() or "N/A",
            "warden_name": str(hostel.get("warden_name") or "").strip() or "N/A",
            "allocated_at": str(alloc.get("created_at") or "")[:10] if alloc.get("created_at") else "",
        })
    rows.sort(key=lambda r: (r["hostel_name"], r["room_number"], r["student_name"]))
    return rows


def get_vacancy_report_data(school_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        return []

    hostel_ids = [h["id"] for h in hostels]
    room_rows = (
        client
        .schema(HOSTEL_SCHEMA)
        .table("hostel_rooms")
        .select("*")
        .eq("school_id", school_id)
        .in_("hostel_id", hostel_ids)
        .order("room_number")
        .execute()
    )
    rooms_by_hostel: dict[str, list[dict[str, Any]]] = {}
    for r in list(room_rows.data or []):
        rooms_by_hostel.setdefault(str(r["hostel_id"]), []).append(r)

    rows: list[dict[str, Any]] = []
    for hostel in hostels:
        rooms = rooms_by_hostel.get(str(hostel["id"]), [])
        for room in rooms:
            if not room.get("is_active"):
                continue
            total = int(room.get("total_beds") or 0)
            occupied = int(room.get("occupied_beds") or 0)
            available = max(total - occupied, 0)
            if available > 0:
                rows.append({
                    "hostel_name": str(hostel.get("name") or "").strip(),
                    "gender_category": str(hostel.get("gender_category") or "").strip() or "N/A",
                    "room_number": str(room.get("room_number") or "").strip(),
                    "total_beds": total,
                    "occupied_beds": occupied,
                    "available_beds": available,
                })
    rows.sort(key=lambda r: (r["hostel_name"], r["room_number"]))
    return rows
