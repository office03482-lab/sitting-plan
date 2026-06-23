from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import platform
from app.services import subscription_engine


SCHOOL_ID = "11111111-1111-1111-1111-111111111111"


class FakeSchoolPlanRepository:
    def __init__(self):
        self.row = {
            "school_id": SCHOOL_ID,
            "plan_tier": "starter",
            "subscription_status": "active",
            "student_limit": 100,
            "teacher_limit": 10,
            "parent_limit": 50,
            "storage_limit_gb": "5",
            "ai_credit_limit": 500,
            "test_limit": 20,
            "lms_limit": 10,
            "metadata": {},
            "effective_from": date.today().isoformat(),
            "effective_until": None,
        }

    def get_plan(self, school_id: str):
        return dict(self.row) if school_id == SCHOOL_ID else None

    def list_plans(self):
        return [dict(self.row)]

    def create_plan(self, payload):
        data = payload.model_dump(exclude_none=True)
        self.row.update(data)
        return dict(self.row)

    def update_plan(self, school_id: str, payload):
        data = payload.model_dump(exclude_none=True)
        for key, value in data.items():
            self.row[key] = value.isoformat() if hasattr(value, "isoformat") else value
        return dict(self.row)


class FakeOverrideRepository:
    def __init__(self, overrides=None):
        self._overrides = overrides or []

    def list_overrides(self, school_id: str):
        return list(self._overrides)


class FakePlanChangeRepository:
    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.counter = 0

    def create_request(self, payload):
        self.counter += 1
        row = payload.model_dump(exclude_none=True)
        row["id"] = f"req-{self.counter}"
        self.rows[row["id"]] = row
        return dict(row)

    def get_request(self, request_id: str):
        row = self.rows.get(request_id)
        return dict(row) if row else None

    def update_request(self, request_id: str, payload):
        row = self.rows[request_id]
        row.update(payload.model_dump(exclude_none=True))
        return dict(row)

    def list_requests(self, school_id: str | None = None):
        values = list(self.rows.values())
        if school_id:
            values = [row for row in values if row.get("school_id") == school_id]
        return [dict(row) for row in values]


def test_activate_plan_creates_paid_subscription_and_updates_limits(monkeypatch):
    repo = FakeSchoolPlanRepository()
    service = subscription_engine.SchoolSubscriptionService(
        repository=repo,
        override_repository=FakeOverrideRepository(),
    )

    monkeypatch.setattr(service, "_rule_limits", lambda plan_tier: {
        "students_used": 500,
        "teachers_used": 50,
        "parents_used": 200,
        "storage_used": 25,
        "ai_credits_used": 5000,
        "tests_used": 100,
        "lms_usage": 50,
    })
    monkeypatch.setattr(subscription_engine, "_list_active_school_subscriptions", lambda school_id: [])
    monkeypatch.setattr(subscription_engine, "_ensure_school_plan_product", lambda school_id, plan_tier, billing_cycle: {"id": "product-1", "currency": "INR", "sale_price": 1999})
    monkeypatch.setattr(subscription_engine, "_create_finance_subscription", lambda **kwargs: {"id": "sub-1", "subscription_status": "active", "plan_name": "Basic", "metadata": {"school_plan_tier": "standard"}, "created_at": "now"})
    monkeypatch.setattr(subscription_engine, "_latest_school_subscription", lambda school_id: {"id": "sub-1", "subscription_status": "active", "plan_name": "Basic", "metadata": {"school_plan_tier": "standard"}})
    monkeypatch.setattr(subscription_engine, "_log_audit_entry", lambda **kwargs: None)

    result = service.activate_plan(SCHOOL_ID, "standard", "monthly", actor_profile_id="profile-1")

    assert result["plan_tier"] == "standard"
    assert result["subscription_status"] == "active"
    assert result["limits"]["students_used"] == 500
    assert result["subscription"]["id"] == "sub-1"
    assert repo.row["plan_tier"] == "standard"


def test_change_plan_future_date_creates_scheduled_request(monkeypatch):
    repo = FakeSchoolPlanRepository()
    request_repo = FakePlanChangeRepository()
    change_service = subscription_engine.PlanChangeRequestService(repository=request_repo, plan_repository=repo)
    service = subscription_engine.SchoolSubscriptionService(
        repository=repo,
        override_repository=FakeOverrideRepository(),
        plan_change_service=change_service,
    )
    monkeypatch.setattr(subscription_engine, "_log_audit_entry", lambda **kwargs: None)

    future = date.today() + timedelta(days=5)
    result = service.change_plan(SCHOOL_ID, "premium", future, actor_profile_id="platform-profile", reason="Upgrade")

    assert result["mode"] == "scheduled"
    assert result["request"]["request_status"] == "scheduled"
    assert result["request"]["requested_plan_tier"] == "premium"


