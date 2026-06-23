from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User
from app.schemas.billing_api import (
    BillingInvoiceResponse,
    BillingWebhookResponse,
    PaymentCancelRequest,
    PaymentOrderCreateRequest,
    PaymentOrderCreateResponse,
    PaymentRefundRequest,
    PaymentVerifyRequest,
    PaymentVerifyResponse,
)
from app.services.payment_infrastructure import payment_service

router = APIRouter(prefix="/api/billing", tags=["Billing"])


def require_platform_admin(user: User = Depends(get_authenticated_user)) -> User:
    if str(getattr(user, "role_key", "") or "").strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Only Platform Admin can access this section")
    return user


@router.post("/orders", response_model=PaymentOrderCreateResponse)
def create_payment_order(
    payload: PaymentOrderCreateRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_permissions("edupay.commerce", "edupay.payments")),
):
    return {
        "data": payment_service.create_order(
            payload.model_dump(exclude_none=True),
            actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
            idempotency_key=idempotency_key,
        )
    }


@router.post("/orders/verify", response_model=PaymentVerifyResponse)
def verify_payment_order(
    payload: PaymentVerifyRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_permissions("edupay.payments", "edupay.commerce")),
):
    return {
        "data": payment_service.verify_payment(
            provider_key=payload.provider_key,
            order_id=payload.order_id,
            provider_order_id=payload.provider_order_id,
            provider_payment_id=payload.provider_payment_id,
            signature=payload.signature,
            metadata=payload.metadata,
            actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
            idempotency_key=idempotency_key,
        )
    }


@router.post("/orders/{order_id}/refund", response_model=PaymentVerifyResponse)
def refund_payment_order(
    order_id: str,
    payload: PaymentRefundRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_platform_admin),
):
    return {
        "data": payment_service.refund_payment(
            provider_key=payload.provider_key,
            order_id=order_id,
            amount=payload.amount,
            reason=payload.reason,
            metadata=payload.metadata,
            actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
            idempotency_key=idempotency_key,
        )
    }


@router.post("/orders/{order_id}/cancel", response_model=PaymentVerifyResponse)
def cancel_payment_order(
    order_id: str,
    payload: PaymentCancelRequest,
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _: User = Depends(require_permissions("edupay.payments", "edupay.commerce")),
):
    return {
        "data": payment_service.cancel_payment(
            provider_key=payload.provider_key,
            order_id=order_id,
            reason=payload.reason,
            metadata=payload.metadata,
            actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
            idempotency_key=idempotency_key,
        )
    }


@router.get("/invoices/{invoice_id}", response_model=BillingInvoiceResponse)
def get_invoice(
    invoice_id: str,
    _: User = Depends(require_permissions("edupay.revenue", "edupay.payments")),
):
    return {"data": payment_service.get_invoice(invoice_id)}


@router.post("/webhooks/razorpay", response_model=BillingWebhookResponse)
async def handle_razorpay_webhook(
    request: Request,
    razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature"),
):
    body = await request.body()
    payload = json.loads(body.decode("utf-8") or "{}")
    event_key = str(payload.get("event_key") or payload.get("event") or "").strip()
    provider_event_id = str(payload.get("provider_event_id") or payload.get("event_id") or payload.get("id") or "").strip()
    if not event_key or not provider_event_id:
        raise HTTPException(status_code=400, detail="event_key and provider_event_id are required")
    return {
        "data": payment_service.handle_webhook(
            provider_key="razorpay",
            event_key=event_key,
            provider_event_id=provider_event_id,
            payload=payload,
            raw_body=body,
            signature=razorpay_signature,
        )
    }
