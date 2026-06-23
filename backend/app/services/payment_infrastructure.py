"""Phase 5 billing and payment infrastructure."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from uuid import uuid4

from fastapi import HTTPException

from app.config import settings
from app.models.subscription_entitlement import CreditWalletType
from app.services.ai_credit_engine import AICreditService
from app.services.subscription_engine import ExternalStudentPlanService, SchoolSubscriptionService
from app.services.supabase_admin import get_supabase_admin_client

MODULE_KEY = "billing_payment_infrastructure"
FINANCE_SCHEMA = "finance"
SUPPORTED_PROVIDERS = {"razorpay", "stripe", "cashfree"}
SUPPORTED_WEBHOOK_EVENTS = {
    "payment.success",
    "payment.failed",
    "subscription.renewed",
    "subscription.cancelled",
    "refund.processed",
}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _finance_table(name: str):
    return _client().schema(FINANCE_SCHEMA).table(name)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _to_float(value: Any) -> float:
    return float(_to_decimal(value))


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _invoice_number() -> str:
    prefix = _normalize(settings.billing_invoice_prefix) or "INV"
    stamp = _utc_now().strftime("%Y%m%d%H%M%S")
    return f"{prefix}-{stamp}-{uuid4().hex[:6].upper()}"


def _round_money(value: Decimal | float | int) -> float:
    return round(float(value), 2)


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    _public_table("audit_logs").insert(
        {
            "school_id": school_id,
            "profile_id": profile_id,
            "action": action,
            "module_key": MODULE_KEY,
            "payload": payload or {},
        }
    ).execute()


class BasePaymentGateway:
    provider_key = "base"

    def create_order(self, *, amount: Decimal, currency: str, receipt: str, notes: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def verify_payment(
        self,
        *,
        provider_order_id: str,
        provider_payment_id: str,
        signature: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def refund_payment(
        self,
        *,
        provider_payment_id: str,
        amount: Decimal,
        reason: str | None,
        notes: dict[str, Any],
    ) -> dict[str, Any]:
        raise NotImplementedError

    def cancel_payment(self, *, provider_order_id: str, notes: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def verify_webhook_signature(self, *, body: bytes, signature: str | None) -> bool:
        raise NotImplementedError


class UnsupportedProviderGateway(BasePaymentGateway):
    def __init__(self, provider_key: str) -> None:
        self.provider_key = provider_key

    def create_order(self, *, amount: Decimal, currency: str, receipt: str, notes: dict[str, Any]) -> dict[str, Any]:
        raise HTTPException(status_code=501, detail=f"{self.provider_key} integration is not implemented yet")

    def verify_payment(
        self,
        *,
        provider_order_id: str,
        provider_payment_id: str,
        signature: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise HTTPException(status_code=501, detail=f"{self.provider_key} integration is not implemented yet")

    def refund_payment(
        self,
        *,
        provider_payment_id: str,
        amount: Decimal,
        reason: str | None,
        notes: dict[str, Any],
    ) -> dict[str, Any]:
        raise HTTPException(status_code=501, detail=f"{self.provider_key} integration is not implemented yet")

    def cancel_payment(self, *, provider_order_id: str, notes: dict[str, Any]) -> dict[str, Any]:
        raise HTTPException(status_code=501, detail=f"{self.provider_key} integration is not implemented yet")

    def verify_webhook_signature(self, *, body: bytes, signature: str | None) -> bool:
        raise HTTPException(status_code=501, detail=f"{self.provider_key} integration is not implemented yet")


class RazorpayGateway(BasePaymentGateway):
    provider_key = "razorpay"
    base_url = "https://api.razorpay.com/v1"

    def __init__(
        self,
        *,
        key_id: str | None = None,
        key_secret: str | None = None,
        webhook_secret: str | None = None,
    ) -> None:
        self.key_id = _normalize(key_id or settings.razorpay_key_id)
        self.key_secret = _normalize(key_secret or settings.razorpay_key_secret)
        self.webhook_secret = _normalize(webhook_secret or settings.razorpay_webhook_secret)

    def _can_call_provider(self) -> bool:
        return bool(self.key_id and self.key_secret)

    def _headers(self) -> dict[str, str]:
        token = base64.b64encode(f"{self.key_id}:{self.key_secret}".encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=self._headers(),
            method=method,
        )
        try:
            with urllib_request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as exc:
            message = exc.read().decode("utf-8", errors="ignore")
            raise HTTPException(status_code=502, detail=f"Razorpay request failed: {message or exc.reason}") from exc
        except urllib_error.URLError as exc:
            raise HTTPException(status_code=503, detail=f"Razorpay network error: {exc.reason}") from exc

    def create_order(self, *, amount: Decimal, currency: str, receipt: str, notes: dict[str, Any]) -> dict[str, Any]:
        if not self._can_call_provider():
            if settings.environment == "production":
                raise HTTPException(status_code=503, detail="Razorpay credentials are not configured")
            return {
                "provider_key": self.provider_key,
                "provider_order_id": f"order_rzp_{uuid4().hex[:18]}",
                "payment_link": f"https://payments.local/razorpay/{receipt}",
                "currency": currency,
                "amount": _round_money(amount),
                "notes": notes,
                "mode": "mock",
            }
        payload = {
            "amount": int((amount * Decimal("100")).quantize(Decimal("1"))),
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
        }
        response = self._request("POST", "/orders", payload)
        return {
            "provider_key": self.provider_key,
            "provider_order_id": response.get("id"),
            "payment_link": response.get("short_url") or response.get("receipt") or "",
            "currency": response.get("currency", currency),
            "amount": _round_money(amount),
            "notes": response.get("notes") or notes,
            "mode": "live",
            "provider_response": response,
        }

    def verify_payment(
        self,
        *,
        provider_order_id: str,
        provider_payment_id: str,
        signature: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        verified = bool(provider_order_id and provider_payment_id)
        mode = "mock"
        if self.key_secret and signature:
            signed_payload = f"{provider_order_id}|{provider_payment_id}".encode("utf-8")
            expected = hmac.new(self.key_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
            verified = hmac.compare_digest(expected, signature)
            mode = "live"
        elif settings.environment == "production" and not signature:
            verified = False
        return {
            "provider_key": self.provider_key,
            "provider_order_id": provider_order_id,
            "provider_payment_id": provider_payment_id,
            "signature": signature,
            "verified": verified,
            "mode": mode,
            "metadata": metadata or {},
        }

    def refund_payment(
        self,
        *,
        provider_payment_id: str,
        amount: Decimal,
        reason: str | None,
        notes: dict[str, Any],
    ) -> dict[str, Any]:
        if not provider_payment_id:
            raise HTTPException(status_code=400, detail="provider_payment_id is required for refunds")
        if not self._can_call_provider():
            if settings.environment == "production":
                raise HTTPException(status_code=503, detail="Razorpay credentials are not configured")
            return {
                "provider_refund_id": f"rfnd_rzp_{uuid4().hex[:16]}",
                "status": "processed",
                "amount": _round_money(amount),
                "mode": "mock",
            }
        payload = {
            "amount": int((amount * Decimal("100")).quantize(Decimal("1"))),
            "notes": notes,
        }
        if reason:
            payload["notes"]["reason"] = reason
        response = self._request("POST", f"/payments/{provider_payment_id}/refund", payload)
        return {
            "provider_refund_id": response.get("id"),
            "status": response.get("status", "processed"),
            "amount": _round_money(amount),
            "mode": "live",
            "provider_response": response,
        }

    def cancel_payment(self, *, provider_order_id: str, notes: dict[str, Any]) -> dict[str, Any]:
        del notes
        if not provider_order_id:
            raise HTTPException(status_code=400, detail="provider_order_id is required for cancellation")
        return {
            "provider_order_id": provider_order_id,
            "status": "cancelled",
            "mode": "local",
        }

    def verify_webhook_signature(self, *, body: bytes, signature: str | None) -> bool:
        if not self.webhook_secret:
            return settings.environment != "production"
        if not signature:
            return False
        expected = hmac.new(self.webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


def _provider_gateway(provider_key: str) -> BasePaymentGateway:
    normalized = _normalize(provider_key).lower()
    if normalized not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported payment provider")
    if normalized == "razorpay":
        return RazorpayGateway()
    return UnsupportedProviderGateway(normalized)


class BillingRepository:
    def get_product_by_title(self, *, school_id: str | None, title: str, product_type: str) -> dict[str, Any] | None:
        query = (
            _finance_table("products")
            .select("*")
            .eq("title", title)
            .eq("product_type", product_type)
            .limit(1)
        )
        if school_id:
            query = query.eq("school_id", school_id)
        else:
            query = query.is_("school_id", "null")
        rows = query.execute().data or []
        return dict(rows[0]) if rows else None

    def create_product(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("products").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def create_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("orders").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_order(self, order_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("orders").update(payload).eq("id", order_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def get_order(self, order_id: str) -> dict[str, Any] | None:
        rows = _finance_table("orders").select("*").eq("id", order_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def get_order_by_provider_order(self, provider_key: str, provider_order_id: str) -> dict[str, Any] | None:
        rows = (
            _finance_table("orders")
            .select("*")
            .eq("provider_key", provider_key)
            .eq("provider_order_id", provider_order_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        return dict(rows[0]) if rows else None

    def create_order_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("order_items").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def list_order_items(self, order_id: str) -> list[dict[str, Any]]:
        return list(_finance_table("order_items").select("*").eq("order_id", order_id).execute().data or [])

    def create_invoice(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("invoices").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_invoice(self, invoice_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("invoices").update(payload).eq("id", invoice_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def get_invoice(self, invoice_id: str) -> dict[str, Any] | None:
        rows = _finance_table("invoices").select("*").eq("id", invoice_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def get_invoice_by_order(self, order_id: str) -> dict[str, Any] | None:
        rows = _finance_table("invoices").select("*").eq("order_id", order_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def create_refund(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_refunds").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_refund(self, refund_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_refunds").update(payload).eq("id", refund_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def get_refund(self, refund_id: str) -> dict[str, Any] | None:
        rows = _finance_table("payment_refunds").select("*").eq("id", refund_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def create_webhook_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_webhook_events").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_webhook_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_webhook_events").update(payload).eq("id", event_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def get_webhook_event(self, provider_key: str, provider_event_id: str) -> dict[str, Any] | None:
        rows = (
            _finance_table("payment_webhook_events")
            .select("*")
            .eq("provider_key", provider_key)
            .eq("provider_event_id", provider_event_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        return dict(rows[0]) if rows else None

    def get_idempotency_record(self, provider_key: str, operation_key: str, idempotency_key: str) -> dict[str, Any] | None:
        rows = (
            _finance_table("payment_idempotency_keys")
            .select("*")
            .eq("provider_key", provider_key)
            .eq("operation_key", operation_key)
            .eq("idempotency_key", idempotency_key)
            .limit(1)
            .execute()
            .data
            or []
        )
        return dict(rows[0]) if rows else None

    def create_idempotency_record(self, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_idempotency_keys").insert(payload).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_idempotency_record(self, record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("payment_idempotency_keys").update(payload).eq("id", record_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def get_ai_credit_product_by_key(self, product_key: str) -> dict[str, Any] | None:
        rows = (
            _public_table("ai_credit_products")
            .select("*")
            .eq("product_key", product_key)
            .eq("is_active", True)
            .limit(1)
            .execute()
            .data
            or []
        )
        return dict(rows[0]) if rows else None

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        rows = _finance_table("subscriptions").select("*").eq("id", subscription_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def update_subscription(self, subscription_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = _finance_table("subscriptions").update(payload).eq("id", subscription_id).execute().data or []
        return dict(rows[0]) if rows else {}


@dataclass(slots=True)
class PaymentService:
    repository: BillingRepository | None = None
    subscription_service: SchoolSubscriptionService | None = None
    external_student_plan_service: ExternalStudentPlanService | None = None
    ai_credit_service: AICreditService | None = None
    gateways: dict[str, BasePaymentGateway] | None = None

    def __post_init__(self) -> None:
        self.repository = self.repository or BillingRepository()
        self.subscription_service = self.subscription_service or SchoolSubscriptionService()
        self.external_student_plan_service = self.external_student_plan_service or ExternalStudentPlanService()
        self.ai_credit_service = self.ai_credit_service or AICreditService()
        self.gateways = self.gateways or {key: _provider_gateway(key) for key in SUPPORTED_PROVIDERS}

    def _gateway(self, provider_key: str) -> BasePaymentGateway:
        normalized = _normalize(provider_key).lower()
        gateway = (self.gateways or {}).get(normalized)
        if not gateway:
            gateway = _provider_gateway(normalized)
            self.gateways[normalized] = gateway
        return gateway

    def _idempotency_result(
        self,
        *,
        provider_key: str,
        operation_key: str,
        idempotency_key: str | None,
        payload: dict[str, Any],
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        if not idempotency_key:
            return None, None
        request_hash = _stable_hash(payload)
        existing = self.repository.get_idempotency_record(provider_key, operation_key, idempotency_key)
        if existing:
            if _normalize(existing.get("request_hash")) != request_hash:
                raise HTTPException(status_code=409, detail="Idempotency key reuse with different payload")
            response_payload = dict(existing.get("response_payload") or {})
            response_payload["idempotency_replayed"] = True
            return response_payload, existing
        created = self.repository.create_idempotency_record(
            {
                "provider_key": provider_key,
                "operation_key": operation_key,
                "idempotency_key": idempotency_key,
                "request_hash": request_hash,
                "status": "pending",
                "expires_at": (_utc_now() + timedelta(days=2)).isoformat(),
                "response_payload": {},
            }
        )
        return None, created

    def _complete_idempotency(self, record: dict[str, Any] | None, payload: dict[str, Any]) -> None:
        if not record or not record.get("id"):
            return
        self.repository.update_idempotency_record(
            str(record["id"]),
            {
                "status": "completed",
                "resource_type": payload.get("resource_type"),
                "resource_id": payload.get("resource_id"),
                "response_payload": payload,
            },
        )

    def _build_purchase(self, payload: dict[str, Any]) -> dict[str, Any]:
        purchase_type = _normalize(payload.get("purchase_type")).lower()
        amount = _to_decimal(payload.get("amount"))
        tax_amount = _to_decimal(payload.get("tax_amount"))
        school_id = _normalize(payload.get("school_id")) or None
        profile_id = _normalize(payload.get("profile_id")) or None
        metadata = dict(payload.get("metadata") or {})
        line_items: list[dict[str, Any]]

        if purchase_type == "school_subscription":
            plan_tier = _normalize(payload.get("plan_tier")).lower()
            billing_cycle = _normalize(payload.get("billing_cycle")).lower() or "monthly"
            line_items = [
                {
                    "title": f"{plan_tier.title()} school subscription",
                    "quantity": 1,
                    "unit_price": _round_money(amount),
                    "total_price": _round_money(amount),
                    "metadata": {"plan_tier": plan_tier, "billing_cycle": billing_cycle},
                }
            ]
            metadata.update({"purchase_type": purchase_type, "plan_tier": plan_tier, "billing_cycle": billing_cycle})
        elif purchase_type == "external_student_subscription":
            external_plan_key = _normalize(payload.get("external_plan_key")).lower()
            line_items = [
                {
                    "title": f"External student {external_plan_key} subscription",
                    "quantity": 1,
                    "unit_price": _round_money(amount),
                    "total_price": _round_money(amount),
                    "metadata": {"external_plan_key": external_plan_key},
                }
            ]
            metadata.update({"purchase_type": purchase_type, "external_plan_key": external_plan_key})
        elif purchase_type == "ai_credit_purchase":
            ai_credit_product_key = _normalize(payload.get("ai_credit_product_key"))
            ai_credits = _safe_int(payload.get("ai_credits"))
            if ai_credit_product_key:
                product = self.repository.get_ai_credit_product_by_key(ai_credit_product_key)
                if not product:
                    raise HTTPException(status_code=404, detail="AI credit product not found")
                ai_credits = _safe_int(product.get("credits"))
                amount = _to_decimal(product.get("price_inr"))
            elif ai_credits <= 0:
                raise HTTPException(status_code=400, detail="AI credits must be greater than zero")
            if amount <= 0:
                amount = Decimal(str(settings.ai_credit_price_per_credit_inr)) * Decimal(ai_credits)
            line_items = [
                {
                    "title": f"AI credit pack ({ai_credits} credits)",
                    "quantity": 1,
                    "unit_price": _round_money(amount),
                    "total_price": _round_money(amount),
                    "metadata": {"ai_credits": ai_credits, "wallet_type": _normalize(payload.get("wallet_type")).lower() or CreditWalletType.PERSONAL.value},
                }
            ]
            metadata.update(
                {
                    "purchase_type": purchase_type,
                    "ai_credit_product_key": ai_credit_product_key or None,
                    "ai_credits": ai_credits,
                    "wallet_type": _normalize(payload.get("wallet_type")).lower() or CreditWalletType.PERSONAL.value,
                }
            )
        else:
            raise HTTPException(status_code=400, detail="Unsupported purchase type")

        return {
            "purchase_type": purchase_type,
            "school_id": school_id,
            "profile_id": profile_id,
            "amount": amount,
            "tax_amount": tax_amount,
            "total_amount": amount + tax_amount,
            "line_items": line_items,
            "metadata": metadata,
        }

    def _ensure_billing_product(self, *, purchase_type: str, school_id: str | None, metadata: dict[str, Any], amount: Decimal) -> dict[str, Any]:
        if purchase_type == "school_subscription":
            title = f"{_normalize(metadata.get('plan_tier')).title()} school subscription"
            product_type = "subscription_plan"
            category = "subscription_course"
            pricing_model = _normalize(metadata.get("billing_cycle")).lower() or "monthly"
            access_tier = "subscription"
        elif purchase_type == "external_student_subscription":
            title = f"External student {_normalize(metadata.get('external_plan_key')).title()} subscription"
            product_type = "subscription_plan"
            category = "subscription_course"
            pricing_model = "monthly"
            access_tier = "subscription"
        else:
            credit_count = _safe_int(metadata.get("ai_credits"))
            title = f"AI credit pack ({credit_count} credits)"
            product_type = "bundle"
            category = "paid_course"
            pricing_model = "one_time"
            access_tier = "paid"

        existing = self.repository.get_product_by_title(school_id=school_id, title=title, product_type=product_type)
        if existing:
            return existing
        return self.repository.create_product(
            {
                "school_id": school_id,
                "owner_scope": "school" if school_id else "platform",
                "product_type": product_type,
                "category": category,
                "title": title,
                "description": f"Auto-generated billing product for {purchase_type}.",
                "pricing_model": pricing_model,
                "access_tier": access_tier,
                "currency": "INR",
                "base_price": _round_money(amount),
                "sale_price": _round_money(amount),
                "billing_interval": pricing_model if product_type == "subscription_plan" else None,
                "metadata": {"purchase_type": purchase_type, **metadata},
            }
        )

    def create_order(
        self,
        payload: dict[str, Any],
        *,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        provider_key = _normalize(payload.get("provider_key")).lower() or "razorpay"
        replay, record = self._idempotency_result(
            provider_key=provider_key,
            operation_key="create_order",
            idempotency_key=idempotency_key,
            payload=payload,
        )
        if replay:
            return replay

        purchase = self._build_purchase(payload)
        gateway = self._gateway(provider_key)
        product = self._ensure_billing_product(
            purchase_type=purchase["purchase_type"],
            school_id=purchase["school_id"],
            metadata=purchase["metadata"],
            amount=purchase["amount"],
        )
        notes = {
            "purchase_type": purchase["purchase_type"],
            "school_id": purchase["school_id"],
            "profile_id": purchase["profile_id"],
        }
        order_row = self.repository.create_order(
            {
                "school_id": purchase["school_id"],
                "profile_id": purchase["profile_id"],
                "student_id": None,
                "provider_key": provider_key,
                "order_status": "pending",
                "currency": _normalize(payload.get("currency")) or "INR",
                "subtotal_amount": _round_money(purchase["amount"]),
                "discount_amount": 0,
                "tax_amount": _round_money(purchase["tax_amount"]),
                "credits_redeemed": 0,
                "total_amount": _round_money(purchase["total_amount"]),
                "metadata": {
                    **purchase["metadata"],
                    "billing_name": payload.get("billing_name"),
                    "billing_email": payload.get("billing_email"),
                    "billing_phone": payload.get("billing_phone"),
                    "billing_address": dict(payload.get("billing_address") or {}),
                    "gst_number": payload.get("gst_number"),
                    "line_items": purchase["line_items"],
                },
                "expires_at": (_utc_now() + timedelta(minutes=30)).isoformat(),
            }
        )
        provider_payload = gateway.create_order(
            amount=purchase["total_amount"],
            currency=_normalize(payload.get("currency")) or "INR",
            receipt=str(order_row.get("id")),
            notes=notes,
        )
        order_row = self.repository.update_order(
            str(order_row.get("id")),
            {
                "provider_order_id": provider_payload.get("provider_order_id"),
                "metadata": {
                    **dict(order_row.get("metadata") or {}),
                    "provider_payload": provider_payload,
                },
            },
        )
        for item in purchase["line_items"]:
            self.repository.create_order_item(
                {
                    "school_id": purchase["school_id"],
                    "order_id": order_row.get("id"),
                    "product_id": product.get("id"),
                    "quantity": item["quantity"],
                    "unit_price": item["unit_price"],
                    "total_price": item["total_price"],
                    "metadata": item["metadata"] | {"title": item["title"]},
                }
            )
        response = {
            "resource_type": "order",
            "resource_id": str(order_row.get("id")),
            "order_id": str(order_row.get("id")),
            "provider_key": provider_key,
            "provider_order_id": provider_payload.get("provider_order_id"),
            "payment_link": provider_payload.get("payment_link"),
            "status": order_row.get("order_status"),
            "purchase_type": purchase["purchase_type"],
            "total_amount": _round_money(purchase["total_amount"]),
            "currency": _normalize(payload.get("currency")) or "INR",
            "line_items": purchase["line_items"],
            "mode": provider_payload.get("mode"),
            "idempotency_replayed": False,
        }
        self._complete_idempotency(record, response)
        _log_audit_entry(
            school_id=purchase["school_id"],
            profile_id=actor_profile_id or purchase["profile_id"],
            action="payment created",
            payload={"order_id": order_row.get("id"), "purchase_type": purchase["purchase_type"], "provider_key": provider_key},
        )
        return response

    def _create_invoice_for_order(self, order: dict[str, Any], fulfilled: dict[str, Any]) -> dict[str, Any]:
        existing = self.repository.get_invoice_by_order(str(order.get("id")))
        metadata = dict(order.get("metadata") or {})
        line_items = metadata.get("line_items") or []
        invoice_payload = {
            "school_id": order.get("school_id"),
            "profile_id": order.get("profile_id"),
            "order_id": order.get("id"),
            "subscription_id": fulfilled.get("subscription_id"),
            "provider_key": order.get("provider_key"),
            "provider_payment_id": order.get("provider_payment_id"),
            "invoice_number": existing.get("invoice_number") if existing else _invoice_number(),
            "invoice_status": "paid",
            "currency": order.get("currency") or "INR",
            "subtotal_amount": order.get("subtotal_amount") or 0,
            "tax_amount": order.get("tax_amount") or 0,
            "total_amount": order.get("total_amount") or 0,
            "gst_number": metadata.get("gst_number"),
            "tax_breakdown": {
                "gst_rate": settings.billing_gst_rate,
                "tax_amount": _to_float(order.get("tax_amount")),
            },
            "billing_name": metadata.get("billing_name"),
            "billing_email": metadata.get("billing_email"),
            "billing_phone": metadata.get("billing_phone"),
            "billing_address": dict(metadata.get("billing_address") or {}),
            "line_items": line_items,
            "metadata": {"purchase_type": metadata.get("purchase_type"), "fulfillment": fulfilled},
            "issued_at": existing.get("issued_at") if existing else _utc_now_iso(),
            "paid_at": _utc_now_iso(),
        }
        if existing:
            return self.repository.update_invoice(str(existing.get("id")), invoice_payload)
        return self.repository.create_invoice(invoice_payload)

    def _fulfill_order(self, order: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
        metadata = dict(order.get("metadata") or {})
        purchase_type = _normalize(metadata.get("purchase_type")).lower()
        provider_payment_id = _normalize(order.get("provider_payment_id"))
        if purchase_type == "school_subscription":
            result = self.subscription_service.activate_plan(
                _normalize(order.get("school_id")),
                _normalize(metadata.get("plan_tier")),
                _normalize(metadata.get("billing_cycle")) or "monthly",
                actor_profile_id=actor_profile_id or _normalize(order.get("profile_id")) or None,
                provider_key=_normalize(order.get("provider_key")) or "razorpay",
                payment_reference=provider_payment_id or None,
            )
            subscription = dict(result.get("subscription") or {})
            return {
                "purchase_type": purchase_type,
                "subscription_id": subscription.get("id"),
                "result": result,
            }
        if purchase_type == "external_student_subscription":
            result = self.external_student_plan_service.purchase_plan(
                _normalize(order.get("profile_id")),
                _normalize(metadata.get("external_plan_key")),
                school_id=_normalize(order.get("school_id")) or None,
                provider_key=_normalize(order.get("provider_key")) or "razorpay",
                payment_reference=provider_payment_id or None,
            )
            subscription = dict(result.get("subscription") or {})
            return {
                "purchase_type": purchase_type,
                "subscription_id": subscription.get("id"),
                "result": result,
            }
        if purchase_type == "ai_credit_purchase":
            ai_credits = _safe_int(metadata.get("ai_credits"))
            wallet_type = _normalize(metadata.get("wallet_type")).lower() or CreditWalletType.PERSONAL.value
            result = self.ai_credit_service.credit(
                _normalize(order.get("profile_id")),
                _normalize(order.get("school_id")),
                ai_credits,
                wallet_type=wallet_type,
                reason="AI credit purchase",
                actor_profile_id=actor_profile_id or _normalize(order.get("profile_id")) or None,
                reference={"reference_type": "billing_order", "reference_id": str(order.get("id"))},
                metadata={"provider_payment_id": provider_payment_id},
                idempotency_key=f"billing-credit:{order.get('id')}",
            )
            return {
                "purchase_type": purchase_type,
                "subscription_id": None,
                "result": result,
            }
        raise HTTPException(status_code=400, detail="Unsupported order purchase type")

    def verify_payment(
        self,
        *,
        provider_key: str,
        order_id: str,
        provider_order_id: str,
        provider_payment_id: str,
        signature: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "order_id": order_id,
            "provider_order_id": provider_order_id,
            "provider_payment_id": provider_payment_id,
            "signature": signature,
            "metadata": metadata or {},
        }
        replay, record = self._idempotency_result(
            provider_key=provider_key,
            operation_key="verify_payment",
            idempotency_key=idempotency_key or provider_payment_id,
            payload=payload,
        )
        if replay:
            return replay

        gateway = self._gateway(provider_key)
        order = self.repository.get_order(order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        verification = gateway.verify_payment(
            provider_order_id=provider_order_id,
            provider_payment_id=provider_payment_id,
            signature=signature,
            metadata=metadata or {},
        )
        if not verification.get("verified"):
            failed = self.repository.update_order(
                order_id,
                {
                    "order_status": "failed",
                    "provider_payment_id": provider_payment_id,
                    "provider_signature": signature,
                    "metadata": {**dict(order.get("metadata") or {}), "verification": verification},
                },
            )
            _log_audit_entry(
                school_id=_normalize(failed.get("school_id")) or None,
                profile_id=actor_profile_id or _normalize(failed.get("profile_id")) or None,
                action="payment failed",
                payload={"order_id": order_id, "provider_payment_id": provider_payment_id},
            )
            raise HTTPException(status_code=400, detail="Payment verification failed")

        order = self.repository.update_order(
            order_id,
            {
                "order_status": "paid",
                "provider_order_id": provider_order_id,
                "provider_payment_id": provider_payment_id,
                "provider_signature": signature,
                "verified_at": _utc_now_iso(),
                "paid_at": _utc_now_iso(),
                "metadata": {**dict(order.get("metadata") or {}), "verification": verification},
            },
        )
        fulfilled = self._fulfill_order(order, actor_profile_id=actor_profile_id)
        invoice = self._create_invoice_for_order(order, fulfilled)
        response = {
            "resource_type": "order",
            "resource_id": order_id,
            "order_id": order_id,
            "status": "paid",
            "provider_payment_id": provider_payment_id,
            "invoice_id": invoice.get("id"),
            "invoice_number": invoice.get("invoice_number"),
            "purchase_type": fulfilled.get("purchase_type"),
            "mode": verification.get("mode"),
            "fulfillment": fulfilled.get("result"),
            "idempotency_replayed": False,
        }
        self._complete_idempotency(record, response)
        _log_audit_entry(
            school_id=_normalize(order.get("school_id")) or None,
            profile_id=actor_profile_id or _normalize(order.get("profile_id")) or None,
            action="payment verified",
            payload={"order_id": order_id, "provider_payment_id": provider_payment_id, "invoice_id": invoice.get("id")},
        )
        return response

    def refund_payment(
        self,
        *,
        provider_key: str,
        order_id: str,
        amount: float | None = None,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        payload = {"order_id": order_id, "amount": amount, "reason": reason, "metadata": metadata or {}}
        replay, record = self._idempotency_result(
            provider_key=provider_key,
            operation_key="refund_payment",
            idempotency_key=idempotency_key or f"refund:{order_id}",
            payload=payload,
        )
        if replay:
            return replay

        order = self.repository.get_order(order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if _normalize(order.get("order_status")).lower() != "paid":
            raise HTTPException(status_code=400, detail="Only paid orders can be refunded")
        refund_amount = _to_decimal(amount if amount is not None else order.get("total_amount"))
        gateway = self._gateway(provider_key)
        gateway_refund = gateway.refund_payment(
            provider_payment_id=_normalize(order.get("provider_payment_id")),
            amount=refund_amount,
            reason=reason,
            notes={"order_id": order_id},
        )
        refund = self.repository.create_refund(
            {
                "school_id": order.get("school_id"),
                "profile_id": order.get("profile_id"),
                "order_id": order_id,
                "invoice_id": (self.repository.get_invoice_by_order(order_id) or {}).get("id"),
                "provider_key": provider_key,
                "provider_payment_id": order.get("provider_payment_id"),
                "provider_refund_id": gateway_refund.get("provider_refund_id"),
                "refund_status": gateway_refund.get("status", "processed"),
                "amount": _round_money(refund_amount),
                "currency": order.get("currency") or "INR",
                "reason": reason,
                "metadata": metadata or {},
                "processed_at": _utc_now_iso(),
            }
        )
        self.repository.update_order(order_id, {"order_status": "cancelled"})
        invoice = self.repository.get_invoice_by_order(order_id)
        if invoice:
            self.repository.update_invoice(str(invoice.get("id")), {"invoice_status": "refunded", "refunded_at": _utc_now_iso()})
        response = {
            "resource_type": "refund",
            "resource_id": str(refund.get("id")),
            "refund_id": refund.get("id"),
            "provider_refund_id": gateway_refund.get("provider_refund_id"),
            "status": refund.get("refund_status"),
            "amount": _round_money(refund_amount),
            "idempotency_replayed": False,
        }
        self._complete_idempotency(record, response)
        _log_audit_entry(
            school_id=_normalize(order.get("school_id")) or None,
            profile_id=actor_profile_id or _normalize(order.get("profile_id")) or None,
            action="refund issued",
            payload={"order_id": order_id, "refund_id": refund.get("id"), "amount": _round_money(refund_amount)},
        )
        return response

    def cancel_payment(
        self,
        *,
        provider_key: str,
        order_id: str,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        payload = {"order_id": order_id, "reason": reason, "metadata": metadata or {}}
        replay, record = self._idempotency_result(
            provider_key=provider_key,
            operation_key="cancel_payment",
            idempotency_key=idempotency_key or f"cancel:{order_id}",
            payload=payload,
        )
        if replay:
            return replay

        order = self.repository.get_order(order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        if _normalize(order.get("order_status")).lower() == "paid":
            raise HTTPException(status_code=400, detail="Paid orders must be refunded instead of cancelled")
        gateway = self._gateway(provider_key)
        gateway_result = gateway.cancel_payment(
            provider_order_id=_normalize(order.get("provider_order_id")),
            notes={"order_id": order_id, "reason": reason},
        )
        updated = self.repository.update_order(
            order_id,
            {
                "order_status": "cancelled",
                "metadata": {**dict(order.get("metadata") or {}), "cancel_reason": reason, "cancel_metadata": metadata or {}},
            },
        )
        response = {
            "resource_type": "order",
            "resource_id": order_id,
            "order_id": order_id,
            "status": updated.get("order_status"),
            "provider_status": gateway_result.get("status"),
            "idempotency_replayed": False,
        }
        self._complete_idempotency(record, response)
        _log_audit_entry(
            school_id=_normalize(updated.get("school_id")) or None,
            profile_id=actor_profile_id or _normalize(updated.get("profile_id")) or None,
            action="payment failed",
            payload={"order_id": order_id, "reason": reason, "mode": "cancelled"},
        )
        return response

    def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        invoice = self.repository.get_invoice(invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return invoice

    def _mark_subscription_renewed(self, subscription_id: str, provider_payment_id: str | None) -> dict[str, Any]:
        subscription = self.repository.get_subscription(subscription_id)
        if not subscription:
            raise HTTPException(status_code=404, detail="Subscription not found")
        expiry_raw = _normalize(subscription.get("expiry_date"))
        expiry_date = datetime.fromisoformat(f"{expiry_raw}T00:00:00+00:00") if expiry_raw else _utc_now()
        billing_interval = _normalize((subscription.get("metadata") or {}).get("billing_cycle")) or "monthly"
        next_expiry = expiry_date + timedelta(days=365 if billing_interval == "yearly" else 30)
        updated = self.repository.update_subscription(
            str(subscription.get("id")),
            {
                "subscription_status": "active",
                "renewal_count": _safe_int(subscription.get("renewal_count")) + 1,
                "renewal_date": next_expiry.date().isoformat(),
                "expiry_date": next_expiry.date().isoformat(),
                "metadata": {**dict(subscription.get("metadata") or {}), "last_renewed_payment_id": provider_payment_id, "last_renewed_at": _utc_now_iso()},
            },
        )
        _log_audit_entry(
            school_id=_normalize(updated.get("school_id")) or None,
            profile_id=_normalize(updated.get("profile_id")) or None,
            action="subscription renewed",
            payload={"subscription_id": updated.get("id"), "provider_payment_id": provider_payment_id},
        )
        return updated

    def handle_webhook(
        self,
        *,
        provider_key: str,
        event_key: str,
        provider_event_id: str,
        payload: dict[str, Any],
        raw_body: bytes,
        signature: str | None,
    ) -> dict[str, Any]:
        gateway = self._gateway(provider_key)
        if event_key not in SUPPORTED_WEBHOOK_EVENTS:
            raise HTTPException(status_code=400, detail="Unsupported webhook event")
        if not gateway.verify_webhook_signature(body=raw_body, signature=signature):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

        existing = self.repository.get_webhook_event(provider_key, provider_event_id)
        if existing:
            response = dict(existing.get("payload") or {})
            return {
                "event_id": existing.get("id"),
                "provider_event_id": provider_event_id,
                "event_key": event_key,
                "status": existing.get("event_status"),
                "replayed": True,
                "result": response.get("result"),
            }

        event_row = self.repository.create_webhook_event(
            {
                "provider_key": provider_key,
                "event_key": event_key,
                "provider_event_id": provider_event_id,
                "event_status": "received",
                "signature_hash": hashlib.sha256((signature or "").encode("utf-8")).hexdigest() if signature else None,
                "payload": payload,
            }
        )
        try:
            result: dict[str, Any] | None = None
            if event_key == "payment.success":
                order_id = _normalize(payload.get("order_id"))
                provider_order_id = _normalize(payload.get("provider_order_id"))
                provider_payment_id = _normalize(payload.get("provider_payment_id"))
                result = self.verify_payment(
                    provider_key=provider_key,
                    order_id=order_id,
                    provider_order_id=provider_order_id,
                    provider_payment_id=provider_payment_id,
                    signature=signature,
                    metadata={"source": "webhook", "provider_event_id": provider_event_id},
                    idempotency_key=f"webhook:{provider_event_id}",
                )
            elif event_key == "payment.failed":
                order = self.repository.get_order(_normalize(payload.get("order_id")))
                if order:
                    self.repository.update_order(str(order.get("id")), {"order_status": "failed", "metadata": {**dict(order.get("metadata") or {}), "failure_payload": payload}})
                    _log_audit_entry(
                        school_id=_normalize(order.get("school_id")) or None,
                        profile_id=_normalize(order.get("profile_id")) or None,
                        action="payment failed",
                        payload={"order_id": order.get("id"), "provider_event_id": provider_event_id},
                    )
                result = {"order_id": payload.get("order_id"), "status": "failed"}
            elif event_key == "subscription.renewed":
                result = self._mark_subscription_renewed(_normalize(payload.get("subscription_id")), _normalize(payload.get("provider_payment_id")) or None)
            elif event_key == "subscription.cancelled":
                subscription = self.repository.update_subscription(
                    _normalize(payload.get("subscription_id")),
                    {"subscription_status": "cancelled", "auto_renew": False, "metadata": {"cancelled_via_webhook": True, "provider_event_id": provider_event_id}},
                )
                result = {"subscription_id": subscription.get("id"), "status": subscription.get("subscription_status")}
            elif event_key == "refund.processed":
                refund = self.repository.get_refund(_normalize(payload.get("refund_id")))
                if refund:
                    refund = self.repository.update_refund(
                        str(refund.get("id")),
                        {"refund_status": "processed", "processed_at": _utc_now_iso(), "metadata": {**dict(refund.get("metadata") or {}), "provider_event_id": provider_event_id}},
                    )
                result = {"refund_id": (refund or {}).get("id"), "status": (refund or {}).get("refund_status", "processed")}
            updated = self.repository.update_webhook_event(
                str(event_row.get("id")),
                {"event_status": "processed", "processed_at": _utc_now_iso(), "payload": {**payload, "result": result}},
            )
            return {
                "event_id": updated.get("id"),
                "provider_event_id": provider_event_id,
                "event_key": event_key,
                "status": updated.get("event_status"),
                "replayed": False,
                "result": result,
            }
        except Exception as exc:
            self.repository.update_webhook_event(
                str(event_row.get("id")),
                {"event_status": "failed", "processed_at": _utc_now_iso(), "error_message": str(exc)},
            )
            raise


payment_service = PaymentService()
