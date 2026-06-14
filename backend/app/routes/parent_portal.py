"""AI-powered parent intelligence portal routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_parent_intelligence import (
    acknowledge_parent_alert,
    contact_teacher,
    get_parent_alerts,
    get_parent_dashboard,
    get_parent_insights,
    get_parent_risk_scores,
    request_parent_meeting,
)

router = APIRouter(prefix="/api/parent", tags=["Parent Intelligence"])


class ParentCommunicationRequest(BaseModel):
    student_id: str
    message: str | None = None
    preferred_date: str | None = None
    note: str | None = None


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_parent_user(user: User) -> bool:
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return _role_key(user) == "parent" or "edupay.parent_portal" in permissions


def _is_school_admin_user(user: User) -> bool:
    return _role_key(user) == "school_admin" or getattr(user, "role", None) == "admin"


def require_parent_intelligence_view_user(
    _: User = Depends(require_permissions("parent_intelligence.view", "parent_intelligence.alerts", "parent_intelligence.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the parent intelligence portal")


def require_parent_intelligence_action_user(
    _: User = Depends(require_permissions("parent_intelligence.alerts", "parent_intelligence.communication", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to parent portal actions")


@router.get("/dashboard")
async def api_get_parent_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_view_user),
):
    return get_parent_dashboard(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.get("/insights")
async def api_get_parent_insights(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_view_user),
):
    return get_parent_insights(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.get("/risk-score")
async def api_get_parent_risk_scores(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_view_user),
):
    return get_parent_risk_scores(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.get("/alerts")
async def api_get_parent_alerts(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_view_user),
):
    return get_parent_alerts(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.post("/alerts/{alert_id}/acknowledge")
async def api_acknowledge_parent_alert(
    alert_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_action_user),
):
    del user
    return acknowledge_parent_alert(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=None,
        alert_id=alert_id,
    )


@router.post("/communication/contact-teacher")
async def api_contact_teacher(
    payload: ParentCommunicationRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_action_user),
):
    del user
    return contact_teacher(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/communication/request-meeting")
async def api_request_parent_meeting(
    payload: ParentCommunicationRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_intelligence_action_user),
):
    del user
    return request_parent_meeting(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )
