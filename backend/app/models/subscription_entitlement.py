"""Domain models for Phase 0 subscription, entitlement, and AI credit foundation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any


class PlanTier(str, Enum):
    STARTER = "starter"
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    TRIAL = "trial"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class CreditWalletType(str, Enum):
    SCHOOL = "school"
    PERSONAL = "personal"
    BONUS = "bonus"


class CreditLedgerTransactionType(str, Enum):
    CREDIT = "credit"
    DEBIT = "debit"
    CONSUMPTION = "consumption"
    GRANT = "grant"
    PURCHASE = "purchase"
    REFUND = "refund"
    BONUS = "bonus"
    EXPIRY = "expiry"
    RESET = "reset"
    ADJUSTMENT = "adjustment"


class PlanChangeRequestStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    SCHEDULED = "scheduled"


@dataclass(slots=True, kw_only=True)
class EntitlementRuleModel:
    id: str | None = None
    plan_tier: PlanTier
    resource_key: str
    max_count: Decimal
    is_active: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class SchoolPlanModel:
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
    created_by: str | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class PlanFeatureOverrideModel:
    id: str | None = None
    school_id: str
    plan_tier: PlanTier
    resource_key: str
    override_max_count: Decimal
    reason: str | None = None
    is_active: bool = True
    effective_from: date | None = None
    effective_until: date | None = None
    created_by: str | None = None
    updated_by: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class UsageSnapshotModel:
    id: str | None = None
    school_id: str
    snapshot_date: date
    students_used: int = 0
    teachers_used: int = 0
    parents_used: int = 0
    storage_used: Decimal = Decimal("0")
    ai_credits_used: int = 0
    tests_used: int = 0
    lms_usage: int = 0
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class AICreditWalletModel:
    id: str | None = None
    profile_id: str
    school_id: str
    wallet_type: CreditWalletType = CreditWalletType.SCHOOL
    version: int = 0
    balance: int = 0
    lifetime_used: int = 0
    lifetime_granted: int = 0
    expires_at: datetime | None = None
    is_frozen: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class AICreditLedgerModel:
    id: str | None = None
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
    metadata: dict[str, Any] = field(default_factory=dict)
    created_by: str | None = None
    created_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class AICreditIdempotencyKeyModel:
    id: str | None = None
    idempotency_key: str
    operation_key: str
    request_hash: str
    status: str = "completed"
    result_payload: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class AICreditProductModel:
    id: str | None = None
    product_key: str
    name: str
    credits: int
    price_inr: Decimal
    target_wallet_type: CreditWalletType = CreditWalletType.SCHOOL
    is_active: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)
    created_by: str | None = None
    updated_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, kw_only=True)
class PlanChangeRequestModel:
    id: str | None = None
    school_id: str
    current_plan_tier: PlanTier
    requested_plan_tier: PlanTier
    current_subscription_status: SubscriptionStatus
    request_status: PlanChangeRequestStatus = PlanChangeRequestStatus.PENDING
    requested_by: str | None = None
    reviewed_by: str | None = None
    effective_date: date | None = None
    reason: str | None = None
    review_notes: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
