"""Supabase-native batch management helpers."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.utils.academic_batches import looks_like_academic_batch_name, split_batch_to_class_section


def _normalize_category(value: Any) -> str:
    return str(value or "batch").strip().lower() or "batch"


def _normalize_name(value: Any) -> str:
    return str(value or "").strip()


def _normalize_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _build_batch_code(batch_name: str, fallback_index: int = 1) -> str:
    import re

    normalized = re.sub(r"[^A-Z0-9]+", "_", (batch_name or "").strip().upper()).strip("_")
    normalized = normalized[:32] if normalized else ""
    return normalized or f"BATCH_{fallback_index}"


def _serialize_batch(row: dict[str, Any], student_count: int = 0) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": _normalize_name(row.get("name")),
        "category": _normalize_category(row.get("category")),
        "syllabus": _normalize_text(row.get("syllabus")),
        "display_order": int(row.get("display_order") or 0),
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "student_count": int(student_count or 0),
    }


def _is_invalid_class_name(name: str | None, category: str | None) -> bool:
    return _normalize_category(category) == "class" and looks_like_academic_batch_name(name)


def _load_batch_rows(
    school_id: str,
    *,
    is_active: bool | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, school_id, name, category, syllabus, display_order, is_active, created_at, updated_at, class_name, section")
        .eq("school_id", school_id)
        .order("display_order")
        .order("created_at")
        .order("id")
    )
    if is_active is not None:
        query = query.eq("is_active", bool(is_active))
    if category:
        query = query.eq("category", _normalize_category(category))
    response = query.execute()
    return list(response.data or [])


def _load_batch_counts(school_id: str, batch_rows: list[dict[str, Any]]) -> dict[str, int]:
    if not batch_rows:
        return {}

    batch_rows_by_id = {str(item.get("id")): item for item in batch_rows if item.get("id") is not None}
    regular_batch_ids = [batch_id for batch_id, row in batch_rows_by_id.items() if _normalize_category(row.get("category")) != "class"]
    class_names = {
        _normalize_name(row.get("name")): 0
        for row in batch_rows
        if _normalize_category(row.get("category")) == "class" and _normalize_name(row.get("name"))
    }
    counts_by_batch_id = {batch_id: 0 for batch_id in batch_rows_by_id}

    query = (
        get_supabase_admin_client()
        .table("students")
        .select("id, batch_id, class_name")
        .eq("school_id", school_id)
    )
    student_rows = list(query.execute().data or [])
    regular_batch_id_set = set(regular_batch_ids)

    for student in student_rows:
        batch_id = str(student.get("batch_id") or "").strip()
        class_name = _normalize_name(student.get("class_name"))
        if batch_id and batch_id in regular_batch_id_set:
            counts_by_batch_id[batch_id] = counts_by_batch_id.get(batch_id, 0) + 1
        elif class_name and class_name in class_names:
            target_batch = next(
                (
                    batch_id
                    for batch_id, batch_row in batch_rows_by_id.items()
                    if _normalize_category(batch_row.get("category")) == "class"
                    and _normalize_name(batch_row.get("name")) == class_name
                ),
                None,
            )
            if target_batch:
                counts_by_batch_id[target_batch] = counts_by_batch_id.get(target_batch, 0) + 1

    return counts_by_batch_id


def _get_batch_or_404(school_id: str, batch_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, school_id, name, category, syllabus, display_order, is_active, created_at, updated_at, class_name, section")
        .eq("school_id", school_id)
        .eq("id", batch_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Batch not found")
    return rows[0]


def _ensure_unique_name(
    school_id: str,
    name: str,
    category: str,
    *,
    exclude_batch_id: str | None = None,
) -> None:
    query = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name")
        .eq("school_id", school_id)
        .eq("category", category)
        .ilike("name", name)
        .limit(10)
    )
    rows = list(query.execute().data or [])
    for row in rows:
        if exclude_batch_id and str(row.get("id")) == str(exclude_batch_id):
            continue
        if _normalize_name(row.get("name")).lower() == name.lower():
            raise HTTPException(
                status_code=400,
                detail=f"Batch with name '{name}' already exists in this school",
            )


def _next_display_order(school_id: str) -> int:
    rows = list(
        get_supabase_admin_client()
        .table("batches")
        .select("display_order")
        .eq("school_id", school_id)
        .order("display_order", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return 1
    return int(rows[0].get("display_order") or 0) + 1


def list_batches(
    school_id: str,
    *,
    is_active: bool | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    batch_rows = _load_batch_rows(school_id, is_active=is_active, category=category)
    counts = _load_batch_counts(school_id, batch_rows)
    return [_serialize_batch(row, counts.get(str(row.get("id")), 0)) for row in batch_rows]


def get_batch(school_id: str, batch_id: str) -> dict[str, Any]:
    row = _get_batch_or_404(school_id, batch_id)
    counts = _load_batch_counts(school_id, [row])
    return _serialize_batch(row, counts.get(str(row.get("id")), 0))


def create_batch(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    name = _normalize_name(payload.get("name"))
    if not name:
        raise HTTPException(status_code=400, detail="Batch name is required")

    category = _normalize_category(payload.get("category"))
    if _is_invalid_class_name(name, category):
        raise HTTPException(status_code=400, detail="Coaching batch names cannot be created as classes")

    _ensure_unique_name(school_id, name, category)
    display_order = int(payload.get("display_order") or 0)
    next_order = _next_display_order(school_id)
    class_name, section = split_batch_to_class_section(name)
    row = {
        "school_id": school_id,
        "batch_code": _build_batch_code(name, next_order),
        "name": name,
        "category": category,
        "class_name": class_name or None,
        "section": section or None,
        "syllabus": _normalize_text(payload.get("syllabus")),
        "display_order": display_order if display_order > 0 else next_order,
        "is_active": bool(payload.get("is_active", True)),
    }
    response = (
        get_supabase_admin_client()
        .table("batches")
        .insert(row)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create batch")
    return _serialize_batch(rows[0], 0)


def update_batch(school_id: str, batch_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    current = _get_batch_or_404(school_id, batch_id)
    next_name = _normalize_name(payload.get("name")) or _normalize_name(current.get("name"))
    next_category = _normalize_category(payload.get("category") or current.get("category"))

    if _is_invalid_class_name(next_name, next_category):
        raise HTTPException(status_code=400, detail="Coaching batch names cannot be saved as classes")

    if next_name.lower() != _normalize_name(current.get("name")).lower() or next_category != _normalize_category(current.get("category")):
        _ensure_unique_name(school_id, next_name, next_category, exclude_batch_id=batch_id)

    update_payload: dict[str, Any] = {
        "name": next_name,
        "category": next_category,
        "batch_code": _build_batch_code(next_name, 1),
    }
    class_name, section = split_batch_to_class_section(next_name)
    update_payload["class_name"] = class_name or None
    update_payload["section"] = section or None
    if "syllabus" in payload:
        update_payload["syllabus"] = _normalize_text(payload.get("syllabus"))
    if "display_order" in payload and payload.get("display_order") is not None:
        update_payload["display_order"] = max(0, int(payload.get("display_order") or 0))
    if "is_active" in payload and payload.get("is_active") is not None:
        update_payload["is_active"] = bool(payload.get("is_active"))

    response = (
        get_supabase_admin_client()
        .table("batches")
        .update(update_payload)
        .eq("school_id", school_id)
        .eq("id", batch_id)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        refreshed = rows[0]
    else:
        refreshed = _get_batch_or_404(school_id, batch_id)
    return _serialize_batch(refreshed, _load_batch_counts(school_id, [refreshed]).get(str(refreshed.get("id")), 0))


def _get_assigned_student_count(school_id: str, batch_rows: list[dict[str, Any]]) -> int:
    counts = _load_batch_counts(school_id, batch_rows)
    return sum(counts.values())


def delete_batch(school_id: str, batch_id: str) -> dict[str, Any]:
    row = _get_batch_or_404(school_id, batch_id)
    assigned_student_count = _get_assigned_student_count(school_id, [row])
    if assigned_student_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete batch: {assigned_student_count} student(s) are assigned. Please reassign them first.",
        )
    get_supabase_admin_client().table("batches").delete().eq("school_id", school_id).eq("id", batch_id).execute()
    return {"message": "Batch deleted successfully"}


def delete_all_batches(school_id: str, *, category: str | None = None) -> dict[str, Any]:
    batch_rows = _load_batch_rows(school_id, category=category)
    if not batch_rows:
        return {"message": "No batches found", "deleted_count": 0}

    assigned_student_count = _get_assigned_student_count(school_id, batch_rows)
    if assigned_student_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete all batches: {assigned_student_count} student(s) are still assigned. Please remove or reassign them first.",
        )

    batch_ids = [row.get("id") for row in batch_rows if row.get("id") is not None]
    if batch_ids:
        get_supabase_admin_client().table("batches").delete().eq("school_id", school_id).in_("id", batch_ids).execute()
    return {"message": "All batches deleted successfully", "deleted_count": len(batch_ids)}


def reorder_batches(school_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        raise HTTPException(status_code=400, detail="At least one batch order item is required")

    batch_ids = [str(item.get("batch_id")) for item in items]
    existing_rows = _load_batch_rows(school_id)
    existing_map = {str(row.get("id")): row for row in existing_rows}
    if any(batch_id not in existing_map for batch_id in batch_ids):
        raise HTTPException(status_code=404, detail="One or more batches were not found")

    for item in items:
        batch_id = str(item.get("batch_id"))
        display_order = max(0, int(item.get("display_order") or 0))
        (
            get_supabase_admin_client()
            .table("batches")
            .update({"display_order": display_order})
            .eq("school_id", school_id)
            .eq("id", batch_id)
            .execute()
        )

    return list_batches(school_id)


def get_batch_by_name(school_id: str, batch_name: str) -> dict[str, Any]:
    normalized_name = _normalize_name(batch_name)
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name, school_id, is_active")
        .eq("school_id", school_id)
        .ilike("name", normalized_name)
        .limit(10)
        .execute()
    )
    rows = list(response.data or [])
    matched = next(
        (row for row in rows if _normalize_name(row.get("name")).lower() == normalized_name.lower()),
        None,
    )
    if not matched:
        return {"exists": False, "batch": None}
    return {"exists": True, "batch": matched}
