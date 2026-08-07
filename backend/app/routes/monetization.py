"""Monetization routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas import (
    CouponApplyRequest,
    CouponApplyResponse,
    PaymentCreateOrderRequest,
    PaymentCreateOrderResponse,
    PaymentVerifyRequest,
    PaymentVerifyResponse,
    RevenueDashboardResponse,
    SubscriptionListResponse,
)
from app.services.supabase_monetization import (
    apply_coupon,
    create_order,
    create_seed_catalog_for_school,
    list_subscriptions,
    revenue_dashboard,
    verify_order,
)

router = APIRouter(tags=["Monetization"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_parent_user(user: User) -> bool:
    if _role_key(user) == "parent":
        return True
    role_metadata = getattr(user, "role_metadata", None)
    if isinstance(role_metadata, dict) and str(role_metadata.get("role_key") or "").strip().lower() == "parent":
        return True
    permissions_raw = str(getattr(user, "permissions", "") or "").lower()
    return "edupay.parent_portal" in [p.strip() for p in permissions_raw.split(",")]


@router.post("/api/payments/create-order", response_model=PaymentCreateOrderResponse)
async def api_create_order(
    payload: PaymentCreateOrderRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.commerce", "edupay.payments")),
):
    school_id = tenant.school_id
    create_seed_catalog_for_school(school_id, str(actor.get("profile_id") or "").strip() or None)
    return create_order(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        provider_key=payload.provider_key,
        items=[item.model_dump(exclude_none=True) for item in payload.items],
        coupon_code=payload.coupon_code,
        referral_code=payload.referral_code,
        affiliate_code=payload.affiliate_code,
        credits_to_redeem=payload.credits_to_redeem,
        metadata=payload.metadata,
    )


@router.post("/api/payments/verify", response_model=PaymentVerifyResponse)
async def api_verify_order(
    payload: PaymentVerifyRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.commerce", "edupay.payments")),
):
    school_id = tenant.school_id
    return verify_order(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        provider_key=payload.provider_key,
        order_id=payload.order_id,
        provider_order_id=payload.provider_order_id,
        provider_payment_id=payload.provider_payment_id,
        signature=payload.signature,
        metadata=payload.metadata,
    )


@router.get("/api/subscriptions", response_model=SubscriptionListResponse)
async def api_subscriptions(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.subscriptions", "edupay.revenue")),
    school_scope: bool = Query(default=False),
):
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip() or None
    role_key = str(actor.get("role_key") or actor.get("role") or "").strip().lower()
    return {
        "subscriptions": list_subscriptions(
            school_id,
            profile_id=profile_id,
            include_school_scope=school_scope or role_key in {"platform_admin", "school_admin", "admin"},
        ),
        "generated_at": _utc_now_iso_helper(),
    }


def _utc_now_iso_helper() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.post("/api/coupons/apply", response_model=CouponApplyResponse)
async def api_apply_coupon(
    payload: CouponApplyRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if not _is_parent_user(user):
        from app.middleware.auth import decode_user_permissions, user_has_permission
        granted = decode_user_permissions(user)
        required = ["edupay.commerce", "edupay.subscriptions"]
        if not any(user_has_permission(user, p) for p in required):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to apply coupons")
    return apply_coupon(school_id, code=payload.code, order_amount=payload.order_amount)


@router.get("/api/revenue/dashboard", response_model=RevenueDashboardResponse)
async def api_revenue_dashboard(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.revenue")),
    global_view: bool = Query(default=False),
):
    school_id: Optional[str] = tenant.school_id
    role_key = str(actor.get("role_key") or actor.get("role") or "").strip().lower()
    if global_view and role_key != "platform_admin":
        global_view = False
    return revenue_dashboard(None if global_view else school_id)
