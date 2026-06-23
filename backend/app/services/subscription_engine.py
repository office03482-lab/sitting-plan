"""Phase 1 subscription engine services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from app.models.subscription_entitlement import PlanTier, SubscriptionStatus
from app.schemas.subscription_entitlement import (
    PlanChangeRequestCreate,
    PlanChangeRequestUpdate,
    SchoolPlanCreate,
    SchoolPlanUpdate,
    UsageSnapshotCreate,
    UsageSnapshotResponse,
    UsageSnapshotUpdate,
)
from app.services.subscription_foundation_repositories import (
    PlanChangeRequestRepository,
    PlanFeatureOverrideRepository,
    SchoolPlanRepository,
    UsageSnapshotRepository,
)
from app.services.supabase_admin import get_supabase_admin_client

MODULE_KEY = "subscription_engine"
FINANCE_SCHEMA = "finance"
RENEWAL_LOOKAHEAD_DAYS = 7

PLAN_LIMIT_FIELDS = {
    "students_used": "student_limit",
    "teachers_used": "teacher_limit",
    "parents_used": "parent_limit",
    "storage_used": "storage_limit_gb",
    "ai_credits_used": "ai_credit_limit",
    "tests_used": "test_limit",
    "lms_usage": "lms_limit",
}

FINANCE_PLAN_NAME_MAP = {
    PlanTier.BASIC: "Basic",
    PlanTier.STANDARD: "Basic",
    PlanTier.PREMIUM: "Premium",
    PlanTier.ENTERPRISE: "Enterprise",
}

EXTERNAL_PLAN_NAME_MAP = {
    "free": "Basic",
    "pro": "Premium",
    "elite": "Enterprise",
}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _finance_table(name: str):
    return _client().schema(FINANCE_SCHEMA).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return _utc_now().date()


def _today_iso() -> str:
    return _today().isoformat()


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _parse_date_value(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    normalized = _normalize(value)
    if not normalized:
        return None
    return date.fromisoformat(normalized[:10])


def _parse_datetime_value(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    normalized = _normalize(value)
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def _normalize_plan_tier(value: Any) -> PlanTier:
    if isinstance(value, PlanTier):
        return value
    normalized = _normalize(value).lower()
    try:
        return PlanTier(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Unsupported plan tier: {value}") from exc


def _normalize_subscription_status(value: Any) -> SubscriptionStatus:
    if isinstance(value, SubscriptionStatus):
        return value
    normalized = _normalize(value).lower()
    try:
        return SubscriptionStatus(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Unsupported subscription status: {value}") from exc


def _normalize_cancel_mode(mode: Any) -> str:
    normalized = _normalize(mode).lower().replace("-", "_")
    if normalized in {"immediate", "now"}:
        return "immediate"
    if normalized in {"end_of_cycle", "end_of_billing_cycle", "end_of_term"}:
        return "end_of_cycle"
    raise HTTPException(status_code=400, detail="Cancellation mode must be 'immediate' or 'end_of_cycle'")


def _normalize_billing_cycle(value: Any) -> str:
    normalized = _normalize(value).lower()
    if normalized in {"", "monthly"}:
        return "monthly"
    if normalized == "yearly":
        return "yearly"
    raise HTTPException(status_code=400, detail="Billing cycle must be 'monthly' or 'yearly'")


def _finance_plan_name(plan_tier: PlanTier) -> str | None:
    return FINANCE_PLAN_NAME_MAP.get(plan_tier)


def _is_paid_plan(plan_tier: PlanTier) -> bool:
    return plan_tier != PlanTier.STARTER


def _price_field(row: dict[str, Any]) -> Decimal:
    sale_price = row.get("sale_price")
    if sale_price is not None:
        return _to_decimal(sale_price)
    return _to_decimal(row.get("base_price"))


def _plan_duration_days(billing_cycle: str) -> int:
    return 365 if billing_cycle == "yearly" else 30


def _log_audit_entry(*, school_id: str | None, profile_id: str | None, action: str, payload: dict[str, Any] | None = None) -> None:
    _public_table("audit_logs").insert(
        {
            "school_id": school_id,
            "profile_id": profile_id,
            "action": action,
            "module_key": MODULE_KEY,
            "payload": payload or {},
        }
    ).execute()


def _latest_school_subscription(school_id: str) -> dict[str, Any] | None:
    rows = (
        _finance_table("subscriptions")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else None


def _list_school_subscriptions(school_id: str) -> list[dict[str, Any]]:
    rows = (
        _finance_table("subscriptions")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _find_school_subscription_by_id(subscription_id: str) -> dict[str, Any] | None:
    rows = (
        _finance_table("subscriptions")
        .select("*")
        .eq("id", subscription_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else None


def _list_active_school_subscriptions(school_id: str) -> list[dict[str, Any]]:
    return [
        row
        for row in _list_school_subscriptions(school_id)
        if _normalize(row.get("subscription_status")).lower() in {"active", "trial", "paused"}
    ]


def _update_school_subscription(subscription_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    rows = _finance_table("subscriptions").update(payload).eq("id", subscription_id).execute().data or []
    return dict(rows[0]) if rows else {}


def _ensure_school_plan_product(school_id: str, plan_tier: PlanTier, billing_cycle: str) -> dict[str, Any]:
    legacy_name = _finance_plan_name(plan_tier)
    if not legacy_name:
        raise HTTPException(status_code=400, detail="Starter plan does not require a paid subscription product")

    title = f"{plan_tier.value.replace('_', ' ').title()} School Plan"
    rows = (
        _finance_table("products")
        .select("*")
        .eq("school_id", school_id)
        .eq("product_type", "subscription_plan")
        .eq("title", title)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        return dict(rows[0])

    payload = {
        "school_id": school_id,
        "owner_scope": "school",
        "product_type": "subscription_plan",
        "category": "subscription_course",
        "title": title,
        "description": f"{plan_tier.value.title()} subscription plan managed by the subscription engine.",
        "pricing_model": billing_cycle,
        "access_tier": "subscription",
        "currency": "INR",
        "base_price": 0,
        "sale_price": 0,
        "billing_interval": billing_cycle,
        "metadata": {
            "plan_name": legacy_name,
            "school_plan_tier": plan_tier.value,
            "source": "subscription_engine",
        },
    }
    inserted = _finance_table("products").insert(payload).execute().data or []
    return dict(inserted[0]) if inserted else payload


def _ensure_external_plan_product(plan_key: str) -> dict[str, Any]:
    legacy_name = EXTERNAL_PLAN_NAME_MAP.get(plan_key)
    if not legacy_name:
        raise HTTPException(status_code=400, detail=f"Unsupported external student plan: {plan_key}")

    title = f"External Student {plan_key.title()} Plan"
    rows = (
        _finance_table("products")
        .select("*")
        .is_("school_id", "null")
        .eq("product_type", "subscription_plan")
        .eq("title", title)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        return dict(rows[0])

    payload = {
        "school_id": None,
        "owner_scope": "platform",
        "product_type": "subscription_plan",
        "category": "subscription_course",
        "title": title,
        "description": f"Platform-managed {plan_key} plan for external students.",
        "pricing_model": "monthly",
        "access_tier": "subscription",
        "currency": "INR",
        "base_price": 0,
        "sale_price": 0,
        "billing_interval": "monthly",
        "metadata": {
            "plan_name": legacy_name,
            "external_plan_key": plan_key,
            "source": "subscription_engine",
        },
    }
    inserted = _finance_table("products").insert(payload).execute().data or []
    return dict(inserted[0]) if inserted else payload


def _create_finance_subscription(
    *,
    school_id: str | None,
    profile_id: str | None,
    product: dict[str, Any],
    plan_name: str,
    provider_key: str,
    start_date: date,
    billing_cycle: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    expiry_date = start_date + timedelta(days=_plan_duration_days(billing_cycle))
    payload = {
        "school_id": school_id,
        "profile_id": profile_id,
        "student_id": None,
        "product_id": product.get("id"),
        "order_id": None,
        "provider_key": provider_key,
        "plan_name": plan_name,
        "subscription_status": "active",
        "start_date": start_date.isoformat(),
        "expiry_date": expiry_date.isoformat(),
        "renewal_date": expiry_date.isoformat(),
        "auto_renew": True,
        "renewal_count": 0,
        "amount": str(_price_field(product)),
        "currency": product.get("currency") or "INR",
        "metadata": metadata or {},
    }
    rows = _finance_table("subscriptions").insert(payload).execute().data or []
    return dict(rows[0]) if rows else payload


def _merge_metadata(row: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(row.get("metadata") or {})
    metadata.update(updates)
    return metadata


def _serialize_subscription(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "profile_id": row.get("profile_id"),
        "product_id": row.get("product_id"),
        "provider_key": row.get("provider_key"),
        "plan_name": row.get("plan_name"),
        "subscription_status": row.get("subscription_status"),
        "start_date": row.get("start_date"),
        "expiry_date": row.get("expiry_date"),
        "renewal_date": row.get("renewal_date"),
        "auto_renew": bool(row.get("auto_renew", False)),
        "renewal_count": _safe_int(row.get("renewal_count")),
        "amount": str(row.get("amount") or 0),
        "currency": row.get("currency"),
        "metadata": dict(row.get("metadata") or {}),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_plan_change_request(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "current_plan_tier": row.get("current_plan_tier"),
        "requested_plan_tier": row.get("requested_plan_tier"),
        "current_subscription_status": row.get("current_subscription_status"),
        "request_status": row.get("request_status"),
        "effective_date": row.get("effective_date"),
        "reason": row.get("reason"),
        "review_notes": row.get("review_notes"),
        "metadata": dict(row.get("metadata") or {}),
        "requested_by": row.get("requested_by"),
        "reviewed_by": row.get("reviewed_by"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


class SchoolSubscriptionService:
    def __init__(
        self,
        repository: SchoolPlanRepository | None = None,
        override_repository: PlanFeatureOverrideRepository | None = None,
        plan_change_service: "PlanChangeRequestService | None" = None,
    ) -> None:
        self.repository = repository or SchoolPlanRepository()
        self.override_repository = override_repository or PlanFeatureOverrideRepository()
        self._plan_change_service = plan_change_service

    def _ensure_school_plan(self, school_id: str) -> dict[str, Any]:
        current = self.repository.get_plan(school_id)
        if current:
            return current
        created = self.repository.create_plan(SchoolPlanCreate(school_id=school_id))
        return created or self.repository.get_plan(school_id) or {}

    def _rule_limits(self, plan_tier: PlanTier) -> dict[str, Decimal]:
        rows = (
            _public_table("entitlement_rule")
            .select("resource_key,max_count")
            .eq("plan_tier", plan_tier.value)
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
        return {str(row.get("resource_key")): _to_decimal(row.get("max_count")) for row in rows}

    def _base_limit_payload(self, plan_tier: PlanTier) -> dict[str, Any]:
        rules = self._rule_limits(plan_tier)
        return {
            "student_limit": _safe_int(rules.get("students_used"), 100),
            "teacher_limit": _safe_int(rules.get("teachers_used"), 10),
            "parent_limit": _safe_int(rules.get("parents_used"), 50),
            "storage_limit_gb": rules.get("storage_used", Decimal("5")),
            "ai_credit_limit": _safe_int(rules.get("ai_credits_used"), 500),
            "test_limit": _safe_int(rules.get("tests_used"), 20),
            "lms_limit": _safe_int(rules.get("lms_usage"), 10),
        }

    def list_plan_catalog(self) -> list[dict[str, Any]]:
        rows = (
            _public_table("entitlement_rule")
            .select("plan_tier,resource_key,max_count,is_active")
            .eq("is_active", True)
            .order("plan_tier")
            .order("resource_key")
            .execute()
            .data
            or []
        )
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            plan_tier = _normalize(row.get("plan_tier")).lower()
            if not plan_tier:
                continue
            item = grouped.setdefault(plan_tier, {"plan_tier": plan_tier, "limits": {}})
            resource_key = _normalize(row.get("resource_key"))
            if resource_key:
                value = _to_decimal(row.get("max_count"))
                item["limits"][resource_key] = str(value) if value != int(value) else int(value)
        return [grouped[key] for key in sorted(grouped.keys())]

    def get_plan_limits(self, school_id: str) -> dict[str, Any]:
        plan = self._ensure_school_plan(school_id)
        plan_tier = _normalize_plan_tier(plan.get("plan_tier") or PlanTier.STARTER.value)
        limits: dict[str, Any] = {
            "students_used": _safe_int(plan.get("student_limit"), 100),
            "teachers_used": _safe_int(plan.get("teacher_limit"), 10),
            "parents_used": _safe_int(plan.get("parent_limit"), 50),
            "storage_used": _to_decimal(plan.get("storage_limit_gb") or 5),
            "ai_credits_used": _safe_int(plan.get("ai_credit_limit"), 500),
            "tests_used": _safe_int(plan.get("test_limit"), 20),
            "lms_usage": _safe_int(plan.get("lms_limit"), 10),
        }
        overrides = self.override_repository.list_overrides(school_id)
        active_overrides: list[dict[str, Any]] = []
        for override in overrides:
            if not bool(override.get("is_active", True)):
                continue
            resource_key = _normalize(override.get("resource_key"))
            if resource_key:
                limits[resource_key] = _to_decimal(override.get("override_max_count"))
                active_overrides.append(
                    {
                        "id": override.get("id"),
                        "resource_key": resource_key,
                        "override_max_count": str(override.get("override_max_count")),
                        "reason": override.get("reason"),
                        "effective_from": override.get("effective_from"),
                        "effective_until": override.get("effective_until"),
                    }
                )
        return {
            "school_id": school_id,
            "plan_tier": plan_tier.value,
            "subscription_status": _normalize(plan.get("subscription_status") or SubscriptionStatus.ACTIVE.value).lower(),
            "limits": {key: (str(value) if isinstance(value, Decimal) else value) for key, value in limits.items()},
            "overrides": active_overrides,
        }

    def get_school_plan(self, school_id: str) -> dict[str, Any]:
        plan = self._ensure_school_plan(school_id)
        limits = self.get_plan_limits(school_id)
        subscription = _latest_school_subscription(school_id)
        return {
            "school_id": school_id,
            "plan_tier": plan.get("plan_tier") or PlanTier.STARTER.value,
            "subscription_status": plan.get("subscription_status") or SubscriptionStatus.ACTIVE.value,
            "effective_from": plan.get("effective_from"),
            "effective_until": plan.get("effective_until"),
            "trial_ends_at": plan.get("trial_ends_at"),
            "metadata": dict(plan.get("metadata") or {}),
            "limits": limits["limits"],
            "overrides": limits["overrides"],
            "subscription": _serialize_subscription(subscription),
            "created_at": plan.get("created_at"),
            "updated_at": plan.get("updated_at"),
        }

    def activate_plan(
        self,
        school_id: str,
        plan_tier: str,
        billing_cycle: str | None,
        *,
        actor_profile_id: str | None = None,
        provider_key: str = "razorpay",
        payment_reference: str | None = None,
    ) -> dict[str, Any]:
        normalized_plan = _normalize_plan_tier(plan_tier)
        normalized_cycle = _normalize_billing_cycle(billing_cycle)
        current = self._ensure_school_plan(school_id)

        for row in _list_active_school_subscriptions(school_id):
            _update_school_subscription(
                str(row.get("id")),
                {
                    "subscription_status": "cancelled",
                    "auto_renew": False,
                    "metadata": _merge_metadata(row, {"replaced_at": _utc_now().isoformat(), "replaced_by_tier": normalized_plan.value}),
                },
            )

        subscription = None
        if _is_paid_plan(normalized_plan):
            product = _ensure_school_plan_product(school_id, normalized_plan, normalized_cycle)
            subscription = _create_finance_subscription(
                school_id=school_id,
                profile_id=actor_profile_id,
                product=product,
                plan_name=_finance_plan_name(normalized_plan) or "Basic",
                provider_key=provider_key,
                start_date=_today(),
                billing_cycle=normalized_cycle,
                metadata={
                    "school_plan_tier": normalized_plan.value,
                    "billing_cycle": normalized_cycle,
                    "source": "manual_activation",
                    "previous_plan_tier": current.get("plan_tier"),
                    "payment_reference": payment_reference,
                },
            )

        limit_payload = self._base_limit_payload(normalized_plan)
        update_payload = SchoolPlanUpdate(
            plan_tier=normalized_plan,
            subscription_status=SubscriptionStatus.ACTIVE,
            effective_from=_today(),
            effective_until=None,
            updated_by=actor_profile_id,
            metadata={
                "billing_cycle": normalized_cycle,
                "activation_source": "platform_admin",
            },
            **limit_payload,
        )
        self.repository.update_plan(school_id, update_payload)
        result = self.get_school_plan(school_id)
        if subscription:
            result["subscription"] = _serialize_subscription(subscription)

        _log_audit_entry(
            school_id=school_id,
            profile_id=actor_profile_id,
            action="Subscription Activated",
            payload={"plan_tier": normalized_plan.value, "billing_cycle": normalized_cycle},
        )
        return result

    def change_plan(
        self,
        school_id: str,
        new_tier: str,
        effective_date: str | date | None = None,
        *,
        actor_profile_id: str | None = None,
        billing_cycle: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        normalized_plan = _normalize_plan_tier(new_tier)
        planned_date = _parse_date_value(effective_date)
        if planned_date and planned_date > _today():
            if self._plan_change_service is None:
                self._plan_change_service = PlanChangeRequestService(plan_repository=self.repository)
            request = self._plan_change_service.create_request(
                school_id=school_id,
                requested_plan_tier=normalized_plan.value,
                requested_by=actor_profile_id,
                effective_date=planned_date.isoformat(),
                reason=reason,
            )
            scheduled = self._plan_change_service.schedule_change(
                str(request.get("id")),
                planned_date.isoformat(),
                reviewed_by=actor_profile_id,
            )
            _log_audit_entry(
                school_id=school_id,
                profile_id=actor_profile_id,
                action="Subscription Changed",
                payload={"new_plan_tier": normalized_plan.value, "effective_date": planned_date.isoformat(), "mode": "scheduled"},
            )
            return {
                "mode": "scheduled",
                "request": scheduled,
                "school_plan": self.get_school_plan(school_id),
            }

        current = self._ensure_school_plan(school_id)
        previous_tier = current.get("plan_tier") or PlanTier.STARTER.value
        result = self.activate_plan(
            school_id,
            normalized_plan.value,
            billing_cycle or "monthly",
            actor_profile_id=actor_profile_id,
        )
        result["previous_plan_tier"] = previous_tier
        _log_audit_entry(
            school_id=school_id,
            profile_id=actor_profile_id,
            action="Subscription Changed",
            payload={"previous_plan_tier": previous_tier, "new_plan_tier": normalized_plan.value, "mode": "immediate"},
        )
        return result

    def cancel_plan(self, school_id: str, mode: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
        cancel_mode = _normalize_cancel_mode(mode)
        current = self._ensure_school_plan(school_id)
        active_subscriptions = _list_active_school_subscriptions(school_id)
        if cancel_mode == "immediate":
            for row in active_subscriptions:
                _update_school_subscription(
                    str(row.get("id")),
                    {
                        "subscription_status": "cancelled",
                        "auto_renew": False,
                        "expiry_date": _today_iso(),
                        "renewal_date": None,
                        "metadata": _merge_metadata(row, {"cancelled_mode": "immediate", "cancelled_at": _utc_now().isoformat()}),
                    },
                )
            self.repository.update_plan(
                school_id,
                SchoolPlanUpdate(
                    subscription_status=SubscriptionStatus.CANCELLED,
                    effective_until=_today(),
                    updated_by=actor_profile_id,
                    metadata={"cancel_mode": "immediate", "cancelled_from_plan_tier": current.get("plan_tier")},
                ),
            )
        else:
            latest = active_subscriptions[0] if active_subscriptions else _latest_school_subscription(school_id)
            if latest:
                _update_school_subscription(
                    str(latest.get("id")),
                    {
                        "auto_renew": False,
                        "metadata": _merge_metadata(latest, {"cancelled_mode": "end_of_cycle", "cancellation_requested_at": _utc_now().isoformat()}),
                    },
                )
            self.repository.update_plan(
                school_id,
                SchoolPlanUpdate(
                    updated_by=actor_profile_id,
                    metadata={"cancel_mode": "end_of_cycle", "cancellation_requested_at": _utc_now().isoformat()},
                ),
            )
        result = self.get_school_plan(school_id)
        _log_audit_entry(
            school_id=school_id,
            profile_id=actor_profile_id,
            action="Subscription Cancelled",
            payload={"mode": cancel_mode, "plan_tier": current.get("plan_tier")},
        )
        return result

    def pause_plan(self, school_id: str, pause_until: str | date | None, *, actor_profile_id: str | None = None) -> dict[str, Any]:
        pause_date = _parse_date_value(pause_until)
        if pause_date is None:
            raise HTTPException(status_code=400, detail="pause_until is required")
        if pause_date <= _today():
            raise HTTPException(status_code=400, detail="pause_until must be a future date")

        for row in _list_active_school_subscriptions(school_id):
            _update_school_subscription(
                str(row.get("id")),
                {
                    "subscription_status": "paused",
                    "renewal_date": pause_date.isoformat(),
                    "metadata": _merge_metadata(row, {"paused_until": pause_date.isoformat(), "paused_at": _utc_now().isoformat()}),
                },
            )
        self.repository.update_plan(
            school_id,
            SchoolPlanUpdate(
                subscription_status=SubscriptionStatus.PAUSED,
                updated_by=actor_profile_id,
                metadata={"paused_until": pause_date.isoformat()},
            ),
        )
        result = self.get_school_plan(school_id)
        _log_audit_entry(
            school_id=school_id,
            profile_id=actor_profile_id,
            action="Subscription Paused",
            payload={"pause_until": pause_date.isoformat()},
        )
        return result

    def resume_plan(self, school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
        rows = _list_school_subscriptions(school_id)
        for row in rows:
            if _normalize(row.get("subscription_status")).lower() == "paused":
                _update_school_subscription(
                    str(row.get("id")),
                    {
                        "subscription_status": "active",
                        "metadata": _merge_metadata(row, {"resumed_at": _utc_now().isoformat()}),
                    },
                )
        self.repository.update_plan(
            school_id,
            SchoolPlanUpdate(
                subscription_status=SubscriptionStatus.ACTIVE,
                updated_by=actor_profile_id,
                metadata={"resumed_at": _utc_now().isoformat()},
            ),
        )
        result = self.get_school_plan(school_id)
        _log_audit_entry(
            school_id=school_id,
            profile_id=actor_profile_id,
            action="Subscription Resumed",
            payload={"school_id": school_id},
        )
        return result


class PlanChangeRequestService:
    def __init__(
        self,
        repository: PlanChangeRequestRepository | None = None,
        plan_repository: SchoolPlanRepository | None = None,
    ) -> None:
        self.repository = repository or PlanChangeRequestRepository()
        self.plan_repository = plan_repository or SchoolPlanRepository()

    def create_request(
        self,
        school_id: str,
        requested_plan_tier: str,
        *,
        requested_by: str | None = None,
        effective_date: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        current = self.plan_repository.get_plan(school_id)
        if not current:
            raise HTTPException(status_code=404, detail="School plan not found")
        payload = PlanChangeRequestCreate(
            school_id=school_id,
            current_plan_tier=_normalize_plan_tier(current.get("plan_tier")),
            requested_plan_tier=_normalize_plan_tier(requested_plan_tier),
            current_subscription_status=_normalize_subscription_status(current.get("subscription_status")),
            request_status="scheduled" if effective_date and _parse_date_value(effective_date) and _parse_date_value(effective_date) > _today() else "pending",
            effective_date=_parse_date_value(effective_date),
            reason=reason,
            requested_by=requested_by,
            metadata={"source": "platform_admin"},
        )
        created = self.repository.create_request(payload)
        _log_audit_entry(
            school_id=school_id,
            profile_id=requested_by,
            action="Subscription Change Request Created",
            payload={"requested_plan_tier": _normalize_plan_tier(requested_plan_tier).value, "effective_date": effective_date},
        )
        return _serialize_plan_change_request(created) or {}

    def approve_request(self, request_id: str, *, reviewed_by: str | None = None, review_notes: str | None = None) -> dict[str, Any]:
        request = self.repository.get_request(request_id)
        if not request:
            raise HTTPException(status_code=404, detail="Plan change request not found")
        updated = self.repository.update_request(
            request_id,
            PlanChangeRequestUpdate(
                request_status="approved",
                reviewed_by=reviewed_by,
                review_notes=review_notes,
            ),
        )
        _log_audit_entry(
            school_id=request.get("school_id"),
            profile_id=reviewed_by,
            action="Subscription Change Request Approved",
            payload={"request_id": request_id},
        )
        return _serialize_plan_change_request(updated) or {}

    def reject_request(self, request_id: str, *, reviewed_by: str | None = None, review_notes: str | None = None) -> dict[str, Any]:
        request = self.repository.get_request(request_id)
        if not request:
            raise HTTPException(status_code=404, detail="Plan change request not found")
        updated = self.repository.update_request(
            request_id,
            PlanChangeRequestUpdate(
                request_status="rejected",
                reviewed_by=reviewed_by,
                review_notes=review_notes,
            ),
        )
        _log_audit_entry(
            school_id=request.get("school_id"),
            profile_id=reviewed_by,
            action="Subscription Change Request Rejected",
            payload={"request_id": request_id},
        )
        return _serialize_plan_change_request(updated) or {}

    def schedule_change(self, request_id: str, effective_date: str | date, *, reviewed_by: str | None = None) -> dict[str, Any]:
        request = self.repository.get_request(request_id)
        if not request:
            raise HTTPException(status_code=404, detail="Plan change request not found")
        effective = _parse_date_value(effective_date)
        if effective is None:
            raise HTTPException(status_code=400, detail="effective_date is required")
        updated = self.repository.update_request(
            request_id,
            PlanChangeRequestUpdate(
                request_status="scheduled",
                effective_date=effective,
                reviewed_by=reviewed_by,
            ),
        )
        _log_audit_entry(
            school_id=request.get("school_id"),
            profile_id=reviewed_by,
            action="Subscription Change Request Scheduled",
            payload={"request_id": request_id, "effective_date": effective.isoformat()},
        )
        return _serialize_plan_change_request(updated) or {}


class ExternalStudentPlanService:
    def get_current_plan(self, profile_id: str) -> dict[str, Any] | None:
        rows = (
            _finance_table("subscriptions")
            .select("*")
            .eq("profile_id", profile_id)
            .is_("school_id", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            return None
        row = dict(rows[0])
        metadata = dict(row.get("metadata") or {})
        return {
            "profile_id": profile_id,
            "plan_key": metadata.get("external_plan_key"),
            "subscription": _serialize_subscription(row),
        }

    def is_active(self, profile_id: str) -> bool:
        plan = self.get_current_plan(profile_id)
        if not plan or not plan.get("subscription"):
            return False
        status = _normalize(plan["subscription"].get("subscription_status")).lower()
        expiry_date = _parse_date_value(plan["subscription"].get("expiry_date"))
        return status in {"active", "trial"} and (expiry_date is None or expiry_date >= _today())

    def purchase_plan(
        self,
        profile_id: str,
        plan_key: str,
        *,
        school_id: str | None = None,
        provider_key: str = "razorpay",
        payment_reference: str | None = None,
    ) -> dict[str, Any]:
        normalized_key = _normalize(plan_key).lower()
        product = _ensure_external_plan_product(normalized_key)
        current = self.get_current_plan(profile_id)
        if current and current.get("subscription"):
            _update_school_subscription(
                str(current["subscription"].get("id")),
                {
                    "subscription_status": "cancelled",
                    "auto_renew": False,
                    "metadata": _merge_metadata(current["subscription"], {"replaced_at": _utc_now().isoformat(), "replacement_plan": normalized_key}),
                },
            )
        subscription = _create_finance_subscription(
            school_id=school_id,
            profile_id=profile_id,
            product=product,
            plan_name=EXTERNAL_PLAN_NAME_MAP[normalized_key],
            provider_key=provider_key,
            start_date=_today(),
            billing_cycle="monthly",
            metadata={
                "external_plan_key": normalized_key,
                "payment_reference": payment_reference,
                "source": "external_student_plan_service",
            },
        )
        return {
            "profile_id": profile_id,
            "plan_key": normalized_key,
            "subscription": _serialize_subscription(subscription),
        }

    def cancel_plan(self, profile_id: str) -> dict[str, Any] | None:
        current = self.get_current_plan(profile_id)
        if not current or not current.get("subscription"):
            return None
        updated = _update_school_subscription(
            str(current["subscription"].get("id")),
            {
                "subscription_status": "cancelled",
                "auto_renew": False,
                "metadata": _merge_metadata(current["subscription"], {"cancelled_at": _utc_now().isoformat()}),
            },
        )
        return {
            "profile_id": profile_id,
            "plan_key": dict(updated.get("metadata") or {}).get("external_plan_key"),
            "subscription": _serialize_subscription(updated),
        }


@dataclass(slots=True)
class PlanCronService:
    school_subscription_service: SchoolSubscriptionService
    plan_change_request_service: PlanChangeRequestService
    school_plan_repository: SchoolPlanRepository
    plan_change_repository: PlanChangeRequestRepository

    def process_expired_plans(self) -> dict[str, Any]:
        processed: list[str] = []
        for plan in self.school_plan_repository.list_plans():
            school_id = _normalize(plan.get("school_id"))
            if not school_id:
                continue
            latest = _latest_school_subscription(school_id)
            if not latest:
                continue
            expiry_date = _parse_date_value(latest.get("expiry_date"))
            status = _normalize(latest.get("subscription_status")).lower()
            if expiry_date and expiry_date < _today() and status in {"active", "trial", "paused"}:
                _update_school_subscription(str(latest.get("id")), {"subscription_status": "expired", "auto_renew": False})
                self.school_plan_repository.update_plan(
                    school_id,
                    SchoolPlanUpdate(
                        subscription_status=SubscriptionStatus.EXPIRED,
                        effective_until=expiry_date,
                        metadata={"expired_at": _utc_now().isoformat()},
                    ),
                )
                processed.append(school_id)
                _log_audit_entry(
                    school_id=school_id,
                    profile_id=None,
                    action="Subscription Expired",
                    payload={"subscription_id": latest.get("id"), "expiry_date": expiry_date.isoformat()},
                )
        return {"processed_schools": processed, "count": len(processed)}

    def process_scheduled_changes(self) -> dict[str, Any]:
        applied: list[str] = []
        for request in self.plan_change_repository.list_requests():
            if _normalize(request.get("request_status")).lower() != "scheduled":
                continue
            effective_date = _parse_date_value(request.get("effective_date"))
            if not effective_date or effective_date > _today():
                continue
            school_id = _normalize(request.get("school_id"))
            self.school_subscription_service.change_plan(
                school_id,
                _normalize(request.get("requested_plan_tier")),
                None,
                actor_profile_id=_normalize(request.get("reviewed_by")) or _normalize(request.get("requested_by")) or None,
            )
            self.plan_change_repository.update_request(
                str(request.get("id")),
                PlanChangeRequestUpdate(
                    request_status="approved",
                    review_notes=f"Applied on {_today_iso()}",
                    reviewed_by=_normalize(request.get("reviewed_by")) or _normalize(request.get("requested_by")) or None,
                ),
            )
            applied.append(str(request.get("id")))
        return {"applied_request_ids": applied, "count": len(applied)}

    def send_renewal_reminders(self) -> dict[str, Any]:
        reminders: list[dict[str, Any]] = []
        threshold = _today() + timedelta(days=RENEWAL_LOOKAHEAD_DAYS)
        rows = _finance_table("subscriptions").select("*").execute().data or []
        for row in rows:
            subscription = dict(row)
            status = _normalize(subscription.get("subscription_status")).lower()
            if status not in {"active", "trial"}:
                continue
            renewal_date = _parse_date_value(subscription.get("renewal_date") or subscription.get("expiry_date"))
            if renewal_date is None or renewal_date < _today() or renewal_date > threshold:
                continue
            reminder = {
                "subscription_id": subscription.get("id"),
                "school_id": subscription.get("school_id"),
                "profile_id": subscription.get("profile_id"),
                "renewal_date": renewal_date.isoformat(),
                "plan_name": subscription.get("plan_name"),
            }
            reminders.append(reminder)
            _log_audit_entry(
                school_id=_normalize(subscription.get("school_id")) or None,
                profile_id=_normalize(subscription.get("profile_id")) or None,
                action="Subscription Renewal Reminder",
                payload=reminder,
            )
        return {"reminders": reminders, "count": len(reminders)}


class UsageSnapshotService:
    """Phase 0 service with basic CRUD only."""

    def __init__(self, repository: UsageSnapshotRepository | None = None) -> None:
        self.repository = repository or UsageSnapshotRepository()

    def create_snapshot(self, payload: UsageSnapshotCreate) -> UsageSnapshotResponse:
        return self.repository.create_snapshot(payload)

    def get_snapshot(self, snapshot_id: str) -> UsageSnapshotResponse | None:
        return self.repository.get_snapshot(snapshot_id)

    def get_snapshot_by_school_date(self, school_id: str, snapshot_date: str) -> UsageSnapshotResponse | None:
        return self.repository.get_snapshot_by_school_date(school_id, snapshot_date)

    def list_snapshots(self, school_id: str, *, limit: int = 30) -> list[UsageSnapshotResponse]:
        return self.repository.list_snapshots(school_id, limit=limit)

    def update_snapshot(self, snapshot_id: str, payload: UsageSnapshotUpdate) -> UsageSnapshotResponse | None:
        return self.repository.update_snapshot(snapshot_id, payload)

    def delete_snapshot(self, snapshot_id: str) -> None:
        self.repository.delete_snapshot(snapshot_id)
