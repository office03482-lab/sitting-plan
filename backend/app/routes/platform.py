from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_authenticated_user
from app.models import User
from app.schemas import (
    BulkActionRequestResponse,
    PlatformAuditLogResponse,
    PlatformAuditLogListResponse,
    PlatformDashboardSummaryResponse,
    PlatformWorkflowEventResponse,
    PlatformWorkflowRequestDetailResponse,
)
from app.services.bulk_action_requests import _serialize_bulk_action_request
from app.services.supabase_admin import get_supabase_admin_client
from app.database import get_db
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/platform", tags=["Platform Administration"])


def require_platform_admin(user: User = Depends(get_authenticated_user)) -> User:
    if str(getattr(user, "role_key", "") or "").strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Only Platform Admin can access this section")
    return user


def _load_profiles_map(profile_ids: set[str]) -> dict[str, dict[str, Any]]:
    ids = [item for item in profile_ids if item]
    if not ids:
        return {}
    response = (
        get_supabase_admin_client()
        .table("profiles")
        .select("id,full_name,display_name,email")
        .in_("id", ids)
        .execute()
    )
    rows = list(response.data or [])
    return {str(row.get("id")): dict(row) for row in rows}


def _load_schools_map(school_ids: set[str]) -> dict[str, dict[str, Any]]:
    ids = [item for item in school_ids if item]
    if not ids:
        return {}
    response = (
        get_supabase_admin_client()
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
    db: Session = Depends(get_db),
):
    supabase = get_supabase_admin_client()

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
    profiles_map = _load_profiles_map(profile_ids)

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

    active_users_count = db.query(User).filter(User.is_active.is_(True)).count()

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
    supabase = get_supabase_admin_client()
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
    profiles_map = _load_profiles_map({item for item in profile_ids if item})

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
    supabase = get_supabase_admin_client()
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
    profiles_map = _load_profiles_map(profile_ids)
    schools_map = _load_schools_map(school_ids)

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
