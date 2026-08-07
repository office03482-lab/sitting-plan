from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import credits
from app.middleware.tenant_context import TenantContext
from app.services.ai_credit_engine import AICreditService


PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
SCHOOL_ID = "11111111-1111-1111-1111-111111111111"


class FakeLedgerRepository:
    def __init__(self):
        self.rows: dict[str, dict[str, Any]] = {}
        self.counter = 0

    def get_entry(self, entry_id: str):
        row = self.rows.get(entry_id)
        return dict(row) if row else None

    def create_entry(self, payload):
        self.counter += 1
        row = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else dict(payload or {})
        row["id"] = f"ledger-{self.counter}"
        self.rows[row["id"]] = row
        return dict(row)

    def list_entries(self, *, wallet_id: str | None = None, school_id: str | None = None, profile_id: str | None = None, limit: int = 50, offset: int = 0):
        rows = list(self.rows.values())
        if wallet_id:
            rows = [row for row in rows if row.get("wallet_id") == wallet_id]
        if school_id:
            rows = [row for row in rows if row.get("school_id") == school_id]
        if profile_id:
            rows = [row for row in rows if row.get("profile_id") == profile_id]
        rows = sorted(rows, key=lambda item: item["id"], reverse=True)
        return [dict(row) for row in rows[offset:offset + limit]]

    def list_entries_for_wallet(self, wallet_id: str):
        rows = [row for row in self.rows.values() if row.get("wallet_id") == wallet_id]
        rows = sorted(rows, key=lambda item: item["id"])
        return [dict(row) for row in rows]


class FakeWalletRepository:
    def __init__(self, ledger_repository: FakeLedgerRepository):
        self.rows: dict[str, dict[str, Any]] = {}
        self.counter = 0
        self.ledger_repository = ledger_repository
        self.lock = Lock()
        self.idempotency_results: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
        self.fail_transfer_after_debit = False

    def get_wallet(self, wallet_id: str):
        row = self.rows.get(wallet_id)
        return dict(row) if row else None

    def list_wallets(self, *, school_id: str | None = None, profile_id: str | None = None, wallet_type: str | None = None):
        rows = list(self.rows.values())
        if school_id:
            rows = [row for row in rows if row.get("school_id") == school_id]
        if profile_id:
            rows = [row for row in rows if row.get("profile_id") == profile_id]
        if wallet_type:
            rows = [row for row in rows if row.get("wallet_type") == wallet_type]
        return [dict(row) for row in rows]

    def create_wallet(self, payload):
        self.counter += 1
        row = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else dict(payload or {})
        row["id"] = f"wallet-{self.counter}"
        row.setdefault("metadata", {})
        row.setdefault("version", 0)
        self.rows[row["id"]] = row
        return dict(row)

    def update_wallet(self, wallet_id: str, payload):
        row = self.rows[wallet_id]
        row.update(payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else dict(payload or {}))
        self.rows[wallet_id] = row
        return dict(row)

    def _idempotent(self, key: str | None, operation: str, request_hash: str | None):
        if not key:
            return None
        existing = self.idempotency_results.get((key, operation))
        if not existing:
            return None
        existing_hash, payload = existing
        if existing_hash != request_hash:
            raise Exception("Idempotency key reuse with different payload")
        replay = dict(payload)
        replay["idempotency_replayed"] = True
        return replay

    def _store_idempotent(self, key: str | None, operation: str, request_hash: str | None, payload: dict[str, Any]):
        if key:
            stored = dict(payload)
            stored["idempotency_replayed"] = False
            self.idempotency_results[(key, operation)] = (request_hash or "", stored)

    def _find_wallet_row(self, *, profile_id: str, school_id: str, wallet_type: str, allow_create: bool = False, expires_at: str | None = None):
        for row in self.rows.values():
            if row.get("profile_id") == profile_id and row.get("school_id") == school_id and row.get("wallet_type") == wallet_type:
                return row
        if not allow_create:
            return None
        self.counter += 1
        row = {
            "id": f"wallet-{self.counter}",
            "profile_id": profile_id,
            "school_id": school_id,
            "wallet_type": wallet_type,
            "version": 0,
            "balance": 0,
            "lifetime_used": 0,
            "lifetime_granted": 0,
            "expires_at": expires_at,
            "is_frozen": False,
            "metadata": {},
        }
        self.rows[row["id"]] = row
        return row

    def apply_wallet_change_atomic(
        self,
        *,
        profile_id: str,
        school_id: str,
        wallet_type: str,
        delta: int,
        transaction_type: str,
        feature: str | None = None,
        reference_type: str | None = None,
        reference_id: str | None = None,
        description: str | None = None,
        actor_profile_id: str | None = None,
        expires_at: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
        allow_create: bool = True,
    ):
        with self.lock:
            replay = self._idempotent(idempotency_key, "wallet_change", request_hash)
            if replay:
                return replay
            wallet = self._find_wallet_row(
                profile_id=profile_id,
                school_id=school_id,
                wallet_type=wallet_type,
                allow_create=allow_create and delta >= 0,
                expires_at=expires_at,
            )
            if wallet is None:
                raise Exception("AI credit wallet not found")
            next_balance = int(wallet.get("balance", 0)) + int(delta)
            if next_balance < 0:
                raise Exception("Insufficient AI credits")
            wallet["balance"] = next_balance
            wallet["version"] = int(wallet.get("version", 0)) + 1
            wallet["lifetime_used"] = int(wallet.get("lifetime_used", 0)) + (abs(int(delta)) if delta < 0 else 0)
            wallet["lifetime_granted"] = int(wallet.get("lifetime_granted", 0)) + (int(delta) if delta > 0 else 0)
            wallet["expires_at"] = expires_at or wallet.get("expires_at")
            merged_metadata = dict(wallet.get("metadata") or {})
            merged_metadata.update(metadata or {})
            wallet["metadata"] = merged_metadata
            ledger = self.ledger_repository.create_entry(
                {
                    "wallet_id": wallet["id"],
                    "profile_id": wallet["profile_id"],
                    "school_id": wallet["school_id"],
                    "transaction_type": transaction_type,
                    "amount": int(delta),
                    "balance_after": next_balance,
                    "feature": feature,
                    "reference_type": reference_type,
                    "reference_id": reference_id,
                    "description": description,
                    "metadata": metadata or {},
                    "created_by": actor_profile_id,
                }
            )
            payload = {"wallet": dict(wallet), "ledger": dict(ledger), "idempotency_replayed": False}
            self._store_idempotent(idempotency_key, "wallet_change", request_hash, payload)
            return payload

    def debit_atomic(
        self,
        *,
        profile_id: str,
        school_id: str,
        amount: int,
        transaction_type: str,
        feature: str | None = None,
        wallet_type: str | None = None,
        reference_type: str | None = None,
        reference_id: str | None = None,
        description: str | None = None,
        actor_profile_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ):
        with self.lock:
            replay = self._idempotent(idempotency_key, "debit", request_hash)
            if replay:
                return replay
            remaining = int(amount)
            candidates = [
                row for row in self.rows.values()
                if row.get("school_id") == school_id
                and not row.get("is_frozen", False)
                and (row.get("expires_at") is None or datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00")) > datetime.now(timezone.utc))
                and int(row.get("balance", 0)) > 0
                and (
                    (wallet_type and row.get("wallet_type") == wallet_type and (row.get("wallet_type") == "school" or row.get("profile_id") == profile_id))
                    or (
                        not wallet_type
                        and (
                            (row.get("wallet_type") == "personal" and row.get("profile_id") == profile_id)
                            or row.get("wallet_type") == "school"
                            or (row.get("wallet_type") == "bonus" and row.get("profile_id") == profile_id)
                        )
                    )
                )
            ]
            priority = {"personal": 1, "school": 2, "bonus": 3}
            candidates.sort(key=lambda item: (priority.get(str(item.get("wallet_type")), 9), -int(item.get("balance", 0))))
            available_total = sum(int(item.get("balance", 0)) for item in candidates)
            if available_total < remaining:
                raise Exception("Insufficient AI credits")
            updates: list[dict[str, Any]] = []
            for wallet in candidates:
                if remaining <= 0:
                    break
                take = min(int(wallet.get("balance", 0)), remaining)
                wallet["balance"] = int(wallet.get("balance", 0)) - take
                wallet["version"] = int(wallet.get("version", 0)) + 1
                wallet["lifetime_used"] = int(wallet.get("lifetime_used", 0)) + take
                merged_metadata = dict(wallet.get("metadata") or {})
                merged_metadata.update(metadata or {})
                wallet["metadata"] = merged_metadata
                ledger = self.ledger_repository.create_entry(
                    {
                        "wallet_id": wallet["id"],
                        "profile_id": wallet["profile_id"],
                        "school_id": wallet["school_id"],
                        "transaction_type": transaction_type,
                        "amount": -take,
                        "balance_after": int(wallet.get("balance", 0)),
                        "feature": feature,
                        "reference_type": reference_type,
                        "reference_id": reference_id,
                        "description": description,
                        "metadata": metadata or {},
                        "created_by": actor_profile_id,
                    }
                )
                updates.append({"wallet": dict(wallet), "ledger": dict(ledger)})
                remaining -= take
            payload = {"amount": int(amount), "wallet_updates": updates, "idempotency_replayed": False}
            self._store_idempotent(idempotency_key, "debit", request_hash, payload)
            return payload

    def transfer_atomic(
        self,
        *,
        from_profile_id: str,
        from_school_id: str,
        from_wallet_type: str,
        to_profile_id: str,
        to_school_id: str,
        to_wallet_type: str,
        amount: int,
        actor_profile_id: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ):
        with self.lock:
            replay = self._idempotent(idempotency_key, "transfer", request_hash)
            if replay:
                return replay
            source = self._find_wallet_row(
                profile_id=from_profile_id,
                school_id=from_school_id,
                wallet_type=from_wallet_type,
                allow_create=False,
            )
            if source is None or int(source.get("balance", 0)) < int(amount):
                raise Exception("Insufficient AI credits")
            target = self._find_wallet_row(
                profile_id=to_profile_id,
                school_id=to_school_id,
                wallet_type=to_wallet_type,
                allow_create=True,
            )
            snapshot_source = dict(source)
            snapshot_target = dict(target)
            snapshot_ledger_rows = dict(self.ledger_repository.rows)
            snapshot_counter = self.ledger_repository.counter
            try:
                source["balance"] = int(source.get("balance", 0)) - int(amount)
                source["version"] = int(source.get("version", 0)) + 1
                source["lifetime_used"] = int(source.get("lifetime_used", 0)) + int(amount)
                if self.fail_transfer_after_debit:
                    raise RuntimeError("forced transfer failure")
                target["balance"] = int(target.get("balance", 0)) + int(amount)
                target["version"] = int(target.get("version", 0)) + 1
                target["lifetime_granted"] = int(target.get("lifetime_granted", 0)) + int(amount)
                source_ledger = self.ledger_repository.create_entry(
                    {
                        "wallet_id": source["id"],
                        "profile_id": source["profile_id"],
                        "school_id": source["school_id"],
                        "transaction_type": "adjustment",
                        "amount": -int(amount),
                        "balance_after": int(source.get("balance", 0)),
                        "description": description or "AI credit transfer out",
                        "metadata": {"transfer_direction": "out", **(metadata or {})},
                        "created_by": actor_profile_id,
                    }
                )
                target_ledger = self.ledger_repository.create_entry(
                    {
                        "wallet_id": target["id"],
                        "profile_id": target["profile_id"],
                        "school_id": target["school_id"],
                        "transaction_type": "adjustment",
                        "amount": int(amount),
                        "balance_after": int(target.get("balance", 0)),
                        "description": description or "AI credit transfer in",
                        "metadata": {"transfer_direction": "in", **(metadata or {})},
                        "created_by": actor_profile_id,
                    }
                )
            except Exception:
                self.rows[source["id"]] = snapshot_source
                self.rows[target["id"]] = snapshot_target
                self.ledger_repository.rows = snapshot_ledger_rows
                self.ledger_repository.counter = snapshot_counter
                raise
            payload = {
                "amount": int(amount),
                "source": {"wallet": dict(source), "ledger": dict(source_ledger)},
                "target": {"wallet": dict(target), "ledger": dict(target_ledger)},
                "idempotency_replayed": False,
            }
            self._store_idempotent(idempotency_key, "transfer", request_hash, payload)
            return payload


class FakeProductRepository:
    def list_products(self, *, active_only: bool = False):
        del active_only
        return []


class FakeUsageCounterService:
    def __init__(self):
        self.total = 0

    def increment(self, school_id: str, resource_key: str, delta: int = 1):
        self.total += int(delta)

    def decrement(self, school_id: str, resource_key: str, delta: int = 1):
        self.total -= int(delta)


def build_service():
    ledger_repository = FakeLedgerRepository()
    wallet_repository = FakeWalletRepository(ledger_repository)
    usage_counter_service = FakeUsageCounterService()
    service = AICreditService(
        wallet_repository=wallet_repository,
        ledger_repository=ledger_repository,
        product_repository=FakeProductRepository(),
        usage_counter_service=usage_counter_service,
    )
    return service, wallet_repository, ledger_repository, usage_counter_service


def test_credit_creates_wallet_and_ledger(monkeypatch):
    service, wallet_repository, ledger_repository, _ = build_service()
    audit_events: list[dict[str, Any]] = []
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: audit_events.append(kwargs))

    result = service.credit(PROFILE_ID, SCHOOL_ID, 25, wallet_type="bonus", reason="Grant")

    assert result["wallet"]["balance"] == 25
    assert result["ledger"]["amount"] == 25
    assert result["ledger"]["transaction_type"] == "credit"
    assert len(wallet_repository.rows) == 1
    assert len(ledger_repository.rows) == 1
    assert audit_events[0]["action"] == "AI Credits Granted"


