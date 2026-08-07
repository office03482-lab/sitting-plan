from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas.ai_credit_api import (
    AICreditAdjustmentRequest,
    AICreditCostResponse,
    AICreditGrantRequest,
    AICreditLedgerListResponse,
    AICreditWalletResponse,
)
from app.services.ai_credit_engine import ai_credit_service

router = APIRouter(prefix="/api/credits", tags=["AI Credits"])


def require_platform_admin(user: User = Depends(get_authenticated_user)) -> User:
    if str(getattr(user, "role_key", "") or "").strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Only Platform Admin can access this section")
    return user


@router.get("/wallet", response_model=AICreditWalletResponse)
def get_credit_wallet_summary(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    return {"data": ai_credit_service.get_balance(profile_id, school_id)}


@router.get("/ledger", response_model=AICreditLedgerListResponse)
def get_credit_ledger(
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    return {"data": ai_credit_service.get_ledger(profile_id, school_id, limit=limit, offset=offset)}


@router.get("/costs", response_model=AICreditCostResponse)
def get_credit_costs(
    _: User = Depends(get_authenticated_user),
):
    return {"costs": ai_credit_service.get_costs()}


@router.post("/admin/adjust", response_model=AICreditWalletResponse)
def adjust_credit_balance(
    payload: AICreditAdjustmentRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_platform_admin),
):
    result = ai_credit_service.adjust_balance(
        profile_id=payload.profile_id,
        school_id=payload.school_id,
        amount=payload.amount,
        wallet_type=payload.wallet_type.value,
        reason=payload.reason,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        idempotency_key=idempotency_key,
    )
    return {"data": result}


@router.post("/admin/grant", response_model=AICreditWalletResponse)
def grant_credit_balance(
    payload: AICreditGrantRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_platform_admin),
):
    result = ai_credit_service.grant_bonus(
        profile_id=payload.profile_id,
        school_id=payload.school_id,
        amount=payload.amount,
        reason=payload.reason,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
        idempotency_key=idempotency_key,
    )
    return {"data": result}
