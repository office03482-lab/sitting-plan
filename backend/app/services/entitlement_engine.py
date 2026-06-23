"""Phase 2 entitlement engine implementation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import time
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status

from app.middleware.auth import (
    get_authenticated_actor_context,
    get_authenticated_user,
    user_has_permission,
)
from app.models import User
from app.schemas.subscription_entitlement import UsageSnapshotCreate, UsageSnapshotUpdate
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.scope_engine import build_scope_context, resolve_permission_scope
from app.services.subscription_engine import (
    PLAN_LIMIT_FIELDS,
    SchoolSubscriptionService,
    UsageSnapshotService,
    _latest_school_subscription,
    _normalize,
    _parse_date_value,
    _parse_datetime_value,
    _today,
)

PLAN_CACHE_TTL_SECONDS = 300
SUBSCRIPTION_CACHE_TTL_SECONDS = 60
USAGE_CACHE_TTL_SECONDS = 30
GRACE_PERIOD_DAYS = 7
DATA_RETENTION_DAYS = 30

RESOURCE_TO_USAGE_FIELD = {
    "students": "students_used",
    "students_used": "students_used",
    "teachers": "teachers_used",
    "teachers_used": "teachers_used",
    "parents": "parents_used",
    "parents_used": "parents_used",
    "storage": "storage_used",
    "storage_gb": "storage_used",
    "storage_used": "storage_used",
    "ai_credits": "ai_credits_used",
    "ai_credits_used": "ai_credits_used",
    "tests": "tests_used",
    "online_tests": "tests_used",
    "tests_used": "tests_used",
    "lms": "lms_usage",
    "lms_courses": "lms_usage",
    "lms_usage": "lms_usage",
}

USAGE_FIELD_DEFAULTS: dict[str, Any] = {
    "students_used": 0,
    "teachers_used": 0,
    "parents_used": 0,
    "storage_used": Decimal("0"),
    "ai_credits_used": 0,
    "tests_used": 0,
    "lms_usage": 0,
}

_PLAN_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SUBSCRIPTION_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_USAGE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_resource_key(resource_key: str | None) -> str:
    normalized = _normalize(resource_key).lower()
    return RESOURCE_TO_USAGE_FIELD.get(normalized, normalized)


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


def _serialize_scope_context(context: Any) -> dict[str, Any]:
    return {
        "permission_key": getattr(context, "permission_key", ""),
        "scope": getattr(context, "scope", ""),
        "role_key": getattr(context, "role_key", ""),
        "school_id": getattr(context, "school_id", ""),
        "profile_id": getattr(context, "profile_id", None),
        "email": getattr(context, "email", None),
        "name": getattr(context, "name", None),
        "staff_member_id": getattr(context, "staff_member_id", None),
        "staff_department": getattr(context, "staff_department", None),
        "student_ids": list(getattr(context, "student_ids", []) or []),
        "assigned_batches": list(getattr(context, "assigned_batches", []) or []),
        "is_school_wide": bool(getattr(context, "is_school_wide", False)),
    }


def _cache_get(cache: dict[str, tuple[float, dict[str, Any]]], key: str) -> dict[str, Any] | None:
    cached = cache.get(key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.monotonic():
        cache.pop(key, None)
        return None
    return dict(payload)


def _cache_set(cache: dict[str, tuple[float, dict[str, Any]]], key: str, payload: dict[str, Any], ttl_seconds: int) -> dict[str, Any]:
    stored = dict(payload)
    cache[key] = (time.monotonic() + ttl_seconds, stored)
    return dict(stored)


@dataclass(slots=True)
class EntitlementResult:
    allowed: bool
    code: str = ""
    message: str = ""
    http_status: int = 403
    details: dict[str, Any] = field(default_factory=dict)
    checks: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def allow(cls, *, details: dict[str, Any] | None = None, checks: dict[str, Any] | None = None) -> "EntitlementResult":
        return cls(allowed=True, details=details or {}, checks=checks or {})

    @classmethod
    def deny(
        cls,
        code: str,
        message: str,
        http_status: int = 403,
        *,
        details: dict[str, Any] | None = None,
        checks: dict[str, Any] | None = None,
    ) -> "EntitlementResult":
        return cls(
            allowed=False,
            code=code,
            message=message,
            http_status=http_status,
            details=details or {},
            checks=checks or {},
        )


class UsageCounterService:
    """Usage counter operations backed by daily usage snapshots."""

    def __init__(self, usage_snapshot_service: UsageSnapshotService | None = None) -> None:
        self.usage_snapshot_service = usage_snapshot_service or UsageSnapshotService()

    def _today_snapshot(self, school_id: str) -> Any:
        snapshot = self.usage_snapshot_service.get_snapshot_by_school_date(school_id, _today().isoformat())
        if snapshot:
            return snapshot
        return self.usage_snapshot_service.create_snapshot(
            UsageSnapshotCreate(
                school_id=school_id,
                snapshot_date=_today(),
            )
        )

    def _field_name(self, resource_key: str) -> str:
        normalized = _normalize_resource_key(resource_key)
        if normalized not in PLAN_LIMIT_FIELDS:
            raise HTTPException(status_code=400, detail=f"Unsupported entitlement resource: {resource_key}")
        return normalized

    def _current_value(self, snapshot: Any, field_name: str) -> Any:
        current = getattr(snapshot, field_name, USAGE_FIELD_DEFAULTS[field_name])
        if field_name == "storage_used":
            return _to_decimal(current)
        return _safe_int(current)

    def _write_value(self, school_id: str, field_name: str, next_value: Any) -> Any:
        snapshot = self._today_snapshot(school_id)
        payload_kwargs = {field_name: next_value}
        updated = self.usage_snapshot_service.update_snapshot(
            str(snapshot.id),
            UsageSnapshotUpdate(**payload_kwargs),
        )
        EntitlementEngine.invalidate_usage_cache(school_id, field_name)
        return updated or snapshot

    def increment(self, school_id: str, resource_key: str, delta: int | float | Decimal = 1) -> Any:
        field_name = self._field_name(resource_key)
        snapshot = self._today_snapshot(school_id)
        current = self._current_value(snapshot, field_name)
        amount = _to_decimal(delta) if field_name == "storage_used" else _safe_int(delta, 1)
        next_value = current + amount
        return self._write_value(school_id, field_name, next_value)

    def decrement(self, school_id: str, resource_key: str, delta: int | float | Decimal = 1) -> Any:
        field_name = self._field_name(resource_key)
        snapshot = self._today_snapshot(school_id)
        current = self._current_value(snapshot, field_name)
        amount = _to_decimal(delta) if field_name == "storage_used" else _safe_int(delta, 1)
        next_value = current - amount
        if field_name == "storage_used":
            next_value = max(Decimal("0"), _to_decimal(next_value))
        else:
            next_value = max(0, _safe_int(next_value))
        return self._write_value(school_id, field_name, next_value)

    def get_usage(self, school_id: str, resource_key: str) -> int | Decimal:
        field_name = self._field_name(resource_key)
        cached = _cache_get(_USAGE_CACHE, school_id)
        if cached and field_name in cached:
            return _to_decimal(cached[field_name]) if field_name == "storage_used" else _safe_int(cached[field_name])

        snapshot = self._today_snapshot(school_id)
        usage = self.get_all_usage(school_id, snapshot=snapshot)
        return usage[field_name]

    def get_all_usage(self, school_id: str, *, snapshot: Any | None = None) -> dict[str, int | Decimal]:
        cached = _cache_get(_USAGE_CACHE, school_id)
        if cached:
            return {
                key: (_to_decimal(value) if key == "storage_used" else _safe_int(value))
                for key, value in cached.items()
                if key in PLAN_LIMIT_FIELDS
            }

        snapshot = snapshot or self._today_snapshot(school_id)
        usage = {
            field_name: self._current_value(snapshot, field_name)
            for field_name in PLAN_LIMIT_FIELDS
        }
        _cache_set(
            _USAGE_CACHE,
            school_id,
            {
                key: str(value) if isinstance(value, Decimal) else value
                for key, value in usage.items()
            },
            USAGE_CACHE_TTL_SECONDS,
        )
        return usage

    def reset_usage(self, school_id: str, resource_key: str) -> Any:
        field_name = self._field_name(resource_key)
        return self._write_value(school_id, field_name, USAGE_FIELD_DEFAULTS[field_name])

    def reset_all_usage(self, school_id: str) -> Any:
        snapshot = self._today_snapshot(school_id)
        updated = self.usage_snapshot_service.update_snapshot(
            str(snapshot.id),
            UsageSnapshotUpdate(**USAGE_FIELD_DEFAULTS),
        )
        EntitlementEngine.invalidate_usage_cache(school_id)
        return updated or snapshot


class GracePeriodService:
    """Grace-period and hard-block status logic for school subscriptions."""

    def __init__(self, school_subscription_service: SchoolSubscriptionService | None = None) -> None:
        self.school_subscription_service = school_subscription_service or SchoolSubscriptionService()

    def _school_plan(self, school_id: str) -> dict[str, Any]:
        return self.school_subscription_service.get_school_plan(school_id)

    def _latest_subscription(self, school_id: str) -> dict[str, Any] | None:
        return _latest_school_subscription(school_id)

    def _expiry_date(self, school_id: str) -> date | None:
        subscription = self._latest_subscription(school_id)
        if subscription:
            expiry = _parse_date_value(subscription.get("expiry_date"))
            if expiry:
                return expiry
        plan = self._school_plan(school_id)
        return _parse_date_value(plan.get("effective_until"))

    def get_status(self, school_id: str) -> str:
        plan = self._school_plan(school_id)
        plan_tier = _normalize(plan.get("plan_tier")).lower()
        if plan_tier == "starter":
            return "active"

        status = _normalize(plan.get("subscription_status")).lower()
        if status == "trial":
            trial_ends_at = _parse_datetime_value(plan.get("trial_ends_at"))
            if trial_ends_at is None or trial_ends_at.date() >= _today():
                return "active"

        expiry_date = self._expiry_date(school_id)
        today = _today()
        if expiry_date and expiry_date < today:
            days_since_expiry = (today - expiry_date).days
            if days_since_expiry <= GRACE_PERIOD_DAYS:
                return "grace"
            return "expired"

        if status in {"active", "trial"}:
            return "active"
        return "expired"

    def days_until_hard_block(self, school_id: str) -> int:
        status = self.get_status(school_id)
        if status == "expired":
            return 0
        expiry_date = self._expiry_date(school_id)
        if status != "grace" or expiry_date is None:
            return GRACE_PERIOD_DAYS
        elapsed = (_today() - expiry_date).days
        return max(0, GRACE_PERIOD_DAYS - elapsed)

    def days_until_data_retention_end(self, school_id: str) -> int:
        expiry_date = self._expiry_date(school_id)
        if expiry_date is None:
            return DATA_RETENTION_DAYS
        elapsed = (_today() - expiry_date).days
        return max(0, DATA_RETENTION_DAYS - max(0, elapsed))

    def is_soft_blocked(self, school_id: str) -> bool:
        return self.get_status(school_id) == "grace"

    def is_hard_blocked(self, school_id: str) -> bool:
        return self.get_status(school_id) == "expired"


class EntitlementEngine:
    def __init__(
        self,
        *,
        school_subscription_service: SchoolSubscriptionService | None = None,
        usage_counter_service: UsageCounterService | None = None,
        grace_period_service: GracePeriodService | None = None,
    ) -> None:
        self.school_subscription_service = school_subscription_service or SchoolSubscriptionService()
        self.usage_counter_service = usage_counter_service or UsageCounterService()
        self.grace_period_service = grace_period_service or GracePeriodService(
            school_subscription_service=self.school_subscription_service
        )

    @staticmethod
    def invalidate_school_plan_cache(school_id: str | None = None) -> None:
        if school_id:
            _PLAN_CACHE.pop(school_id, None)
            return
        _PLAN_CACHE.clear()

    @staticmethod
    def invalidate_subscription_cache(school_id: str | None = None) -> None:
        if school_id:
            _SUBSCRIPTION_CACHE.pop(school_id, None)
            return
        _SUBSCRIPTION_CACHE.clear()

    @staticmethod
    def invalidate_usage_cache(school_id: str | None = None, resource_key: str | None = None) -> None:
        del resource_key
        if school_id:
            _USAGE_CACHE.pop(school_id, None)
            return
        _USAGE_CACHE.clear()

    @staticmethod
    def cache_status() -> dict[str, Any]:
        return {
            "school_plan_cache": {
                "status": "ok",
                "ttl_seconds": PLAN_CACHE_TTL_SECONDS,
                "entries": len(_PLAN_CACHE),
            },
            "subscription_cache": {
                "status": "ok",
                "ttl_seconds": SUBSCRIPTION_CACHE_TTL_SECONDS,
                "entries": len(_SUBSCRIPTION_CACHE),
            },
            "usage_cache": {
                "status": "ok",
                "ttl_seconds": USAGE_CACHE_TTL_SECONDS,
                "entries": len(_USAGE_CACHE),
            },
        }

    def _get_school_plan(self, school_id: str) -> dict[str, Any]:
        cached = _cache_get(_PLAN_CACHE, school_id)
        if cached:
            return cached
        payload = self.school_subscription_service.get_school_plan(school_id)
        return _cache_set(_PLAN_CACHE, school_id, payload, PLAN_CACHE_TTL_SECONDS)

    def _get_plan_limits(self, school_id: str) -> dict[str, Any]:
        plan = self._get_school_plan(school_id)
        return {
            "school_id": school_id,
            "plan_tier": plan.get("plan_tier"),
            "subscription_status": plan.get("subscription_status"),
            "limits": dict(plan.get("limits") or {}),
            "overrides": list(plan.get("overrides") or []),
        }

    def _get_latest_subscription(self, school_id: str) -> dict[str, Any] | None:
        cached = _cache_get(_SUBSCRIPTION_CACHE, school_id)
        if cached:
            payload = cached.get("subscription")
            return dict(payload) if isinstance(payload, dict) else None
        payload = _latest_school_subscription(school_id)
        _cache_set(
            _SUBSCRIPTION_CACHE,
            school_id,
            {"subscription": dict(payload) if payload else None},
            SUBSCRIPTION_CACHE_TTL_SECONDS,
        )
        return dict(payload) if payload else None

    def _resolve_subscription_state(self, school_id: str) -> dict[str, Any]:
        if not school_id:
            return {
                "status": "none",
                "reason": "missing_school_context",
                "plan_tier": "",
                "subscription": None,
                "is_soft_blocked": False,
                "is_hard_blocked": False,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": 0,
            }

        plan = self._get_school_plan(school_id)
        plan_tier = _normalize(plan.get("plan_tier")).lower()
        subscription_status = _normalize(plan.get("subscription_status")).lower()
        subscription = self._get_latest_subscription(school_id)

        if plan_tier == "starter":
            return {
                "status": "active",
                "reason": "starter_plan",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": False,
                "days_until_hard_block": GRACE_PERIOD_DAYS,
                "days_until_data_retention_end": DATA_RETENTION_DAYS,
            }

        trial_ends_at = _parse_datetime_value(plan.get("trial_ends_at"))
        if subscription_status == "trial" and (trial_ends_at is None or trial_ends_at.date() >= _today()):
            return {
                "status": "trial",
                "reason": "trial_active",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": False,
                "days_until_hard_block": GRACE_PERIOD_DAYS,
                "days_until_data_retention_end": DATA_RETENTION_DAYS,
            }

        if not subscription:
            return {
                "status": "none",
                "reason": "subscription_missing",
                "plan_tier": plan_tier,
                "subscription": None,
                "is_soft_blocked": False,
                "is_hard_blocked": True,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": 0,
            }

        raw_status = _normalize(subscription.get("subscription_status")).lower() or subscription_status or "none"
        expiry_date = _parse_date_value(subscription.get("expiry_date"))
        today = _today()
        if raw_status in {"active", "trial"} and expiry_date and expiry_date < today:
            days_since_expiry = (today - expiry_date).days
            if days_since_expiry <= GRACE_PERIOD_DAYS:
                return {
                    "status": "grace",
                    "reason": "within_grace_period",
                    "plan_tier": plan_tier,
                    "subscription": subscription,
                    "is_soft_blocked": True,
                    "is_hard_blocked": False,
                    "days_until_hard_block": max(0, GRACE_PERIOD_DAYS - days_since_expiry),
                    "days_until_data_retention_end": max(0, DATA_RETENTION_DAYS - days_since_expiry),
                }
            return {
                "status": "expired",
                "reason": "grace_period_elapsed",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": True,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": max(0, DATA_RETENTION_DAYS - days_since_expiry),
            }

        if raw_status == "paused":
            return {
                "status": "paused",
                "reason": "subscription_paused",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": True,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": DATA_RETENTION_DAYS,
            }
        if raw_status == "cancelled":
            return {
                "status": "cancelled",
                "reason": "subscription_cancelled",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": True,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": DATA_RETENTION_DAYS,
            }
        if raw_status == "expired":
            return {
                "status": "expired",
                "reason": "subscription_expired",
                "plan_tier": plan_tier,
                "subscription": subscription,
                "is_soft_blocked": False,
                "is_hard_blocked": True,
                "days_until_hard_block": 0,
                "days_until_data_retention_end": self.grace_period_service.days_until_data_retention_end(school_id),
            }

        return {
            "status": raw_status or "none",
            "reason": "subscription_active",
            "plan_tier": plan_tier,
            "subscription": subscription,
            "is_soft_blocked": False,
            "is_hard_blocked": False,
            "days_until_hard_block": GRACE_PERIOD_DAYS,
            "days_until_data_retention_end": DATA_RETENTION_DAYS,
        }

    def check_permission(self, user: Any, permission_key: str) -> EntitlementResult:
        normalized_permission = _normalize(permission_key).lower()
        if not normalized_permission:
            return EntitlementResult.deny(
                "PERMISSION_KEY_REQUIRED",
                "A permission key is required for entitlement evaluation.",
                http_status=status.HTTP_400_BAD_REQUEST,
            )
        if user_has_permission(user, normalized_permission):
            return EntitlementResult.allow(
                details={"permission_key": normalized_permission},
                checks={"permission": {"allowed": True, "permission_key": normalized_permission}},
            )
        return EntitlementResult.deny(
            "PERMISSION_DENIED",
            f"Missing required permission: {normalized_permission}",
            http_status=status.HTTP_403_FORBIDDEN,
            details={"permission_key": normalized_permission},
            checks={"permission": {"allowed": False, "permission_key": normalized_permission}},
        )

    def check_scope(
        self,
        user: Any,
        permission_key: str,
        *,
        school_id: str,
        actor: dict[str, Any] | None = None,
    ) -> EntitlementResult:
        scope = resolve_permission_scope(user, permission_key)
        normalized_school_id = _normalize(school_id)
        if scope != "platform" and not normalized_school_id:
            return EntitlementResult.deny(
                "SCOPE_DENIED",
                "School context is required for this permission scope.",
                http_status=status.HTTP_403_FORBIDDEN,
                details={"scope": scope, "permission_key": _normalize(permission_key).lower()},
                checks={"scope": {"allowed": False, "scope": scope}},
            )

        context = build_scope_context(
            user=user,
            actor=actor or {},
            school_id=normalized_school_id,
            permission_key=permission_key,
        )
        context_payload = _serialize_scope_context(context)
        return EntitlementResult.allow(
            details=context_payload,
            checks={"scope": {"allowed": True, **context_payload}},
        )

    def check_subscription(self, school_id: str, *, user: Any | None = None) -> EntitlementResult:
        if user is not None and is_platform_admin_user(user):
            return EntitlementResult.allow(
                details={"status": "bypassed", "reason": "platform_admin_bypass"},
                checks={"subscription": {"allowed": True, "bypassed": True}},
            )

        status_payload = self._resolve_subscription_state(school_id)
        state = status_payload["status"]
        if state in {"active", "trial", "grace"}:
            return EntitlementResult.allow(
                details=status_payload,
                checks={"subscription": {"allowed": True, **status_payload}},
            )
        return EntitlementResult.deny(
            f"PLAN_{state.upper()}",
            f"Subscription status '{state}' does not allow this action.",
            http_status=status.HTTP_402_PAYMENT_REQUIRED,
            details=status_payload,
            checks={"subscription": {"allowed": False, **status_payload}},
        )

    def check_entitlement(
        self,
        school_id: str,
        resource_key: str,
        delta: int | float | Decimal = 1,
        *,
        user: Any | None = None,
    ) -> EntitlementResult:
        normalized_field = _normalize_resource_key(resource_key)
        if not normalized_field or normalized_field not in PLAN_LIMIT_FIELDS:
            return EntitlementResult.deny(
                "RESOURCE_KEY_REQUIRED",
                "A supported entitlement resource key is required.",
                http_status=status.HTTP_400_BAD_REQUEST,
                details={"resource_key": resource_key},
            )

        if user is not None and is_platform_admin_user(user):
            return EntitlementResult.allow(
                details={"resource_key": normalized_field, "bypassed": True},
                checks={"entitlement": {"allowed": True, "bypassed": True, "resource_key": normalized_field}},
            )

        plan_limits = self._get_plan_limits(school_id)
        usage = self.usage_counter_service.get_usage(school_id, normalized_field)
        raw_limit = (plan_limits.get("limits") or {}).get(normalized_field)
        limit = _to_decimal(raw_limit)
        usage_value = _to_decimal(usage)
        requested_delta = _to_decimal(delta)

        details = {
            "resource_key": normalized_field,
            "current_usage": str(usage_value) if normalized_field == "storage_used" else int(usage_value),
            "maximum_allowed": str(limit) if normalized_field == "storage_used" else int(limit),
            "requested_delta": str(requested_delta) if normalized_field == "storage_used" else int(requested_delta),
            "remaining": str(limit - usage_value) if normalized_field == "storage_used" else int(limit - usage_value),
            "plan_tier": plan_limits.get("plan_tier"),
        }

        if limit < 0:
            return EntitlementResult.allow(
                details=details | {"remaining": "unlimited"},
                checks={"entitlement": {"allowed": True, **details, "remaining": "unlimited"}},
            )

        if usage_value + requested_delta > limit:
            return EntitlementResult.deny(
                "LIMIT_EXCEEDED",
                f"{normalized_field} limit of {limit} reached. Current: {usage_value}",
                http_status=status.HTTP_403_FORBIDDEN,
                details=details,
                checks={"entitlement": {"allowed": False, **details}},
            )

        return EntitlementResult.allow(
            details=details,
            checks={"entitlement": {"allowed": True, **details}},
        )

    def check_limits(self, school_id: str) -> EntitlementResult:
        plan_limits = self._get_plan_limits(school_id)
        usage = self.usage_counter_service.get_all_usage(school_id)
        resources: dict[str, Any] = {}
        for field_name in PLAN_LIMIT_FIELDS:
            raw_limit = (plan_limits.get("limits") or {}).get(field_name)
            limit = _to_decimal(raw_limit)
            current_usage = _to_decimal(usage.get(field_name, 0))
            resources[field_name] = {
                "current_usage": str(current_usage) if field_name == "storage_used" else int(current_usage),
                "maximum_allowed": str(limit) if field_name == "storage_used" else int(limit),
                "remaining": (
                    "unlimited"
                    if limit < 0
                    else (str(limit - current_usage) if field_name == "storage_used" else int(limit - current_usage))
                ),
            }
        details = {
            "school_id": school_id,
            "plan_tier": plan_limits.get("plan_tier"),
            "subscription_status": plan_limits.get("subscription_status"),
            "resources": resources,
        }
        return EntitlementResult.allow(details=details, checks={"limits": {"allowed": True, **details}})

    def combine_all(
        self,
        user: Any,
        permission_key: str,
        school_id: str,
        resource_key: str | None = None,
        delta: int | float | Decimal = 1,
        *,
        actor: dict[str, Any] | None = None,
    ) -> EntitlementResult:
        checks: dict[str, Any] = {}

        permission_result = self.check_permission(user, permission_key)
        checks.update(permission_result.checks)
        if not permission_result.allowed:
            return EntitlementResult.deny(
                permission_result.code,
                permission_result.message,
                permission_result.http_status,
                details=permission_result.details,
                checks=checks,
            )

        scope_result = self.check_scope(user, permission_key, school_id=school_id, actor=actor)
        checks.update(scope_result.checks)
        if not scope_result.allowed:
            return EntitlementResult.deny(
                scope_result.code,
                scope_result.message,
                scope_result.http_status,
                details=scope_result.details,
                checks=checks,
            )

        subscription_result = self.check_subscription(school_id, user=user)
        checks.update(subscription_result.checks)
        if not subscription_result.allowed:
            return EntitlementResult.deny(
                subscription_result.code,
                subscription_result.message,
                subscription_result.http_status,
                details=subscription_result.details,
                checks=checks,
            )

        if resource_key:
            entitlement_result = self.check_entitlement(school_id, resource_key, delta, user=user)
            checks.update(entitlement_result.checks)
            if not entitlement_result.allowed:
                return EntitlementResult.deny(
                    entitlement_result.code,
                    entitlement_result.message,
                    entitlement_result.http_status,
                    details=entitlement_result.details,
                    checks=checks,
                )

        return EntitlementResult.allow(
            details={
                "permission_key": _normalize(permission_key).lower(),
                "school_id": _normalize(school_id),
                "resource_key": _normalize_resource_key(resource_key) if resource_key else None,
                "requested_delta": str(_to_decimal(delta)) if resource_key == "storage_used" else delta,
            },
            checks=checks,
        )


usage_counter_service = UsageCounterService()
grace_period_service = GracePeriodService()
entitlement_engine = EntitlementEngine(
    usage_counter_service=usage_counter_service,
    grace_period_service=grace_period_service,
)


def require_entitlement(
    permission_key: str,
    resource_key: str | None = None,
    delta: int | float | Decimal = 1,
) -> Callable[..., Any]:
    def dependency(
        request: Request,
        user: User = Depends(get_authenticated_user),
        actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    ) -> User:
        if request.method == "OPTIONS":
            return user

        school_id = _normalize(actor.get("school_id") or getattr(user, "school_id", ""))
        result = entitlement_engine.combine_all(
            user,
            permission_key,
            school_id,
            resource_key=resource_key,
            delta=delta,
            actor=actor,
        )
        if not result.allowed:
            raise HTTPException(
                status_code=result.http_status,
                detail={
                    "code": result.code,
                    "message": result.message,
                    "details": result.details,
                    "checks": result.checks,
                },
            )
        return user

    return dependency
