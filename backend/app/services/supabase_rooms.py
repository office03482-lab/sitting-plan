"""Supabase-native room repository."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_metrics import get_school_core_counts_cached


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
    try:
        payload = get_school_core_counts_cached(school_id)
        rpc_value = payload.get("rooms_summary")
        if isinstance(rpc_value, dict):
            return {
                "count": int(rpc_value.get("count") or 0),
                "totalCapacity": int(rpc_value.get("totalCapacity") or 0),
            }
    except Exception:
        pass

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


def _compute_desk_layout(num_benches: int) -> list[dict[str, Any]]:
    desks = []
    for bench_idx in range(num_benches):
        row_idx = bench_idx // 3
        col_idx = bench_idx % 3
        desks.append({
            "desk_index": bench_idx,
            "row": row_idx,
            "col": col_idx,
            "seats": [
                {"position": 1, "label": "left"},
                {"position": 2, "label": "right"},
            ],
        })
    return desks


def create_room(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    name = _normalize(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Room name is required")

    num_benches = int(payload.get("num_benches") or 0)
    if num_benches <= 0:
        raise HTTPException(status_code=400, detail="Number of benches must be positive")

    existing = get_supabase_admin_client().table("rooms").select("id").eq("school_id", school_id).ilike("name", name).limit(10).execute()
    for row in list(existing.data or []):
        if _normalize(row.get("name")).lower() == name.lower():
            raise HTTPException(status_code=400, detail=f"Room with name '{name}' already exists")

    layout = _compute_desk_layout(num_benches)
    capacity = num_benches * 2
    door_location = str(payload.get("door_location") or "left").strip().lower()
    room_row = {
        "school_id": school_id,
        "name": name,
        "length_feet": float(payload.get("length_feet") or 0),
        "width_feet": float(payload.get("width_feet") or 0),
        "desk_length_feet": float(payload.get("desk_length_feet") or 2.0),
        "desk_width_feet": float(payload.get("desk_width_feet") or 3.0),
        "num_benches": num_benches,
        "capacity": capacity,
        "teaching_zone_clearance_feet": float(payload.get("teaching_zone_clearance_feet") or 5.0),
        "aisle_width_feet": float(payload.get("aisle_width_feet") or 3.0),
        "door_location": door_location,
        "window_location": _normalize(payload.get("window_location")) or None,
        "is_accessible": bool(payload.get("is_accessible", False)),
        "is_active": bool(payload.get("is_active", True)),
        "metadata": {"desk_layout": layout},
    }
    response = get_supabase_admin_client().table("rooms").insert(room_row).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create room")
    return _serialize_room(rows[0])


def update_room(school_id: str, room_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    get_room(school_id, room_id)

    update_payload: dict[str, Any] = {}
    if "name" in payload and _normalize(payload.get("name")):
        update_payload["name"] = _normalize(payload["name"])
    for float_field in ("length_feet", "width_feet", "desk_length_feet", "desk_width_feet", "teaching_zone_clearance_feet", "aisle_width_feet"):
        if float_field in payload:
            update_payload[float_field] = float(payload[float_field] or 0)
    if "num_benches" in payload:
        nb = int(payload["num_benches"] or 0)
        if nb > 0:
            update_payload["num_benches"] = nb
            update_payload["capacity"] = nb * 2
    if "door_location" in payload:
        update_payload["door_location"] = _normalize(payload["door_location"]) or "left"
    if "window_location" in payload:
        update_payload["window_location"] = _normalize(payload["window_location"]) or None
    if "is_accessible" in payload:
        update_payload["is_accessible"] = bool(payload["is_accessible"])
    if "is_active" in payload:
        update_payload["is_active"] = bool(payload["is_active"])

    if not update_payload:
        return get_room(school_id, room_id)

    response = (
        get_supabase_admin_client()
        .table("rooms")
        .update(update_payload)
        .eq("school_id", school_id)
        .eq("id", room_id)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        return _serialize_room(rows[0])
    return get_room(school_id, room_id)


def delete_room(school_id: str, room_id: str) -> dict[str, Any]:
    get_room(school_id, room_id)
    response = (
        get_supabase_admin_client()
        .table("rooms")
        .update({"is_active": False})
        .eq("school_id", school_id)
        .eq("id", room_id)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"message": "Room deleted"}


def delete_all_rooms(school_id: str, *, is_admin: bool = False) -> dict[str, Any]:
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can delete all rooms")

    existing = (
        get_supabase_admin_client()
        .table("rooms")
        .select("id")
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(existing.data or [])
    count = len(rows)
    if count:
        get_supabase_admin_client().table("rooms").delete().eq("school_id", school_id).execute()
    return {
        "message": f"All {count} rooms deleted successfully",
        "deleted_rooms": count,
        "deleted_desks": 0,
        "deleted_seats": 0,
    }
