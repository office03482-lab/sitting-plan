"""Consolidated assistant routes for school leadership."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import SchoolAiAssistantQueryRequest, SchoolAiAssistantResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_ai_assistants import answer_school_ai_question
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/ai-assistants", tags=["AI Assistants"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user) or _role_key(user) == "school_admin"


def require_school_ai_user(
    _: User = Depends(require_permissions("ai_agents.view", "ai_agents.run", "predictions.manage", "predictions.campus", "bi.academic")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the School AI assistant")


@router.post("/school/query", response_model=SchoolAiAssistantResponse)
async def api_school_ai_query(
    payload: SchoolAiAssistantQueryRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_school_ai_user),
):
    del user
    return answer_school_ai_question(
        school_id,
        payload.question,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )
