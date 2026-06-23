"""API schemas for Phase 3 AI credit endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.models.subscription_entitlement import CreditWalletType


class AICreditAdjustmentRequest(BaseModel):
    profile_id: str
    school_id: str
    amount: int
    wallet_type: CreditWalletType = CreditWalletType.BONUS
    reason: str


class AICreditGrantRequest(BaseModel):
    profile_id: str
    school_id: str
    amount: int
    wallet_type: CreditWalletType = CreditWalletType.BONUS
    reason: str


class AICreditCostResponse(BaseModel):
    costs: dict[str, int]


class AICreditWalletResponse(BaseModel):
    data: dict[str, Any]


class AICreditLedgerListResponse(BaseModel):
    data: dict[str, Any]
