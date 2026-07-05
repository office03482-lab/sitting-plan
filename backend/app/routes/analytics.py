"""Analytics routes for online-test insights."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import (
    BatchAnalyticsResponse,
    PlatformAnalyticsResponse,
    SchoolAnalyticsResponse,
    StudentAnalyticsResponse,
    TestAnalyticsResponse,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.supabase_analytics import (
    get_batch_analytics,
    get_platform_analytics,
    get_school_analytics,
    get_student_analytics,
    get_test_analytics,
)
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def require_student_analytics_user(
    _: User = Depends(require_permissions("online_tests.view", "online_tests.attempt", "online_tests.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to student analytics")


def require_teacher_analytics_user(
    _: User = Depends(require_permissions("online_tests.manage", "online_tests.grade", "online_tests.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can view this analytics dashboard")


def require_school_analytics_user(
    _: User = Depends(require_permissions("online_tests.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only school or platform administrators can view school analytics")


def require_platform_analytics_user(user: User = Depends(get_authenticated_user)) -> User:
    if is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only platform administrators can view platform analytics")


@router.get("/student/{student_id}", response_model=StudentAnalyticsResponse)
async def api_get_student_analytics(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_student_analytics_user),
):
    permission_key = "online_tests.attempt" if _is_student_user(user) else "online_tests.reports"
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key=permission_key,
        school_id=school_id,
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="analytics.student",
    )
    target_student_id = student_id
    if student_id == "me":
        if not _is_student_user(user):
            raise HTTPException(status_code=403, detail="Only students can use the me shortcut")
        from app.services.supabase_analytics import _get_student_by_profile_id

        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        target_student_id = str(_get_student_by_profile_id(school_id, profile_id).get("id") or "").strip()
    result = get_student_analytics(school_id, target_student_id, actor_profile_id=actor.get("profile_id"))
    try:
        from app.services.supabase_analytics import persist_student_analytics
        persist_student_analytics(school_id, target_student_id, actor_profile_id=actor.get("profile_id"))
    except Exception:
        pass
    commit_route_retrofit(reservation)
    return result


@router.get("/test/{test_id}", response_model=TestAnalyticsResponse)
async def api_get_test_analytics(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_analytics_user),
):
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key="online_tests.reports",
        school_id=school_id,
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="analytics.test",
    )
    result = get_test_analytics(school_id, test_id, actor_profile_id=actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result


@router.get("/batch/{batch_id}", response_model=BatchAnalyticsResponse)
async def api_get_batch_analytics(
    batch_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_teacher_analytics_user),
):
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key="online_tests.reports",
        school_id=school_id,
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="analytics.batch",
    )
    result = get_batch_analytics(school_id, batch_id, actor_profile_id=actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result


@router.get("/school/{target_school_id}", response_model=SchoolAnalyticsResponse)
async def api_get_school_analytics(
    target_school_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_school_analytics_user),
):
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key="online_tests.reports",
        school_id=school_id,
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="analytics.school",
    )
    resolved_school_id = target_school_id
    if target_school_id == "me":
        resolved_school_id = school_id
    if not is_platform_admin_user(user) and resolved_school_id != school_id:
        raise HTTPException(status_code=403, detail="Cross-school analytics are not allowed for this user")
    result = get_school_analytics(resolved_school_id, actor_profile_id=actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result


@router.get("/platform", response_model=PlatformAnalyticsResponse)
async def api_get_platform_analytics(
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_platform_analytics_user),
):
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key="online_tests.reports",
        school_id=str(actor.get("school_id") or "").strip(),
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="analytics.platform",
    )
    result = get_platform_analytics(actor_profile_id=actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result
