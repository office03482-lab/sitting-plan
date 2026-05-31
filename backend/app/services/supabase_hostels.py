"""Supabase-native hostel repository using hostels schema."""
from __future__ import annotations
from typing import Any
from fastapi import HTTPException
from app.services.supabase_admin import get_supabase_admin_client


def _normalize(value: Any) -> str:
    return str(value or "").strip()


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


def list_hostels(school_id: str) -> list[dict[str, Any]]:
    client = get_supabase_admin_client()
    hostel_rows = (
        client
        .schema("hostels")
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .order("name")
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        return []

    hostel_ids = [h["id"] for h in hostels]
    room_rows = (
        client
        .schema("hostels")
        .table("hostel_rooms")
        .select("*")
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
        .schema("hostels")
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    hostels = list(hostel_rows.data or [])
    if not hostels:
        raise HTTPException(status_code=404, detail="Hostel not found")
    hostel = hostels[0]

    room_rows = (
        client
        .schema("hostels")
        .table("hostel_rooms")
        .select("*")
        .eq("hostel_id", hostel["id"])
        .execute()
    )
    return _serialize_hostel(hostel, list(room_rows.data or []))


def create_hostel(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    name = _normalize(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Hostel name is required")

    hostel_data = {
        "school_id": school_id,
        "name": name,
        "hostel_head": _normalize(payload.get("hostel_head")) or None,
        "warden_name": _normalize(payload.get("warden_name")) or None,
        "gender_category": _normalize(payload.get("gender_category")) or None,
        "address": _normalize(payload.get("address")) or None,
        "is_active": bool(payload.get("is_active", True)),
    }

    response = client.schema("hostels").table("hostels").insert(hostel_data).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create hostel")
    hostel = rows[0]

    generated_room_count = max(int(payload.get("total_rooms") or 0), 0)
    rooms = payload.get("rooms") or []

    if generated_room_count:
        room_rows = [
            {
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
                "hostel_id": hostel["id"],
                "room_number": _normalize(r.get("room_number")),
                "total_beds": 2,
                "occupied_beds": 0,
                "is_active": True,
            }
            for r in rooms
        ]
    else:
        room_rows = []

    if room_rows:
        client.schema("hostels").table("hostel_rooms").insert(room_rows).execute()

    room_response = (
        client
        .schema("hostels")
        .table("hostel_rooms")
        .select("*")
        .eq("hostel_id", hostel["id"])
        .execute()
    )
    return _serialize_hostel(hostel, list(room_response.data or []))


def update_hostel(school_id: str, hostel_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema("hostels")
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
    for key in ("name", "hostel_head", "warden_name", "gender_category", "address", "is_active"):
        if key in payload:
            val = payload[key]
            if key == "is_active":
                update_data[key] = bool(val)
            elif val is not None:
                update_data[key] = _normalize(val)
            else:
                update_data[key] = None

    if update_data:
        client.schema("hostels").table("hostels").update(update_data).eq("id", hostel_id).execute()

    return get_hostel(school_id, hostel_id)


def delete_hostel(school_id: str, hostel_id: str) -> dict[str, str]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema("hostels")
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    if not list(existing.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    client.schema("hostels").table("hostels").update({"is_active": False}).eq("id", hostel_id).execute()
    client.schema("hostels").table("hostel_rooms").update({"is_active": False}).eq("hostel_id", hostel_id).execute()

    client.table("students").update({
        "preferred_hostel_id": None,
        "assigned_hostel_id": None,
        "assigned_room_id": None,
        "assigned_bed_label": None,
        "hostel_request_status": "not_requested",
    }).eq("school_id", school_id).eq("preferred_hostel_id", hostel_id).execute()

    client.table("students").update({
        "assigned_hostel_id": None,
        "assigned_room_id": None,
        "assigned_bed_label": None,
        "hostel_request_status": "not_requested",
    }).eq("school_id", school_id).eq("assigned_hostel_id", hostel_id).execute()

    return {"message": "Hostel deleted successfully"}


def add_room(school_id: str, hostel_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_admin_client()
    existing = (
        client
        .schema("hostels")
        .table("hostels")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", hostel_id)
        .limit(1)
        .execute()
    )
    if not list(existing.data or []):
        raise HTTPException(status_code=404, detail="Hostel not found")

    room_data = {
        "hostel_id": hostel_id,
        "room_number": _normalize(payload.get("room_number")),
        "total_beds": int(payload.get("total_beds") or 2),
        "occupied_beds": 0,
        "is_active": True,
    }
    response = client.schema("hostels").table("hostel_rooms").insert(room_data).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to add room")

    return _serialize_hostel_room(rows[0])


def sync_room_occupancy(school_id: str, room_id: str) -> None:
    if not room_id:
        return
    client = get_supabase_admin_client()
    count_response = (
        client
        .table("students")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("assigned_room_id", room_id)
        .eq("hostel_request_status", "approved")
        .limit(0)
        .execute()
    )
    occupied_beds = count_response.count or 0
    client.schema("hostels").table("hostel_rooms").update({"occupied_beds": occupied_beds}).eq("id", room_id).execute()
