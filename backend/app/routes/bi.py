"""Enterprise BI routes backed by warehouse snapshots."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas import (
    AcademicBiResponse,
    BiReportExportResponse,
    FinanceBiResponse,
    OperationsBiResponse,
    PlatformBiResponse,
    SavedBiReportCreateRequest,
    SavedBiReportResponse,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_bi import (
    create_saved_report,
    export_dashboard_payload,
    get_academic_dashboard,
    get_finance_dashboard,
    get_operations_dashboard,
    get_platform_dashboard,
    list_saved_reports,
)
router = APIRouter(prefix="/api/bi", tags=["Business Intelligence"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def require_bi_school_user(
    _: User = Depends(require_permissions("bi.academic", "bi.finance", "bi.operations", "bi.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    legacy_role = str(getattr(getattr(user, "role", None), "value", getattr(user, "role", "")) or "").strip().lower()
    if is_platform_admin_user(user) or _role_key(user) in {"school_admin", "teacher"} or legacy_role == "admin":
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have BI dashboard access")


def require_bi_platform_user(
    _: User = Depends(require_permissions("bi.platform")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only platform administrators can view platform BI dashboards")


@router.get("/academic", response_model=AcademicBiResponse)
async def api_bi_academic(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    school_id = tenant.school_id
    del user
    return get_academic_dashboard(school_id, period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/attendance", response_model=AcademicBiResponse, include_in_schema=False)
async def api_bi_attendance(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    school_id = tenant.school_id
    del user
    return get_academic_dashboard(school_id, period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/performance", response_model=AcademicBiResponse, include_in_schema=False)
async def api_bi_performance(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    school_id = tenant.school_id
    del user
    return get_academic_dashboard(school_id, period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/finance", response_model=FinanceBiResponse)
async def api_bi_finance(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    school_id = tenant.school_id
    del user
    return get_finance_dashboard(school_id, period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/operations", response_model=OperationsBiResponse)
async def api_bi_operations(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    school_id = tenant.school_id
    del user
    return get_operations_dashboard(school_id, period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/platform", response_model=PlatformBiResponse)
async def api_bi_platform(
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_platform_user),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
):
    del user
    return get_platform_dashboard(period=period, actor_profile_id=actor.get("profile_id"))


@router.get("/reports", response_model=list[SavedBiReportResponse])
async def api_bi_reports(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
):
    school_id = tenant.school_id
    return list_saved_reports(
        school_id,
        actor_profile_id=actor.get("profile_id"),
        include_platform=is_platform_admin_user(user),
    )


@router.post("/reports", response_model=SavedBiReportResponse)
async def api_bi_reports_create(
    payload: SavedBiReportCreateRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
):
    school_id = tenant.school_id
    resolved_school_id = None if (payload.dashboard_key == "platform" and is_platform_admin_user(user)) else school_id
    return create_saved_report(
        resolved_school_id,
        actor_profile_id=actor.get("profile_id"),
        report_name=payload.report_name,
        dashboard_key=payload.dashboard_key,
        filters=payload.filters,
        selected_metrics=payload.selected_metrics,
        export_format=payload.export_format,
        cadence=payload.cadence,
    )


@router.get("/reports/export", response_model=BiReportExportResponse)
async def api_bi_reports_export(
    dashboard_key: str = Query(..., pattern="^(academic|finance|operations|platform)$"),
    period: str = Query(default="monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_bi_school_user),
):
    school_id = tenant.school_id
    if dashboard_key == "platform":
        if not is_platform_admin_user(user):
            raise HTTPException(status_code=403, detail="Only platform administrators can export platform BI dashboards")
        payload = get_platform_dashboard(period=period, actor_profile_id=actor.get("profile_id"))
        return export_dashboard_payload("platform", payload, school_id=None, actor_profile_id=actor.get("profile_id"))
    if dashboard_key == "academic":
        payload = get_academic_dashboard(school_id or "", period=period, actor_profile_id=actor.get("profile_id"))
    elif dashboard_key == "finance":
        payload = get_finance_dashboard(school_id or "", period=period, actor_profile_id=actor.get("profile_id"))
    else:
        payload = get_operations_dashboard(school_id or "", period=period, actor_profile_id=actor.get("profile_id"))
    return export_dashboard_payload(dashboard_key, payload, school_id=school_id, actor_profile_id=actor.get("profile_id"))
