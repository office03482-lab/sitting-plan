"""Shared Supabase-aware context helpers for production-safe routes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.config import settings
from app.services.supabase_admin import get_supabase_admin_client


def is_legacy_sqlite_mode() -> bool:
    return not bool(settings.use_supabase_native_services)


def resolve_school_id_from_actor(explicit_school_id: Any, actor: dict[str, Any]) -> str:
    candidate = str(explicit_school_id or "").strip()
    if candidate and candidate != "1":
        return candidate

    actor_school_id = str(actor.get("school_id") or "").strip()
    if actor_school_id and actor_school_id != "1":
        return actor_school_id

    profile_id = str(actor.get("user_id") or actor.get("id") or "").strip()
    if profile_id:
        supabase = get_supabase_admin_client()
        membership_response = (
            supabase
            .table("school_memberships")
            .select("school_id, is_primary")
            .eq("profile_id", profile_id)
            .eq("is_active", True)
            .eq("status", "active")
            .execute()
        )
        memberships = list(membership_response.data or [])
        primary_membership = next((item for item in memberships if item.get("is_primary")), None)
        if primary_membership and primary_membership.get("school_id"):
            return str(primary_membership["school_id"])
        if memberships and memberships[0].get("school_id"):
            return str(memberships[0]["school_id"])

    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")
