from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.models import UserRole
from app.routes import entitlement as entitlement_routes
from app.services import entitlement_engine


SCHOOL_ID = "11111111-1111-1111-1111-111111111111"


def _user(*, permissions: str = "", role_key: str = "teacher", role: UserRole = UserRole.VIEWER):
    return SimpleNamespace(
        id=1,
        role=role,
        permissions=permissions,
        role_key=role_key,
        user_type="teaching",
        school_id=SCHOOL_ID,
        email="teacher@example.com",
        username="teacher",
    )


class FakeUsageSnapshotService:
    def __init__(self):
        self.snapshot = SimpleNamespace(
            id="snap-1",
            school_id=SCHOOL_ID,
            snapshot_date=date.today(),
            students_used=0,
            teachers_used=0,
            parents_used=0,
            storage_used=Decimal("0"),
            ai_credits_used=0,
            tests_used=0,
            lms_usage=0,
        )

    def create_snapshot(self, payload):
        for key, value in payload.model_dump(exclude_none=True).items():
            setattr(self.snapshot, key, value)
        return self.snapshot

    def get_snapshot_by_school_date(self, school_id: str, snapshot_date: str):
        if school_id == self.snapshot.school_id:
            return self.snapshot
        return None

    def update_snapshot(self, snapshot_id: str, payload):
        for key, value in payload.model_dump(exclude_none=True).items():
            setattr(self.snapshot, key, value)
        return self.snapshot


def test_check_permission_allows_and_denies():
    engine = entitlement_engine.EntitlementEngine()
    allowed = engine.check_permission(_user(permissions="admin_office.students"), "admin_office.students")
    denied = engine.check_permission(_user(permissions="lms"), "admin_office.students")

    assert allowed.allowed is True
    assert denied.allowed is False
    assert denied.code == "PERMISSION_DENIED"


def test_check_scope_requires_school_context_for_non_platform(monkeypatch):
    engine = entitlement_engine.EntitlementEngine()

    monkeypatch.setattr(entitlement_engine, "resolve_permission_scope", lambda user, permission_key: "assigned")
    monkeypatch.setattr(
        entitlement_engine,
        "build_scope_context",
        lambda **kwargs: SimpleNamespace(
            permission_key="admin_office.students",
            scope="assigned",
            role_key="teacher",
            school_id=kwargs.get("school_id"),
            profile_id="profile-1",
            email="teacher@example.com",
            name="Teacher",
            staff_member_id="staff-1",
            staff_department="Science",
            student_ids=[],
            assigned_batches=[],
            is_school_wide=False,
        ),
    )

    allowed = engine.check_scope(_user(permissions="admin_office.students"), "admin_office.students", school_id=SCHOOL_ID, actor={"profile_id": "profile-1"})
    denied = engine.check_scope(_user(permissions="admin_office.students"), "admin_office.students", school_id="", actor={"profile_id": "profile-1"})

    assert allowed.allowed is True
    assert allowed.details["scope"] == "assigned"
    assert denied.allowed is False
    assert denied.code == "SCOPE_DENIED"


def test_check_subscription_supports_grace_and_expired(monkeypatch):
    engine = entitlement_engine.EntitlementEngine()
    monkeypatch.setattr(
        engine,
        "_get_school_plan",
        lambda school_id: {
            "school_id": school_id,
            "plan_tier": "premium",
            "subscription_status": "active",
            "limits": {},
            "overrides": [],
        },
    )

    monkeypatch.setattr(
        engine,
        "_get_latest_subscription",
        lambda school_id: {
            "id": "sub-1",
            "subscription_status": "active",
            "expiry_date": (date.today() - timedelta(days=2)).isoformat(),
        },
    )
    grace = engine.check_subscription(SCHOOL_ID)

    monkeypatch.setattr(
        engine,
        "_get_latest_subscription",
        lambda school_id: {
            "id": "sub-2",
            "subscription_status": "active",
            "expiry_date": (date.today() - timedelta(days=10)).isoformat(),
        },
    )
    expired = engine.check_subscription(SCHOOL_ID)

    assert grace.allowed is True
    assert grace.details["status"] == "grace"
    assert expired.allowed is False
    assert expired.code == "PLAN_EXPIRED"
    assert expired.http_status == 402


def test_check_entitlement_and_limits(monkeypatch):
    usage_service = SimpleNamespace(
        get_usage=lambda school_id, resource_key: 95,
        get_all_usage=lambda school_id: {
            "students_used": 95,
            "teachers_used": 5,
            "parents_used": 20,
            "storage_used": Decimal("2"),
            "ai_credits_used": 15,
            "tests_used": 3,
            "lms_usage": 2,
        },
    )
    engine = entitlement_engine.EntitlementEngine(usage_counter_service=usage_service)
    monkeypatch.setattr(
        engine,
        "_get_plan_limits",
        lambda school_id: {
            "school_id": school_id,
            "plan_tier": "standard",
            "subscription_status": "active",
            "limits": {
                "students_used": 100,
                "teachers_used": 10,
                "parents_used": 50,
                "storage_used": "5",
                "ai_credits_used": 100,
                "tests_used": 10,
                "lms_usage": 10,
            },
            "overrides": [],
        },
    )

    denied = engine.check_entitlement(SCHOOL_ID, "students", 10)
    limits = engine.check_limits(SCHOOL_ID)

    assert denied.allowed is False
    assert denied.code == "LIMIT_EXCEEDED"
    assert limits.allowed is True
    assert limits.details["resources"]["students_used"]["remaining"] == 5


