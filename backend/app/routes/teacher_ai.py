"""Teacher assistant routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import (
    TeacherAiAssignmentRequest,
    TeacherAiAssignmentResponse,
    TeacherAiLessonPlanRequest,
    TeacherAiLessonPlanResponse,
    TeacherAiQuestionPaperRequest,
    TeacherAiQuestionPaperResponse,
    TeacherAiReportCommentsRequest,
    TeacherAiReportCommentsResponse,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.supabase_teacher_ai import (
    generate_assignment,
    generate_lesson_plan,
    generate_question_paper,
    generate_report_comments,
    get_teacher_ai_overview,
)

router = APIRouter(prefix="/api/teacher-ai", tags=["Teacher AI"])
alias_router = APIRouter(prefix="/api/ai", tags=["Teacher AI"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def require_teacher_ai_user(
    _: User = Depends(require_permissions("teacher_ai.generate", "teacher_ai.evaluate", "teacher_ai.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the Teacher AI assistant")


@router.post("/question-paper", response_model=TeacherAiQuestionPaperResponse)
async def api_teacher_ai_question_paper(
    payload: TeacherAiQuestionPaperRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="teacher_ai.generate",
        school_id=tenant.school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_test_generation",
        credit_amount=5,
        reason="teacher_ai.question_paper",
    )
    result = generate_question_paper(
        tenant.school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/assignment", response_model=TeacherAiAssignmentResponse)
async def api_teacher_ai_assignment(
    payload: TeacherAiAssignmentRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="teacher_ai.generate",
        school_id=tenant.school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_test_generation",
        credit_amount=5,
        reason="teacher_ai.assignment",
    )
    result = generate_assignment(
        tenant.school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/lesson-plan", response_model=TeacherAiLessonPlanResponse)
async def api_teacher_ai_lesson_plan(
    payload: TeacherAiLessonPlanRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="teacher_ai.generate",
        school_id=tenant.school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_study_plan",
        credit_amount=3,
        reason="teacher_ai.lesson_plan",
    )
    result = generate_lesson_plan(
        tenant.school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/report-comments", response_model=TeacherAiReportCommentsResponse)
async def api_teacher_ai_report_comments(
    payload: TeacherAiReportCommentsRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    reservation = prepare_route_retrofit(
        flag_name="ai",
        user=user,
        actor=actor,
        permission_key="teacher_ai.reports",
        school_id=tenant.school_id,
        resource_key="ai_credits_used",
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="teacher_ai.report_comments",
    )
    result = generate_report_comments(
        tenant.school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )
    commit_route_retrofit(reservation)
    return result


@alias_router.get("/teacher-assistant", include_in_schema=False)
async def api_teacher_ai_overview(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    del user
    return get_teacher_ai_overview(
        tenant.school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
    )