def test_debit_consumes_personal_then_school_and_records_usage(monkeypatch):
    service, wallet_repository, ledger_repository, usage_counter = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    wallet_repository.create_wallet(
        {
            "profile_id": PROFILE_ID,
            "school_id": SCHOOL_ID,
            "wallet_type": "personal",
            "balance": 2,
            "lifetime_used": 0,
            "lifetime_granted": 2,
            "expires_at": None,
            "is_frozen": False,
            "metadata": {},
            "version": 0,
        }
    )
    wallet_repository.create_wallet(
        {
            "profile_id": PROFILE_ID,
            "school_id": SCHOOL_ID,
            "wallet_type": "school",
            "balance": 10,
            "lifetime_used": 0,
            "lifetime_granted": 10,
            "expires_at": None,
            "is_frozen": False,
            "metadata": {},
            "version": 0,
        }
    )

    result = service.debit(PROFILE_ID, SCHOOL_ID, feature="ai_chat", amount=5)

    assert result["amount"] == 5
    assert len(result["wallet_updates"]) == 2
    assert usage_counter.total == 5
    assert len(ledger_repository.rows) == 2
    balances = sorted([row["balance"] for row in wallet_repository.rows.values()])
    assert balances == [0, 7]


def test_refund_recreates_credits_and_reduces_usage(monkeypatch):
    service, wallet_repository, ledger_repository, usage_counter = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    service.credit(PROFILE_ID, SCHOOL_ID, 10, wallet_type="school", reason="Seed")
    debit = service.debit(PROFILE_ID, SCHOOL_ID, amount=4, feature="ai_chat")
    refunded = service.refund(PROFILE_ID, SCHOOL_ID, ledger_id=debit["wallet_updates"][0]["ledger"]["id"], reason="Retry")

    assert refunded["ledger"]["transaction_type"] == "refund"
    assert refunded["wallet"]["balance"] == 10
    assert usage_counter.total == 0
    assert len(ledger_repository.rows) == 3
    assert wallet_repository.list_wallets(school_id=SCHOOL_ID, wallet_type="school")[0]["balance"] == 10