def test_usage_counter_service_crud_invalidates_cache():
    service = entitlement_engine.UsageCounterService(usage_snapshot_service=FakeUsageSnapshotService())

    service.increment(SCHOOL_ID, "students", 2)
    service.increment(SCHOOL_ID, "storage_gb", Decimal("1.5"))
    assert service.get_usage(SCHOOL_ID, "students") == 2
    assert service.get_usage(SCHOOL_ID, "storage_gb") == Decimal("1.5")

    service.decrement(SCHOOL_ID, "students", 1)
    service.reset_usage(SCHOOL_ID, "storage_gb")
    usage = service.get_all_usage(SCHOOL_ID)

    assert usage["students_used"] == 1
    assert usage["storage_used"] == Decimal("0")

    service.reset_all_usage(SCHOOL_ID)
    usage = service.get_all_usage(SCHOOL_ID)
    assert usage["students_used"] == 0
    assert usage["tests_used"] == 0


def test_grace_period_service_states(monkeypatch):
    service = entitlement_engine.GracePeriodService()
    monkeypatch.setattr(
        service,
        "_school_plan",
        lambda school_id: {
            "school_id": school_id,
            "plan_tier": "premium",
            "subscription_status": "active",
            "effective_until": None,
        },
    )
    monkeypatch.setattr(service, "_latest_subscription", lambda school_id: {"expiry_date": (date.today() - timedelta(days=3)).isoformat()})

    assert service.get_status(SCHOOL_ID) == "grace"
    assert service.is_soft_blocked(SCHOOL_ID) is True
    assert service.days_until_hard_block(SCHOOL_ID) == 4

    monkeypatch.setattr(service, "_latest_subscription", lambda school_id: {"expiry_date": (date.today() - timedelta(days=15)).isoformat()})
    assert service.get_status(SCHOOL_ID) == "expired"
    assert service.is_hard_blocked(SCHOOL_ID) is True


def test_platform_admin_bypasses_subscription_and_entitlement(monkeypatch):
    engine = entitlement_engine.EntitlementEngine()
    user = _user(permissions="admin_office.students", role_key="platform_admin")

    monkeypatch.setattr(entitlement_engine, "user_has_permission", lambda current_user, permission_key: True)
    monkeypatch.setattr(entitlement_engine, "resolve_permission_scope", lambda current_user, permission_key: "platform")
    monkeypatch.setattr(
        entitlement_engine,
        "build_scope_context",
        lambda **kwargs: SimpleNamespace(
            permission_key="admin_office.students",
            scope="platform",
            role_key="platform_admin",
            school_id="",
            profile_id="profile-platform",
            email="platform@example.com",
            name="Platform Admin",
            staff_member_id=None,
            staff_department=None,
            student_ids=[],
            assigned_batches=[],
            is_school_wide=True,
        ),
    )

    result = engine.combine_all(
        user,
        "admin_office.students",
        "",
        resource_key="students",
        delta=1,
        actor={"profile_id": "profile-platform"},
    )

    assert result.allowed is True
    assert result.checks["subscription"]["bypassed"] is True
    assert result.checks["entitlement"]["bypassed"] is True


def test_require_entitlement_dependency_and_health_endpoint(monkeypatch):
    protected_app = FastAPI()

    @protected_app.get("/protected")
    def protected_route(_: Any = Depends(entitlement_engine.require_entitlement("admin_office.students", resource_key="students"))):
        return {"ok": True}

    protected_app.dependency_overrides[get_authenticated_user] = lambda: _user(permissions="admin_office.students")
    protected_app.dependency_overrides[get_authenticated_actor_context] = lambda: {"school_id": SCHOOL_ID, "profile_id": "profile-1"}

    monkeypatch.setattr(
        entitlement_engine.entitlement_engine,
        "combine_all",
        lambda user, permission_key, school_id, resource_key=None, delta=1, actor=None: entitlement_engine.EntitlementResult.allow(
            checks={"permission": {"allowed": True}}
        ),
    )

    client = TestClient(protected_app)
    response = client.get("/protected")
    assert response.status_code == 200
    assert response.json()["ok"] is True

    monkeypatch.setattr(
        entitlement_engine.entitlement_engine,
        "combine_all",
        lambda user, permission_key, school_id, resource_key=None, delta=1, actor=None: entitlement_engine.EntitlementResult.deny(
            "PLAN_EXPIRED",
            "Subscription expired",
            http_status=402,
            checks={"subscription": {"allowed": False, "status": "expired"}},
        ),
    )
    response = client.get("/protected")
    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "PLAN_EXPIRED"

    health_app = FastAPI()
    health_app.include_router(entitlement_routes.router)
    health_app.dependency_overrides[entitlement_routes.require_platform_admin] = lambda: _user(role_key="platform_admin")

    monkeypatch.setattr(
        entitlement_routes.entitlement_engine,
        "check_subscription",
        lambda school_id: entitlement_engine.EntitlementResult.allow(details={"status": "active", "plan_tier": "premium", "reason": "subscription_active"}),
    )
    monkeypatch.setattr(entitlement_routes.grace_period_service, "is_soft_blocked", lambda school_id: False)
    monkeypatch.setattr(entitlement_routes.grace_period_service, "is_hard_blocked", lambda school_id: False)
    monkeypatch.setattr(entitlement_routes.grace_period_service, "days_until_hard_block", lambda school_id: 7)
    monkeypatch.setattr(entitlement_routes.grace_period_service, "days_until_data_retention_end", lambda school_id: 30)

    health_client = TestClient(health_app)
    health = health_client.get(f"/api/entitlement/health?school_id={SCHOOL_ID}")

    assert health.status_code == 200
    payload = health.json()
    assert payload["engine_status"]["status"] == "ok"
    assert payload["subscription_status"]["status"] == "active"
