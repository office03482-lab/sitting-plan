"""Grounded AI tutor routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import AiTutorConversationSummaryResponse, AiTutorRequest, AiTutorResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.supabase_ai_tutor import list_ai_conversations, tutor_chat, tutor_explain, tutor_practice, tutor_revision
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/ai", tags=["AI Tutor"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def require_ai_tutor_chat_user(
    _: User = Depends(require_permissions("ai_tutor.chat", "ai_tutor.review", "ai_tutor.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the AI tutor")


@router.post("/chat", response_model=AiTutorResponse)
async def api_ai_chat(
    payload: AiTutorRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_tutor_chat_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="ai_tutor.chat",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
        reason="ai_tutor.chat",
    )
    result = tutor_chat(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.get("/conversations", response_model=list[AiTutorConversationSummaryResponse])
async def api_ai_conversations(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_tutor_chat_user),
    target_student_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    return list_ai_conversations(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        target_student_id=target_student_id,
        limit=limit,
    )


@router.post("/explain", response_model=AiTutorResponse)
async def api_ai_explain(
    payload: AiTutorRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_tutor_chat_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="ai_tutor.chat",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
        reason="ai_tutor.explain",
    )
    result = tutor_explain(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/practice", response_model=AiTutorResponse)
async def api_ai_practice(
    payload: AiTutorRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_tutor_chat_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="ai_tutor.chat",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
        reason="ai_tutor.practice",
    )
    result = tutor_practice(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/revision", response_model=AiTutorResponse)
async def api_ai_revision(
    payload: AiTutorRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_ai_tutor_chat_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="ai_tutor.chat",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
        reason="ai_tutor.revision",
    )
    result = tutor_revision(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result