def test_get_plan_limits_applies_feature_overrides():
    repo = FakeSchoolPlanRepository()
    overrides = [{"id": "ovr-1", "resource_key": "students_used", "override_max_count": "750", "is_active": True, "reason": "Pilot", "effective_from": None, "effective_until": None}]
    service = subscription_engine.SchoolSubscriptionService(
        repository=repo,
        override_repository=FakeOverrideRepository(overrides=overrides),
    )

    limits = service.get_plan_limits(SCHOOL_ID)

    assert limits["limits"]["students_used"] == "750"
    assert limits["overrides"][0]["resource_key"] == "students_used"


def test_plan_change_request_service_approve_and_schedule(monkeypatch):
    repo = FakeSchoolPlanRepository()
    request_repo = FakePlanChangeRepository()
    service = subscription_engine.PlanChangeRequestService(repository=request_repo, plan_repository=repo)
    monkeypatch.setattr(subscription_engine, "_log_audit_entry", lambda **kwargs: None)

    created = service.create_request(SCHOOL_ID, "premium", requested_by="platform-profile")
    scheduled = service.schedule_change(created["id"], date.today() + timedelta(days=2), reviewed_by="reviewer")
    approved = service.approve_request(created["id"], reviewed_by="reviewer")

    assert created["request_status"] == "pending"
    assert scheduled["request_status"] == "scheduled"
    assert approved["request_status"] == "approved"


def test_platform_subscription_api_routes(monkeypatch):
    app = FastAPI()
    app.include_router(platform.router)

    app.dependency_overrides[platform.require_platform_admin] = lambda: SimpleNamespace(id="platform-profile", role_key="platform_admin")
    app.dependency_overrides[platform.get_authenticated_actor_context] = lambda: {"profile_id": "profile-platform"}

    monkeypatch.setattr(platform.school_subscription_service, "get_school_plan", lambda school_id: {"school_id": school_id, "plan_tier": "starter"})
    monkeypatch.setattr(platform.school_subscription_service, "activate_plan", lambda school_id, plan_tier, billing_cycle, actor_profile_id=None: {"school_id": school_id, "plan_tier": plan_tier, "billing_cycle": billing_cycle, "actor_profile_id": actor_profile_id})
    monkeypatch.setattr(platform.school_subscription_service, "change_plan", lambda school_id, new_tier, effective_date=None, actor_profile_id=None, billing_cycle=None, reason=None: {"school_id": school_id, "plan_tier": new_tier, "effective_date": str(effective_date) if effective_date else None, "reason": reason})
    monkeypatch.setattr(platform.school_subscription_service, "cancel_plan", lambda school_id, mode, actor_profile_id=None: {"school_id": school_id, "mode": mode})
    monkeypatch.setattr(platform.school_subscription_service, "pause_plan", lambda school_id, pause_until, actor_profile_id=None: {"school_id": school_id, "pause_until": str(pause_until)})
    monkeypatch.setattr(platform.school_subscription_service, "resume_plan", lambda school_id, actor_profile_id=None: {"school_id": school_id, "status": "active"})
    monkeypatch.setattr(platform.school_subscription_service, "list_plan_catalog", lambda: [{"plan_tier": "starter", "limits": {"students_used": 100}}])

    client = TestClient(app)

    response = client.get(f"/api/platform/schools/{SCHOOL_ID}/subscription")
    assert response.status_code == 200
    assert response.json()["school_id"] == SCHOOL_ID

    response = client.get("/api/platform/plans")
    assert response.status_code == 200
    assert response.json()["count"] == 1

    response = client.post(f"/api/platform/schools/{SCHOOL_ID}/subscription/activate", json={"plan_tier": "standard", "billing_cycle": "monthly"})
    assert response.status_code == 200
    assert response.json()["plan_tier"] == "standard"

    response = client.post(f"/api/platform/schools/{SCHOOL_ID}/subscription/change", json={"new_plan_tier": "premium", "reason": "Upgrade"})
    assert response.status_code == 200
    assert response.json()["plan_tier"] == "premium"

    response = client.post(f"/api/platform/schools/{SCHOOL_ID}/subscription/cancel", json={"mode": "immediate"})
    assert response.status_code == 200
    assert response.json()["mode"] == "immediate"

    response = client.post(f"/api/platform/schools/{SCHOOL_ID}/subscription/pause", json={"pause_until": (date.today() + timedelta(days=3)).isoformat()})
    assert response.status_code == 200
    assert SCHOOL_ID in response.json()["school_id"]

    response = client.post(f"/api/platform/schools/{SCHOOL_ID}/subscription/resume")
    assert response.status_code == 200
    assert response.json()["status"] == "active"
