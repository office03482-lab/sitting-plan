"""
Question Bank Taxonomy Service — Supabase CRUD for hierarchical taxonomy.
All operations use the Supabase PostgREST client.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError as PostgrestAPIError

from app.services.supabase_admin import get_supabase_admin_client


def _client():
    return get_supabase_admin_client()


# ─── Exam Types ──────────────────────────────────────────────

def list_exam_types(school_id: str) -> list[dict[str, Any]]:
    resp = _client().table("qb_exam_types").select("*").eq("school_id", school_id).eq("is_active", True).order("display_order").execute()
    return resp.data or []


def create_exam_type(school_id: str, name: str, slug: str, display_order: int = 0) -> dict[str, Any]:
    resp = _client().table("qb_exam_types").insert({
        "school_id": school_id, "name": name, "slug": slug, "display_order": display_order,
    }).execute()
    return resp.data[0] if resp.data else {}


# ─── Taxonomy Nodes ──────────────────────────────────────────

def list_taxonomy_nodes(school_id: str, exam_type_slug: str | None = None, node_type: str | None = None, parent_id: str | None = None) -> list[dict[str, Any]]:
    q = _client().table("qb_taxonomy_nodes").select("*").eq("school_id", school_id).eq("is_active", True)
    if exam_type_slug:
        q = q.eq("exam_type_slug", exam_type_slug)
    if node_type:
        q = q.eq("node_type", node_type)
    if parent_id:
        q = q.eq("parent_id", parent_id)
    elif parent_id is None and node_type == "subject":
        q = q.is_("parent_id", "null")
    resp = q.order("display_order").execute()
    return resp.data or []


def create_taxonomy_node(school_id: str, name: str, node_type: str, exam_type_slug: str = "custom", parent_id: str | None = None, display_order: int = 0) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "school_id": school_id, "name": name, "node_type": node_type,
        "exam_type_slug": exam_type_slug, "display_order": display_order,
    }
    if parent_id:
        payload["parent_id"] = parent_id
    resp = _client().table("qb_taxonomy_nodes").insert(payload).execute()
    return resp.data[0] if resp.data else {}


def delete_taxonomy_node(node_id: str, school_id: str) -> bool:
    try:
        _client().table("qb_taxonomy_nodes").update({"is_active": False}).eq("id", node_id).eq("school_id", school_id).execute()
        return True
    except PostgrestAPIError:
        return False


# ─── Tags ────────────────────────────────────────────────────

def list_tags(school_id: str) -> list[dict[str, Any]]:
    resp = _client().table("qb_tags").select("*").eq("school_id", school_id).eq("is_active", True).order("name").execute()
    return resp.data or []


def create_tag(school_id: str, name: str, slug: str, color: str = "#6b7280", icon: str | None = None) -> dict[str, Any]:
    resp = _client().table("qb_tags").insert({
        "school_id": school_id, "name": name, "slug": slug, "color": color, "icon": icon,
    }).execute()
    return resp.data[0] if resp.data else {}


# ─── Sources ─────────────────────────────────────────────────

def list_sources(school_id: str) -> list[dict[str, Any]]:
    resp = _client().table("qb_sources").select("*").eq("school_id", school_id).eq("is_active", True).order("name").execute()
    return resp.data or []


def create_source(school_id: str, name: str, source_type: str = "self") -> dict[str, Any]:
    resp = _client().table("qb_sources").insert({
        "school_id": school_id, "name": name, "source_type": source_type,
    }).execute()
    return resp.data[0] if resp.data else {}


# ─── Questions (Enhanced QB) ─────────────────────────────────

def list_questions(school_id: str, filters: dict[str, Any] | None = None, skip: int = 0, limit: int = 50) -> list[dict[str, Any]]:
    q = _client().table("qb_questions").select("*", count="exact").eq("school_id", school_id).eq("is_active", True)
    if filters:
        if filters.get("exam_type_slug"):
            q = q.eq("exam_type_slug", filters["exam_type_slug"])
        if filters.get("subject"):
            q = q.eq("subject", filters["subject"])
        if filters.get("chapter"):
            q = q.eq("chapter", filters["chapter"])
        if filters.get("topic"):
            q = q.eq("topic", filters["topic"])
        if filters.get("difficulty_level"):
            q = q.eq("difficulty_level", filters["difficulty_level"])
        if filters.get("question_type"):
            q = q.eq("question_type", filters["question_type"])
        if filters.get("status"):
            q = q.eq("status", filters["status"])
        if filters.get("search"):
            q = q.or_(f"prompt_text.ilike.%{filters['search']}%,question_code.ilike.%{filters['search']}%")
    resp = q.order("created_at", desc=True).range(skip, skip + limit - 1).execute()
    return resp.data or []


def get_question(question_id: str, school_id: str) -> dict[str, Any] | None:
    resp = _client().table("qb_questions").select("*").eq("id", question_id).eq("school_id", school_id).single().execute()
    return resp.data if resp.data else None


def create_question(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    payload["school_id"] = school_id
    resp = _client().table("qb_questions").insert(payload).execute()
    return resp.data[0] if resp.data else {}


def update_question(question_id: str, school_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    resp = _client().table("qb_questions").update(payload).eq("id", question_id).eq("school_id", school_id).execute()
    return resp.data[0] if resp.data else None


def soft_delete_question(question_id: str, school_id: str) -> bool:
    from datetime import datetime, timezone
    try:
        _client().table("qb_questions").update({
            "is_active": False, "deleted_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", question_id).eq("school_id", school_id).execute()
        return True
    except PostgrestAPIError:
        return False


# ─── Version History ─────────────────────────────────────────

def create_version(question_id: str, school_id: str, snapshot: dict[str, Any], version: int, changed_by: str | None = None, change_summary: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "question_id": question_id, "school_id": school_id,
        "version": version, "snapshot": snapshot,
    }
    if changed_by:
        payload["changed_by"] = changed_by
    if change_summary:
        payload["change_summary"] = change_summary
    resp = _client().table("qb_question_versions").insert(payload).execute()
    return resp.data[0] if resp.data else {}


def list_versions(question_id: str, school_id: str, limit: int = 20) -> list[dict[str, Any]]:
    resp = _client().table("qb_question_versions").select("*").eq("question_id", question_id).eq("school_id", school_id).order("version", desc=True).limit(limit).execute()
    return resp.data or []


def get_version(version_id: str) -> dict[str, Any] | None:
    resp = _client().table("qb_question_versions").select("*").eq("id", version_id).single().execute()
    return resp.data if resp.data else None


# ─── Edit History (Audit Log) ────────────────────────────────

def log_history(question_id: str, school_id: str, action: str, field_changed: str | None = None, old_value: Any = None, new_value: Any = None, performed_by: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "question_id": question_id, "school_id": school_id, "action": action,
    }
    if field_changed:
        payload["field_changed"] = field_changed
    if old_value is not None:
        payload["old_value"] = old_value
    if new_value is not None:
        payload["new_value"] = new_value
    if performed_by:
        payload["performed_by"] = performed_by
    resp = _client().table("qb_question_history").insert(payload).execute()
    return resp.data[0] if resp.data else {}


def list_history(question_id: str, school_id: str, limit: int = 50) -> list[dict[str, Any]]:
    resp = _client().table("qb_question_history").select("*").eq("question_id", question_id).eq("school_id", school_id).order("created_at", desc=True).limit(limit).execute()
    return resp.data or []
