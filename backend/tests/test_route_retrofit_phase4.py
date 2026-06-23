from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.auth import get_authenticated_actor_context
from app.routes import ai_tutor, online_tests
from app.services import route_retrofit


SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _user(*, role_key: str = "teacher", permissions: list[str] | None = None, user_type: str = "teaching", role: Any = None):
    return SimpleNamespace(
        id=1,
        role=role,
        role_key=role_key,
        permissions=permissions or [],
        user_type=user_type,
        school_id=SCHOOL_ID,
        email="user@example.com",
        username="user",
    )


def _allow_result() -> SimpleNamespace:
    return SimpleNamespace(allowed=True, code="ALLOWED", message="ok", details={}, checks={})


def _deny_result(code: str, *, http_status: int = 403, message: str = "denied") -> SimpleNamespace:
    return SimpleNamespace(allowed=False, code=code, message=message, details={}, checks={}, http_status=http_status)


def test_prepare_route_retrofit_maps_subscription_and_limit_errors(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_tests", True, raising=False)

    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _deny_result("PLAN_EXPIRED", http_status=402, message="expired"))
    try:
        route_retrofit.prepare_route_retrofit(
            flag_name="tests",
            user=_user(),
            actor={"profile_id": PROFILE_ID},
            permission_key="online_tests.manage",
            school_id=SCHOOL_ID,
            resource_key="tests_used",
            delta=1,
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 402
        assert exc.detail["code"] == "SUBSCRIPTION_EXPIRED"
    else:
        raise AssertionError("Expected subscription failure")

    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _deny_result("LIMIT_EXCEEDED", message="limit"))
    try:
        route_retrofit.prepare_route_retrofit(
            flag_name="tests",
            user=_user(),
            actor={"profile_id": PROFILE_ID},
            permission_key="online_tests.manage",
            school_id=SCHOOL_ID,
            resource_key="tests_used",
            delta=1,
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403
        assert exc.detail["code"] == "PLAN_LIMIT_REACHED"
    else:
        raise AssertionError("Expected entitlement limit failure")


def test_prepare_route_retrofit_preserves_permission_and_scope_denials(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_lms", True, raising=False)

    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _deny_result("PERMISSION_DENIED", message="permission"))
    try:
        route_retrofit.prepare_route_retrofit(
            flag_name="lms",
            user=_user(),
            actor={"profile_id": PROFILE_ID},
            permission_key="lms.manage",
            school_id=SCHOOL_ID,
            resource_key="lms_usage",
            delta=1,
        )
    except Exception as exc:
        assert exc.detail["code"] == "PERMISSION_DENIED"
    else:
        raise AssertionError("Expected permission denial")

    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _deny_result("SCOPE_DENIED", message="scope"))
    try:
        route_retrofit.prepare_route_retrofit(
            flag_name="lms",
            user=_user(),
            actor={"profile_id": PROFILE_ID},
            permission_key="lms.manage",
            school_id=SCHOOL_ID,
            resource_key="lms_usage",
            delta=1,
        )
    except Exception as exc:
        assert exc.detail["code"] == "SCOPE_DENIED"
    else:
        raise AssertionError("Expected scope denial")


