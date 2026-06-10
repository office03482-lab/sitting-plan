"""Supabase-native inventory repository for production-safe routes."""

from __future__ import annotations

import concurrent.futures
import json
import time
from datetime import date, datetime
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_metrics import get_inventory_dashboard_summary_rpc

_INVENTORY_SCHEMA = "inventory"
_INVENTORY_DASHBOARD_CACHE_TTL_SECONDS = 30
_inventory_dashboard_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _client():
    return get_supabase_admin_client()


def _t(table: str, schema: str | None = _INVENTORY_SCHEMA):
    return _client().schema(schema).table(table)


def _select_one(table: str, school_id: str, record_id: str, schema: str | None = _INVENTORY_SCHEMA):
    resp = _t(table, schema).select("*").eq("id", record_id).eq("school_id", school_id).limit(1).execute()
    rows = list(resp.data or [])
    if not rows:
        return None
    return dict(rows[0])


def _insert_and_return(table: str, payload: dict, schema: str | None = _INVENTORY_SCHEMA) -> dict:
    resp = _t(table, schema).insert(payload).execute()
    rows = list(resp.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail=f"{table} insert returned no data")
    return dict(rows[0])


def _update_and_return(table: str, record_id: str, school_id: str, payload: dict, schema: str | None = _INVENTORY_SCHEMA) -> dict:
    _t(table, schema).update(payload).eq("id", record_id).eq("school_id", school_id).execute()
    updated = _select_one(table, school_id, record_id, schema)
    if not updated:
        raise HTTPException(status_code=500, detail=f"{table} update could not reload")
    return updated


def _delete_row(table: str, record_id: str, school_id: str, schema: str | None = _INVENTORY_SCHEMA) -> None:
    _t(table, schema).delete().eq("id", record_id).eq("school_id", school_id).execute()


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _normalize_batch_names(batch_names: Optional[list[str]]) -> list[str]:
    result: list[str] = []
    for raw in batch_names or []:
        name = (raw or "").strip()
        if name and name not in result:
            result.append(name)
    return result


def _parse_batch_names(metadata: Any) -> list[str]:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            return []
    if isinstance(metadata, dict):
        raw = metadata.get("batch_names") or metadata.get("legacy_batch_names") or []
        if isinstance(raw, list):
            return _normalize_batch_names([str(x) for x in raw])
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return _normalize_batch_names([str(x) for x in parsed])
            except (json.JSONDecodeError, TypeError):
                pass
    return []


def _normalize_unit_type(value: Optional[str]) -> str:
    normalized = (value or "book").strip().lower().replace(" ", "_")
    mapping = {
        "book": "book", "copy": "copy", "notebook": "notebook",
        "sheet": "sheet", "kit": "kit", "piece": "piece",
        "set": "set", "box": "box", "unit": "unit",
        "material": "material", "other": "other",
    }
    return mapping.get(normalized, normalized or "book")


def _build_inventory_code(prefix: str, *parts: Optional[str]) -> str:
    base = "-".join(
        "".join(char.lower() if char.isalnum() else "-" for char in (part or "").strip()).strip("-")
        for part in parts
        if part and str(part).strip()
    )
    base = "-".join(seg for seg in base.split("-") if seg)[:24]
    return f"{prefix}-{base or prefix.lower()}-{uuid4().hex[:8]}"


def _get_metadata(row: dict) -> dict:
    raw = row.get("metadata")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return {}


def _calculate_material_stock(school_id: str, material_id: str) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA

    total_in = 0
    rows = supabase.schema(s).table("stock_in_entries").select("quantity_received").eq("material_item_id", material_id).eq("school_id", school_id).execute()
    for r in list(rows.data or []):
        total_in += int(r.get("quantity_received") or 0)

    total_out = 0
    rows = supabase.schema(s).table("stock_out_entries").select("quantity_issued").eq("material_item_id", material_id).eq("school_id", school_id).execute()
    for r in list(rows.data or []):
        total_out += int(r.get("quantity_issued") or 0)

    rows = supabase.schema(s).table("student_issue_entries").select("quantity_issued").eq("material_item_id", material_id).eq("school_id", school_id).execute()
    for r in list(rows.data or []):
        total_out += int(r.get("quantity_issued") or 0)

    return {
        "current_stock": max(total_in - total_out, 0),
        "total_distributed": total_out,
    }


# ==================== Suppliers ====================


