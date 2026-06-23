from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import UserRole
from app.routes import billing
from app.services.payment_infrastructure import PaymentService


SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


class FakeRepository:
    def __init__(self) -> None:
        self.products: dict[str, dict[str, Any]] = {}
        self.orders: dict[str, dict[str, Any]] = {}
        self.order_items: dict[str, dict[str, Any]] = {}
        self.invoices: dict[str, dict[str, Any]] = {}
        self.refunds: dict[str, dict[str, Any]] = {}
        self.webhooks: dict[tuple[str, str], dict[str, Any]] = {}
        self.idempotency: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.product_counter = 0
        self.order_counter = 0
        self.order_item_counter = 0
        self.invoice_counter = 0
        self.refund_counter = 0
        self.webhook_counter = 0
        self.idempotency_counter = 0

    def _create(self, store: dict[str, dict[str, Any]], payload: dict[str, Any], prefix: str, counter_attr: str) -> dict[str, Any]:
        setattr(self, counter_attr, getattr(self, counter_attr) + 1)
        row = dict(payload)
        row["id"] = f"{prefix}-{getattr(self, counter_attr)}"
        store[row["id"]] = row
        return dict(row)

    def get_product_by_title(self, *, school_id: str | None, title: str, product_type: str):
        for row in self.products.values():
            if row.get("school_id") == school_id and row.get("title") == title and row.get("product_type") == product_type:
                return dict(row)
        return None

    def create_product(self, payload: dict[str, Any]):
        return self._create(self.products, payload, "product", "product_counter")

    def create_order(self, payload: dict[str, Any]):
        return self._create(self.orders, payload, "order", "order_counter")

    def update_order(self, order_id: str, payload: dict[str, Any]):
        self.orders[order_id].update(payload)
        return dict(self.orders[order_id])

    def get_order(self, order_id: str):
        row = self.orders.get(order_id)
        return dict(row) if row else None

    def get_order_by_provider_order(self, provider_key: str, provider_order_id: str):
        for row in self.orders.values():
            if row.get("provider_key") == provider_key and row.get("provider_order_id") == provider_order_id:
                return dict(row)
        return None

    def create_order_item(self, payload: dict[str, Any]):
        return self._create(self.order_items, payload, "order-item", "order_item_counter")

    def list_order_items(self, order_id: str):
        return [dict(row) for row in self.order_items.values() if row.get("order_id") == order_id]

    def create_invoice(self, payload: dict[str, Any]):
        return self._create(self.invoices, payload, "invoice", "invoice_counter")

    def update_invoice(self, invoice_id: str, payload: dict[str, Any]):
        self.invoices[invoice_id].update(payload)
        return dict(self.invoices[invoice_id])

    def get_invoice(self, invoice_id: str):
        row = self.invoices.get(invoice_id)
        return dict(row) if row else None

    def get_invoice_by_order(self, order_id: str):
        for row in self.invoices.values():
            if row.get("order_id") == order_id:
                return dict(row)
        return None

    def create_refund(self, payload: dict[str, Any]):
        return self._create(self.refunds, payload, "refund", "refund_counter")

    def update_refund(self, refund_id: str, payload: dict[str, Any]):
        self.refunds[refund_id].update(payload)
        return dict(self.refunds[refund_id])

    def get_refund(self, refund_id: str):
        row = self.refunds.get(refund_id)
        return dict(row) if row else None

    def create_webhook_event(self, payload: dict[str, Any]):
        row = self._create(self.webhooks, payload, "webhook", "webhook_counter")
        self.webhooks[(row["provider_key"], row["provider_event_id"])] = row
        return dict(row)

    def update_webhook_event(self, event_id: str, payload: dict[str, Any]):
        for key, row in list(self.webhooks.items()):
            if isinstance(key, tuple):
                if row.get("id") == event_id:
                    row.update(payload)
                    self.webhooks[key] = row
                    return dict(row)
        raise KeyError(event_id)

    def get_webhook_event(self, provider_key: str, provider_event_id: str):
        row = self.webhooks.get((provider_key, provider_event_id))
        return dict(row) if row else None

    def get_idempotency_record(self, provider_key: str, operation_key: str, idempotency_key: str):
        row = self.idempotency.get((provider_key, operation_key, idempotency_key))
        return dict(row) if row else None

    def create_idempotency_record(self, payload: dict[str, Any]):
        row = self._create({}, payload, "idem", "idempotency_counter")
        self.idempotency[(row["provider_key"], row["operation_key"], row["idempotency_key"])] = row
        return dict(row)

    def update_idempotency_record(self, record_id: str, payload: dict[str, Any]):
        for key, row in list(self.idempotency.items()):
            if row.get("id") == record_id:
                row.update(payload)
                self.idempotency[key] = row
                return dict(row)
        raise KeyError(record_id)

    def get_ai_credit_product_by_key(self, product_key: str):
        for row in self.products.values():
            if row.get("product_key") == product_key:
                return dict(row)
        return None

    def get_subscription(self, subscription_id: str):
        row = self.subscriptions.get(subscription_id)
        return dict(row) if row else None

    def update_subscription(self, subscription_id: str, payload: dict[str, Any]):
        row = self.subscriptions.setdefault(subscription_id, {"id": subscription_id})
        row.update(payload)
        self.subscriptions[subscription_id] = row
        return dict(row)


