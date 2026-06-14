"""Teacher assistant routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
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
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_teacher_ai import (
    generate_assignment,
    generate_lesson_plan,
    generate_question_paper,
    generate_report_comments,
)

router = APIRouter(prefix="/api/teacher-ai", tags=["Teacher AI"])


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
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    return generate_question_paper(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/assignment", response_model=TeacherAiAssignmentResponse)
async def api_teacher_ai_assignment(
    payload: TeacherAiAssignmentRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    return generate_assignment(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/lesson-plan", response_model=TeacherAiLessonPlanResponse)
async def api_teacher_ai_lesson_plan(
    payload: TeacherAiLessonPlanRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    return generate_lesson_plan(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/report-comments", response_model=TeacherAiReportCommentsResponse)
async def api_teacher_ai_report_comments(
    payload: TeacherAiReportCommentsRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_ai_user),
):
    return generate_report_comments(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        payload=payload.model_dump(exclude_none=True),
    )
