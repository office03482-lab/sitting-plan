from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas import (
    BulkActionDecision,
    BulkActionRequestCreate,
    BulkActionRequestResponse,
)
from app.services.bulk_action_requests import (
    approve_bulk_action_request,
    can_request_bulk_action,
    create_bulk_action_request,
    execute_bulk_action_request,
    is_platform_admin_user,
    list_bulk_action_requests,
    reject_bulk_action_request,
)

router = APIRouter(prefix="/api/bulk-action-requests", tags=["Bulk Action Requests"])


def _require_profile_id(actor: dict) -> str:
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="Authenticated profile is required")
    return profile_id


@router.post("", response_model=BulkActionRequestResponse, status_code=status.HTTP_201_CREATED)
def create_bulk_action_request_endpoint(
    payload: BulkActionRequestCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if not can_request_bulk_action(user, payload.module_name):
        raise HTTPException(status_code=403, detail="You do not have permission to request this bulk action")
    return BulkActionRequestResponse(
        **create_bulk_action_request(
            school_id=school_id,
            module_name=payload.module_name,
            action_type=payload.action_type,
            requested_by_profile_id=_require_profile_id(actor),
            requested_role=str(actor.get("role") or getattr(user, "role_key", "") or "viewer"),
            reason=payload.reason,
            payload_json=payload.payload_json,
        )
    )


@router.get("", response_model=List[BulkActionRequestResponse])
def list_bulk_action_requests_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    module_name: Optional[str] = Query(default=None),
):
    school_id = tenant.school_id
    return [
        BulkActionRequestResponse(**row)
        for row in list_bulk_action_requests(
            school_id,
            status_filter=status_filter,
            module_name=module_name,
        )
    ]


@router.post("/{request_id}/approve", response_model=BulkActionRequestResponse)
def approve_bulk_action_request_endpoint(
    request_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    del school_id
    if not is_platform_admin_user(user):
        raise HTTPException(status_code=403, detail="Only Super Admin can approve bulk action requests")
    profile_id = _require_profile_id(actor)
    approve_bulk_action_request(
        request_id,
        approved_by_profile_id=profile_id,
        approved_role=str(actor.get("role") or getattr(user, "role_key", "") or "platform_admin"),
    )
    executed = execute_bulk_action_request(
        request_id,
        executed_by_profile_id=profile_id,
        executed_role=str(actor.get("role") or getattr(user, "role_key", "") or "platform_admin"),
    )
    return BulkActionRequestResponse(**executed)


@router.post("/{request_id}/reject", response_model=BulkActionRequestResponse)
def reject_bulk_action_request_endpoint(
    request_id: str,
    payload: BulkActionDecision,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    del school_id
    if not is_platform_admin_user(user):
        raise HTTPException(status_code=403, detail="Only Super Admin can reject bulk action requests")
    rejected = reject_bulk_action_request(
        request_id,
        rejected_by_profile_id=_require_profile_id(actor),
        rejected_role=str(actor.get("role") or getattr(user, "role_key", "") or "platform_admin"),
        reason=payload.reason,
    )
    return BulkActionRequestResponse(**rejected)