def test_expire_zeroes_expired_wallet(monkeypatch):
    service, wallet_repository, ledger_repository, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    wallet = service.credit(PROFILE_ID, SCHOOL_ID, 12, wallet_type="bonus", reason="Promo", expires_at=datetime.now(timezone.utc) - timedelta(days=1))
    result = service.expire(wallet_id=wallet["wallet"]["id"])

    assert result["count"] == 1
    assert result["items"][0]["expired_amount"] == 12
    assert ledger_repository.rows["ledger-2"]["transaction_type"] == "expiry"
    assert wallet_repository.rows[wallet["wallet"]["id"]]["balance"] == 0


def test_insufficient_balance_raises(monkeypatch):
    service, _, _, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    service.credit(PROFILE_ID, SCHOOL_ID, 2, wallet_type="school", reason="Seed")

    try:
        service.debit(PROFILE_ID, SCHOOL_ID, amount=5, feature="ai_chat")
    except Exception as exc:
        assert "Insufficient AI credits" in str(exc)
        return
    raise AssertionError("Expected insufficient balance error")


def test_admin_adjustment_can_remove_credits(monkeypatch):
    service, wallet_repository, ledger_repository, usage_counter = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    created = service.credit(PROFILE_ID, SCHOOL_ID, 20, wallet_type="bonus", reason="Grant")
    adjusted = service.adjust_balance(
        profile_id=PROFILE_ID,
        school_id=SCHOOL_ID,
        amount=-5,
        wallet_type="bonus",
        reason="Admin adjustment",
        actor_profile_id="platform-profile",
    )

    assert adjusted["amount"] == 5
    assert wallet_repository.rows[created["wallet"]["id"]]["balance"] == 15
    assert usage_counter.total == 0
    assert list(ledger_repository.rows.values())[-1]["transaction_type"] == "adjustment"