class FakeGateway:
    provider_key = "razorpay"

    def __init__(self, webhook_secret: str = "secret") -> None:
        self.webhook_secret = webhook_secret
        self.refunds: list[dict[str, Any]] = []

    def create_order(self, *, amount, currency, receipt, notes):
        return {
            "provider_key": "razorpay",
            "provider_order_id": f"provider-{receipt}",
            "payment_link": f"https://example.test/pay/{receipt}",
            "mode": "test",
            "amount": float(amount),
            "currency": currency,
            "notes": notes,
        }

    def verify_payment(self, *, provider_order_id, provider_payment_id, signature=None, metadata=None):
        return {
            "provider_key": "razorpay",
            "provider_order_id": provider_order_id,
            "provider_payment_id": provider_payment_id,
            "signature": signature,
            "verified": bool(provider_order_id and provider_payment_id),
            "mode": "test",
            "metadata": metadata or {},
        }

    def refund_payment(self, *, provider_payment_id, amount, reason, notes):
        payload = {
            "provider_refund_id": f"refund-{len(self.refunds) + 1}",
            "status": "processed",
            "amount": float(amount),
            "reason": reason,
            "notes": notes,
        }
        self.refunds.append(payload)
        return payload

    def cancel_payment(self, *, provider_order_id, notes):
        return {"provider_order_id": provider_order_id, "status": "cancelled", "notes": notes}

    def verify_webhook_signature(self, *, body: bytes, signature: str | None):
        if not signature:
            return False
        expected = hmac.new(self.webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


class FakeSchoolSubscriptionService:
    def __init__(self) -> None:
        self.activations: list[dict[str, Any]] = []

    def activate_plan(self, school_id: str, plan_tier: str, billing_cycle: str | None, **kwargs):
        activation = {
            "id": f"sub-{len(self.activations) + 1}",
            "school_id": school_id,
            "plan_tier": plan_tier,
            "billing_cycle": billing_cycle or "monthly",
            "payment_reference": kwargs.get("payment_reference"),
        }
        self.activations.append(activation)
        return {"subscription": activation, "school_id": school_id}


class FakeExternalStudentPlanService:
    def __init__(self) -> None:
        self.purchases: list[dict[str, Any]] = []

    def purchase_plan(self, profile_id: str, plan_key: str, **kwargs):
        purchase = {
            "id": f"external-sub-{len(self.purchases) + 1}",
            "profile_id": profile_id,
            "plan_key": plan_key,
            "payment_reference": kwargs.get("payment_reference"),
        }
        self.purchases.append(purchase)
        return {"subscription": purchase, "profile_id": profile_id}


class FakeAICreditService:
    def __init__(self) -> None:
        self.credits: list[dict[str, Any]] = []

    def credit(self, profile_id: str, school_id: str, amount: int, **kwargs):
        payload = {
            "profile_id": profile_id,
            "school_id": school_id,
            "amount": amount,
            "wallet_type": kwargs.get("wallet_type"),
            "reference": kwargs.get("reference"),
        }
        self.credits.append(payload)
        return {"wallet": {"balance": amount}, "ledger": {"transaction_type": "credit"}, "credited_amount": amount}


def build_service():
    repository = FakeRepository()
    gateway = FakeGateway()
    service = PaymentService(
        repository=repository,
        subscription_service=FakeSchoolSubscriptionService(),
        external_student_plan_service=FakeExternalStudentPlanService(),
        ai_credit_service=FakeAICreditService(),
        gateways={"razorpay": gateway},
    )
    return service, repository, gateway


def auth_user(role_key: str = "platform_admin", permissions: str = "edupay.commerce,edupay.payments,edupay.revenue"):
    return type(
        "User",
        (),
        {
            "role_key": role_key,
            "permissions": permissions,
            "role": UserRole.ADMIN,
            "email": "platform@example.com",
            "username": "platform-admin",
            "full_name": "Platform Admin",
            "is_active": True,
            "id": 1,
        },
    )()


def test_payment_verification_and_subscription_activation(monkeypatch):
    monkeypatch.setattr("app.services.payment_infrastructure._log_audit_entry", lambda **kwargs: None)
    service, repository, _ = build_service()

    created = service.create_order(
        {
            "purchase_type": "school_subscription",
            "provider_key": "razorpay",
            "school_id": SCHOOL_ID,
            "amount": 999,
            "plan_tier": "premium",
            "billing_cycle": "monthly",
        },
        actor_profile_id=PROFILE_ID,
        idempotency_key="create-school-sub",
    )

    verified = service.verify_payment(
        provider_key="razorpay",
        order_id=created["order_id"],
        provider_order_id=created["provider_order_id"],
        provider_payment_id="pay-1",
        signature="sig-1",
        actor_profile_id=PROFILE_ID,
        idempotency_key="verify-school-sub",
    )

    assert verified["status"] == "paid"
    assert verified["invoice_id"]
    assert repository.get_invoice(verified["invoice_id"])["invoice_status"] == "paid"
    assert service.subscription_service.activations[0]["payment_reference"] == "pay-1"


def test_duplicate_webhook_is_replay_safe(monkeypatch):
    monkeypatch.setattr("app.services.payment_infrastructure._log_audit_entry", lambda **kwargs: None)
    service, _, gateway = build_service()

    created = service.create_order(
        {
            "purchase_type": "school_subscription",
            "provider_key": "razorpay",
            "school_id": SCHOOL_ID,
            "amount": 799,
            "plan_tier": "standard",
            "billing_cycle": "monthly",
        },
        idempotency_key="webhook-order",
    )

    payload = {
        "event_key": "payment.success",
        "provider_event_id": "evt-1",
        "order_id": created["order_id"],
        "provider_order_id": created["provider_order_id"],
        "provider_payment_id": "pay-webhook-1",
    }
    body = json.dumps(payload).encode("utf-8")
    signature = hmac.new(gateway.webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

    first = service.handle_webhook(
        provider_key="razorpay",
        event_key="payment.success",
        provider_event_id="evt-1",
        payload=payload,
        raw_body=body,
        signature=signature,
    )
    second = service.handle_webhook(
        provider_key="razorpay",
        event_key="payment.success",
        provider_event_id="evt-1",
        payload=payload,
        raw_body=body,
        signature=signature,
    )

    assert first["replayed"] is False
    assert second["replayed"] is True


def test_refund_flow_marks_invoice_refunded(monkeypatch):
    monkeypatch.setattr("app.services.payment_infrastructure._log_audit_entry", lambda **kwargs: None)
    service, repository, gateway = build_service()

    created = service.create_order(
        {
            "purchase_type": "school_subscription",
            "provider_key": "razorpay",
            "school_id": SCHOOL_ID,
            "amount": 1299,
            "plan_tier": "premium",
            "billing_cycle": "yearly",
        },
        idempotency_key="refund-order",
    )
    verified = service.verify_payment(
        provider_key="razorpay",
        order_id=created["order_id"],
        provider_order_id=created["provider_order_id"],
        provider_payment_id="pay-refund-1",
        signature="sig-refund",
        idempotency_key="refund-verify",
    )
    refund = service.refund_payment(
        provider_key="razorpay",
        order_id=created["order_id"],
        reason="requested",
        idempotency_key="refund-order-1",
    )

    assert refund["status"] == "processed"
    assert gateway.refunds[0]["provider_refund_id"] == refund["provider_refund_id"]
    assert repository.get_invoice(verified["invoice_id"])["invoice_status"] == "refunded"


def test_ai_credit_purchase_credits_wallet(monkeypatch):
    monkeypatch.setattr("app.services.payment_infrastructure._log_audit_entry", lambda **kwargs: None)
    service, _, _ = build_service()

    created = service.create_order(
        {
            "purchase_type": "ai_credit_purchase",
            "provider_key": "razorpay",
            "school_id": SCHOOL_ID,
            "profile_id": PROFILE_ID,
            "ai_credits": 500,
            "amount": 399,
            "wallet_type": "personal",
        },
        idempotency_key="ai-credit-order",
    )
    verified = service.verify_payment(
        provider_key="razorpay",
        order_id=created["order_id"],
        provider_order_id=created["provider_order_id"],
        provider_payment_id="pay-credit-1",
        signature="sig-credit",
        idempotency_key="ai-credit-verify",
    )

    assert verified["status"] == "paid"
    assert service.ai_credit_service.credits[0]["amount"] == 500
    assert service.ai_credit_service.credits[0]["wallet_type"] == "personal"


def test_billing_routes_expose_payment_and_webhook_flow(monkeypatch):
    monkeypatch.setattr("app.services.payment_infrastructure._log_audit_entry", lambda **kwargs: None)
    service, _, gateway = build_service()
    monkeypatch.setattr(billing, "payment_service", service)

    app = FastAPI()
    app.include_router(billing.router)
    app.dependency_overrides[billing.get_authenticated_user] = lambda: auth_user()
    app.dependency_overrides[billing.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID, "school_id": SCHOOL_ID}
    app.dependency_overrides[billing.require_platform_admin] = lambda: auth_user()

    client = TestClient(app)
    create_response = client.post(
        "/api/billing/orders",
        json={
            "purchase_type": "external_student_subscription",
            "provider_key": "razorpay",
            "profile_id": PROFILE_ID,
            "amount": 499,
            "external_plan_key": "pro",
        },
        headers={"Idempotency-Key": "route-create"},
    )
    assert create_response.status_code == 200
    created = create_response.json()["data"]

    verify_response = client.post(
        "/api/billing/orders/verify",
        json={
            "provider_key": "razorpay",
            "order_id": created["order_id"],
            "provider_order_id": created["provider_order_id"],
            "provider_payment_id": "pay-route-1",
            "signature": "sig-route-1",
        },
        headers={"Idempotency-Key": "route-verify"},
    )
    assert verify_response.status_code == 200
    assert verify_response.json()["data"]["status"] == "paid"

    payload = {
        "event_key": "refund.processed",
        "provider_event_id": "evt-route-1",
        "refund_id": "missing-refund",
    }
    body = json.dumps(payload).encode("utf-8")
    signature = hmac.new(gateway.webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    webhook_response = client.post(
        "/api/billing/webhooks/razorpay",
        content=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )
    assert webhook_response.status_code == 200
    assert webhook_response.json()["data"]["status"] == "processed"
