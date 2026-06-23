"""Study planner and academic copilot routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import LearningGoalCreate, LearningGoalResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_study_planner import (
    create_learning_goal,
    get_study_recommendations,
    get_today_planner,
    get_week_planner,
)

router = APIRouter(prefix="/api/study-planner", tags=["Study Planner"])
alias_router = APIRouter(prefix="/api/ai", tags=["Study Planner"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def _is_parent_user(user: User) -> bool:
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return _role_key(user) == "parent" or "edupay.parent_portal" in permissions


def require_study_planner_view_user(
    _: User = Depends(require_permissions("study_planner.view", "study_planner.goals", "study_planner.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the study planner")


def require_study_planner_goals_user(
    _: User = Depends(require_permissions("study_planner.goals", "study_planner.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to learning goals")


@router.get("/today")
@router.get("/dashboard", include_in_schema=False)
@alias_router.get("/dashboard", include_in_schema=False)
async def api_get_today_planner(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_study_planner_view_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="study_planner.view",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_study_plan",
        credit_amount=3,
        reason="study_planner.today",
    )
    result = get_today_planner(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )
    commit_route_retrofit(reservation)
    return result


@router.get("/week")
@alias_router.get("/study-plan", include_in_schema=False)
async def api_get_week_planner(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_study_planner_view_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="study_planner.view",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_study_plan",
        credit_amount=3,
        reason="study_planner.week",
    )
    result = get_week_planner(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )
    commit_route_retrofit(reservation)
    return result


@router.get("/recommendations")
@router.get("/tasks", include_in_schema=False)
async def api_get_study_recommendations(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_study_planner_view_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="study_planner.view",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_study_plan",
        credit_amount=3,
        reason="study_planner.recommendations",
    )
    result = get_study_recommendations(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/goals", response_model=LearningGoalResponse)
async def api_create_learning_goal(
    payload: LearningGoalCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_study_planner_goals_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="study_planner.goals",
        school_id=school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_study_plan",
        credit_amount=3,
        reason="study_planner.goals",
    )
    result = create_learning_goal(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
        user_email=getattr(user, "email", None),
    )
    commit_route_retrofit(reservation)
    return result
