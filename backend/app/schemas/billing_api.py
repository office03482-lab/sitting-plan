"""Schemas for Phase 5 billing and payment infrastructure."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class BillingAddress(BaseModel):
    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str = "IN"


class PaymentOrderCreateRequest(BaseModel):
    purchase_type: Literal["school_subscription", "external_student_subscription", "ai_credit_purchase"]
    provider_key: str = "razorpay"
    school_id: str | None = None
    profile_id: str | None = None
    amount: float | None = None
    currency: str = "INR"
    tax_amount: float = 0
    billing_name: str | None = None
    billing_email: str | None = None
    billing_phone: str | None = None
    billing_address: BillingAddress = Field(default_factory=BillingAddress)
    gst_number: str | None = None
    plan_tier: str | None = None
    billing_cycle: str = "monthly"
    external_plan_key: str | None = None
    ai_credit_product_key: str | None = None
    ai_credits: int | None = None
    wallet_type: str = "personal"
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_purchase_shape(self):
        if self.purchase_type == "school_subscription":
            if not self.school_id or not self.plan_tier:
                raise ValueError("school_id and plan_tier are required for school subscriptions")
            if self.amount is None:
                raise ValueError("amount is required for school subscriptions")
        if self.purchase_type == "external_student_subscription":
            if not self.profile_id or not self.external_plan_key:
                raise ValueError("profile_id and external_plan_key are required for external student subscriptions")
            if self.amount is None:
                raise ValueError("amount is required for external student subscriptions")
        if self.purchase_type == "ai_credit_purchase":
            if not self.profile_id or not self.school_id:
                raise ValueError("profile_id and school_id are required for AI credit purchases")
            if not self.ai_credit_product_key and not self.ai_credits:
                raise ValueError("ai_credit_product_key or ai_credits is required for AI credit purchases")
            if self.amount is None and not self.ai_credit_product_key:
                raise ValueError("amount is required for custom AI credit purchases")
        return self


class PaymentOrderCreateResponse(BaseModel):
    data: dict[str, Any]


class PaymentVerifyRequest(BaseModel):
    provider_key: str = "razorpay"
    order_id: str
    provider_order_id: str
    provider_payment_id: str
    signature: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PaymentVerifyResponse(BaseModel):
    data: dict[str, Any]


class PaymentRefundRequest(BaseModel):
    provider_key: str = "razorpay"
    amount: float | None = None
    reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PaymentCancelRequest(BaseModel):
    provider_key: str = "razorpay"
    reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BillingInvoiceResponse(BaseModel):
    data: dict[str, Any]


class BillingWebhookResponse(BaseModel):
    data: dict[str, Any]
