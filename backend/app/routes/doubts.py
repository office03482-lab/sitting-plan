"""Academic doubt solver routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import DoubtHistoryResponse, DoubtInputBase, DoubtSolverResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_doubt_solver import get_doubt_solver_overview, list_doubt_history, solve_image_doubt, solve_pdf_doubt, solve_text_doubt

router = APIRouter(prefix="/api/doubts", tags=["AI Doubt Solver"])
alias_router = APIRouter(prefix="/api/ai", tags=["AI Doubt Solver"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_student_user(user: User) -> bool:
    user_type = str(getattr(user, "user_type", "") or "").strip().lower()
    role_key = _role_key(user)
    return user_type == "student" or role_key == "student" or role_key.startswith("managed_")


def require_doubt_solver_user(
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=403, detail="Only students can use the doubt solver")


@router.post("/text", response_model=DoubtSolverResponse)
async def api_doubt_text(
    payload: DoubtInputBase,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_doubt_solver_user),
):
    school_id = tenant.school_id
    return solve_text_doubt(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/image", response_model=DoubtSolverResponse)
async def api_doubt_image(
    payload: DoubtInputBase,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_doubt_solver_user),
):
    school_id = tenant.school_id
    return solve_image_doubt(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/pdf", response_model=DoubtSolverResponse)
async def api_doubt_pdf(
    payload: DoubtInputBase,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_doubt_solver_user),
):
    school_id = tenant.school_id
    return solve_pdf_doubt(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/history", response_model=list[DoubtHistoryResponse])
async def api_doubt_history(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_doubt_solver_user),
    target_student_id: Optional[str] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
):
    school_id = tenant.school_id
    return list_doubt_history(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        target_student_id=target_student_id,
        limit=limit,
    )


@alias_router.get("/doubt-solver", include_in_schema=False)
async def api_doubt_solver_overview(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_doubt_solver_user),
    target_student_id: Optional[str] = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
):
    school_id = tenant.school_id
    return get_doubt_solver_overview(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        target_student_id=target_student_id,
        limit=limit,
    )