def test_bonus_affordability_and_balance_helpers(monkeypatch):
    service, wallet_repository, ledger_repository, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    granted = service.grant_bonus(PROFILE_ID, SCHOOL_ID, 6, reason="Promo credits")
    affordability = service.check_affordability(PROFILE_ID, SCHOOL_ID, "ai_analytics")
    sufficient = service.ensure_sufficient_balance(PROFILE_ID, SCHOOL_ID, 4)

    assert granted["ledger"]["transaction_type"] == "bonus"
    assert granted["wallet"]["wallet_type"] == "bonus"
    assert affordability["estimated_cost"] == 4
    assert affordability["affordable"] is True
    assert sufficient["total_balance"] == 6
    assert len(wallet_repository.rows) == 1
    assert len(ledger_repository.rows) == 1


def test_wallet_summary_ledger_and_cost_routes(monkeypatch):
    service, _, _, _ = build_service()
    monkeypatch.setattr(credits, "ai_credit_service", service)
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    service.credit(PROFILE_ID, SCHOOL_ID, 9, wallet_type="school", reason="Seed")

    app = FastAPI()
    app.include_router(credits.router)
    app.dependency_overrides[credits.get_authenticated_user] = lambda: type("User", (), {"role_key": "teacher"})()
    app.dependency_overrides[credits.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID, "school_id": SCHOOL_ID}
    app.dependency_overrides[credits.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[credits.require_platform_admin] = lambda: type("User", (), {"role_key": "platform_admin"})()

    client = TestClient(app)

    wallet_response = client.get("/api/credits/wallet")
    assert wallet_response.status_code == 200
    assert wallet_response.json()["data"]["total_balance"] == 9

    ledger_response = client.get("/api/credits/ledger")
    assert ledger_response.status_code == 200
    assert ledger_response.json()["data"]["count"] >= 1

    costs_response = client.get("/api/credits/costs")
    assert costs_response.status_code == 200
    assert costs_response.json()["costs"]["ai_chat"] == 1

    adjust_response = client.post(
        "/api/credits/admin/adjust",
        json={
            "profile_id": PROFILE_ID,
            "school_id": SCHOOL_ID,
            "amount": 3,
            "wallet_type": "bonus",
            "reason": "Manual grant",
        },
        headers={"Idempotency-Key": "adjust-1"},
    )
    assert adjust_response.status_code == 200
    assert adjust_response.json()["data"]["wallet"]["balance"] == 3

    grant_response = client.post(
        "/api/credits/admin/grant",
        json={
            "profile_id": PROFILE_ID,
            "school_id": SCHOOL_ID,
            "amount": 5,
            "wallet_type": "bonus",
            "reason": "Promo grant",
        },
        headers={"Idempotency-Key": "grant-1"},
    )
    assert grant_response.status_code == 200
    assert grant_response.json()["data"]["ledger"]["transaction_type"] == "bonus"
