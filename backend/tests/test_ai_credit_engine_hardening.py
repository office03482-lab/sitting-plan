from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from app.services.ai_credit_engine import AICreditService
from test_ai_credit_engine_phase3 import PROFILE_ID, SCHOOL_ID, build_service


def test_concurrent_debit_prevents_double_spend(monkeypatch):
    service, _, _, usage_counter = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)
    service.credit(PROFILE_ID, SCHOOL_ID, 5, wallet_type="school", reason="Seed")

    def do_debit():
        try:
            return service.debit(PROFILE_ID, SCHOOL_ID, amount=4, feature="ai_chat", idempotency_key=None)
        except Exception as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: do_debit(), range(2)))

    successes = [item for item in results if isinstance(item, dict)]
    failures = [item for item in results if isinstance(item, str)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert "Insufficient AI credits" in failures[0]
    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 1
    assert usage_counter.total == 4


def test_concurrent_credit_is_atomic(monkeypatch):
    service, _, _, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    def do_credit():
        return service.credit(PROFILE_ID, SCHOOL_ID, 7, wallet_type="bonus", reason="Concurrent grant")

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: do_credit(), range(2)))

    assert len(results) == 2
    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 14


def test_duplicate_request_returns_existing_result(monkeypatch):
    service, _, ledger_repository, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)

    first = service.credit(PROFILE_ID, SCHOOL_ID, 9, wallet_type="bonus", reason="Grant", idempotency_key="credit-1")
    second = service.credit(PROFILE_ID, SCHOOL_ID, 9, wallet_type="bonus", reason="Grant", idempotency_key="credit-1")

    assert first["ledger"]["id"] == second["ledger"]["id"]
    assert second["idempotency_replayed"] is True
    assert len(ledger_repository.rows) == 1
    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 9


def test_retry_safe_debit_does_not_duplicate_ledger(monkeypatch):
    service, _, ledger_repository, usage_counter = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)
    service.credit(PROFILE_ID, SCHOOL_ID, 10, wallet_type="school", reason="Seed")

    first = service.debit(PROFILE_ID, SCHOOL_ID, amount=3, feature="ai_chat", idempotency_key="debit-1")
    second = service.debit(PROFILE_ID, SCHOOL_ID, amount=3, feature="ai_chat", idempotency_key="debit-1")

    assert first["wallet_updates"][0]["ledger"]["id"] == second["wallet_updates"][0]["ledger"]["id"]
    assert second["idempotency_replayed"] is True
    assert len(ledger_repository.rows) == 2
    assert usage_counter.total == 3
    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 7


def test_atomic_transfer_rolls_back_on_failure(monkeypatch):
    service, wallet_repository, _, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)
    service.credit(PROFILE_ID, SCHOOL_ID, 8, wallet_type="bonus", reason="Seed")
    wallet_repository.fail_transfer_after_debit = True

    try:
        service.transfer(
            from_profile_id=PROFILE_ID,
            from_school_id=SCHOOL_ID,
            to_profile_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            to_school_id=SCHOOL_ID,
            amount=5,
            reason="Transfer",
        )
    except Exception as exc:
        assert "forced transfer failure" in str(exc)
    else:
        raise AssertionError("Expected forced transfer failure")

    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 8


def test_transfer_idempotency_is_safe(monkeypatch):
    service, _, _, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)
    service.credit(PROFILE_ID, SCHOOL_ID, 12, wallet_type="bonus", reason="Seed")

    first = service.transfer(
        from_profile_id=PROFILE_ID,
        from_school_id=SCHOOL_ID,
        to_profile_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        to_school_id=SCHOOL_ID,
        amount=4,
        reason="Transfer",
        idempotency_key="transfer-1",
    )
    second = service.transfer(
        from_profile_id=PROFILE_ID,
        from_school_id=SCHOOL_ID,
        to_profile_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        to_school_id=SCHOOL_ID,
        amount=4,
        reason="Transfer",
        idempotency_key="transfer-1",
    )

    assert first["source"]["ledger"]["id"] == second["source"]["ledger"]["id"]
    assert second["idempotency_replayed"] is True
    assert service.get_balance(PROFILE_ID, SCHOOL_ID)["total_balance"] == 8


def test_ledger_consistency_helper(monkeypatch):
    service, _, _, _ = build_service()
    monkeypatch.setattr("app.services.ai_credit_engine._log_audit_entry", lambda **kwargs: None)
    service.credit(PROFILE_ID, SCHOOL_ID, 10, wallet_type="school", reason="Seed")
    service.debit(PROFILE_ID, SCHOOL_ID, amount=4, feature="ai_chat")
    service.refund(PROFILE_ID, SCHOOL_ID, amount=1, reason="Retry refund")

    result = service.verify_ledger_integrity(profile_id=PROFILE_ID, school_id=SCHOOL_ID)

    assert result["consistent"] is True
    assert len(result["wallets"]) >= 1


def test_service_class_still_constructs():
    service = AICreditService()
    assert service is not None
