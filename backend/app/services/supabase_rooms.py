"""Supabase-native room repository for read operations."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _serialize_room(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": _normalize(row.get("name")),
        "length_feet": float(row.get("length_feet") or 0),
        "width_feet": float(row.get("width_feet") or 0),
        "desk_length_feet": float(row.get("desk_length_feet") or 2.0),
        "desk_width_feet": float(row.get("desk_width_feet") or 3.0),
        "num_benches": int(row.get("num_benches") or 0),
        "capacity": int(row.get("capacity") or 0),
        "teaching_zone_clearance_feet": float(row.get("teaching_zone_clearance_feet") or 5.0),
        "aisle_width_feet": float(row.get("aisle_width_feet") or 3.0),
        "door_location": _normalize(row.get("door_location")) or "left",
        "window_location": _normalize(row.get("window_location")) or None,
        "glare_mitigation": bool(row.get("is_accessible", False)),
        "is_accessible": bool(row.get("is_accessible", False)),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_rooms(
    school_id: str,
    *,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("name")
        .range(skip, skip + limit - 1)
        .execute()
    )
    rows = list(response.data or [])
    return [_serialize_room(row) for row in rows]


def get_room(school_id: str, room_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("rooms")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", room_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Room not found")
    return _serialize_room(rows[0])


def get_rooms_summary(school_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("rooms")
        .select("id, capacity")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    rows = list(response.data or [])
    return {
        "count": len(rows),
        "totalCapacity": sum(int(row.get("capacity") or 0) for row in rows),
    }
