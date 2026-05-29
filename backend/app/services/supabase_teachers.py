"""Supabase-native teacher (staff_members) repository for read operations."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client


def _normalize(value: Any) -> str:
    return str(value or "").strip()


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


def _serialize_teacher(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _get_metadata(row)
    subject = _normalize(metadata.get("subject")) or _normalize(row.get("department"))
    return {
        "id": row.get("id"),
        "name": _normalize(row.get("full_name")),
        "subject": subject,
        "email": _normalize(row.get("email")) or None,
        "phone": _normalize(row.get("phone")) or None,
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
        .eq("staff_type", "teaching")
    )


def list_teachers(
    school_id: str,
    *,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    response = (
        _base_query()
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("full_name")
        .order("created_at")
        .range(skip, skip + limit - 1)
        .execute()
    )
    rows = list(response.data or [])
    return [_serialize_teacher(row) for row in rows]


def get_teacher(school_id: str, teacher_id: str) -> dict[str, Any]:
    response = (
        _base_query()
        .eq("school_id", school_id)
        .eq("id", teacher_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return _serialize_teacher(rows[0])


def get_teachers_by_ids(school_id: str, teacher_ids: list[str]) -> list[dict[str, Any]]:
    if not teacher_ids:
        return []
    response = (
        _base_query()
        .eq("school_id", school_id)
        .in_("id", teacher_ids)
        .execute()
    )
    rows = list(response.data or [])
    return [_serialize_teacher(row) for row in rows]


def count_teachers(school_id: str) -> int:
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id", count="exact")
        .eq("staff_type", "teaching")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(0)
        .execute()
    )
    return response.count or 0
