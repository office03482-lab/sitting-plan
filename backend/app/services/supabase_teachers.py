"""Supabase-native teacher (staff_members) repository."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_metrics import get_school_core_counts_cached


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


def _next_generated_employee_code() -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    return f"TCH-{timestamp}"


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
        "employee_code": _normalize(row.get("employee_code")) or None,
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


def _get_teacher_row(school_id: str, teacher_id: str) -> dict[str, Any]:
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
    return rows[0]


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
    try:
        payload = get_school_core_counts_cached(school_id)
        rpc_value = payload.get("teachers_count")
        if rpc_value is not None:
            return int(rpc_value)
    except Exception:
        pass

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


def create_teacher(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    name = _normalize(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Teacher name is required")

    subject = _normalize(payload.get("subject"))
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required")

    employee_code = _normalize(payload.get("employee_code")) or _normalize(payload.get("staff_id")) or _next_generated_employee_code()
    employee_match = (
        _base_query(extra_select="id")
        .eq("school_id", school_id)
        .eq("employee_code", employee_code)
        .limit(1)
        .execute()
    )
    if list(employee_match.data or []):
        raise HTTPException(status_code=400, detail=f"Teacher with employee code '{employee_code}' already exists")

    existing = _base_query(extra_select="id,full_name,department,metadata").eq("school_id", school_id).ilike("full_name", name).execute()
    for row in list(existing.data or []):
        row_subject = (_get_metadata(row) or {}).get("subject") or _normalize(row.get("department"))
        if _normalize(row.get("full_name")).lower() == name.lower() and row_subject.lower() == subject.lower():
            raise HTTPException(status_code=400, detail="Teacher with this name and subject already exists")

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata["subject"] = subject
    designation = _normalize(payload.get("designation")) or _normalize(metadata.get("designation")) or None
    if designation:
        metadata["designation"] = designation
    shift_timing = _normalize(payload.get("shift_timing")) or _normalize(metadata.get("shift_timing")) or None
    if shift_timing:
        metadata["shift_timing"] = shift_timing
    photo_data_url = payload.get("photoDataUrl")
    if photo_data_url:
        metadata["photoDataUrl"] = photo_data_url

    email = _normalize(payload.get("email")) or None
    phone = _normalize(payload.get("phone")) or None
    row = {
        "school_id": school_id,
        "staff_type": "teaching",
        "employee_code": employee_code,
        "full_name": name,
        "email": email,
        "phone": phone,
        "department": _normalize(payload.get("department")) or subject,
        "designation": designation,
        "joining_date": _normalize_date(payload.get("joining_date")),
        "metadata": metadata,
        "is_active": bool(payload.get("is_active", True)),
    }
    response = get_supabase_admin_client().table("staff_members").insert(row).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create teacher")
    return _serialize_teacher(rows[0])


def update_teacher(school_id: str, teacher_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    current_row = _get_teacher_row(school_id, teacher_id)
    current = _serialize_teacher(current_row)

    update_payload: dict[str, Any] = {}
    metadata = _get_metadata(current_row)

    if "name" in payload:
        name = _normalize(payload["name"])
        if name:
            update_payload["full_name"] = name
    if "email" in payload:
        update_payload["email"] = _normalize(payload["email"]) or None
    if "phone" in payload:
        update_payload["phone"] = _normalize(payload["phone"]) or None
    if "employee_code" in payload:
        employee_code = _normalize(payload["employee_code"])
        if employee_code:
            existing = (
                _base_query(extra_select="id")
                .eq("school_id", school_id)
                .eq("employee_code", employee_code)
                .neq("id", teacher_id)
                .limit(1)
                .execute()
            )
            if list(existing.data or []):
                raise HTTPException(status_code=400, detail=f"Teacher with employee code '{employee_code}' already exists")
            update_payload["employee_code"] = employee_code
    if "subject" in payload:
        subject = _normalize(payload["subject"])
        if subject:
            metadata["subject"] = subject
            update_payload["department"] = subject
    if "department" in payload:
        update_payload["department"] = _normalize(payload["department"]) or None
    if "designation" in payload:
        designation = _normalize(payload["designation"]) or None
        update_payload["designation"] = designation
        if designation:
            metadata["designation"] = designation
        else:
            metadata.pop("designation", None)
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
        next_metadata = dict(payload["metadata"])
        next_metadata["subject"] = _normalize(next_metadata.get("subject")) or metadata.get("subject") or current.get("subject")
        metadata = next_metadata
    if "is_active" in payload:
        update_payload["is_active"] = bool(payload["is_active"])

    update_payload["metadata"] = metadata

    if not update_payload:
        return current

    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .update(update_payload)
        .eq("school_id", school_id)
        .eq("id", teacher_id)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        return _serialize_teacher(rows[0])
    return get_teacher(school_id, teacher_id)


def delete_teacher(school_id: str, teacher_id: str) -> dict[str, Any]:
    get_teacher(school_id, teacher_id)
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .update({"is_active": False})
        .eq("school_id", school_id)
        .eq("id", teacher_id)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return {"message": "Teacher deleted successfully"}
