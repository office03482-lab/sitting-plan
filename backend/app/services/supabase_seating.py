"""Supabase-native seating plan repository for production-safe routes."""

from __future__ import annotations

from typing import Any, Iterable

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client


def _sanitize_lookup_ids(values: Iterable[str]) -> list[str]:
    normalized = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "None":
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _fetch_exam_lookup(exam_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(exam_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .schema("exam")
        .table("exams")
        .select("id, name, metadata")
        .in_("id", ids)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


def _fetch_room_lookup(room_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(room_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = supabase.table("rooms").select("id, name, length_feet, width_feet, capacity, exam_capacity").in_("id", ids).execute()
    return {str(item["id"]): item for item in list(response.data or [])}


def _normalize_batch_distribution(batch_distribution: Any) -> tuple[list[str], list[dict[str, Any]]]:
    if isinstance(batch_distribution, dict):
        batches = [str(item) for item in batch_distribution.keys()]
        total = sum(int(value or 0) for value in batch_distribution.values()) or 0
        return batches, [
            {
                "batch": str(batch_name),
                "count": int(count or 0),
                "percentage": round((int(count or 0) / total) * 100, 2) if total else 0.0,
            }
            for batch_name, count in batch_distribution.items()
        ]
    if isinstance(batch_distribution, list):
        batches = []
        normalized = []
        for item in batch_distribution:
            if isinstance(item, dict):
                batch_name = str(item.get("batch") or "").strip()
                if batch_name:
                    batches.append(batch_name)
                normalized.append(item)
        return batches, normalized
    return [], []


def serialize_seating_plan_row(
    row: dict[str, Any],
    *,
    exam_lookup: dict[str, dict[str, Any]],
    room_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    exam = exam_lookup.get(str(row.get("exam_id"))) or {}
    room = room_lookup.get(str(row.get("room_id"))) or {}
    metadata = row.get("plan_metadata") or {}
    batches, batch_distribution = _normalize_batch_distribution(row.get("batch_distribution"))
    return {
        "id": row.get("id"),
        "exam_id": row.get("exam_id"),
        "room_id": row.get("room_id"),
        "exam_name": exam.get("name") or metadata.get("exam_name"),
        "exam_subject": (exam.get("metadata") or {}).get("subject_text") if isinstance(exam.get("metadata"), dict) else metadata.get("exam_subject"),
        "room_name": room.get("name") or metadata.get("room_name"),
        "batches": batches,
        "batch_distribution": batch_distribution,
        "name": row.get("plan_name") or metadata.get("plan_name") or "",
        "plan_type": metadata.get("ui_plan_type") or row.get("plan_type") or "strict",
        "status": row.get("status") or "draft",
        "students_assigned": int(row.get("students_assigned") or 0),
        "is_valid": bool(row.get("is_valid", True)),
        "validation_errors": row.get("validation_errors") or None,
        "created_at": row.get("created_at"),
    }


def list_seating_plans(school_id: str, *, exam_id: str | None = None, room_id: str | None = None) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    query = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if exam_id:
        query = query.eq("exam_id", exam_id)
    if room_id:
        query = query.eq("room_id", room_id)
    response = query.order("created_at", desc=True).execute()
    rows = list(response.data or [])
    exam_lookup = _fetch_exam_lookup([row.get("exam_id") for row in rows])
    room_lookup = _fetch_room_lookup([row.get("room_id") for row in rows])
    return [serialize_seating_plan_row(row, exam_lookup=exam_lookup, room_lookup=room_lookup) for row in rows]


def get_seating_plan_layout(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    result = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("*")
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .single()
        .execute()
    )
    row = result.data
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")

    metadata = row.get("plan_metadata") or {}
    layout = metadata.get("layout") if isinstance(metadata, dict) else None
    if isinstance(layout, dict) and isinstance(layout.get("desks"), list):
        room_lookup = _fetch_room_lookup([row.get("room_id")])
        room = room_lookup.get(str(row.get("room_id"))) or {}
        return {
            "room_id": row.get("room_id"),
            "room_name": room.get("name") or metadata.get("room_name") or "Room",
            "desks": layout.get("desks") or [],
            "dimensions": {
                "length_feet": room.get("length_feet") or 0,
                "width_feet": room.get("width_feet") or 0,
            },
            "capacity": int(room.get("exam_capacity") or room.get("capacity") or 0),
            "occupied": int(layout.get("occupied") or 0),
        }

    raise HTTPException(status_code=404, detail="Plan layout metadata not found")


def finalize_seating_plan(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    updated = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .update({"status": "finalized"})
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(updated.data or []):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"message": "Plan finalized", "plan_id": plan_id}


def delete_seating_plan(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    deleted = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .delete()
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(deleted.data or []):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"message": "Seating plan deleted successfully"}


def delete_all_seating_plans(school_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    existing = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("id")
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        supabase.schema("exam").table("seating_plans").delete().eq("school_id", school_id).execute()
    return {
        "message": f"All {len(rows)} seating plans deleted successfully",
        "deleted_count": len(rows),
    }
