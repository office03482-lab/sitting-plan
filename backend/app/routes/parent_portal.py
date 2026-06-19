"""Parent Portal routes — simplified parent-friendly endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.parent_portal_service import (
    ai_ask,
    generate_recommendations,
    get_academic_progress,
    get_alerts,
    get_assignments,
    get_attendance_center,
    get_children,
    get_dashboard,
    get_test_results,
)
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_parent_intelligence import (
    acknowledge_parent_alert,
    contact_teacher,
    get_parent_alerts,
    request_parent_meeting,
)

router = APIRouter(prefix="/api/parent", tags=["Parent Portal"])


class AiAskRequest(BaseModel):
    question: str
    student_id: str | None = None
    history: list[dict[str, str]] | None = None


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


def require_parent_view_user(
    _: User = Depends(require_permissions("parent_intelligence.view", "parent_intelligence.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the parent portal")


# ─── Multi-Child Support (Phase 7) ─────────────────────────────────────

@router.get("/children")
async def api_list_children(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_children(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


# ─── Dashboard (Phase 1) ───────────────────────────────────────────────

@router.get("/dashboard")
async def api_get_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_dashboard(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


# ─── Academic Progress (Phase 2) ───────────────────────────────────────

@router.get("/academic-progress")
async def api_get_academic_progress(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_academic_progress(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── Attendance Center (Phase 3) ───────────────────────────────────────

@router.get("/attendance")
async def api_get_attendance(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_attendance_center(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── Online Test Results (Phase 4) ─────────────────────────────────────

@router.get("/test-results")
async def api_get_test_results(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_test_results(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── Assignments (Phase 5) ─────────────────────────────────────────────

@router.get("/assignments")
async def api_get_assignments(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_assignments(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── Alerts (Phase 6) ──────────────────────────────────────────────────

@router.get("/alerts")
async def api_get_alerts(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return get_alerts(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── AI Assistant (Phase 8) ────────────────────────────────────────────

@router.post("/ai/ask")
async def api_ai_ask(
    payload: AiAskRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return ai_ask(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=payload.student_id,
        question=payload.question,
        history=payload.history,
    )


@router.get("/ai/recommendations")
async def api_get_recommendations(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    return generate_recommendations(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        student_id=student_id,
    )


# ─── Legacy Intelligence Endpoints (keep for backward compat) ──────────

@router.get("/insights")
async def api_get_parent_insights(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    from app.services.supabase_parent_intelligence import get_parent_insights as _old_insights
    return _old_insights(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.get("/risk-score")
async def api_get_parent_risk_scores(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
):
    from app.services.supabase_parent_intelligence import get_parent_risk_scores as _old_risk
    return _old_risk(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.post("/alerts/{alert_id}/acknowledge")
async def api_acknowledge_parent_alert(
    alert_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
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
    user: User = Depends(require_parent_view_user),
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
    user: User = Depends(require_parent_view_user),
):
    del user
    return request_parent_meeting(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )
