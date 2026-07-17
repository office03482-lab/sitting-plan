"""Shared context helpers for production-safe routes.

School ID resolution is ROLE-AWARE and AUTHORIZATION-GATED.
- Platform Admin: may provide explicit school_id query parameter (validated).
- All other roles: school_id from JWT claims only; explicit parameter is validated
  against school_memberships to prevent cross-tenant IDOR.
No legacy SQLite mode.
"""
from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

from fastapi import HTTPException, Query, Depends, Request

from app.middleware.auth import get_authenticated_actor_context

logger = logging.getLogger(__name__)

_PLACEHOLDER_SCHOOL_IDS = {"", "1", "none", "null", "undefined"}
_SCHOOL_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SCHOOL_CACHE_TTL = 300  # 5 minutes


def _get_cached_school(school_id: str) -> dict[str, Any] | None:
    entry = _SCHOOL_CACHE.get(school_id)
    if entry and (time.monotonic() - entry[0]) < _SCHOOL_CACHE_TTL:
        return entry[1]
    _SCHOOL_CACHE.pop(school_id, None)
    return None


def _set_cached_school(school_id: str, data: dict[str, Any]) -> None:
    _SCHOOL_CACHE[school_id] = (time.monotonic(), data)


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


def _get_actor_role_key(actor: dict[str, Any]) -> str:
    return str(actor.get("role_key") or actor.get("role") or "").strip().lower()


def _ensure_supabase_school_exists(school_id: str) -> dict[str, Any]:
    cached = _get_cached_school(school_id)
    if cached:
        return cached

    from app.services.supabase_admin import get_supabase_admin_client, _invalidate_admin_client_cache

    def _query_school(client: Any) -> dict[str, Any]:
        response = (
            client
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

    try:
        supabase = get_supabase_admin_client()
        result = _query_school(supabase)
    except HTTPException:
        raise
    except Exception as exc:
        error_name = type(exc).__name__
        if "RemoteProtocol" in error_name or "RemoteProtocol" in str(exc):
            logger.warning(
                "school_exists.remote_protocol_error_retrying",
                extra={"school_id": school_id, "error": str(exc)},
            )
            _invalidate_admin_client_cache()
            supabase = get_supabase_admin_client()
            result = _query_school(supabase)
        else:
            raise

    _set_cached_school(school_id, result)
    return result


def _validate_school_membership(actor: dict[str, Any], school_id: str) -> bool:
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id or not school_id:
        return False
    from app.services.supabase_admin import get_supabase_admin_client
    supabase = get_supabase_admin_client()
    try:
        response = (
            supabase
            .table("school_memberships")
            .select("id")
            .eq("profile_id", profile_id)
            .eq("school_id", school_id)
            .limit(1)
            .execute()
        )
        return len(list(response.data or [])) > 0
    except Exception:
        logger.exception("auth.membership_validation_failed", extra={"profile_id": profile_id, "school_id": school_id})
        return False


def _role_aware_resolve_school_id(
    request: Request,
    actor: dict[str, Any],
    explicit_school_id: Any,
    logger_key: str = "school_context_denied",
) -> str:
    role_key = _get_actor_role_key(actor)
    is_platform_admin = role_key == "platform_admin"

    if is_platform_admin:
        candidate = _normalize_school_id_candidate(explicit_school_id)
        if candidate and not _is_placeholder_school_id(candidate):
            try:
                _ensure_supabase_school_exists(candidate)
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception(
                    "school_validation_unexpected_error",
                    extra={
                        "school_id": candidate,
                        "actor_user_id": str(actor.get("user_id") or ""),
                        "actor_profile_id": str(actor.get("profile_id") or ""),
                        "error_type": type(exc).__name__,
                        "error_detail": str(exc),
                    },
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"School validation failed due to a server error ({type(exc).__name__}). Please check server logs.",
                )
            return candidate
        raise HTTPException(status_code=403, detail="Platform Admin requires an explicit school_id")

    actor_school_id = _resolve_school_id_from_actor_claims(actor)
    if actor_school_id:
        return actor_school_id

    candidate = _normalize_school_id_candidate(explicit_school_id)
    if candidate and not _is_placeholder_school_id(candidate):
        if _validate_school_membership(actor, candidate):
            return candidate

    logger.warning(
        f"auth.{logger_key}",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "actor_user_id": str(actor.get("user_id") or ""),
            "actor_role": role_key,
            "actor_school_id": str(actor.get("school_id") or ""),
            "explicit_school_id": _normalize_school_id_candidate(explicit_school_id),
            "failure_reason": "school_id_missing_or_unauthorized",
        },
    )
    raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")


def resolve_school_id_from_actor(
    request: Request,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    return _role_aware_resolve_school_id(request, actor, explicit_school_id)


def resolve_school_id_from_exam_context(
    request: Request,
    exam_id: str,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    return _role_aware_resolve_school_id(request, actor, explicit_school_id, "exam_school_context_denied")


def resolve_school_id_from_seating_plan_context(
    request: Request,
    plan_id: str,
    explicit_school_id: Any = Query(None, alias="school_id"),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
) -> str:
    return _role_aware_resolve_school_id(request, actor, explicit_school_id, "seating_plan_school_context_denied")


def ensure_supabase_school_exists(school_id: str) -> dict[str, Any]:
    """Public wrapper — used by routes that need to verify a school exists."""
    return _ensure_supabase_school_exists(school_id)
