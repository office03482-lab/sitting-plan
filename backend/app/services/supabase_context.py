"""Shared context helpers for production-safe routes.

School ID resolution uses JWT claims ONLY.
No fallback to Supabase profiles/memberships tables.
No explicit school_id query parameter fallback.
Supabase-native only — no SQLite legacy mode.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException, Query, Depends, Request

from app.middleware.auth import get_authenticated_actor_context

logger = logging.getLogger(__name__)

_PLACEHOLDER_SCHOOL_IDS = {"", "1", "none", "null", "undefined"}


def is_legacy_sqlite_mode() -> bool:
    return False


def ensure_legacy_sqlite_route_available(
    module_name: str,
    school_id: Any = None,
    *,
    reason: str | None = None,
) -> None:
    pass


def build_legacy_sqlite_route_blocker(
    module_name: str,
    *,
    reason: str | None = None,
) -> Any:
    def dependency() -> None:
        pass
    return dependency


def _normalize_school_id_candidate(value: Any) -> str:
    return str(value or "").strip()


def _is_valid_uuid(value: Any) -> bool:
    candidate = _normalize_school_id_candidate(value)
    if not candidate:
        return False
    try:
        UUID(candidate)
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def _is_placeholder_school_id(value: Any) -> bool:
    return _normalize_school_id_candidate(value).lower() in _PLACEHOLDER_SCHOOL_IDS


def _resolve_school_id_from_actor_claims(actor: dict[str, Any]) -> str:
    for key in ("school_id", "school_uuid", "active_school_id", "current_school_id"):
        candidate = _normalize_school_id_candidate(actor.get(key))
        if candidate and not _is_placeholder_school_id(candidate):
            return candidate
    return ""


def resolve_school_id_from_actor(
    request: Request,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    logger.warning(
        "auth.school_context_denied",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "actor_user_id": str(actor.get("user_id") or ""),
            "actor_role": str(actor.get("role") or ""),
            "actor_school_id": str(actor.get("school_id") or ""),
            "explicit_school_id": _normalize_school_id_candidate(explicit_school_id),
            "failure_reason": "school_id_missing_from_context",
        },
    )
    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")


def resolve_school_id_from_exam_context(
    request: Request,
    exam_id: str,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    logger.warning(
        "auth.exam_school_context_denied",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "actor_user_id": str(actor.get("user_id") or ""),
            "actor_role": str(actor.get("role") or ""),
            "actor_school_id": str(actor.get("school_id") or ""),
            "explicit_school_id": _normalize_school_id_candidate(explicit_school_id),
            "failure_reason": "unable_to_resolve_school_id_from_exam_context",
        },
    )
    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from exam context")


def resolve_school_id_from_seating_plan_context(
    request: Request,
    plan_id: str,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    logger.warning(
        "auth.seating_plan_school_context_denied",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "actor_user_id": str(actor.get("user_id") or ""),
            "actor_role": str(actor.get("role") or ""),
            "actor_school_id": str(actor.get("school_id") or ""),
            "explicit_school_id": _normalize_school_id_candidate(explicit_school_id),
            "failure_reason": "unable_to_resolve_school_id",
        },
    )
    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from seating plan context")


def ensure_supabase_school_exists(school_id: str) -> dict[str, Any]:
    from app.services.supabase_admin import get_supabase_admin_client
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
