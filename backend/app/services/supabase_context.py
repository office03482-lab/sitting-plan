"""Shared Supabase-aware context helpers for production-safe routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, Query, Depends, Request

from app.config import settings
from app.services.supabase_admin import get_supabase_admin_client
from app.middleware.auth import get_authenticated_actor_context

logger = logging.getLogger(__name__)

LEGACY_SCHOOL_FALLBACK = "1"
_PLACEHOLDER_SCHOOL_IDS = {"", "1", "none", "null", "undefined"}


def is_legacy_sqlite_mode() -> bool:
    return not bool(settings.use_supabase_native_services)


def _normalize_school_id_candidate(value: Any) -> str:
    return str(value or "").strip()


def _is_placeholder_school_id(value: Any) -> bool:
    return _normalize_school_id_candidate(value).lower() in _PLACEHOLDER_SCHOOL_IDS


def _resolve_school_id_from_actor_claims(actor: dict[str, Any]) -> str:
    for key in ("school_id", "school_uuid", "active_school_id", "current_school_id"):
        candidate = _normalize_school_id_candidate(actor.get(key))
        if candidate and not _is_placeholder_school_id(candidate):
            return candidate
    return ""


def _resolve_profile_id(actor: dict[str, Any]) -> str:
    for key in ("profile_id", "user_id", "id", "sub"):
        candidate = _normalize_school_id_candidate(actor.get(key))
        if candidate:
            return candidate
    return ""


def _lookup_school_id_from_profile(profile_id: str) -> str:
    supabase = get_supabase_admin_client()
    profile_response = (
        supabase
        .table("profiles")
        .select("id, school_id")
        .eq("id", profile_id)
        .limit(1)
        .execute()
    )
    profiles = list(profile_response.data or [])
    if profiles:
        candidate = _normalize_school_id_candidate(profiles[0].get("school_id"))
        if candidate and not _is_placeholder_school_id(candidate):
            return candidate
    return ""


def _lookup_school_id_from_memberships(profile_id: str) -> str:
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
    return ""


def resolve_school_id_from_actor(
    request: Request,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    profile_id = _resolve_profile_id(actor)
    if profile_id:
        candidate = _lookup_school_id_from_profile(profile_id)
        if candidate and not _is_placeholder_school_id(candidate):
            return candidate

        candidate = _lookup_school_id_from_memberships(profile_id)
        if candidate and not _is_placeholder_school_id(candidate):
            return candidate

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    if is_legacy_sqlite_mode():
        return LEGACY_SCHOOL_FALLBACK

    logger.warning(
        "auth.school_context_denied",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "actor_user_id": str(actor.get("user_id") or ""),
            "actor_profile_id": str(actor.get("profile_id") or ""),
            "actor_role": str(actor.get("role") or ""),
            "actor_school_id": str(actor.get("school_id") or ""),
            "explicit_school_id": _normalize_school_id_candidate(explicit_school_id),
            "failure_reason": "valid_uuid_school_id_missing_from_context",
        },
    )
    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")


def ensure_supabase_school_exists(school_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .table("schools")
        .select("id, name")
        .eq("id", school_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        return rows[0]
    raise HTTPException(status_code=404, detail="School not found")
