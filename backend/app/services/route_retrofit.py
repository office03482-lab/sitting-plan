"""Shared Phase 4 route retrofit helpers."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from app.config import settings
from app.models import User
from app.services.ai_credit_engine import ai_credit_service
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.entitlement_engine import entitlement_engine, usage_counter_service


FEATURE_FLAG_MAP = {
    "ai": "enable_retrofit_ai",
    "tests": "enable_retrofit_tests",
    "lms": "enable_retrofit_lms",
    "storage": "enable_retrofit_storage",
    "analytics": "enable_retrofit_analytics",
}


@dataclass(slots=True)
class RetrofitReservation:
    enabled: bool
    school_id: str
    profile_id: str | None
    resource_key: str | None = None
    delta: int | float | Decimal = 0
    credit_feature: str | None = None
    credit_amount: int = 0
    reason: str | None = None
    bypassed: bool = False


def retrofit_enabled(flag_name: str) -> bool:
    setting_name = FEATURE_FLAG_MAP.get(flag_name, flag_name)
    return bool(getattr(settings, setting_name, False))


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _platform_admin_bypass(user: User | None) -> bool:
    return bool(user) and is_platform_admin_user(user)


def _structured_error(code: str, message: str, *, status_code: int = 403, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
            "details": details or {},
        },
    )


def _map_entitlement_error(result: Any) -> HTTPException:
    code = _normalize(getattr(result, "code", "")).upper()
    message = str(getattr(result, "message", "") or "Access denied")
    details = dict(getattr(result, "details", {}) or {})
    checks = dict(getattr(result, "checks", {}) or {})
    if code.startswith("PLAN_"):
        mapped = "SUBSCRIPTION_EXPIRED"
    elif code == "LIMIT_EXCEEDED":
        mapped = "PLAN_LIMIT_REACHED"
    elif code == "RESOURCE_KEY_REQUIRED":
        mapped = "FEATURE_NOT_INCLUDED"
    else:
        mapped = code or "FEATURE_NOT_INCLUDED"
    return _structured_error(
        mapped,
        message,
        status_code=int(getattr(result, "http_status", 403) or 403),
        details={"engine": details, "checks": checks},
    )


def _credit_error(message: str, *, details: dict[str, Any] | None = None) -> HTTPException:
    return _structured_error("INSUFFICIENT_CREDITS", message, status_code=402, details=details)


def prepare_route_retrofit(
    *,
    flag_name: str,
    user: User,
    actor: dict[str, Any],
    permission_key: str,
    school_id: str,
    resource_key: str | None = None,
    delta: int | float | Decimal = 0,
    credit_feature: str | None = None,
    credit_amount: int = 0,
    reason: str | None = None,
) -> RetrofitReservation:
    if not retrofit_enabled(flag_name):
        return RetrofitReservation(enabled=False, school_id=school_id, profile_id=_normalize(actor.get("profile_id")) or None)

    bypassed = _platform_admin_bypass(user)
    if not bypassed:
        result = entitlement_engine.combine_all(
            user,
            permission_key,
            school_id,
            resource_key=resource_key,
            delta=delta,
            actor=actor,
        )
        if not result.allowed:
            raise _map_entitlement_error(result)

        if credit_feature and credit_amount > 0:
            try:
                ai_credit_service.ensure_sufficient_credits(
                    _normalize(actor.get("profile_id")),
                    school_id,
                    credit_amount,
                )
            except HTTPException as exc:
                raise _credit_error(str(exc.detail), details={"feature": credit_feature, "amount": credit_amount}) from exc

    return RetrofitReservation(
        enabled=True,
        bypassed=bypassed,
        school_id=school_id,
        profile_id=_normalize(actor.get("profile_id")) or None,
        resource_key=resource_key,
        delta=delta,
        credit_feature=credit_feature,
        credit_amount=credit_amount,
        reason=reason,
    )


def commit_route_retrofit(reservation: RetrofitReservation) -> None:
    if not reservation.enabled or reservation.bypassed:
        return
    if reservation.resource_key and reservation.delta:
        usage_counter_service.increment(reservation.school_id, reservation.resource_key, reservation.delta)
    if reservation.credit_feature and reservation.credit_amount > 0 and reservation.profile_id:
        try:
            ai_credit_service.debit(
                reservation.profile_id,
                reservation.school_id,
                amount=reservation.credit_amount,
                feature=reservation.credit_feature,
                reason=reservation.reason,
                actor_profile_id=reservation.profile_id,
            )
        except HTTPException as exc:
            raise _credit_error(str(exc.detail), details={"feature": reservation.credit_feature, "amount": reservation.credit_amount}) from exc


def storage_delta_gb(byte_count: int) -> Decimal:
    bytes_value = max(0, int(byte_count))
    return (Decimal(bytes_value) / Decimal(1024 * 1024 * 1024)).quantize(Decimal("0.0001"))
