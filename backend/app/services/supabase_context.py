"""Shared context helpers for production-safe routes.

School ID resolution uses JWT claims ONLY.
No fallback to Supabase profiles/memberships tables.
No explicit school_id query parameter fallback.
"""
from __future__ import annotations

import logging
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException, Query, Depends, Request

from app.config import settings
from app.middleware.auth import get_authenticated_actor_context

logger = logging.getLogger(__name__)

LEGACY_SCHOOL_FALLBACK = "1"
_PLACEHOLDER_SCHOOL_IDS = {"", "1", "none", "null", "undefined"}
_MIGRATION_UNAVAILABLE_STATUS_CODE = 503
_MIGRATION_UNAVAILABLE_DETAIL = "This module is temporarily unavailable during Supabase migration."


def should_use_supabase_native_services() -> bool:
    configured_flag = settings.use_supabase_native_services
    if configured_flag is not None:
        return bool(configured_flag)
    return bool(settings.supabase_url and settings.supabase_service_role_key)


def is_legacy_sqlite_mode() -> bool:
    return not should_use_supabase_native_services()


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


def _raise_migration_block(module_name: str, reason: str | None, school_id: Any) -> None:
    normalized_school_id = _normalize_school_id_candidate(school_id)
    logger.warning(
        "storage.migration_route_blocked",
        extra={
            "guarded_module": module_name,
            "school_id": normalized_school_id,
            "native_mode": should_use_supabase_native_services(),
            "reason": reason or "",
        },
    )
    raise HTTPException(
        status_code=_MIGRATION_UNAVAILABLE_STATUS_CODE,
        detail=_MIGRATION_UNAVAILABLE_DETAIL,
    )


def ensure_legacy_sqlite_route_available(
    module_name: str,
    school_id: Any = None,
    *,
    reason: str | None = None,
) -> None:
    if not should_use_supabase_native_services():
        return
    if school_id is not None and not _is_valid_uuid(school_id):
        return
    _raise_migration_block(module_name, reason, school_id)


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
    """
    Resolve school_id from JWT actor claims ONLY.
    Falls back to explicit query param for legacy SQLite mode.
    No lookup to Supabase profiles/memberships.
    """
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

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
    """Resolve school_id from JWT actor claims only."""
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    if is_legacy_sqlite_mode():
        return LEGACY_SCHOOL_FALLBACK

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
    """Resolve school_id from JWT actor claims only."""
    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        return candidate

    if is_legacy_sqlite_mode():
        return LEGACY_SCHOOL_FALLBACK

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
    """Verify school exists. Uses local DB in SQLite mode."""
    from app.database import SessionLocal
    from app.models import School

    if is_legacy_sqlite_mode():
        db = SessionLocal()
        try:
            school = db.query(School).filter(School.id == int(school_id)).first()
            if not school:
                raise HTTPException(status_code=404, detail="School not found")
            return {"id": school.id, "name": school.name}
        finally:
            db.close()

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


def build_legacy_sqlite_route_blocker(
    module_name: str,
    *,
    reason: str | None = None,
) -> Callable[[], None]:
    def dependency(
        school_id: str = Depends(resolve_school_id_from_actor),
    ) -> None:
        ensure_legacy_sqlite_route_available(module_name, school_id, reason=reason)

    return dependency
