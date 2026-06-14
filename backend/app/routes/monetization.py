"""Monetization routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.middleware.auth import get_authenticated_actor_context, require_permissions
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
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_monetization import (
    apply_coupon,
    create_order,
    create_seed_catalog_for_school,
    list_subscriptions,
    revenue_dashboard,
    verify_order,
)

router = APIRouter(tags=["Monetization"])


@router.post("/api/payments/create-order", response_model=PaymentCreateOrderResponse)
async def api_create_order(
    payload: PaymentCreateOrderRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.commerce", "edupay.payments")),
):
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
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.commerce", "edupay.payments")),
):
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
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.subscriptions", "edupay.revenue")),
    school_scope: bool = Query(default=False),
):
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
    school_id: str = Depends(resolve_school_id_from_actor),
    _: dict = Depends(require_permissions("edupay.commerce", "edupay.subscriptions", "edupay.parent_portal")),
):
    return apply_coupon(school_id, code=payload.code, order_amount=payload.order_amount)


@router.get("/api/revenue/dashboard", response_model=RevenueDashboardResponse)
async def api_revenue_dashboard(
    school_id: Optional[str] = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    _: dict = Depends(require_permissions("edupay.revenue")),
    global_view: bool = Query(default=False),
):
    role_key = str(actor.get("role_key") or actor.get("role") or "").strip().lower()
    if global_view and role_key != "platform_admin":
        global_view = False
    return revenue_dashboard(None if global_view else school_id)
