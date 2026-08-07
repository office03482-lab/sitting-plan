"""Predictive intelligence routes powered by warehouse snapshots."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import FinancePredictionsResponse, CampusPredictionsResponse, StudentPredictionsResponse
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_predictions import (
    get_campus_predictions_dashboard,
    get_finance_predictions_dashboard,
    get_student_predictions_dashboard,
)

router = APIRouter(prefix="/api/predictions", tags=["Predictive Intelligence"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_parent_user(user: User) -> bool:
    if _role_key(user) == "parent":
        return True
    role_metadata = getattr(user, "role_metadata", None)
    if isinstance(role_metadata, dict) and str(role_metadata.get("role_key") or "").strip().lower() == "parent":
        return True
    permissions_raw = str(getattr(user, "permissions", "") or "").lower()
    return "edupay.parent_portal" in [p.strip() for p in permissions_raw.split(",")]


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user) or _role_key(user) == "school_admin"


def require_student_predictions_user(
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_parent_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to student predictive dashboards")


def require_campus_predictions_user(
    _: User = Depends(require_permissions("predictions.campus", "predictions.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can view campus predictive dashboards")


def require_finance_predictions_user(
    _: User = Depends(require_permissions("predictions.finance", "predictions.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only school or platform administrators can view finance predictive dashboards")


@router.get("/student", response_model=StudentPredictionsResponse)
async def api_get_student_predictions(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_student_predictions_user),
    student_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    school_id = tenant.school_id
    return get_student_predictions_dashboard(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        requested_student_id=student_id,
        limit=limit,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.get("/campus", response_model=CampusPredictionsResponse)
async def api_get_campus_predictions(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_campus_predictions_user),
):
    school_id = tenant.school_id
    del user
    return get_campus_predictions_dashboard(
        school_id,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.get("/finance", response_model=FinancePredictionsResponse)
async def api_get_finance_predictions(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_finance_predictions_user),
):
    school_id = tenant.school_id
    del user
    return get_finance_predictions_dashboard(
        school_id,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )
