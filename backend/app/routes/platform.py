from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.models import User
from app.schemas import (
    BulkActionRequestResponse,
    PlatformAuditLogResponse,
    PlatformAuditLogListResponse,
    PlatformDashboardSummaryResponse,
    PlatformWorkflowEventResponse,
    PlatformWorkflowRequestDetailResponse,
)
from app.schemas.platform_control_plane import (
    PlatformAnalyticsOverviewResponse,
    PlatformAuditCenterResponse,
    PlatformCloneSchoolRequest,
    PlatformGlobalSearchResponse,
    PlatformHealthDashboardResponse,
    PlatformNotificationCreateRequest,
    PlatformNotificationListResponse,
    PlatformNotificationResponse,
    PlatformOnboardingRequest,
    PlatformOnboardingResponse,
    PlatformSchoolCreateRequest,
    PlatformSchoolLifecycleRequest,
    PlatformSchoolListResponse,
    PlatformSchoolSummaryResponse,
    PlatformSchoolUpdateRequest,
    PlatformSubscriptionSummaryResponse,
    PlatformSupportActionRequest,
    PlatformSupportActionResponse,
    PlatformUsageDashboardResponse,
)
from app.schemas.subscription_api import (
    PlatformSubscriptionActivateRequest,
    PlatformSubscriptionCancelRequest,
    PlatformSubscriptionChangeRequest,
    PlatformSubscriptionPauseRequest,
)
from app.services.bulk_action_requests import _serialize_bulk_action_request
from app.services import platform_control_plane
from app.services.supabase_admin import create_supabase_admin_client
from app.services.subscription_engine import (
    PlanChangeRequestService,
    PlanCronService,
    SchoolSubscriptionService,
)
router = APIRouter(prefix="/api/platform", tags=["Platform Administration"])


def require_platform_admin(user: User = Depends(get_authenticated_user)) -> User:
    if str(getattr(user, "role_key", "") or "").strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Only Platform Admin can access this section")
    return user


school_subscription_service = SchoolSubscriptionService()
plan_change_request_service = PlanChangeRequestService()
plan_cron_service = PlanCronService(
    school_subscription_service=school_subscription_service,
    plan_change_request_service=plan_change_request_service,
    school_plan_repository=school_subscription_service.repository,
    plan_change_repository=plan_change_request_service.repository,
)


def _load_profiles_map(profile_ids: set[str], supabase=None) -> dict[str, dict[str, Any]]:
    ids = [item for item in profile_ids if item]
    if not ids:
        return {}
    supabase = supabase or create_supabase_admin_client()
    response = (
        supabase
        .table("profiles")
        .select("id,full_name,display_name,email")
        .in_("id", ids)
        .execute()
    )
    rows = list(response.data or [])
    return {str(row.get("id")): dict(row) for row in rows}


def _load_schools_map(school_ids: set[str], supabase=None) -> dict[str, dict[str, Any]]:
    ids = [item for item in school_ids if item]
    if not ids:
        return {}
    supabase = supabase or create_supabase_admin_client()
    response = (
        supabase
        .table("schools")
        .select("id,name")
        .in_("id", ids)
        .execute()
    )
    rows = list(response.data or [])
    return {str(row.get("id")): dict(row) for row in rows}


def _profile_name(profile: dict[str, Any] | None) -> str | None:
    if not profile:
        return None
    return str(profile.get("display_name") or profile.get("full_name") or profile.get("email") or "").strip() or None


def _serialize_event(row: dict[str, Any], profiles_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    actor_profile_id = str(row.get("actor_profile_id") or "").strip() or None
    return {
        "id": row.get("id"),
        "request_id": row.get("request_id"),
        "school_id": row.get("school_id"),
        "event_type": row.get("event_type") or "",
        "actor_profile_id": actor_profile_id,
        "actor_role": row.get("actor_role"),
        "actor_name": _profile_name(profiles_map.get(actor_profile_id or "")),
        "notes": row.get("notes"),
        "payload": dict(row.get("payload") or {}) if isinstance(row.get("payload"), dict) else {},
        "created_at": row.get("created_at"),
    }


@router.get("/dashboard-summary", response_model=PlatformDashboardSummaryResponse)
def get_platform_dashboard_summary(
    _: User = Depends(require_platform_admin),
):
    supabase = create_supabase_admin_client()

    request_rows = list(
        (
            supabase.schema("workflow")
            .table("bulk_action_requests")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        ).data
        or []
    )
    event_rows = list(
        (
            supabase.schema("workflow")
            .table("bulk_action_events")
            .select("*")
            .order("created_at", desc=True)
            .limit(12)
            .execute()
        ).data
        or []
    )
    school_rows = list((supabase.table("schools").select("id,name").execute()).data or [])

    profile_ids: set[str] = set()
    for row in request_rows:
        for key in (
            "requested_by_profile_id",
            "approved_by_profile_id",
            "rejected_by_profile_id",
            "executed_by_profile_id",
        ):
            value = str(row.get(key) or "").strip()
            if value:
                profile_ids.add(value)
    for row in event_rows:
        value = str(row.get("actor_profile_id") or "").strip()
        if value:
            profile_ids.add(value)
    profiles_map = _load_profiles_map(profile_ids, supabase)

    workflow_counts = {
        "pending": 0,
        "approved": 0,
        "rejected": 0,
        "executed": 0,
        "cancelled": 0,
    }
    for row in request_rows:
        status = str(row.get("status") or "").strip().lower()
        if status in workflow_counts:
            workflow_counts[status] += 1

    recent_workflow_activity = [
        PlatformWorkflowEventResponse(**_serialize_event(dict(row), profiles_map))
        for row in event_rows
    ]

    active_memberships_count = (
        supabase.table("school_memberships")
        .select("profile_id", count="exact")
        .eq("is_active", True)
        .eq("status", "active")
        .execute()
    )
    active_profiles_count = (
        supabase.table("profiles")
        .select("id", count="exact")
        .eq("is_active", True)
        .execute()
    )
    active_users_count = max(
        int(active_memberships_count.count or 0),
        int(active_profiles_count.count or 0),
    )

    return PlatformDashboardSummaryResponse(
        workflow_counts=workflow_counts,
        schools_count=len(school_rows),
        active_users_count=active_users_count,
        recent_workflow_activity=recent_workflow_activity,
    )


@router.get("/workflow/{request_id}", response_model=PlatformWorkflowRequestDetailResponse)
def get_platform_workflow_request_detail(
    request_id: str,
    _: User = Depends(require_platform_admin),
):
    supabase = create_supabase_admin_client()
    request_rows = list(
        (
            supabase.schema("workflow")
            .table("bulk_action_requests")
            .select("*")
            .eq("id", request_id)
            .limit(1)
            .execute()
        ).data
        or []
    )
    if not request_rows:
        raise HTTPException(status_code=404, detail="Bulk action request not found")

    event_rows = list(
        (
            supabase.schema("workflow")
            .table("bulk_action_events")
            .select("*")
            .eq("request_id", request_id)
            .order("created_at", desc=False)
            .execute()
        ).data
        or []
    )

    request_row = dict(request_rows[0])
    profile_ids = {
        str(request_row.get("requested_by_profile_id") or "").strip(),
        str(request_row.get("approved_by_profile_id") or "").strip(),
        str(request_row.get("rejected_by_profile_id") or "").strip(),
        str(request_row.get("executed_by_profile_id") or "").strip(),
    }
    for row in event_rows:
        value = str(row.get("actor_profile_id") or "").strip()
        if value:
            profile_ids.add(value)
    profiles_map = _load_profiles_map({item for item in profile_ids if item}, supabase)

    serialized_request = _serialize_bulk_action_request(request_row)
    return PlatformWorkflowRequestDetailResponse(
        request=BulkActionRequestResponse(**serialized_request),
        requested_by_name=_profile_name(profiles_map.get(str(request_row.get("requested_by_profile_id") or ""))),
        approved_by_name=_profile_name(profiles_map.get(str(request_row.get("approved_by_profile_id") or ""))),
        rejected_by_name=_profile_name(profiles_map.get(str(request_row.get("rejected_by_profile_id") or ""))),
        executed_by_name=_profile_name(profiles_map.get(str(request_row.get("executed_by_profile_id") or ""))),
        events=[PlatformWorkflowEventResponse(**_serialize_event(dict(row), profiles_map)) for row in event_rows],
    )


def _normalize_audit_search_term(value: str | None) -> str:
    normalized = str(value or "").strip()
    for token in (",", "(", ")"):
        normalized = normalized.replace(token, " ")
    return " ".join(normalized.split())


def _build_audit_search_haystack(row: dict[str, Any]) -> str:
    payload = row.get("payload")
    payload_text = json.dumps(payload, sort_keys=True, ensure_ascii=True) if isinstance(payload, (dict, list)) else str(payload or "")
    values = [
        row.get("action"),
        row.get("module_key"),
        row.get("entity_table"),
        row.get("entity_id"),
        row.get("profile_id"),
        payload_text,
        row.get("user_agent"),
        row.get("ip_address"),
    ]
    return " ".join(str(value or "") for value in values).casefold()


@router.get("/audit-logs", response_model=PlatformAuditLogListResponse)
def list_platform_audit_logs(
    q: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    module_key: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_platform_admin),
):
    supabase = create_supabase_admin_client()
    query = supabase.table("audit_logs").select("*").order("created_at", desc=True)
    if action:
        query = query.eq("action", action)
    if module_key:
        query = query.eq("module_key", module_key)

    normalized_query = _normalize_audit_search_term(q)
    if normalized_query:
        search_tokens = normalized_query.casefold().split()
        response = query.execute()
        matching_rows = []
        for raw_row in list(response.data or []):
            row = dict(raw_row)
            haystack = _build_audit_search_haystack(row)
            if all(token in haystack for token in search_tokens):
                matching_rows.append(row)
        total_count = len(matching_rows)
        rows = matching_rows[offset:offset + limit]
    else:
        upper_bound = offset + limit - 1
        response = query.range(offset, upper_bound).execute()
        rows = [dict(row) for row in list(response.data or [])]
        count_response = supabase.table("audit_logs").select("id", count="exact", head=True)
        if action:
            count_response = count_response.eq("action", action)
        if module_key:
            count_response = count_response.eq("module_key", module_key)
        total_count = int(count_response.execute().count or 0)

    profile_ids = {str(row.get("profile_id") or "").strip() for row in rows if row.get("profile_id")}
    school_ids = {str(row.get("school_id") or "").strip() for row in rows if row.get("school_id")}
    profiles_map = _load_profiles_map(profile_ids, supabase)
    schools_map = _load_schools_map(school_ids, supabase)

    result: list[PlatformAuditLogResponse] = []
    for row in rows:
        profile_id = str(row.get("profile_id") or "").strip() or None
        school_id = str(row.get("school_id") or "").strip() or None
        result.append(
            PlatformAuditLogResponse(
                id=str(row.get("id") or ""),
                school_id=school_id,
                school_name=(schools_map.get(school_id or "") or {}).get("name"),
                profile_id=profile_id,
                profile_name=_profile_name(profiles_map.get(profile_id or "")),
                action=str(row.get("action") or ""),
                module_key=row.get("module_key"),
                entity_table=row.get("entity_table"),
                entity_id=str(row.get("entity_id") or "").strip() or None,
                payload=dict(row.get("payload") or {}) if isinstance(row.get("payload"), dict) else {},
                ip_address=str(row.get("ip_address") or "").strip() or None,
                user_agent=row.get("user_agent"),
                created_at=row.get("created_at"),
            )
        )
    return PlatformAuditLogListResponse(
        items=result,
        total_count=total_count,
        limit=limit,
        offset=offset,
    )


@router.get("/plans")
def list_platform_plan_catalog(
    _: User = Depends(require_platform_admin),
):
    plans = school_subscription_service.list_plan_catalog()
    return {"plans": plans, "count": len(plans)}


@router.get("/schools/{school_id}/subscription")
def get_platform_school_subscription(
    school_id: str,
    _: User = Depends(require_platform_admin),
):
    return school_subscription_service.get_school_plan(school_id)


@router.post("/schools/{school_id}/subscription/activate")
def activate_platform_school_subscription(
    school_id: str,
    payload: PlatformSubscriptionActivateRequest,
    user: User = Depends(require_platform_admin),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
):
    return school_subscription_service.activate_plan(
        school_id,
        payload.plan_tier.value,
        payload.billing_cycle,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.post("/schools/{school_id}/subscription/change")
def change_platform_school_subscription(
    school_id: str,
    payload: PlatformSubscriptionChangeRequest,
    user: User = Depends(require_platform_admin),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
):
    return school_subscription_service.change_plan(
        school_id,
        payload.new_plan_tier.value,
        payload.effective_date,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        billing_cycle=payload.billing_cycle,
        reason=payload.reason,
    )


@router.post("/schools/{school_id}/subscription/cancel")
def cancel_platform_school_subscription(
    school_id: str,
    payload: PlatformSubscriptionCancelRequest,
    user: User = Depends(require_platform_admin),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
):
    return school_subscription_service.cancel_plan(
        school_id,
        payload.mode,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.post("/schools/{school_id}/subscription/pause")
def pause_platform_school_subscription(
    school_id: str,
    payload: PlatformSubscriptionPauseRequest,
    user: User = Depends(require_platform_admin),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
):
    return school_subscription_service.pause_plan(
        school_id,
        payload.pause_until,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.post("/schools/{school_id}/subscription/resume")
def resume_platform_school_subscription(
    school_id: str,
    user: User = Depends(require_platform_admin),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
):
    return school_subscription_service.resume_plan(
        school_id,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.get("/schools", response_model=PlatformSchoolListResponse)
def list_platform_schools(
    status: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.list_schools(status=status, q=q)


@router.post("/schools", response_model=PlatformSchoolSummaryResponse)
def create_platform_school(
    payload: PlatformSchoolCreateRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.create_school(payload.model_dump(), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.get("/schools/{school_id}", response_model=PlatformSchoolSummaryResponse)
def get_platform_school_detail(
    school_id: str,
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.get_school_detail(school_id)


@router.put("/schools/{school_id}", response_model=PlatformSchoolSummaryResponse)
def update_platform_school(
    school_id: str,
    payload: PlatformSchoolUpdateRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.update_school(school_id, payload.model_dump(exclude_none=True), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/schools/{school_id}/status", response_model=PlatformSchoolSummaryResponse)
def update_platform_school_status(
    school_id: str,
    payload: PlatformSchoolLifecycleRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.set_school_status(
        school_id,
        payload.status,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        reason=payload.reason,
    )


@router.post("/schools/clone-settings", response_model=PlatformSchoolSummaryResponse)
def clone_platform_school_settings(
    payload: PlatformCloneSchoolRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.clone_school_settings(payload.source_school_id, payload.target_school_id, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/schools/copy-academic-structure")
def copy_platform_school_academic_structure(
    payload: PlatformCloneSchoolRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.copy_academic_structure(payload.source_school_id, payload.target_school_id, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.get("/schools/{school_id}/subscription-summary", response_model=PlatformSubscriptionSummaryResponse)
def get_platform_subscription_summary(
    school_id: str,
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.get_subscription_summary(school_id)


@router.get("/usage", response_model=PlatformUsageDashboardResponse)
def get_platform_usage_dashboard(
    school_id: Optional[str] = Query(default=None),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.get_usage_dashboard(school_id=school_id)


@router.get("/health", response_model=PlatformHealthDashboardResponse)
def get_platform_health_dashboard(
    school_id: Optional[str] = Query(default=None),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.get_health_dashboard(school_id=school_id)


@router.get("/search", response_model=PlatformGlobalSearchResponse)
def search_platform_entities(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=25, ge=1, le=100),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.global_search(q, limit=limit)


@router.get("/analytics-overview", response_model=PlatformAnalyticsOverviewResponse)
def get_platform_analytics_overview(
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.get_platform_analytics_overview()


@router.post("/support/{school_id}", response_model=PlatformSupportActionResponse)
def run_platform_support_action(
    school_id: str,
    payload: PlatformSupportActionRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.run_support_action(
        school_id,
        payload.action,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        notes=payload.notes,
    )


@router.get("/audit-center", response_model=PlatformAuditCenterResponse)
def get_platform_audit_center(
    school_id: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    module_key: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=250),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.list_audit_center(
        school_id=school_id,
        user_id=user_id,
        action=action,
        module_key=module_key,
        severity=severity,
        limit=limit,
    )


@router.get("/notifications", response_model=PlatformNotificationListResponse)
def list_platform_notifications(
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.list_notifications()


@router.post("/notifications", response_model=PlatformNotificationResponse)
def create_platform_notification(
    payload: PlatformNotificationCreateRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.create_notification(payload.model_dump(), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/onboarding", response_model=PlatformOnboardingResponse)
def run_platform_onboarding(
    payload: PlatformOnboardingRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_platform_admin),
):
    return platform_control_plane.run_onboarding(payload.model_dump(), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)
