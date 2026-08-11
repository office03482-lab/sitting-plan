"""Student practice AI routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas import AiTutorRequest, AiTutorResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.supabase_ai_tutor import tutor_practice

router = APIRouter(prefix="/api/ai", tags=["Student Practice AI"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def require_student_practice_user(
    _: User = Depends(require_permissions("ai_tutor.chat")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user):
        return user
    if is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can use the practice generator")


@router.post("/practice", response_model=AiTutorResponse)
async def api_ai_practice(
    payload: AiTutorRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_student_practice_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="ai_tutor.chat",
        school_id=tenant.school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
        reason="ai_tutor.practice",
    )
    result = tutor_practice(
        tenant.school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result
