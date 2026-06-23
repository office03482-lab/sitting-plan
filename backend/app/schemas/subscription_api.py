"""API schemas for Phase 1 subscription endpoints."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from app.models.subscription_entitlement import PlanTier


class PlatformSubscriptionActivateRequest(BaseModel):
    plan_tier: PlanTier
    billing_cycle: str = "monthly"


class PlatformSubscriptionChangeRequest(BaseModel):
    new_plan_tier: PlanTier
    effective_date: date | None = None
    billing_cycle: str = "monthly"
    reason: str | None = None


class PlatformSubscriptionCancelRequest(BaseModel):
    mode: str = "immediate"


class PlatformSubscriptionPauseRequest(BaseModel):
    pause_until: date


class PlatformSubscriptionResponse(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)