def test_prepare_route_retrofit_maps_credit_failure(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_ai", True, raising=False)
    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _allow_result())

    def _raise_credit(*args, **kwargs):
        raise route_retrofit.HTTPException(status_code=402, detail="not enough credits")

    monkeypatch.setattr(route_retrofit.ai_credit_service, "ensure_sufficient_credits", _raise_credit)

    try:
        route_retrofit.prepare_route_retrofit(
            flag_name="ai",
            user=_user(role_key="student", user_type="student"),
            actor={"profile_id": PROFILE_ID},
            permission_key="ai_tutor.chat",
            school_id=SCHOOL_ID,
            resource_key="ai_credits_used",
            credit_feature="ai_chat",
            credit_amount=1,
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 402
        assert exc.detail["code"] == "INSUFFICIENT_CREDITS"
    else:
        raise AssertionError("Expected insufficient credit failure")


def test_platform_admin_bypass_skips_subscription_entitlement_and_credits(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_ai", True, raising=False)
    calls = {"combine": 0, "credits": 0}

    monkeypatch.setattr(
        route_retrofit.entitlement_engine,
        "combine_all",
        lambda *args, **kwargs: calls.__setitem__("combine", calls["combine"] + 1) or _allow_result(),
    )
    monkeypatch.setattr(
        route_retrofit.ai_credit_service,
        "ensure_sufficient_credits",
        lambda *args, **kwargs: calls.__setitem__("credits", calls["credits"] + 1),
    )

    reservation = route_retrofit.prepare_route_retrofit(
        flag_name="ai",
        user=_user(role_key="platform_admin"),
        actor={"profile_id": PROFILE_ID},
        permission_key="ai_tutor.chat",
        school_id=SCHOOL_ID,
        resource_key="ai_credits_used",
        credit_feature="ai_chat",
        credit_amount=1,
    )

    assert reservation.enabled is True
    assert reservation.bypassed is True
    assert calls["combine"] == 0
    assert calls["credits"] == 0


def test_commit_route_retrofit_updates_usage_and_debits(monkeypatch):
    usage_calls: list[tuple[str, str, Any]] = []
    debit_calls: list[dict[str, Any]] = []

    monkeypatch.setattr(
        route_retrofit.usage_counter_service,
        "increment",
        lambda school_id, resource_key, delta=1: usage_calls.append((school_id, resource_key, delta)),
    )
    monkeypatch.setattr(
        route_retrofit.ai_credit_service,
        "debit",
        lambda profile_id, school_id, **kwargs: debit_calls.append({"profile_id": profile_id, "school_id": school_id, **kwargs}),
    )

    reservation = route_retrofit.RetrofitReservation(
        enabled=True,
        school_id=SCHOOL_ID,
        profile_id=PROFILE_ID,
        resource_key="tests_used",
        delta=2,
        credit_feature="ai_test_generation",
        credit_amount=5,
        reason="online_tests.ai_generate",
    )
    route_retrofit.commit_route_retrofit(reservation)

    assert usage_calls == [(SCHOOL_ID, "tests_used", 2)]
    assert debit_calls[0]["amount"] == 5
    assert debit_calls[0]["feature"] == "ai_test_generation"


def test_ai_tutor_route_enforces_and_commits(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_ai", True, raising=False)
    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _allow_result())
    monkeypatch.setattr(route_retrofit.ai_credit_service, "ensure_sufficient_credits", lambda *args, **kwargs: None)

    usage_calls: list[tuple[str, str, Any]] = []
    debit_calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        route_retrofit.usage_counter_service,
        "increment",
        lambda school_id, resource_key, delta=1: usage_calls.append((school_id, resource_key, delta)),
    )
    monkeypatch.setattr(
        route_retrofit.ai_credit_service,
        "debit",
        lambda profile_id, school_id, **kwargs: debit_calls.append({"profile_id": profile_id, "school_id": school_id, **kwargs}),
    )
    monkeypatch.setattr(
        ai_tutor,
        "tutor_chat",
        lambda *args, **kwargs: {
            "mode": "chat",
            "topic": "Algebra",
            "student_profile": {},
            "personalization": {},
            "explanation": "Answer",
        },
    )

    app = FastAPI()
    app.include_router(ai_tutor.router)
    user = _user(role_key="student", user_type="student")
    app.dependency_overrides[ai_tutor.require_ai_tutor_chat_user] = lambda: user
    app.dependency_overrides[get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID, "school_id": SCHOOL_ID}
    app.dependency_overrides[ai_tutor.resolve_school_id_from_actor] = lambda: SCHOOL_ID

    client = TestClient(app)
    response = client.post("/api/ai/chat", json={"topic": "Algebra", "question": "What is x?"})

    assert response.status_code == 200
    assert response.json()["mode"] == "chat"
    assert usage_calls == [(SCHOOL_ID, "ai_credits_used", 0)] or usage_calls == []
    assert debit_calls[0]["amount"] == 1
    assert debit_calls[0]["feature"] == "ai_chat"


def test_online_tests_ai_generate_route_returns_structured_limit_error(monkeypatch):
    monkeypatch.setattr(route_retrofit.settings, "enable_retrofit_tests", True, raising=False)
    monkeypatch.setattr(route_retrofit.entitlement_engine, "combine_all", lambda *args, **kwargs: _deny_result("LIMIT_EXCEEDED", message="too many tests"))

    app = FastAPI()
    app.include_router(online_tests.router)
    scope_context = SimpleNamespace(
        user=_user(),
        permission_key="online_tests.manage",
        scope="school",
        role_key="teacher",
        school_id=SCHOOL_ID,
        profile_id=PROFILE_ID,
        is_school_wide=True,
    )
    app.dependency_overrides[online_tests.require_online_tests_manage_scope] = lambda: scope_context
    app.dependency_overrides[get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID, "school_id": SCHOOL_ID}
    app.dependency_overrides[online_tests.resolve_school_id_from_actor] = lambda: SCHOOL_ID

    client = TestClient(app)
    response = client.post(
        "/api/online-tests/ai-generate",
        json={
            "subject": "Maths",
            "chapter": "Algebra",
            "topic": "Linear equations",
            "batch_id": "batch-1",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "PLAN_LIMIT_REACHED"
