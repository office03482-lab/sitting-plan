"""Phase 3A AI credit engine hardening implementation."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.models.subscription_entitlement import CreditLedgerTransactionType, CreditWalletType
from app.services.entitlement_engine import UsageCounterService
from app.services.subscription_foundation_repositories import (
    AICreditLedgerRepository,
    AICreditProductRepository,
    AICreditWalletRepository,
)
from app.services.supabase_admin import get_supabase_admin_client

MODULE_KEY = "ai_credit_engine"
DEFAULT_BONUS_EXPIRY_DAYS = 90

DEFAULT_COST_REGISTRY = {
    "ai_chat": 1,
    "ai_test_generation": 5,
    "ai_study_plan": 3,
    "ai_evaluation": 2,
    "ai_analytics": 4,
    "ai_tutor_chat": 1,
    "test_generation": 5,
    "study_plan": 3,
    "student_analysis": 2,
    "report_card": 1,
    "doubt_solver": 1,
    "parent_ai_insights": 2,
    "ai_agent_execution": 5,
    "bulk_test_generation": 20,
}

TRANSACTION_TYPE_ALIASES = {
    "grant": CreditLedgerTransactionType.CREDIT.value,
    "purchase": CreditLedgerTransactionType.CREDIT.value,
    "consume": CreditLedgerTransactionType.DEBIT.value,
    "consumption": CreditLedgerTransactionType.DEBIT.value,
    "remove": CreditLedgerTransactionType.DEBIT.value,
}

WALLET_PRIORITY = (
    CreditWalletType.PERSONAL.value,
    CreditWalletType.SCHOOL.value,
    CreditWalletType.BONUS.value,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize(value: Any) -> str:
    if hasattr(value, "value"):
        value = getattr(value, "value")
    return str(value or "").strip()


def _normalize_wallet_type(value: Any) -> str:
    normalized = _normalize(value).lower() or CreditWalletType.SCHOOL.value
    allowed = {item.value for item in CreditWalletType}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported wallet type: {value}")
    return normalized


def _normalize_transaction_type(value: Any) -> str:
    normalized = _normalize(value).lower()
    normalized = TRANSACTION_TYPE_ALIASES.get(normalized, normalized)
    allowed = {item.value for item in CreditLedgerTransactionType}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported ledger transaction type: {value}")
    return normalized


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    normalized = _normalize(value)
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _log_audit_entry(*, school_id: str | None, profile_id: str | None, action: str, payload: dict[str, Any] | None = None) -> None:
    (
        get_supabase_admin_client()
        .table("audit_logs")
        .insert(
            {
                "school_id": school_id,
                "profile_id": profile_id,
                "action": action,
                "module_key": MODULE_KEY,
                "payload": payload or {},
            }
        )
        .execute()
    )


def _stable_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class AICreditService:
    def __init__(
        self,
        wallet_repository: AICreditWalletRepository | None = None,
        ledger_repository: AICreditLedgerRepository | None = None,
        product_repository: AICreditProductRepository | None = None,
        usage_counter_service: UsageCounterService | None = None,
        cost_registry: dict[str, int] | None = None,
    ) -> None:
        self.wallet_repository = wallet_repository or AICreditWalletRepository()
        self.ledger_repository = ledger_repository or AICreditLedgerRepository()
        self.product_repository = product_repository or AICreditProductRepository()
        self.usage_counter_service = usage_counter_service or UsageCounterService()
        self.cost_registry = {str(key).strip().lower(): int(value) for key, value in (cost_registry or DEFAULT_COST_REGISTRY).items()}

    def _wallets_for_context(self, profile_id: str, school_id: str) -> list[dict[str, Any]]:
        wallets = self.wallet_repository.list_wallets(school_id=school_id)
        return [dict(wallet) for wallet in wallets if _normalize(wallet.get("school_id")) == school_id]

    def _wallet_is_expired(self, wallet: dict[str, Any], *, now: datetime | None = None) -> bool:
        expires_at = _parse_datetime(wallet.get("expires_at"))
        current = now or _utc_now()
        return expires_at is not None and expires_at <= current

    def _active_wallet(self, wallet: dict[str, Any], *, now: datetime | None = None) -> bool:
        return not bool(wallet.get("is_frozen")) and not self._wallet_is_expired(wallet, now=now)

    def _find_wallet(
        self,
        *,
        profile_id: str,
        school_id: str,
        wallet_type: str,
        create_if_missing: bool = False,
    ) -> dict[str, Any] | None:
        normalized_type = _normalize_wallet_type(wallet_type)
        wallets = self._wallets_for_context(profile_id, school_id)
        for wallet in wallets:
            if _normalize(wallet.get("wallet_type")).lower() != normalized_type:
                continue
            if normalized_type in {CreditWalletType.PERSONAL.value, CreditWalletType.BONUS.value} and _normalize(wallet.get("profile_id")) != profile_id:
                continue
            return wallet
        if not create_if_missing:
            return None
        return None

    def _wallet_priority(self, profile_id: str, school_id: str) -> list[dict[str, Any]]:
        wallets = self._wallets_for_context(profile_id, school_id)
        current = _utc_now()
        ordered: list[dict[str, Any]] = []
        for wallet_type in WALLET_PRIORITY:
            candidates = [
                wallet
                for wallet in wallets
                if _normalize(wallet.get("wallet_type")).lower() == wallet_type
                and (
                    wallet_type == CreditWalletType.SCHOOL.value
                    or _normalize(wallet.get("profile_id")) == profile_id
                )
                and self._active_wallet(wallet, now=current)
            ]
            candidates.sort(key=lambda item: _safe_int(item.get("balance")), reverse=True)
            ordered.extend(candidates)
        return ordered

    def _request_hash(
        self,
        operation_key: str,
        payload: dict[str, Any],
    ) -> str:
        normalized_payload = {"operation_key": operation_key, **payload}
        return _stable_hash(normalized_payload)

    def _reference_fields(self, reference: dict[str, Any] | None) -> tuple[str | None, str | None]:
        ref = dict(reference or {})
        reference_type = _normalize(ref.get("reference_type")) or None
        reference_id = _normalize(ref.get("reference_id")) or None
        return reference_type, reference_id

    def _coerce_atomic_result(self, result: dict[str, Any] | None) -> dict[str, Any]:
        payload = dict(result or {})
        payload["idempotency_replayed"] = bool(payload.get("idempotency_replayed", False))
        return payload

    def set_cost(self, feature: str, credits: int) -> dict[str, int]:
        normalized_feature = _normalize(feature).lower()
        if not normalized_feature:
            raise HTTPException(status_code=400, detail="Feature key is required")
        if int(credits) < 0:
            raise HTTPException(status_code=400, detail="Credits must be zero or greater")
        self.cost_registry[normalized_feature] = int(credits)
        return dict(self.cost_registry)

    def get_costs(self) -> dict[str, int]:
        return dict(sorted(self.cost_registry.items()))

    def estimate_cost(self, feature: str, quantity: int = 1) -> int:
        normalized_feature = _normalize(feature).lower()
        if normalized_feature not in self.cost_registry:
            raise HTTPException(status_code=400, detail=f"Unknown AI feature cost: {feature}")
        return self.cost_registry[normalized_feature] * max(1, int(quantity))

    def check_balance(self, profile_id: str, school_id: str) -> dict[str, Any]:
        return self.get_balance(profile_id, school_id)

    def ensure_sufficient_balance(self, profile_id: str, school_id: str, amount: int) -> dict[str, Any]:
        return self.ensure_sufficient_credits(profile_id, school_id, amount)

    def ensure_sufficient_credits(self, profile_id: str, school_id: str, amount: int) -> dict[str, Any]:
        summary = self.get_balance(profile_id, school_id)
        if int(summary["total_balance"]) < int(amount):
            raise HTTPException(status_code=402, detail="Insufficient AI credits")
        return summary

    def check_affordability(self, profile_id: str, school_id: str, feature: str, quantity: int = 1) -> dict[str, Any]:
        estimated_cost = self.estimate_cost(feature, quantity)
        balance = self.get_balance(profile_id, school_id)
        total_balance = int(balance["total_balance"])
        return {
            "profile_id": profile_id,
            "school_id": school_id,
            "feature": _normalize(feature).lower(),
            "quantity": max(1, int(quantity)),
            "estimated_cost": estimated_cost,
            "current_balance": total_balance,
            "affordable": total_balance >= estimated_cost,
            "shortfall": max(0, estimated_cost - total_balance),
        }

    def get_balance(self, profile_id: str, school_id: str) -> dict[str, Any]:
        wallets = self._wallet_priority(profile_id, school_id)
        summary_wallets: list[dict[str, Any]] = []
        total_balance = 0
        for wallet in wallets:
            balance = _safe_int(wallet.get("balance"))
            total_balance += balance
            summary_wallets.append(
                {
                    "id": wallet.get("id"),
                    "profile_id": wallet.get("profile_id"),
                    "school_id": wallet.get("school_id"),
                    "wallet_type": wallet.get("wallet_type"),
                    "version": _safe_int(wallet.get("version")),
                    "balance": balance,
                    "lifetime_used": _safe_int(wallet.get("lifetime_used")),
                    "lifetime_granted": _safe_int(wallet.get("lifetime_granted")),
                    "expires_at": wallet.get("expires_at"),
                    "is_frozen": bool(wallet.get("is_frozen", False)),
                    "metadata": dict(wallet.get("metadata") or {}),
                }
            )
        return {
            "profile_id": profile_id,
            "school_id": school_id,
            "total_balance": total_balance,
            "wallets": summary_wallets,
        }

    def get_ledger(self, profile_id: str, school_id: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        entries = self.ledger_repository.list_entries(
            school_id=school_id,
            profile_id=profile_id,
            limit=limit,
            offset=offset,
        )
        return {
            "profile_id": profile_id,
            "school_id": school_id,
            "items": [dict(entry) for entry in entries],
            "limit": limit,
            "offset": offset,
            "count": len(entries),
        }

    def credit(
        self,
        profile_id: str,
        school_id: str,
        amount: int,
        *,
        wallet_type: str = CreditWalletType.BONUS.value,
        reason: str | None = None,
        reference: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        expires_at: datetime | None = None,
        transaction_type: str = CreditLedgerTransactionType.CREDIT.value,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        credits = _safe_int(amount)
        if credits <= 0:
            raise HTTPException(status_code=400, detail="Credit amount must be greater than zero")
        normalized_type = _normalize_wallet_type(wallet_type)
        normalized_tx = _normalize_transaction_type(transaction_type)
        expiry_value = expires_at
        if normalized_type == CreditWalletType.BONUS.value and expiry_value is None:
            expiry_value = _utc_now() + timedelta(days=DEFAULT_BONUS_EXPIRY_DAYS)
        reference_type, reference_id = self._reference_fields(reference)
        request_hash = self._request_hash(
            "credit",
            {
                "profile_id": profile_id,
                "school_id": school_id,
                "wallet_type": normalized_type,
                "amount": credits,
                "transaction_type": normalized_tx,
                "reason": reason,
                "reference_type": reference_type,
                "reference_id": reference_id,
                # Keep idempotency stable when bonus expiry is server-generated.
                "expires_at": expires_at.isoformat() if expires_at else None,
                "metadata": metadata or {},
            },
        )
        result = self._coerce_atomic_result(
            self.wallet_repository.apply_wallet_change_atomic(
                profile_id=profile_id,
                school_id=school_id,
                wallet_type=normalized_type,
                delta=credits,
                transaction_type=normalized_tx,
                reference_type=reference_type,
                reference_id=reference_id,
                description=reason,
                actor_profile_id=actor_profile_id,
                expires_at=expiry_value.isoformat() if expiry_value else None,
                metadata=metadata or {},
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                allow_create=True,
            )
        )
        if not result.get("idempotency_replayed"):
            _log_audit_entry(
                school_id=school_id,
                profile_id=actor_profile_id or profile_id,
                action="AI Credits Credited" if normalized_type != CreditWalletType.BONUS.value else "AI Credits Granted",
                payload={
                    "target_profile_id": profile_id,
                    "wallet_type": normalized_type,
                    "amount": credits,
                    "ledger_id": dict(result.get("ledger") or {}).get("id"),
                    "reason": reason,
                    "idempotency_key": idempotency_key,
                },
            )
        return {
            "profile_id": profile_id,
            "school_id": school_id,
            "wallet": dict(result.get("wallet") or {}),
            "ledger": dict(result.get("ledger") or {}),
            "idempotency_replayed": bool(result.get("idempotency_replayed")),
            "total_balance": self.get_balance(profile_id, school_id)["total_balance"],
        }

    def debit(
        self,
        profile_id: str,
        school_id: str,
        amount: int | None = None,
        *,
        feature: str | None = None,
        quantity: int = 1,
        reason: str | None = None,
        reference: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        transaction_type: str = CreditLedgerTransactionType.DEBIT.value,
        wallet_type: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        credits = _safe_int(amount) if amount is not None else self.estimate_cost(feature or "", quantity)
        if credits <= 0:
            raise HTTPException(status_code=400, detail="Debit amount must be greater than zero")
        normalized_tx = _normalize_transaction_type(transaction_type)
        normalized_wallet_type = _normalize_wallet_type(wallet_type) if wallet_type else None
        reference_type, reference_id = self._reference_fields(reference)
        request_hash = self._request_hash(
            "debit",
            {
                "profile_id": profile_id,
                "school_id": school_id,
                "amount": credits,
                "feature": feature,
                "quantity": quantity,
                "reason": reason,
                "transaction_type": normalized_tx,
                "wallet_type": normalized_wallet_type,
                "reference_type": reference_type,
                "reference_id": reference_id,
                "metadata": {},
            },
        )
        result = self._coerce_atomic_result(
            self.wallet_repository.debit_atomic(
                profile_id=profile_id,
                school_id=school_id,
                amount=credits,
                transaction_type=normalized_tx,
                feature=feature,
                wallet_type=normalized_wallet_type,
                reference_type=reference_type,
                reference_id=reference_id,
                description=reason,
                actor_profile_id=actor_profile_id,
                metadata={},
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
        )
        if normalized_tx in {CreditLedgerTransactionType.DEBIT.value, CreditLedgerTransactionType.CONSUMPTION.value} and not result.get("idempotency_replayed"):
            self.usage_counter_service.increment(school_id, "ai_credits", credits)
        if not result.get("idempotency_replayed"):
            _log_audit_entry(
                school_id=school_id,
                profile_id=actor_profile_id or profile_id,
                action="AI Credits Debited",
                payload={
                    "target_profile_id": profile_id,
                    "amount": credits,
                    "feature": feature,
                    "ledger_ids": [dict(item.get("ledger") or {}).get("id") for item in list(result.get("wallet_updates") or [])],
                    "reason": reason,
                    "idempotency_key": idempotency_key,
                },
            )
        return {
            "profile_id": profile_id,
            "school_id": school_id,
            "amount": credits,
            "wallet_updates": [dict(item) for item in list(result.get("wallet_updates") or [])],
            "idempotency_replayed": bool(result.get("idempotency_replayed")),
            "total_balance": self.get_balance(profile_id, school_id)["total_balance"],
        }

    def refund(
        self,
        profile_id: str,
        school_id: str,
        *,
        ledger_id: str | None = None,
        amount: int | None = None,
        reason: str | None = None,
        reference: dict[str, Any] | None = None,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        original_entry = None
        refund_amount = _safe_int(amount)
        wallet_type = CreditWalletType.BONUS.value
        feature = None
        if ledger_id:
            original_entry = self.ledger_repository.get_entry(ledger_id)
            if not original_entry:
                raise HTTPException(status_code=404, detail="Original ledger entry not found")
            feature = _normalize(original_entry.get("feature")) or None
            original_amount = _safe_int(original_entry.get("amount"))
            refund_amount = abs(original_amount) if refund_amount <= 0 else refund_amount
            source_wallet = self.wallet_repository.get_wallet(str(original_entry.get("wallet_id") or ""))
            if source_wallet:
                wallet_type = _normalize(source_wallet.get("wallet_type")).lower() or wallet_type
        if refund_amount <= 0:
            raise HTTPException(status_code=400, detail="Refund amount must be greater than zero")

        result = self.credit(
            profile_id,
            school_id,
            refund_amount,
            wallet_type=wallet_type,
            reason=reason or "AI credit refund",
            reference=(reference or {})
            | {
                "reference_type": _normalize((reference or {}).get("reference_type")) or "refund",
                "reference_id": _normalize((reference or {}).get("reference_id")) or _normalize(ledger_id),
            },
            actor_profile_id=actor_profile_id,
            transaction_type=CreditLedgerTransactionType.REFUND.value,
            metadata={"original_ledger_id": _normalize(ledger_id) or None},
            idempotency_key=idempotency_key,
        )
        if original_entry and _safe_int(original_entry.get("amount")) < 0 and not result.get("idempotency_replayed"):
            self.usage_counter_service.decrement(school_id, "ai_credits", refund_amount)
        if not result.get("idempotency_replayed"):
            _log_audit_entry(
                school_id=school_id,
                profile_id=actor_profile_id or profile_id,
                action="AI Credits Refunded",
                payload={
                    "target_profile_id": profile_id,
                    "amount": refund_amount,
                    "original_ledger_id": _normalize(ledger_id) or None,
                    "feature": feature,
                    "idempotency_key": idempotency_key,
                },
            )
        return result

    def expire(
        self,
        *,
        wallet_id: str | None = None,
        school_id: str | None = None,
        actor_profile_id: str | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        current = now or _utc_now()
        wallets: list[dict[str, Any]]
        if wallet_id:
            wallet = self.wallet_repository.get_wallet(wallet_id)
            wallets = [wallet] if wallet else []
        elif school_id:
            wallets = self.wallet_repository.list_wallets(school_id=school_id)
        else:
            wallets = self.wallet_repository.list_wallets()

        expired: list[dict[str, Any]] = []
        for wallet in wallets:
            if not wallet or not self._wallet_is_expired(wallet, now=current):
                continue
            balance = _safe_int(wallet.get("balance"))
            if balance <= 0:
                continue
            expiry_key = f"expiry:{_normalize(wallet.get('id'))}:{current.date().isoformat()}"
            result = self._coerce_atomic_result(
                self.wallet_repository.apply_wallet_change_atomic(
                    profile_id=_normalize(wallet.get("profile_id")),
                    school_id=_normalize(wallet.get("school_id")),
                    wallet_type=_normalize(wallet.get("wallet_type")),
                    delta=-balance,
                    transaction_type=CreditLedgerTransactionType.EXPIRY.value,
                    description="AI credits expired",
                    actor_profile_id=actor_profile_id,
                    metadata={"expired_at": current.isoformat()},
                    idempotency_key=expiry_key,
                    request_hash=self._request_hash(
                        "expire",
                        {
                            "wallet_id": _normalize(wallet.get("id")),
                            "balance": balance,
                            "expired_at": current.date().isoformat(),
                        },
                    ),
                    allow_create=False,
                )
            )
            expired.append(
                {
                    "wallet": dict(result.get("wallet") or {}),
                    "ledger": dict(result.get("ledger") or {}),
                    "expired_amount": balance,
                    "idempotency_replayed": bool(result.get("idempotency_replayed")),
                }
            )
            if not result.get("idempotency_replayed"):
                _log_audit_entry(
                    school_id=_normalize(wallet.get("school_id")) or None,
                    profile_id=actor_profile_id or _normalize(wallet.get("profile_id")) or None,
                    action="AI Credits Expired",
                    payload={
                        "wallet_id": wallet.get("id"),
                        "expired_amount": balance,
                    },
                )
        return {"count": len(expired), "items": expired}

    def grant_bonus(
        self,
        profile_id: str,
        school_id: str,
        amount: int,
        *,
        reason: str,
        actor_profile_id: str | None = None,
        expires_at: datetime | None = None,
        reference: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return self.credit(
            profile_id,
            school_id,
            amount,
            wallet_type=CreditWalletType.BONUS.value,
            reason=reason,
            reference=reference,
            actor_profile_id=actor_profile_id,
            expires_at=expires_at,
            transaction_type=CreditLedgerTransactionType.BONUS.value,
            metadata=metadata,
            idempotency_key=idempotency_key,
        )

    def transfer(
        self,
        *,
        from_profile_id: str,
        from_school_id: str,
        to_profile_id: str,
        to_school_id: str,
        amount: int,
        from_wallet_type: str = CreditWalletType.BONUS.value,
        to_wallet_type: str = CreditWalletType.BONUS.value,
        reason: str | None = None,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        credits = _safe_int(amount)
        if credits <= 0:
            raise HTTPException(status_code=400, detail="Transfer amount must be greater than zero")
        request_hash = self._request_hash(
            "transfer",
            {
                "from_profile_id": from_profile_id,
                "from_school_id": from_school_id,
                "from_wallet_type": _normalize_wallet_type(from_wallet_type),
                "to_profile_id": to_profile_id,
                "to_school_id": to_school_id,
                "to_wallet_type": _normalize_wallet_type(to_wallet_type),
                "amount": credits,
                "reason": reason,
            },
        )
        result = self._coerce_atomic_result(
            self.wallet_repository.transfer_atomic(
                from_profile_id=from_profile_id,
                from_school_id=from_school_id,
                from_wallet_type=_normalize_wallet_type(from_wallet_type),
                to_profile_id=to_profile_id,
                to_school_id=to_school_id,
                to_wallet_type=_normalize_wallet_type(to_wallet_type),
                amount=credits,
                actor_profile_id=actor_profile_id,
                description=reason,
                metadata={},
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
        )
        if not result.get("idempotency_replayed"):
            _log_audit_entry(
                school_id=to_school_id,
                profile_id=actor_profile_id or to_profile_id,
                action="AI Credits Transferred",
                payload={
                    "from_profile_id": from_profile_id,
                    "to_profile_id": to_profile_id,
                    "amount": credits,
                    "source_ledger_id": dict(dict(result.get("source") or {}).get("ledger") or {}).get("id"),
                    "target_ledger_id": dict(dict(result.get("target") or {}).get("ledger") or {}).get("id"),
                    "idempotency_key": idempotency_key,
                },
            )
        return {
            "amount": credits,
            "source": dict(result.get("source") or {}),
            "target": dict(result.get("target") or {}),
            "idempotency_replayed": bool(result.get("idempotency_replayed")),
        }

    def adjust_balance(
        self,
        *,
        profile_id: str,
        school_id: str,
        amount: int,
        wallet_type: str = CreditWalletType.BONUS.value,
        reason: str,
        actor_profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if amount >= 0:
            return self.credit(
                profile_id,
                school_id,
                amount,
                wallet_type=wallet_type,
                reason=reason,
                actor_profile_id=actor_profile_id,
                transaction_type=CreditLedgerTransactionType.ADJUSTMENT.value,
                idempotency_key=idempotency_key,
            )
        return self.debit(
            profile_id,
            school_id,
            abs(amount),
            reason=reason,
            actor_profile_id=actor_profile_id,
            transaction_type=CreditLedgerTransactionType.ADJUSTMENT.value,
            wallet_type=wallet_type,
            idempotency_key=idempotency_key,
        )

    def verify_ledger_integrity(self, *, profile_id: str | None = None, school_id: str | None = None) -> dict[str, Any]:
        wallets = self.wallet_repository.list_wallets(school_id=school_id, profile_id=profile_id)
        results: list[dict[str, Any]] = []
        overall_consistent = True
        for wallet in wallets:
            entries = self.ledger_repository.list_entries_for_wallet(str(wallet.get("id") or ""))
            ledger_balance = sum(_safe_int(entry.get("amount")) for entry in entries)
            wallet_balance = _safe_int(wallet.get("balance"))
            consistent = wallet_balance == ledger_balance
            overall_consistent = overall_consistent and consistent
            results.append(
                {
                    "wallet_id": wallet.get("id"),
                    "profile_id": wallet.get("profile_id"),
                    "school_id": wallet.get("school_id"),
                    "wallet_type": wallet.get("wallet_type"),
                    "wallet_balance": wallet_balance,
                    "ledger_balance": ledger_balance,
                    "consistent": consistent,
                }
            )
        return {
            "consistent": overall_consistent,
            "wallets": results,
        }


class AICreditWalletService:
    def __init__(self, credit_service: AICreditService | None = None) -> None:
        self.credit_service = credit_service or AICreditService()

    def get_balance(self, profile_id: str, school_id: str):
        return self.credit_service.get_balance(profile_id, school_id)

    def get_ledger(self, profile_id: str, school_id: str, limit: int = 50, offset: int = 0):
        return self.credit_service.get_ledger(profile_id, school_id, limit=limit, offset=offset)

    def list_products(self):
        return self.credit_service.product_repository.list_products(active_only=True)


class CreditEngine:
    def __init__(self, credit_service: AICreditService | None = None) -> None:
        self.credit_service = credit_service or AICreditService()

    def consume(self, profile_id: str, school_id: str, feature: str, credits: int, reference: dict | None = None):
        return self.credit_service.debit(profile_id, school_id, credits, feature=feature, reference=reference, transaction_type=CreditLedgerTransactionType.DEBIT.value)

    def grant(self, profile_id: str, school_id: str, credits: int, reason: str, reference: dict | None = None):
        return self.credit_service.credit(profile_id, school_id, credits, wallet_type=CreditWalletType.BONUS.value, reason=reason, reference=reference, transaction_type=CreditLedgerTransactionType.BONUS.value)

    def purchase(self, profile_id: str, school_id: str, product_id: str, order_id: str):
        raise NotImplementedError("Phase 3 does not implement product purchase flow or Razorpay integration.")

    def refund(self, profile_id: str, school_id: str, original_transaction_id: str, reason: str):
        return self.credit_service.refund(profile_id, school_id, ledger_id=original_transaction_id, reason=reason)

    def expire_old_credits(self):
        return self.credit_service.expire()


ai_credit_service = AICreditService()
