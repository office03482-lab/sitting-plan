"""Supabase-native student repository for read operations."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _looks_like_academic_batch_name(name: str | None) -> bool:
    from app.utils.academic_batches import looks_like_academic_batch_name
    return looks_like_academic_batch_name(name)


def _normalize_class_name(class_name: str | None, batch_name: str | None = None) -> str | None:
    normalized = _normalize(class_name)
    if not normalized:
        return None
    if _looks_like_academic_batch_name(normalized):
        return None
    if batch_name and normalized.lower() == _normalize(batch_name).lower():
        return None
    return normalized


def _get_batch_name_map(school_id: str) -> dict[str, str]:
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name")
        .eq("school_id", school_id)
        .execute()
    )
    return {str(row["id"]): str(row["name"]) for row in list(response.data or [])}


def _resolve_batch_id(school_id: str, batch_name: str) -> str | None:
    normalized_name = _normalize(batch_name)
    if not normalized_name:
        return None
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name")
        .eq("school_id", school_id)
        .execute()
    )
    for row in list(response.data or []):
        if _normalize(row.get("name")).lower() == normalized_name.lower():
            return str(row["id"])
    return None


def _get_metadata(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    return metadata


def _serialize_student(row: dict[str, Any], batch_name_map: dict[str, str] | None = None) -> dict[str, Any]:
    metadata = _get_metadata(row)

    batch_id = _normalize(row.get("batch_id"))
    batch_name = ""
    if batch_id and batch_name_map and batch_id in batch_name_map:
        batch_name = batch_name_map[batch_id]
    if not batch_name:
        batch_name = _normalize(metadata.get("legacy_batch_label"))

    class_name = _normalize(row.get("class_name"))
    safe_class_name = _normalize_class_name(class_name, batch_name)

    return {
        "id": row.get("id"),
        "roll_number": _normalize(row.get("roll_number")),
        "name": _normalize(row.get("full_name")),
        "father_name": _normalize(row.get("father_name")) or None,
        "batch": batch_name,
        "batch_id": batch_id or None,
        "class_name": safe_class_name,
        "section": _normalize(row.get("section")) or None,
        "academic_session": _normalize(row.get("academic_session")) or None,
        "email": _normalize(row.get("email")) or None,
        "phone": _normalize(row.get("phone")) or None,
        "special_needs": _normalize(row.get("special_needs")) or None,
        "requires_near_exit": bool(row.get("requires_near_exit", False)),
        "requires_extra_time": bool(row.get("requires_extra_time", False)),
        "boarding_type": _normalize(row.get("boarding_type")) or None,
        "hostel_required": bool(row.get("hostel_required", False)),
        "preferred_hostel_id": metadata.get("preferred_hostel_id"),
        "hostel_request_status": _normalize(metadata.get("hostel_request_status", "not_requested")),
        "assigned_hostel_id": metadata.get("assigned_hostel_id"),
        "assigned_hostel_name": None,
        "assigned_room_id": metadata.get("assigned_room_id"),
        "assigned_room_number": None,
        "assigned_bed_label": _normalize(metadata.get("assigned_bed_label")) or None,
        "hostel_notes": _normalize(metadata.get("hostel_notes")) or None,
        "reference_name": _normalize(metadata.get("reference_name")) or None,
        "reference_number": _normalize(metadata.get("reference_number")) or None,
        "reference_remark": _normalize(metadata.get("reference_remark")) or None,
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_students(
    school_id: str,
    *,
    batch: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    query = (
        supabase
        .table("students")
        .select("*")
        .eq("school_id", school_id)
    )

    if batch:
        batch_id = _resolve_batch_id(school_id, batch)
        if batch_id:
            query = query.eq("batch_id", batch_id)
        else:
            return []

    response = (
        query
        .order("created_at", desc=True)
        .order("id", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )

    rows = list(response.data or [])
    if not rows:
        return []
    batch_name_map = _get_batch_name_map(school_id)
    return [_serialize_student(row, batch_name_map) for row in rows]


def get_student(school_id: str, student_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")

    batch_name_map = _get_batch_name_map(school_id)
    return _serialize_student(rows[0], batch_name_map)


def get_students_by_ids(school_id: str, student_ids: list[str]) -> list[dict[str, Any]]:
    if not student_ids:
        return []

    response = (
        get_supabase_admin_client()
        .table("students")
        .select("*")
        .eq("school_id", school_id)
        .in_("id", student_ids)
        .execute()
    )

    rows = list(response.data or [])
    if not rows:
        return []
    batch_name_map = _get_batch_name_map(school_id)
    return [_serialize_student(row, batch_name_map) for row in rows]


def get_students_count(school_id: str) -> int:
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(0)
        .execute()
    )
    return response.count or 0
