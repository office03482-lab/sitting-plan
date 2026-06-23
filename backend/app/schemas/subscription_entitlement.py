"""Pydantic schemas for Phase 0 subscription, entitlement, and AI credit foundation."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.subscription_entitlement import (
    CreditLedgerTransactionType,
    CreditWalletType,
    PlanChangeRequestStatus,
    PlanTier,
    SubscriptionStatus,
)


class EntitlementRuleBase(BaseModel):
    plan_tier: PlanTier
    resource_key: str
    max_count: Decimal
    is_active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class EntitlementRuleCreate(EntitlementRuleBase):
    pass


class EntitlementRuleUpdate(BaseModel):
    max_count: Decimal | None = None
    is_active: bool | None = None
    metadata: dict[str, Any] | None = None


class EntitlementRuleResponse(EntitlementRuleBase):
    id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SchoolPlanBase(BaseModel):
    school_id: str
    plan_tier: PlanTier = PlanTier.STARTER
    subscription_status: SubscriptionStatus = SubscriptionStatus.ACTIVE
    student_limit: int = 100
    teacher_limit: int = 10
    parent_limit: int = 50
    storage_limit_gb: Decimal = Decimal("5")
    ai_credit_limit: int = 500
    test_limit: int = 20
    lms_limit: int = 10
    effective_from: date | None = None
    effective_until: date | None = None
    trial_ends_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SchoolPlanCreate(SchoolPlanBase):
    created_by: str | None = None


class SchoolPlanUpdate(BaseModel):
    plan_tier: PlanTier | None = None
    subscription_status: SubscriptionStatus | None = None
    student_limit: int | None = None
    teacher_limit: int | None = None
    parent_limit: int | None = None
    storage_limit_gb: Decimal | None = None
    ai_credit_limit: int | None = None
    test_limit: int | None = None
    lms_limit: int | None = None
    effective_from: date | None = None
    effective_until: date | None = None
    trial_ends_at: datetime | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] | None = None


class SchoolPlanResponse(SchoolPlanBase):
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PlanFeatureOverrideBase(BaseModel):
    school_id: str
    plan_tier: PlanTier
    resource_key: str
    override_max_count: Decimal
    reason: str | None = None
    is_active: bool = True
    effective_from: date | None = None
    effective_until: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlanFeatureOverrideCreate(PlanFeatureOverrideBase):
    created_by: str | None = None


class PlanFeatureOverrideUpdate(BaseModel):
    override_max_count: Decimal | None = None
    reason: str | None = None
    is_active: bool | None = None
    effective_from: date | None = None
    effective_until: date | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] | None = None


class PlanFeatureOverrideResponse(PlanFeatureOverrideBase):
    id: str
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UsageSnapshotBase(BaseModel):
    school_id: str
    snapshot_date: date
    students_used: int = 0
    teachers_used: int = 0
    parents_used: int = 0
    storage_used: Decimal = Decimal("0")
    ai_credits_used: int = 0
    tests_used: int = 0
    lms_usage: int = 0


class UsageSnapshotCreate(UsageSnapshotBase):
    created_by: str | None = None


class UsageSnapshotUpdate(BaseModel):
    students_used: int | None = None
    teachers_used: int | None = None
    parents_used: int | None = None
    storage_used: Decimal | None = None
    ai_credits_used: int | None = None
    tests_used: int | None = None
    lms_usage: int | None = None
    updated_by: str | None = None


class UsageSnapshotResponse(UsageSnapshotBase):
    id: str
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AICreditWalletBase(BaseModel):
    profile_id: str
    school_id: str
    wallet_type: CreditWalletType = CreditWalletType.SCHOOL
    version: int = 0
    balance: int = 0
    lifetime_used: int = 0
    lifetime_granted: int = 0
    expires_at: datetime | None = None
    is_frozen: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class AICreditWalletCreate(AICreditWalletBase):
    created_by: str | None = None


class AICreditWalletUpdate(BaseModel):
    version: int | None = None
    balance: int | None = None
    lifetime_used: int | None = None
    lifetime_granted: int | None = None
    expires_at: datetime | None = None
    is_frozen: bool | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] | None = None


class AICreditWalletResponse(AICreditWalletBase):
    id: str
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AICreditLedgerBase(BaseModel):
    wallet_id: str
    profile_id: str
    school_id: str
    transaction_type: CreditLedgerTransactionType
    amount: int
    balance_after: int
    feature: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AICreditLedgerCreate(AICreditLedgerBase):
    created_by: str | None = None


class AICreditLedgerResponse(AICreditLedgerBase):
    id: str
    created_by: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AICreditIdempotencyKeyBase(BaseModel):
    idempotency_key: str
    operation_key: str
    request_hash: str
    status: str = "completed"
    result_payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AICreditIdempotencyKeyCreate(AICreditIdempotencyKeyBase):
    pass


class AICreditIdempotencyKeyUpdate(BaseModel):
    status: str | None = None
    result_payload: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class AICreditIdempotencyKeyResponse(AICreditIdempotencyKeyBase):
    id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AICreditProductBase(BaseModel):
    product_key: str
    name: str
    credits: int
    price_inr: Decimal
    target_wallet_type: CreditWalletType = CreditWalletType.SCHOOL
    is_active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class AICreditProductCreate(AICreditProductBase):
    created_by: str | None = None


class AICreditProductUpdate(BaseModel):
    name: str | None = None
    credits: int | None = None
    price_inr: Decimal | None = None
    target_wallet_type: CreditWalletType | None = None
    is_active: bool | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] | None = None


class AICreditProductResponse(AICreditProductBase):
    id: str
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PlanChangeRequestBase(BaseModel):
    school_id: str
    current_plan_tier: PlanTier
    requested_plan_tier: PlanTier
    current_subscription_status: SubscriptionStatus
    request_status: PlanChangeRequestStatus = PlanChangeRequestStatus.PENDING
    effective_date: date | None = None
    reason: str | None = None
    review_notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlanChangeRequestCreate(PlanChangeRequestBase):
    requested_by: str | None = None


class PlanChangeRequestUpdate(BaseModel):
    request_status: PlanChangeRequestStatus | None = None
    effective_date: date | None = None
    review_notes: str | None = None
    reviewed_by: str | None = None
    metadata: dict[str, Any] | None = None


class PlanChangeRequestResponse(PlanChangeRequestBase):
    id: str
    requested_by: str | None = None
    reviewed_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
