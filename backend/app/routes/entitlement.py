from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_authenticated_user
from app.models import User
from app.services.entitlement_engine import entitlement_engine, grace_period_service

router = APIRouter(prefix="/api/entitlement", tags=["Entitlement"])


def require_platform_admin(user: User = Depends(get_authenticated_user)) -> User:
    if str(getattr(user, "role_key", "") or "").strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Only Platform Admin can access this section")
    return user


@router.get("/health")
def get_entitlement_health(
    school_id: str | None = Query(default=None),
    _: User = Depends(require_platform_admin),
) -> dict[str, Any]:
    subscription_status: dict[str, Any]
    if school_id:
        subscription_check = entitlement_engine.check_subscription(school_id)
        subscription_status = {
            "school_id": school_id,
            "allowed": subscription_check.allowed,
            "status": str(subscription_check.details.get("status") or ""),
            "plan_tier": subscription_check.details.get("plan_tier"),
            "reason": subscription_check.details.get("reason"),
            "is_soft_blocked": grace_period_service.is_soft_blocked(school_id),
            "is_hard_blocked": grace_period_service.is_hard_blocked(school_id),
            "days_until_hard_block": grace_period_service.days_until_hard_block(school_id),
            "days_until_data_retention_end": grace_period_service.days_until_data_retention_end(school_id),
        }
    else:
        subscription_status = {
            "status": "not_requested",
            "message": "Pass school_id to inspect a specific school's subscription state.",
        }

    return {
        "engine_status": {
            "status": "ok",
            "checks": ["permission", "scope", "subscription", "entitlement"],
        },
        "cache_status": entitlement_engine.cache_status(),
        "subscription_status": subscription_status,
    }
