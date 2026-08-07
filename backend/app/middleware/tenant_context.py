"""Tenant context middleware + FastAPI dependency (EP-00 F-001).

Every new exam/service route can declare ``Depends(get_tenant_context)`` and
receive a validated ``TenantContext`` carrying ``school_id``. School ID
resolution is DELEGATED to ``app.services.supabase_context`` (the role-aware,
authorization-gated resolver kernel) — this module never duplicates resolution
logic.

Layering:
- ``TenantContextMiddleware`` runs before routers. It is gated by
  ``settings.tenant_context_enabled`` (rollback switch), skips the explicit
  anonymous allow-list (see ``ANONYMOUS_ALLOW_PATHS``), and performs
  best-effort enrichment of ``request.state.tenant_context`` from JWT claims.
  It NEVER rejects — enforcement is the responsibility of the
  ``get_tenant_context`` dependency so existing routes remain untouched.
- ``get_tenant_context`` is the strict enforcement point. New routes that
  depend on it always receive a validated ``school_id`` or the resolver
  kernel's 401/403.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, Query, Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.middleware.anonymous_access import is_anonymous_path, is_anonymous_request
from app.middleware.auth import (
    _get_request_token_payload,
    build_actor_context,
    get_authenticated_user,
)
from app.models import User
from app.services.supabase_context import resolve_school_id_from_actor

logger = logging.getLogger(__name__)


@dataclass
class TenantContext:
    """Resolved, validated tenant scope for the current request."""

    school_id: str
    role: str = ""
    profile_id: str = ""
    resolved_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    source: str = "tenant_context"

def _resolve_actor_from_request(request: Request) -> dict[str, Any]:
    """Reuse the auth module's principal/claims resolvers (no duplication)."""
    principal = getattr(request.state, "resolved_auth_principal", None)
    if isinstance(principal, dict):
        actor = principal.get("actor")
        if isinstance(actor, dict):
            return actor
    authorization = request.headers.get("Authorization") or request.headers.get("authorization")
    payload = _get_request_token_payload(request, authorization)
    return build_actor_context(authorization, payload)


def _build_context(school_id: str, actor: dict[str, Any], *, source: str) -> TenantContext:
    return TenantContext(
        school_id=school_id,
        role=str(actor.get("role_key") or actor.get("role") or "").strip().lower(),
        profile_id=str(actor.get("profile_id") or "").strip(),
        source=source,
    )


async def get_tenant_context(
    request: Request,
    user: User = Depends(get_authenticated_user),
    explicit_school_id: Any = Query(None, alias="school_id"),
) -> TenantContext:
    """Strict tenant-context dependency for new exam/service routes.

    Always resolves a validated ``school_id`` via ``supabase_context``, or
    raises the resolver kernel's 401/403. Reuses ``request.state.tenant_context``
    when the middleware already enriched it for this request.
    """
    if request.method == "OPTIONS":
        return TenantContext(school_id="")

    cached = getattr(request.state, "tenant_context", None)
    if isinstance(cached, TenantContext) and cached.school_id:
        return cached

    actor = _resolve_actor_from_request(request)
    school_id = resolve_school_id_from_actor(
        request=request,
        explicit_school_id=explicit_school_id,
        actor=actor,
    )
    context = _build_context(school_id, actor, source="tenant_context:resolver")
    request.state.tenant_context = context
    logger.info(
        "tenant_context.resolved",
        extra={
            "school_id": context.school_id,
            "role": context.role,
            "profile_id": context.profile_id,
            "source": context.source,
            "user_id": str(getattr(user, "id", "")),
        },
    )
    return context


class TenantContextMiddleware(BaseHTTPMiddleware):
    """Pre-router tenant-context layer.

    - Disabled via ``TENANT_CONTEXT_ENABLED=false`` (EP-00 F-001 rollback).
    - Skips the explicit anonymous allow-list.
    - Best-effort enrichment of ``request.state.tenant_context`` from JWT
      claims; never rejects, so existing routes are unaffected.
    """

    def __init__(self, app, *, enabled: bool | None = None):
        super().__init__(app)
        self.enabled = settings.tenant_context_enabled if enabled is None else enabled

    async def dispatch(self, request: Request, call_next):
        if not self.enabled or is_anonymous_request(request.method, request.url.path):
            return await call_next(request)

        try:
            existing = getattr(request.state, "tenant_context", None)
            if not isinstance(existing, TenantContext) or not existing.school_id:
                actor = _resolve_actor_from_request(request)
                if actor.get("school_id") or actor.get("role"):
                    school_id = resolve_school_id_from_actor(
                        request=request,
                        explicit_school_id=request.query_params.get("school_id"),
                        actor=actor,
                    )
                    if school_id:
                        request.state.tenant_context = _build_context(
                            school_id, actor, source="tenant_context:middleware"
                        )
        except Exception:
            logger.debug(
                "tenant_context.middleware_skip",
                extra={"path": str(request.url.path), "method": request.method},
            )

        return await call_next(request)