def _serialize_supplier(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "contact_person": row.get("contact_person") or None,
        "phone": row.get("phone") or None,
        "email": row.get("email") or None,
        "address": row.get("address") or None,
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_suppliers(school_id: str, search: Optional[str] = None, is_active: Optional[bool] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("suppliers").select("*").eq("school_id", school_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    resp = query.order("name", desc=False).execute()
    rows = list(resp.data or [])
    if search:
        pattern = search.strip().lower()
        rows = [
            r for r in rows
            if pattern in (r.get("name") or "").lower()
            or pattern in (r.get("contact_person") or "").lower()
        ]
    return [_serialize_supplier(r) for r in rows]


def create_supplier(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name is required")

    dup = supabase.schema(s).table("suppliers").select("id").eq("school_id", school_id).ilike("name", name).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Supplier already exists")

    row = {
        "school_id": school_id,
        "supplier_code": _build_inventory_code("SUP", name),
        "name": name,
        "contact_person": (payload.get("contact_person") or "").strip() or None,
        "phone": (payload.get("phone") or "").strip() or None,
        "email": (payload.get("email") or "").strip() or None,
        "address": (payload.get("address") or "").strip() or None,
        "is_active": bool(payload.get("is_active", True)),
    }
    created = _insert_and_return("suppliers", row)
    return _serialize_supplier(created)


def update_supplier(school_id: str, supplier_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    existing = _select_one("suppliers", school_id, supplier_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Supplier not found")

    updates = {k: v for k, v in payload.items() if v is not None and k != "id"}
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Supplier name cannot be empty")
        dup = supabase.schema(s).table("suppliers").select("id").eq("school_id", school_id).ilike("name", name).neq("id", supplier_id).limit(1).execute()
        if list(dup.data or []):
            raise HTTPException(status_code=400, detail="Another supplier with this name already exists")
        updates["name"] = name

    updates = {
        "supplier_code": _build_inventory_code("SUP", updates.get("name", existing.get("name", ""))),
        **{k: v for k, v in updates.items() if k in {"name", "contact_person", "phone", "email", "address", "is_active"}},
    }
    if "name" in payload:
        updates["name"] = (payload["name"] or "").strip() or existing.get("name")
    if "contact_person" in payload:
        updates["contact_person"] = (payload["contact_person"] or "").strip() or None
    if "phone" in payload:
        updates["phone"] = (payload["phone"] or "").strip() or None
    if "email" in payload:
        updates["email"] = (payload["email"] or "").strip() or None
    if "address" in payload:
        updates["address"] = (payload["address"] or "").strip() or None
    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])

    updated = _update_and_return("suppliers", supplier_id, school_id, updates)
    return _serialize_supplier(updated)


def delete_supplier(school_id: str, supplier_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    existing = _select_one("suppliers", school_id, supplier_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Supplier not found")

    rows = _t("stock_in_entries", s).select("id").eq("supplier_id", supplier_id).eq("school_id", school_id).limit(1).execute()
    if list(rows.data or []):
        raise HTTPException(status_code=400, detail="Supplier cannot be deleted because stock history exists")

    _delete_row("suppliers", supplier_id, school_id)
    return {"message": "Supplier deleted successfully"}


# ==================== Subjects ====================


def _serialize_subject(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_subjects(school_id: str, is_active: Optional[bool] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("subjects").select("*").eq("school_id", school_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    resp = query.order("name", desc=False).execute()
    return [_serialize_subject(r) for r in list(resp.data or [])]


def create_subject(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Subject name is required")

    dup = supabase.schema(s).table("subjects").select("id").eq("school_id", school_id).ilike("name", name).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Subject already exists")

    row = {
        "school_id": school_id,
        "name": name,
        "is_active": bool(payload.get("is_active", True)),
    }
    created = _insert_and_return("subjects", row)
    return _serialize_subject(created)


def update_subject(school_id: str, subject_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    existing = _select_one("subjects", school_id, subject_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Subject not found")

    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Subject name cannot be empty")
        dup = supabase.schema(s).table("subjects").select("id").eq("school_id", school_id).ilike("name", name).neq("id", subject_id).limit(1).execute()
        if list(dup.data or []):
            raise HTTPException(status_code=400, detail="Another subject with this name already exists")
        updates = {"name": name}
    else:
        updates = {}

    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])

    if "name" in updates:
        linked = supabase.schema(s).table("material_items").select("id,metadata").eq("subject_id", subject_id).eq("school_id", school_id).execute()
        for item in list(linked.data or []):
            meta = _get_metadata(item)
            meta["subject_text"] = name
            supabase.schema(s).table("material_items").update({"metadata": meta, "subject_id": subject_id}).eq("id", item["id"]).execute()

    updated = _update_and_return("subjects", subject_id, school_id, updates)
    return _serialize_subject(updated)


def delete_subject(school_id: str, subject_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    existing = _select_one("subjects", school_id, subject_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Subject not found")

    sets = _t("sets", s).select("id").eq("subject_id", subject_id).eq("school_id", school_id).limit(1).execute()
    if list(sets.data or []):
        raise HTTPException(status_code=400, detail="Delete linked sets first")

    mats = _t("material_items", s).select("id").eq("subject_id", subject_id).eq("school_id", school_id).limit(1).execute()
    if list(mats.data or []):
        raise HTTPException(status_code=400, detail="Delete linked materials first")

    _delete_row("subjects", subject_id, school_id)
    return {"message": "Subject deleted successfully"}


# ==================== Sets ====================


def _serialize_set(row: dict, subject_name: str = "") -> dict:
    return {
        "id": row.get("id"),
        "subject_id": row.get("subject_id"),
        "subject_name": subject_name,
        "name": row.get("name") or "",
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_sets(school_id: str, subject_id: Optional[str] = None, is_active: Optional[bool] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("sets").select("*").eq("school_id", school_id)
    if subject_id:
        query = query.eq("subject_id", subject_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    resp = query.order("name", desc=False).execute()
    rows = list(resp.data or [])

    subject_ids = {str(r.get("subject_id")) for r in rows if r.get("subject_id")}
    subjects = {}
    for sid in subject_ids:
        sub = _select_one("subjects", school_id, sid)
        if sub:
            subjects[sid] = sub.get("name", "")

    return [_serialize_set(r, subjects.get(str(r.get("subject_id")), "")) for r in rows]


def create_set(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    subject_id = str(payload.get("subject_id") or "")
    name = (payload.get("name") or "").strip()

    if not subject_id:
        raise HTTPException(status_code=400, detail="subject_id is required")
    if not name:
        raise HTTPException(status_code=400, detail="Set name is required")

    subject = _select_one("subjects", school_id, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    dup = supabase.schema(s).table("sets").select("id").eq("school_id", school_id).eq("subject_id", subject_id).ilike("name", name).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Set already exists for this subject")

    row = {
        "school_id": school_id,
        "subject_id": subject_id,
        "name": name,
        "is_active": bool(payload.get("is_active", True)),
    }
    created = _insert_and_return("sets", row)
    return _serialize_set(created, subject.get("name", ""))


def update_set(school_id: str, set_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    existing = _select_one("sets", school_id, set_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Set not found")

    next_subject_id = str(payload.get("subject_id", existing.get("subject_id", "")))
    next_name = str(payload.get("name", existing.get("name", ""))).strip()

    if not next_name:
        raise HTTPException(status_code=400, detail="Set name cannot be empty")

    subject = _select_one("subjects", school_id, next_subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    dup = supabase.schema(s).table("sets").select("id").eq("school_id", school_id).eq("subject_id", next_subject_id).ilike("name", next_name).neq("id", set_id).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Another set with this name already exists for the selected subject")

    updates = {
        "subject_id": next_subject_id,
        "name": next_name,
    }
    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])

    updated = _update_and_return("sets", set_id, school_id, updates)

    linked = supabase.schema(s).table("material_items").select("id,metadata").eq("set_id", set_id).eq("school_id", school_id).execute()
    for item in list(linked.data or []):
        meta = _get_metadata(item)
        meta["set_text"] = next_name
        meta["subject_category_id"] = next_subject_id
        supabase.schema(s).table("material_items").update({
            "metadata": meta,
            "set_id": next_subject_id,
        }).eq("id", item["id"]).execute()

    return _serialize_set(updated, subject.get("name", ""))


def delete_set(school_id: str, set_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    existing = _select_one("sets", school_id, set_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Set not found")

    volumes = _t("volumes", s).select("id").eq("set_id", set_id).eq("school_id", school_id).execute()
    volume_ids = [str(r["id"]) for r in list(volumes.data or [])]

    mats = _t("material_items", s).select("id").eq("school_id", school_id).or_(f"set_id.eq.{set_id}" + (f",volume_id.in.({','.join(volume_ids)})" if volume_ids else "")).execute()
    for item in list(mats.data or []):
        meta = _get_metadata(item)
        meta.pop("set_category_id", None)
        meta.pop("volume_category_id", None)
        _t("material_items", s).update({
            "set_id": None,
            "set_name": None,
            "volume_id": None,
            "volume_name": None,
            "volume_number": None,
            "set_part_name": None,
            "metadata": meta,
        }).eq("id", item["id"]).execute()

    for vid in volume_ids:
        _delete_row("volumes", vid, school_id)

    _delete_row("sets", set_id, school_id)
    return {"message": "Set deleted successfully"}


# ==================== Volumes ====================


def _serialize_volume(row: dict, set_name: str = "", subject_id: str = "", subject_name: str = "") -> dict:
    return {
        "id": row.get("id"),
        "set_id": row.get("set_id"),
        "set_name": set_name,
        "subject_id": subject_id,
        "subject_name": subject_name,
        "name": row.get("name") or "",
        "volume_number": int(row.get("volume_number") or 1),
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_volumes(school_id: str, subject_id: Optional[str] = None, set_id: Optional[str] = None, is_active: Optional[bool] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("volumes").select("*, sets!inner(*)").eq("volumes.school_id", school_id)
    if set_id:
        query = query.eq("volumes.set_id", set_id)
    if subject_id:
        query = query.eq("sets.subject_id", subject_id)
    if is_active is not None:
        query = query.eq("volumes.is_active", is_active)
    resp = query.order("volumes.volume_number", desc=False).order("volumes.name", desc=False).execute()
    rows = list(resp.data or [])

    set_ids = {str(r.get("set_id")) for r in rows if r.get("set_id")}
    sets_map = {}
    for sid in set_ids:
        subj = _select_one("subjects", school_id, sid)
        srow = _select_one("sets", school_id, sid)
        if srow:
            sets_map[sid] = {
                "name": srow.get("name", ""),
                "subject_id": srow.get("subject_id", ""),
            }

    result = []
    for r in rows:
        sid = str(r.get("set_id", ""))
        sinfo = sets_map.get(sid, {})
        subj_id = sinfo.get("subject_id", "")
        sub = _select_one("subjects", school_id, subj_id) if subj_id else None
        result.append(_serialize_volume(
            r,
            set_name=sinfo.get("name", ""),
            subject_id=subj_id,
            subject_name=sub.get("name", "") if sub else "",
        ))
    return result


def create_volume(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    set_id = str(payload.get("set_id") or "")
    name = (payload.get("name") or "").strip()
    volume_number = int(payload.get("volume_number") or 1)

    if not set_id:
        raise HTTPException(status_code=400, detail="set_id is required")
    if not name:
        raise HTTPException(status_code=400, detail="Volume name is required")

    inventory_set = _select_one("sets", school_id, set_id)
    if not inventory_set:
        raise HTTPException(status_code=404, detail="Set not found")

    dup = supabase.schema(s).table("volumes").select("id").eq("school_id", school_id).eq("set_id", set_id).eq("volume_number", volume_number).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Volume number already exists for this set")

    row = {
        "school_id": school_id,
        "set_id": set_id,
        "name": name,
        "volume_number": volume_number,
        "is_active": bool(payload.get("is_active", True)),
    }
    created = _insert_and_return("volumes", row)

    subject = _select_one("subjects", school_id, inventory_set.get("subject_id", "")) if inventory_set.get("subject_id") else None
    return _serialize_volume(created, inventory_set.get("name", ""), inventory_set.get("subject_id", ""), subject.get("name", "") if subject else "")


def update_volume(school_id: str, volume_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    existing = _select_one("volumes", school_id, volume_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Volume not found")

    next_set_id = str(payload.get("set_id", existing.get("set_id", "")))
    next_volume_number = int(payload.get("volume_number", existing.get("volume_number", 1)))
    next_name = str(payload.get("name", existing.get("name", ""))).strip()

    if not next_name:
        raise HTTPException(status_code=400, detail="Volume name cannot be empty")

    inventory_set = _select_one("sets", school_id, next_set_id)
    if not inventory_set:
        raise HTTPException(status_code=404, detail="Set not found")

    dup = supabase.schema(s).table("volumes").select("id").eq("school_id", school_id).eq("set_id", next_set_id).eq("volume_number", next_volume_number).neq("id", volume_id).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Another volume with this number already exists for the selected set")

    updates = {
        "set_id": next_set_id,
        "name": next_name,
        "volume_number": next_volume_number,
    }
    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])

    updated = _update_and_return("volumes", volume_id, school_id, updates)

    linked = supabase.schema(s).table("material_items").select("id,metadata").eq("volume_id", volume_id).eq("school_id", school_id).execute()
    for item in list(linked.data or []):
        meta = _get_metadata(item)
        meta["volume_text"] = next_name
        meta["set_category_id"] = next_set_id
        supabase.schema(s).table("material_items").update({
            "metadata": meta,
            "volume_name": next_name,
            "volume_number": next_volume_number,
            "set_id": next_set_id,
            "set_part_name": f"Volume {next_volume_number} - {next_name}",
        }).eq("id", item["id"]).execute()

    subject = _select_one("subjects", school_id, inventory_set.get("subject_id", "")) if inventory_set.get("subject_id") else None
    return _serialize_volume(updated, inventory_set.get("name", ""), inventory_set.get("subject_id", ""), subject.get("name", "") if subject else "")


def delete_volume(school_id: str, volume_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    existing = _select_one("volumes", school_id, volume_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Volume not found")

    mats = _t("material_items", s).select("id,metadata").eq("volume_id", volume_id).eq("school_id", school_id).execute()
    for item in list(mats.data or []):
        meta = _get_metadata(item)
        meta.pop("volume_category_id", None)
        _t("material_items", s).update({
            "volume_id": None,
            "volume_name": None,
            "volume_number": None,
            "set_part_name": None,
            "metadata": meta,
        }).eq("id", item["id"]).execute()

    _delete_row("volumes", volume_id, school_id)
    return {"message": "Volume deleted successfully"}


# ==================== Catalog ====================


def get_catalog(school_id: str, include_inactive: bool = True) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA

    subj_query = supabase.schema(s).table("subjects").select("*").eq("school_id", school_id)
    if not include_inactive:
        subj_query = subj_query.eq("is_active", True)
    subjects = list((subj_query.order("name", desc=False).execute()).data or [])

    sets_q = supabase.schema(s).table("sets").select("*").eq("school_id", school_id)
    if not include_inactive:
        sets_q = sets_q.eq("is_active", True)
    all_sets = list((sets_q.order("name", desc=False).execute()).data or [])

    vols_q = supabase.schema(s).table("volumes").select("*").eq("school_id", school_id)
    if not include_inactive:
        vols_q = vols_q.eq("is_active", True)
    all_volumes = list((vols_q.order("volume_number", desc=False).order("name", desc=False).execute()).data or [])

    mats = list((supabase.schema(s).table("material_items").select("*").eq("school_id", school_id).execute()).data or [])
    material_map: dict[str, list[dict]] = {}
    for m in mats:
        vid = str(m.get("volume_id") or "")
        if vid:
            material_map.setdefault(vid, []).append(m)

    def _serialize_material(m: dict) -> dict:
        meta = _get_metadata(m)
        return {
            "id": m.get("id"),
            "name": m.get("name") or "",
            "subject_id": m.get("subject_id"),
            "subject": meta.get("subject_text") or "",
            "set_id": m.get("set_id"),
            "set_name": meta.get("set_text") or "",
            "volume_id": m.get("volume_id"),
            "volume_name": m.get("volume_name") or "",
            "volume_number": m.get("volume_number"),
            "set_part_name": m.get("set_part_name") or "",
            "batch_names": _parse_batch_names(meta),
            "description": m.get("description") or "",
            "unit_type": m.get("unit_type") or "book",
            "price": float(m.get("unit_price") or 0),
            "low_stock_threshold": int(m.get("low_stock_threshold") or 10),
            "school_id": m.get("school_id"),
            "current_stock": int(m.get("current_stock") or 0),
            "total_distributed": int(m.get("total_distributed") or 0),
            "is_active": bool(m.get("is_active", True)),
            "created_at": m.get("created_at"),
            "updated_at": m.get("updated_at"),
        }

    sets_by_subject: dict[str, list[dict]] = {}
    for inv_set in all_sets:
        sets_by_subject.setdefault(str(inv_set.get("subject_id") or ""), []).append(inv_set)

    volumes_by_set: dict[str, list[dict]] = {}
    for vol in all_volumes:
        volumes_by_set.setdefault(str(vol.get("set_id") or ""), []).append(vol)

    result = []
    for subj in subjects:
        sid = str(subj.get("id", ""))
        set_nodes = []
        for inv_set in sets_by_subject.get(sid, []):
            siid = str(inv_set.get("id", ""))
            volume_nodes = []
            for vol in volumes_by_set.get(siid, []):
                vid = str(vol.get("id", ""))
                volume_nodes.append({
                    "id": vol.get("id"),
                    "name": vol.get("name") or "",
                    "volume_number": int(vol.get("volume_number") or 1),
                    "is_active": bool(vol.get("is_active", True)),
                    "materials": sorted(
                        [_serialize_material(m) for m in material_map.get(vid, [])],
                        key=lambda x: (x.get("name") or "").lower(),
                    ),
                })
            set_nodes.append({
                "id": inv_set.get("id"),
                "name": inv_set.get("name") or "",
                "is_active": bool(inv_set.get("is_active", True)),
                "volumes": sorted(volume_nodes, key=lambda v: (v.get("volume_number", 1), (v.get("name") or "").lower())),
            })
        result.append({
            "id": subj.get("id"),
            "name": subj.get("name") or "",
            "is_active": bool(subj.get("is_active", True)),
            "sets": sorted(set_nodes, key=lambda s: (s.get("name") or "").lower()),
        })
    return result


# ==================== Materials ====================


def _serialize_material(row: dict) -> dict:
    meta = _get_metadata(row)
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "subject_id": row.get("subject_id"),
        "subject": meta.get("subject_text") or "",
        "set_id": row.get("set_id"),
        "set_name": meta.get("set_text") or "",
        "volume_id": row.get("volume_id"),
        "volume_name": row.get("volume_name") or "",
        "volume_number": row.get("volume_number"),
        "set_part_name": row.get("set_part_name") or "",
        "batch_names": _parse_batch_names(meta),
        "description": row.get("description") or "",
        "unit_type": row.get("unit_type") or "book",
        "price": float(row.get("unit_price") or 0),
        "low_stock_threshold": int(row.get("low_stock_threshold") or 10),
        "school_id": row.get("school_id"),
        "current_stock": int(row.get("current_stock") or 0),
        "total_distributed": int(row.get("total_distributed") or 0),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_materials(
    school_id: str,
    search: Optional[str] = None,
    subject: Optional[str] = None,
    batch_name: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("material_items").select("*").eq("school_id", school_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    resp = query.order("name", desc=False).execute()
    rows = list(resp.data or [])

    if search:
        p = search.strip().lower()
        rows = [
            r for r in rows
            if p in (r.get("name") or "").lower()
            or p in (r.get("subject_id") or "").lower()
            or p in (r.get("set_part_name") or "").lower()
            or p in (r.get("volume_name") or "").lower()
        ]
    if subject:
        sp = subject.strip().lower()
        rows = [r for r in rows if sp in _get_metadata(r).get("subject_text", "").lower()]
    if batch_name:
        bp = batch_name.strip().lower()
        rows = [r for r in rows if bp in (r.get("class_name") or "").lower() or bp in str(_get_metadata(r).get("batch_names", "")).lower()]

    return [_serialize_material(r) for r in rows]


def create_material(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Material name is required")

    dup = supabase.schema(s).table("material_items").select("id").eq("school_id", school_id).ilike("name", name).limit(1).execute()
    if list(dup.data or []):
        raise HTTPException(status_code=400, detail="Material already exists")

    meta: dict[str, Any] = {"source": "api"}
    subject_id = payload.get("subject_id")
    set_id = payload.get("set_id")
    volume_id = payload.get("volume_id")

    if subject_id:
        subject = _select_one("subjects", school_id, str(subject_id))
        if subject:
            meta["subject_text"] = subject.get("name", "")
            meta["subject_category_id"] = str(subject["id"])

    if set_id:
        inv_set = _select_one("sets", school_id, str(set_id))
        if inv_set:
            meta["set_text"] = inv_set.get("name", "")
            meta["set_category_id"] = str(inv_set["id"])
            if not subject_id and inv_set.get("subject_id"):
                sub = _select_one("subjects", school_id, str(inv_set["subject_id"]))
                if sub:
                    meta["subject_text"] = sub.get("name", "")
                    meta["subject_category_id"] = str(sub["id"])
                    subject_id = sub["id"]

    if volume_id:
        vol = _select_one("volumes", school_id, str(volume_id))
        if vol:
            meta["volume_text"] = vol.get("name", "")
            meta["volume_category_id"] = str(vol["id"])
            if not set_id and vol.get("set_id"):
                inv_set_ref = _select_one("sets", school_id, str(vol["set_id"]))
                if inv_set_ref:
                    meta["set_text"] = inv_set_ref.get("name", "")
                    meta["set_category_id"] = str(inv_set_ref["id"])
                    set_id = inv_set_ref["id"]
                    sub = _select_one("subjects", school_id, str(inv_set_ref.get("subject_id", "")))
                    if sub:
                        meta["subject_text"] = sub.get("name", "")
                        meta["subject_category_id"] = str(sub["id"])
                        subject_id = sub["id"]

    batch_names = _normalize_batch_names(payload.get("batch_names"))
    if batch_names:
        meta["batch_names"] = batch_names

    unit_type = _normalize_unit_type(payload.get("unit_type"))
    vol_num = payload.get("volume_number")
    vol_name = meta.get("volume_text") or payload.get("volume_name") or ""
    set_part_name = None
    if vol_num and vol_name:
        set_part_name = f"Volume {vol_num} - {vol_name}"
    elif payload.get("set_part_name"):
        set_part_name = str(payload.get("set_part_name")).strip() or None

    row = {
        "school_id": school_id,
        "item_code": _build_inventory_code("MAT", name),
        "name": name,
        "subject_id": subject_id,
        "set_id": set_id,
        "volume_id": volume_id,
        "volume_name": vol_name or None,
        "volume_number": vol_num,
        "set_part_name": set_part_name,
        "class_name": ", ".join(batch_names) if batch_names else None,
        "description": (payload.get("description") or "").strip() or None,
        "unit_type": unit_type,
        "unit_price": float(payload.get("price") or 0),
        "low_stock_threshold": int(payload.get("low_stock_threshold") or 10),
        "current_stock": 0,
        "is_active": bool(payload.get("is_active", True)),
        "metadata": meta,
    }
    created = _insert_and_return("material_items", row)
    return _serialize_material(created)


def update_material(school_id: str, material_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    existing = _select_one("material_items", school_id, material_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Material not found")

    updates: dict[str, Any] = {}

    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Material name cannot be empty")
        dup = supabase.schema(s).table("material_items").select("id").eq("school_id", school_id).ilike("name", name).neq("id", material_id).limit(1).execute()
        if list(dup.data or []):
            raise HTTPException(status_code=400, detail="Another material with this name already exists")
        updates["name"] = name
        updates["item_code"] = _build_inventory_code("MAT", name)

    if "description" in payload:
        updates["description"] = (payload["description"] or "").strip() or None
    if "unit_type" in payload:
        updates["unit_type"] = _normalize_unit_type(payload["unit_type"])
    if "price" in payload:
        updates["unit_price"] = float(payload["price"])
    if "low_stock_threshold" in payload:
        updates["low_stock_threshold"] = int(payload["low_stock_threshold"])
    if "is_active" in payload:
        updates["is_active"] = bool(payload["is_active"])

    meta = _get_metadata(existing)
    subject_id = existing.get("subject_id")
    set_id = existing.get("set_id")
    volume_id = existing.get("volume_id")

    if "subject_id" in payload:
        subject_id = payload["subject_id"]
        if subject_id:
            sub = _select_one("subjects", school_id, str(subject_id))
            meta["subject_text"] = sub.get("name", "") if sub else ""
            meta["subject_category_id"] = str(subject_id)
        else:
            meta.pop("subject_text", None)
            meta.pop("subject_category_id", None)

    if "set_id" in payload:
        set_id = payload["set_id"]
        if set_id:
            inv_set = _select_one("sets", school_id, str(set_id))
            meta["set_text"] = inv_set.get("name", "") if inv_set else ""
            meta["set_category_id"] = str(set_id)
            if inv_set and inv_set.get("subject_id"):
                meta["subject_category_id"] = str(inv_set["subject_id"])
        else:
            meta.pop("set_text", None)
            meta.pop("set_category_id", None)

    if "volume_id" in payload:
        volume_id = payload["volume_id"]
        if volume_id:
            vol = _select_one("volumes", school_id, str(volume_id))
            meta["volume_text"] = vol.get("name", "") if vol else ""
            meta["volume_category_id"] = str(volume_id)
        else:
            meta.pop("volume_text", None)
            meta.pop("volume_category_id", None)

    if "batch_names" in payload:
        bn = _normalize_batch_names(payload["batch_names"])
        meta["batch_names"] = bn
        updates["class_name"] = ", ".join(bn) if bn else None

    updates["metadata"] = meta
    updates["subject_id"] = subject_id
    updates["set_id"] = set_id
    updates["volume_id"] = volume_id

    vol_name = meta.get("volume_text") or payload.get("volume_name") or existing.get("volume_name") or ""
    vol_num = payload.get("volume_number") or existing.get("volume_number")
    if "volume_name" in payload:
        updates["volume_name"] = (payload["volume_name"] or "").strip() or None
    if "volume_number" in payload:
        updates["volume_number"] = payload["volume_number"]
    if "set_name" in payload:
        updates["set_name"] = (payload["set_name"] or "").strip() or None
    if "set_part_name" in payload:
        updates["set_part_name"] = (payload["set_part_name"] or "").strip() or None
    if "subject" in payload:
        updates["subject"] = (payload["subject"] or "").strip() or None

    vol_num_final = updates.get("volume_number") or existing.get("volume_number")
    vol_name_final = updates.get("volume_name") or meta.get("volume_text") or existing.get("volume_name") or ""
    if vol_num_final and vol_name_final:
        updates["set_part_name"] = f"Volume {vol_num_final} - {vol_name_final}"

    if volume_id is None and "volume_id" in payload:
        updates["volume_id"] = None
        updates["volume_name"] = None
        updates["volume_number"] = None
        updates["set_part_name"] = None

    updated = _update_and_return("material_items", material_id, school_id, updates)
    return _serialize_material(updated)


def delete_material(school_id: str, material_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    existing = _select_one("material_items", school_id, material_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Material not found")

    stock_in = _t("stock_in_entries", s).select("id").eq("material_item_id", material_id).eq("school_id", school_id).limit(1).execute()
    stock_out = _t("stock_out_entries", s).select("id").eq("material_item_id", material_id).eq("school_id", school_id).limit(1).execute()
    if list(stock_in.data or []) or list(stock_out.data or []):
        raise HTTPException(status_code=400, detail="Material cannot be deleted because stock history exists")

    _delete_row("material_items", material_id, school_id)
    return {"message": "Material deleted successfully"}


# ==================== Stock In ====================


def _serialize_stock_in(entry: dict, supplier_name: str = "", material_name: str = "") -> dict:
    return {
        "id": entry.get("id"),
        "date": entry.get("entry_date") or entry.get("date"),
        "supplier_id": entry.get("supplier_id"),
        "supplier_name": supplier_name,
        "material_id": entry.get("material_item_id") or entry.get("material_id"),
        "material_name": material_name,
        "quantity_received": int(entry.get("quantity_received") or 0),
        "entry_type": entry.get("entry_type") or "purchase",
        "added_by": entry.get("added_by") or entry.get("created_by") or "",
        "notes": entry.get("notes") or None,
        "school_id": entry.get("school_id"),
        "created_at": entry.get("created_at") or entry.get("entry_date"),
    }


def list_stock_in(school_id: str, supplier_id: Optional[str] = None, material_id: Optional[str] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("stock_in_entries").select("*").eq("school_id", school_id)
    if supplier_id:
        query = query.eq("supplier_id", supplier_id)
    if material_id:
        query = query.eq("material_item_id", material_id)
    resp = query.order("entry_date", desc=True).order("id", desc=True).execute()
    rows = list(resp.data or [])

    supplier_ids = {str(r.get("supplier_id")) for r in rows if r.get("supplier_id")}
    material_ids = {str(r.get("material_item_id")) for r in rows if r.get("material_item_id")}
    suppliers = {}
    for sid in supplier_ids:
        srow = _select_one("suppliers", school_id, sid)
        if srow:
            suppliers[sid] = srow.get("name", "")
    materials = {}
    for mid in material_ids:
        mrow = _select_one("material_items", school_id, mid)
        if mrow:
            materials[mid] = mrow.get("name", "")

    return [
        _serialize_stock_in(r, suppliers.get(str(r.get("supplier_id")), ""), materials.get(str(r.get("material_item_id")), ""))
        for r in rows
    ]


def create_stock_in(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    supplier_id = str(payload.get("supplier_id") or "")
    material_id = str(payload.get("material_id") or "")
    quantity = int(payload.get("quantity_received") or 0)

    if not supplier_id:
        raise HTTPException(status_code=400, detail="supplier_id is required")
    if not material_id:
        raise HTTPException(status_code=400, detail="material_id is required")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity_received must be > 0")

    supplier = _select_one("suppliers", school_id, supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    material = _select_one("material_items", school_id, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    entry_date = payload.get("date")
    if isinstance(entry_date, str):
        entry_date = entry_date
    elif hasattr(entry_date, "isoformat"):
        entry_date = entry_date.isoformat()
    else:
        entry_date = _now_iso()

    row = {
        "school_id": school_id,
        "material_item_id": material_id,
        "supplier_id": supplier_id,
        "entry_date": entry_date,
        "quantity_received": quantity,
        "entry_type": str(payload.get("entry_type") or "purchase").strip() or "purchase",
        "added_by": str(payload.get("added_by") or "system").strip(),
        "notes": (payload.get("notes") or "").strip() or None,
        "unit_price": float(payload.get("unit_price") or material.get("unit_price") or 0),
    }
    created = _insert_and_return("stock_in_entries", row)

    stock = _calculate_material_stock(school_id, material_id)
    supabase.schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    return _serialize_stock_in(created, supplier.get("name", ""), material.get("name", ""))


def delete_stock_in(school_id: str, entry_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    entry = _select_one("stock_in_entries", school_id, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Stock-in entry not found")

    material_id = str(entry.get("material_item_id") or "")
    qty = int(entry.get("quantity_received") or 0)

    material = _select_one("material_items", school_id, material_id) if material_id else None
    if material and int(material.get("current_stock") or 0) < qty:
        raise HTTPException(
            status_code=400,
            detail="This stock-in entry cannot be deleted because later distributions depend on it",
        )

    _delete_row("stock_in_entries", entry_id, school_id)

    if material_id:
        stock = _calculate_material_stock(school_id, material_id)
        _client().schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    return {"message": "Stock-in entry deleted successfully"}


# ==================== Stock Out ====================


def _serialize_stock_out(entry: dict, material_name: str = "") -> dict:
    return {
        "id": entry.get("id"),
        "date": entry.get("entry_date") or entry.get("date"),
        "batch_id": entry.get("batch_id"),
        "batch_name": entry.get("batch_name") or "",
        "material_id": entry.get("material_item_id") or entry.get("material_id"),
        "material_name": material_name,
        "quantity_issued": int(entry.get("quantity_issued") or 0),
        "issued_by": entry.get("issued_by") or "",
        "remarks": entry.get("remarks") or None,
        "school_id": entry.get("school_id"),
        "created_at": entry.get("created_at") or entry.get("entry_date"),
    }


def list_stock_out(school_id: str, batch_id: Optional[str] = None, material_id: Optional[str] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("stock_out_entries").select("*").eq("school_id", school_id)
    if batch_id:
        query = query.eq("batch_id", batch_id)
    if material_id:
        query = query.eq("material_item_id", material_id)
    resp = query.order("entry_date", desc=True).order("id", desc=True).execute()
    rows = list(resp.data or [])

    material_ids = {str(r.get("material_item_id")) for r in rows if r.get("material_item_id")}
    materials = {}
    for mid in material_ids:
        mrow = _select_one("material_items", school_id, mid)
        if mrow:
            materials[mid] = mrow.get("name", "")

    return [_serialize_stock_out(r, materials.get(str(r.get("material_item_id")), "")) for r in rows]


def create_stock_out(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    material_id = str(payload.get("material_id") or "")
    quantity = int(payload.get("quantity_issued") or 0)

    if not material_id:
        raise HTTPException(status_code=400, detail="material_id is required")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity_issued must be > 0")

    material = _select_one("material_items", school_id, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    batch_ids = payload.get("batch_ids") or []
    batch_names_payload = payload.get("batch_name") or ""
    batch_id_payload = payload.get("batch_id")

    selected_batches: list[dict] = []
    if batch_ids:
        for bid in batch_ids:
            resp = _client().table("batches").select("*").eq("id", bid).eq("school_id", school_id).limit(1).execute()
            rows = list(resp.data or [])
            if not rows:
                raise HTTPException(status_code=404, detail=f"Batch {bid} not found")
            selected_batches.append(dict(rows[0]))
    elif batch_id_payload:
        resp = _client().table("batches").select("*").eq("id", batch_id_payload).eq("school_id", school_id).limit(1).execute()
        rows = list(resp.data or [])
        if not rows:
            raise HTTPException(status_code=404, detail="Batch not found")
        selected_batches.append(dict(rows[0]))
    elif batch_names_payload:
        resp = _client().table("batches").select("*").eq("school_id", school_id).ilike("name", batch_names_payload.strip()).limit(1).execute()
        rows = list(resp.data or [])
        if not rows:
            raise HTTPException(status_code=404, detail="Batch not found")
        selected_batches.append(dict(rows[0]))
    else:
        raise HTTPException(status_code=400, detail="batch_ids, batch_id, or batch_name is required")

    total_required = quantity * len(selected_batches)
    current_stock = int(material.get("current_stock") or 0)
    if current_stock < total_required:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot issue {quantity} item(s) each to {len(selected_batches)} batch(es). Only {current_stock} in stock.",
        )

    entry_date = payload.get("date")
    if isinstance(entry_date, str):
        entry_date = entry_date
    elif hasattr(entry_date, "isoformat"):
        entry_date = entry_date.isoformat()
    else:
        entry_date = _now_iso()

    created_entry = None
    for batch in selected_batches:
        row = {
            "school_id": school_id,
            "material_item_id": material_id,
            "batch_id": batch.get("id"),
            "batch_name": batch.get("name") or "",
            "entry_date": entry_date,
            "quantity_issued": quantity,
            "issued_by": str(payload.get("issued_by") or "system").strip(),
            "remarks": (payload.get("remarks") or "").strip() or None,
        }
        created = _insert_and_return("stock_out_entries", row)
        if not created_entry:
            created_entry = created

    stock = _calculate_material_stock(school_id, material_id)
    supabase.schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    if not created_entry:
        raise HTTPException(status_code=500, detail="Stock-out entry creation failed")
    return _serialize_stock_out(created_entry, material.get("name", ""))


def delete_stock_out(school_id: str, entry_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    entry = _select_one("stock_out_entries", school_id, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Stock-out entry not found")

    material_id = str(entry.get("material_item_id") or "")
    _delete_row("stock_out_entries", entry_id, school_id)

    if material_id:
        stock = _calculate_material_stock(school_id, material_id)
        _client().schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    return {"message": "Stock-out entry deleted successfully"}


# ==================== Student Issues ====================


def _serialize_student_issue(entry: dict, material_name: str = "") -> dict:
    return {
        "id": entry.get("id"),
        "date": entry.get("issue_date") or entry.get("date") or entry.get("created_at"),
        "batch_id": entry.get("batch_id"),
        "batch_name": entry.get("batch_name") or "",
        "student_id": entry.get("student_id"),
        "student_name": entry.get("student_name") or "",
        "material_id": entry.get("material_item_id") or entry.get("material_id"),
        "material_name": material_name,
        "quantity_issued": int(entry.get("quantity_issued") or 0),
        "issued_by": entry.get("issued_by") or entry.get("issued_by_profile_id") or "",
        "remarks": entry.get("remarks") or None,
        "school_id": entry.get("school_id"),
        "created_at": entry.get("created_at") or entry.get("issue_date"),
    }


def list_student_issues(school_id: str, batch_id: Optional[str] = None, student_id: Optional[str] = None, material_id: Optional[str] = None) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    query = supabase.schema(s).table("student_issue_entries").select("*").eq("school_id", school_id)
    if batch_id:
        query = query.eq("batch_id", batch_id)
    if student_id:
        query = query.eq("student_id", student_id)
    if material_id:
        query = query.eq("material_item_id", material_id)
    resp = query.order("issue_date", desc=True).order("id", desc=True).execute()
    rows = list(resp.data or [])

    material_ids = {str(r.get("material_item_id")) for r in rows if r.get("material_item_id")}
    materials = {}
    for mid in material_ids:
        mrow = _select_one("material_items", school_id, mid)
        if mrow:
            materials[mid] = mrow.get("name", "")

    return [_serialize_student_issue(r, materials.get(str(r.get("material_item_id")), "")) for r in rows]


def create_student_issue(school_id: str, payload: dict) -> dict:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    material_id = str(payload.get("material_id") or "")
    quantity = int(payload.get("quantity_issued") or 0)
    student_ids = [str(sid) for sid in (payload.get("student_ids") or [])]

    if not material_id:
        raise HTTPException(status_code=400, detail="material_id is required")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity_issued must be > 0")
    if not student_ids:
        raise HTTPException(status_code=400, detail="Please select at least one student")

    material = _select_one("material_items", school_id, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    students = []
    for sid in student_ids:
        resp = _client().table("students").select("*").eq("id", sid).eq("school_id", school_id).limit(1).execute()
        rows = list(resp.data or [])
        if not rows:
            raise HTTPException(status_code=404, detail=f"Student {sid} not found")
        students.append(dict(rows[0]))

    batch_names_set = {((s.get("batch") or "").strip() or "Unassigned Batch") for s in students}
    if len(batch_names_set) > 1:
        raise HTTPException(status_code=400, detail="Selected students must belong to the same batch")

    batch_name = next(iter(batch_names_set))
    selected_batch = None
    batch_id_payload = payload.get("batch_id")

    if batch_id_payload:
        resp = _client().table("batches").select("*").eq("id", batch_id_payload).eq("school_id", school_id).limit(1).execute()
        rows = list(resp.data or [])
        if not rows:
            raise HTTPException(status_code=404, detail="Batch not found")
        selected_batch = dict(rows[0])
        if selected_batch.get("name") != batch_name:
            raise HTTPException(status_code=400, detail="Selected students do not belong to the chosen batch")
    else:
        resp = _client().table("batches").select("*").eq("school_id", school_id).ilike("name", batch_name).limit(1).execute()
        rows = list(resp.data or [])
        if rows:
            selected_batch = dict(rows[0])

    total_required = quantity * len(students)
    current_stock = int(material.get("current_stock") or 0)
    if current_stock < total_required:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot issue {quantity} item(s) each to {len(students)} student(s). Only {current_stock} in stock.",
        )

    entry_date = payload.get("date")
    if isinstance(entry_date, str):
        entry_date = entry_date
    elif hasattr(entry_date, "isoformat"):
        entry_date = entry_date.isoformat()
    else:
        entry_date = _now_iso()

    created_entry = None
    for student in students:
        row = {
            "school_id": school_id,
            "material_item_id": material_id,
            "student_id": student.get("id"),
            "student_name": student.get("full_name") or student.get("name") or "",
            "batch_id": selected_batch.get("id") if selected_batch else student.get("batch_id"),
            "batch_name": batch_name,
            "issue_date": entry_date,
            "quantity_issued": quantity,
            "issued_by_profile_id": str(payload.get("issued_by") or "system").strip(),
            "remarks": (payload.get("remarks") or "").strip() or None,
        }
        created = _insert_and_return("student_issue_entries", row)
        if not created_entry:
            created_entry = created

    stock = _calculate_material_stock(school_id, material_id)
    supabase.schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    if not created_entry:
        raise HTTPException(status_code=500, detail="Student issue entry creation failed")
    return _serialize_student_issue(created_entry, material.get("name", ""))


def delete_student_issue(school_id: str, entry_id: str) -> dict:
    s = _INVENTORY_SCHEMA
    entry = _select_one("student_issue_entries", school_id, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Student issue entry not found")

    material_id = str(entry.get("material_item_id") or "")
    _delete_row("student_issue_entries", entry_id, school_id)

    if material_id:
        stock = _calculate_material_stock(school_id, material_id)
        _client().schema(s).table("material_items").update(stock).eq("id", material_id).eq("school_id", school_id).execute()

    return {"message": "Student issue entry deleted successfully"}


# ==================== Dashboard ====================


def get_dashboard(school_id: str) -> dict:
    cached = _inventory_dashboard_cache.get(school_id)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]

    try:
        payload = get_inventory_dashboard_summary_rpc(school_id)
        if payload:
            low_stock_rows = payload.get("low_stock_items")
            low_stock_items = [_serialize_material(item) for item in list(low_stock_rows or [])]
            result = {
                "total_materials_registered": int(payload.get("total_materials_registered") or 0),
                "total_books_in_inventory": int(payload.get("total_books_in_inventory") or 0),
                "total_books_distributed": int(payload.get("total_books_distributed") or 0),
                "current_stock_available": int(payload.get("current_stock_available") or 0),
                "low_stock_alert_count": int(payload.get("low_stock_alert_count") or 0),
                "low_stock_items": low_stock_items,
            }
            _inventory_dashboard_cache[school_id] = (now + _INVENTORY_DASHBOARD_CACHE_TTL_SECONDS, result)
            return result
    except Exception:
        pass

    supabase = _client()
    s = _INVENTORY_SCHEMA

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        def fetch_materials():
            return list((supabase.schema(s).table("material_items").select("*").eq("school_id", school_id).execute()).data or [])

        def fetch_stock_in_sum():
            rows = supabase.schema(s).table("stock_in_entries").select("quantity_received").eq("school_id", school_id).execute()
            return sum(int(r.get("quantity_received") or 0) for r in list(rows.data or []))

        def fetch_stock_out_sum():
            rows = supabase.schema(s).table("stock_out_entries").select("quantity_issued").eq("school_id", school_id).execute()
            return sum(int(r.get("quantity_issued") or 0) for r in list(rows.data or []))

        def fetch_student_issue_sum():
            rows = supabase.schema(s).table("student_issue_entries").select("quantity_issued").eq("school_id", school_id).execute()
            return sum(int(r.get("quantity_issued") or 0) for r in list(rows.data or []))

        f_materials = pool.submit(fetch_materials)
        f_stock_in = pool.submit(fetch_stock_in_sum)
        f_stock_out = pool.submit(fetch_stock_out_sum)
        f_student_issue = pool.submit(fetch_student_issue_sum)

        materials = f_materials.result()
        total_in = f_stock_in.result()
        total_out = f_stock_out.result() + f_student_issue.result()

    low_stock_items = [
        m for m in materials
        if bool(m.get("is_active", True)) and int(m.get("current_stock") or 0) <= int(m.get("low_stock_threshold") or 10)
    ]

    result = {
        "total_materials_registered": len(materials),
        "total_books_in_inventory": int(total_in),
        "total_books_distributed": int(total_out),
        "current_stock_available": sum(int(m.get("current_stock") or 0) for m in materials),
        "low_stock_alert_count": len(low_stock_items),
        "low_stock_items": [_serialize_material(m) for m in low_stock_items],
    }
    _inventory_dashboard_cache[school_id] = (time.monotonic() + _INVENTORY_DASHBOARD_CACHE_TTL_SECONDS, result)
    return result


# ==================== Material History ====================


def get_material_history(school_id: str, material_id: str) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA

    material = _select_one("material_items", school_id, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    history: list[dict] = []
    material_name = material.get("name", "")

    rows = list((supabase.schema(s).table("stock_in_entries").select("*").eq("material_item_id", material_id).eq("school_id", school_id).execute()).data or [])
    for entry in rows:
        supplier = _select_one("suppliers", school_id, str(entry.get("supplier_id", ""))) if entry.get("supplier_id") else None
        history.append({
            "entry_id": entry.get("id"),
            "entry_kind": "stock_in",
            "date": entry.get("entry_date") or entry.get("date"),
            "material_id": material_id,
            "material_name": material_name,
            "quantity": int(entry.get("quantity_received") or 0),
            "counterparty": supplier.get("name", "") if supplier else "",
            "performed_by": entry.get("added_by") or "",
            "notes": entry.get("notes") or None,
        })

    rows = list((supabase.schema(s).table("stock_out_entries").select("*").eq("material_item_id", material_id).eq("school_id", school_id).execute()).data or [])
    for entry in rows:
        history.append({
            "entry_id": entry.get("id"),
            "entry_kind": "stock_out",
            "date": entry.get("entry_date") or entry.get("date"),
            "material_id": material_id,
            "material_name": material_name,
            "quantity": int(entry.get("quantity_issued") or 0),
            "counterparty": entry.get("batch_name") or "",
            "performed_by": entry.get("issued_by") or "",
            "notes": entry.get("remarks") or None,
        })

    rows = list((supabase.schema(s).table("student_issue_entries").select("*").eq("material_item_id", material_id).eq("school_id", school_id).execute()).data or [])
    for entry in rows:
        student_name = entry.get("student_name") or ""
        batch_name = entry.get("batch_name") or ""
        counterparty = f"{student_name} ({batch_name or 'No Batch'})" if student_name else (batch_name or "")
        history.append({
            "entry_id": entry.get("id"),
            "entry_kind": "student_issue",
            "date": entry.get("issue_date") or entry.get("date"),
            "material_id": material_id,
            "material_name": material_name,
            "quantity": int(entry.get("quantity_issued") or 0),
            "counterparty": counterparty,
            "performed_by": entry.get("issued_by") or "",
            "notes": entry.get("remarks") or None,
        })

    history.sort(key=lambda h: str(h.get("date") or ""), reverse=True)
    return history


# ==================== Reports ====================


def get_report_data(
    school_id: str,
    report_type: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    supplier_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    material_id: Optional[str] = None,
    student_id: Optional[str] = None,
) -> list[dict]:
    supabase = _client()
    s = _INVENTORY_SCHEMA
    normalized_type = report_type.strip().lower()

    if normalized_type == "stock_in":
        query = supabase.schema(s).table("stock_in_entries").select("*").eq("school_id", school_id)
        if date_from:
            query = query.gte("entry_date", date_from)
        if date_to:
            query = query.lte("entry_date", date_to)
        if supplier_id:
            query = query.eq("supplier_id", supplier_id)
        if material_id:
            query = query.eq("material_item_id", material_id)
        rows = list((query.order("entry_date", desc=True).order("id", desc=True).execute()).data or [])
        supplier_ids = {str(r.get("supplier_id")) for r in rows if r.get("supplier_id")}
        material_ids = {str(r.get("material_item_id")) for r in rows if r.get("material_item_id")}
        suppliers = {sid: (_select_one("suppliers", school_id, sid) or {}).get("name", "") for sid in supplier_ids}
        materials = {mid: (_select_one("material_items", school_id, mid) or {}).get("name", "") for mid in material_ids}
        return [
            {
                "date": str(r.get("entry_date") or ""),
                "supplier": suppliers.get(str(r.get("supplier_id")), ""),
                "material": materials.get(str(r.get("material_item_id")), ""),
                "quantity_received": int(r.get("quantity_received") or 0),
                "entry_type": r.get("entry_type") or "purchase",
                "added_by": r.get("added_by") or "",
                "notes": r.get("notes") or "",
            }
            for r in rows
        ]

    if normalized_type in ("batch_distribution", "distribution"):
        result: list[dict] = []

        if student_id is None:
            bq = supabase.schema(s).table("stock_out_entries").select("*").eq("school_id", school_id)
            if date_from:
                bq = bq.gte("entry_date", date_from)
            if date_to:
                bq = bq.lte("entry_date", date_to)
            if batch_id:
                bq = bq.eq("batch_id", batch_id)
            if material_id:
                bq = bq.eq("material_item_id", material_id)
            b_rows = list((bq.order("entry_date", desc=True).order("id", desc=True).execute()).data or [])
            mat_ids = {str(r.get("material_item_id")) for r in b_rows if r.get("material_item_id")}
            b_materials = {mid: (_select_one("material_items", school_id, mid) or {}).get("name", "") for mid in mat_ids}
            for r in b_rows:
                result.append({
                    "date": str(r.get("entry_date") or ""),
                    "scope": "Batch",
                    "batch": r.get("batch_name") or "",
                    "student": "",
                    "material": b_materials.get(str(r.get("material_item_id")), ""),
                    "quantity_issued": int(r.get("quantity_issued") or 0),
                    "issued_by": r.get("issued_by") or "",
                    "remarks": r.get("remarks") or "",
                })

        sq = supabase.schema(s).table("student_issue_entries").select("*").eq("school_id", school_id)
        if date_from:
            sq = sq.gte("issue_date", date_from)
        if date_to:
            sq = sq.lte("issue_date", date_to)
        if batch_id:
            sq = sq.eq("batch_id", batch_id)
        if material_id:
            sq = sq.eq("material_item_id", material_id)
        if student_id:
            sq = sq.eq("student_id", student_id)
        s_rows = list((sq.order("issue_date", desc=True).order("id", desc=True).execute()).data or [])
        s_mat_ids = {str(r.get("material_item_id")) for r in s_rows if r.get("material_item_id")}
        s_materials = {mid: (_select_one("material_items", school_id, mid) or {}).get("name", "") for mid in s_mat_ids}
        for r in s_rows:
            result.append({
                "date": str(r.get("issue_date") or ""),
                "scope": "Student",
                "batch": r.get("batch_name") or "",
                "student": r.get("student_name") or "",
                "material": s_materials.get(str(r.get("material_item_id")), ""),
                "quantity_issued": int(r.get("quantity_issued") or 0),
                "issued_by": r.get("issued_by") or "",
                "remarks": r.get("remarks") or "",
            })

        result.sort(key=lambda row: row["date"], reverse=True)
        return result

    if normalized_type in ("current_inventory", "inventory"):
        query = supabase.schema(s).table("material_items").select("*").eq("school_id", school_id)
        if material_id:
            query = query.eq("id", material_id)
        rows = list((query.order("name", desc=False).execute()).data or [])
        return [
            {
                "material": r.get("name") or "",
                "subject": _get_metadata(r).get("subject_text", ""),
                "set_name": _get_metadata(r).get("set_text", ""),
                "set_part_name": r.get("set_part_name") or "",
                "batches": ", ".join(_parse_batch_names(_get_metadata(r))),
                "unit_type": r.get("unit_type") or "book",
                "price": float(r.get("unit_price") or 0),
                "current_stock": int(r.get("current_stock") or 0),
                "distributed": int(r.get("total_distributed") or 0),
                "status": "Active" if bool(r.get("is_active", True)) else "Inactive",
            }
            for r in rows
        ]

    if normalized_type == "low_stock":
        query = supabase.schema(s).table("material_items").select("*").eq("school_id", school_id).eq("is_active", True)
        if material_id:
            query = query.eq("id", material_id)
        rows = list((query.order("current_stock", desc=False).order("name", desc=False).execute()).data or [])
        rows = [r for r in rows if int(r.get("current_stock") or 0) <= int(r.get("low_stock_threshold") or 10)]
        return [
            {
                "material": r.get("name") or "",
                "subject": _get_metadata(r).get("subject_text", ""),
                "set_name": _get_metadata(r).get("set_text", ""),
                "set_part_name": r.get("set_part_name") or "",
                "batches": ", ".join(_parse_batch_names(_get_metadata(r))),
                "current_stock": int(r.get("current_stock") or 0),
                "low_stock_threshold": int(r.get("low_stock_threshold") or 10),
                "status": "Low Stock" if int(r.get("current_stock") or 0) > 0 else "Out of Stock",
            }
            for r in rows
        ]

    raise HTTPException(status_code=400, detail="Unsupported report type")
