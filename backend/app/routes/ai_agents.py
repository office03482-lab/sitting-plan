"""AI Academic Operating System routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import (
    AiAgentApproveRequest,
    AiAgentDashboardResponse,
    AiAgentRecommendationResponse,
    AiAgentRunRequest,
    AiAgentRunResponse,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_ai_agents import (
    approve_ai_agent_recommendation,
    get_ai_agents_dashboard,
    list_ai_agent_recommendations,
    run_ai_agent_jobs,
)
router = APIRouter(prefix="/api/ai-agents", tags=["AI Academic Operating System"])
alias_router = APIRouter(prefix="/api/ai", tags=["AI Academic Operating System"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user) or _role_key(user) == "school_admin"


def require_ai_agents_view_user(
    _: User = Depends(require_permissions("ai_agents.view", "ai_agents.run", "ai_agents.approve", "ai_agents.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the AI command center")


def require_ai_agents_run_user(
    _: User = Depends(require_permissions("ai_agents.run")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to run AI agents")


def require_ai_agents_approve_user(
    _: User = Depends(require_permissions("ai_agents.approve")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to approve AI recommendations")


@router.get("/dashboard", response_model=AiAgentDashboardResponse)
@alias_router.get("/dashboard", response_model=AiAgentDashboardResponse, include_in_schema=False)
def api_get_ai_agents_dashboard(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_agents_view_user),
):
    school_id = tenant.school_id
    del user
    return get_ai_agents_dashboard(
        school_id,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.post("/run", response_model=AiAgentRunResponse)
def api_run_ai_agents(
    payload: AiAgentRunRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_agents_run_user),
):
    school_id = tenant.school_id
    del user
    return run_ai_agent_jobs(
        school_id,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        requested_agent_key=payload.agent_key,
    )


@router.get("/recommendations", response_model=list[AiAgentRecommendationResponse])
@alias_router.get("/recommendations", response_model=list[AiAgentRecommendationResponse], include_in_schema=False)
def api_list_ai_agent_recommendations(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_agents_view_user),
):
    school_id = tenant.school_id
    del actor, user
    return list_ai_agent_recommendations(school_id)


@router.post("/approve", response_model=AiAgentRecommendationResponse)
def api_approve_ai_agent_recommendation(
    payload: AiAgentApproveRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_agents_approve_user),
):
    school_id = tenant.school_id
    return approve_ai_agent_recommendation(
        school_id,
        recommendation_id=payload.recommendation_id,
        decision=payload.decision,
        approver_profile_id=str(actor.get("profile_id") or "").strip() or None,
        approver_role_key=_role_key(user),
        notes=payload.notes,
    )
