from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import platform


SCHOOL_ID = "11111111-1111-1111-1111-111111111111"


def _build_app() -> TestClient:
    app = FastAPI()
    app.include_router(platform.router)
    app.dependency_overrides[platform.require_platform_admin] = lambda: SimpleNamespace(id="platform-profile", role_key="platform_admin")
    app.dependency_overrides[platform.get_authenticated_actor_context] = lambda: {"profile_id": "profile-platform", "school_id": SCHOOL_ID}
    return TestClient(app)


def test_platform_school_lifecycle_routes(monkeypatch):
    client = _build_app()
    monkeypatch.setattr(platform.platform_control_plane, "list_schools", lambda **kwargs: {"items": [{"id": SCHOOL_ID, "school_code": "SCH1", "slug": "school-1", "name": "School 1", "timezone": "Asia/Kolkata", "status": "active", "is_active": True, "student_count": 10, "teacher_count": 2, "staff_count": 3, "metadata": {}}], "total_count": 1})
    monkeypatch.setattr(platform.platform_control_plane, "create_school", lambda payload, actor_profile_id=None: {"id": SCHOOL_ID, "school_code": payload["school_code"], "slug": payload["slug"], "name": payload["name"], "timezone": payload.get("timezone", "Asia/Kolkata"), "status": "active", "is_active": True, "student_count": 0, "teacher_count": 0, "staff_count": 0, "metadata": {}})
    monkeypatch.setattr(platform.platform_control_plane, "get_school_detail", lambda school_id: {"id": school_id, "school_code": "SCH1", "slug": "school-1", "name": "School 1", "timezone": "Asia/Kolkata", "status": "active", "is_active": True, "student_count": 10, "teacher_count": 2, "staff_count": 3, "metadata": {}})
    monkeypatch.setattr(platform.platform_control_plane, "update_school", lambda school_id, payload, actor_profile_id=None: {"id": school_id, "school_code": payload.get("school_code", "SCH1"), "slug": payload.get("slug", "school-1"), "name": payload.get("name", "School 1"), "timezone": "Asia/Kolkata", "status": "active", "is_active": True, "student_count": 10, "teacher_count": 2, "staff_count": 3, "metadata": {}})
    monkeypatch.setattr(platform.platform_control_plane, "set_school_status", lambda school_id, status, actor_profile_id=None, reason=None: {"id": school_id, "school_code": "SCH1", "slug": "school-1", "name": "School 1", "timezone": "Asia/Kolkata", "status": status, "is_active": status == "active", "student_count": 10, "teacher_count": 2, "staff_count": 3, "metadata": {"reason": reason}})
    monkeypatch.setattr(platform.platform_control_plane, "clone_school_settings", lambda source_school_id, target_school_id, actor_profile_id=None: {"id": target_school_id, "school_code": "SCH2", "slug": "school-2", "name": "School 2", "timezone": "Asia/Kolkata", "status": "active", "is_active": True, "student_count": 0, "teacher_count": 0, "staff_count": 0, "metadata": {"source_school_id": source_school_id}})
    monkeypatch.setattr(platform.platform_control_plane, "copy_academic_structure", lambda source_school_id, target_school_id, actor_profile_id=None: {"source_school_id": source_school_id, "target_school_id": target_school_id, "batches_created": 2, "subjects_created": 4})

    assert client.get("/api/platform/schools").status_code == 200
    assert client.post("/api/platform/schools", json={"school_code": "SCH1", "slug": "school-1", "name": "School 1"}).status_code == 200
    assert client.get(f"/api/platform/schools/{SCHOOL_ID}").status_code == 200
    assert client.put(f"/api/platform/schools/{SCHOOL_ID}", json={"name": "Renamed"}).status_code == 200
    status_response = client.post(f"/api/platform/schools/{SCHOOL_ID}/status", json={"status": "suspended"})
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "suspended"
    assert client.post("/api/platform/schools/clone-settings", json={"source_school_id": SCHOOL_ID, "target_school_id": "22222222-2222-2222-2222-222222222222"}).status_code == 200
    assert client.post("/api/platform/schools/copy-academic-structure", json={"source_school_id": SCHOOL_ID, "target_school_id": "22222222-2222-2222-2222-222222222222"}).status_code == 200


def test_platform_subscription_usage_analytics_and_health_routes(monkeypatch):
    client = _build_app()
    monkeypatch.setattr(platform.platform_control_plane, "get_subscription_summary", lambda school_id: {"school_id": school_id, "current_plan": "starter", "status": "trial", "usage": {}, "grace_period_days": 7, "payment_status": "pending", "metadata": {}})
    monkeypatch.setattr(platform.platform_control_plane, "get_usage_dashboard", lambda school_id=None: {"items": [{"school_id": SCHOOL_ID, "school_name": "School 1", "students": 10, "teachers": 2, "parents": 8, "staff": 4, "rooms": 6, "attendance_records": 20, "ai_credits_used": 5, "ai_requests": 11, "online_tests": 2, "storage_used_gb": 1.25, "database_size_mb": 80, "monthly_active_users": 7}], "total_students": 10, "total_teachers": 2, "total_ai_requests": 11, "total_storage_used_gb": 1.25})
    monkeypatch.setattr(platform.platform_control_plane, "get_health_dashboard", lambda school_id=None: {"items": [{"school_id": SCHOOL_ID, "school_name": "School 1", "api_status": "healthy", "background_jobs": "stable", "queue_status": "idle", "storage_health": "healthy"}]})
    monkeypatch.setattr(platform.platform_control_plane, "get_platform_analytics_overview", lambda: {"total_schools": 2, "active_schools": 1, "trial_schools": 1, "revenue": 99.0, "monthly_growth": 1, "student_count": 10, "teacher_count": 2, "subscriptions": 2, "ai_usage": 5, "credit_sales": 44.0})

    assert client.get(f"/api/platform/schools/{SCHOOL_ID}/subscription-summary").status_code == 200
    assert client.get("/api/platform/usage").status_code == 200
    assert client.get("/api/platform/health").status_code == 200
    analytics_response = client.get("/api/platform/analytics-overview")
    assert analytics_response.status_code == 200
    assert analytics_response.json()["revenue"] == 99.0


def test_platform_support_audit_search_notifications_and_onboarding(monkeypatch):
    client = _build_app()
    monkeypatch.setattr(platform.platform_control_plane, "global_search", lambda q, limit=25: {"items": [{"entity_type": "student", "school_id": SCHOOL_ID, "school_name": "School 1", "entity_id": "student-1", "title": "Aarav", "subtitle": "ADM-1", "metadata": {}}], "total_count": 1})
    monkeypatch.setattr(platform.platform_control_plane, "run_support_action", lambda school_id, action, actor_profile_id=None, notes=None: {"school_id": school_id, "action": action, "status": "completed", "audited": True, "details": {"notes": notes}})
    monkeypatch.setattr(platform.platform_control_plane, "list_audit_center", lambda **kwargs: {"items": [{"action": "platform.school.created", "module_key": "platform_control_plane"}], "total_count": 1})
    monkeypatch.setattr(platform.platform_control_plane, "list_notifications", lambda: {"items": [{"id": "notif-1", "title": "Maintenance", "message": "Tonight", "notification_type": "maintenance", "severity": "warning", "audience_scope": "all", "school_ids": [], "metadata": {}}], "total_count": 1})
    monkeypatch.setattr(platform.platform_control_plane, "create_notification", lambda payload, actor_profile_id=None: {"id": "notif-2", "title": payload["title"], "message": payload["message"], "notification_type": payload["notification_type"], "severity": payload.get("severity", "info"), "audience_scope": payload.get("audience_scope", "all"), "school_ids": payload.get("school_ids", []), "metadata": payload.get("metadata", {})})
    monkeypatch.setattr(platform.platform_control_plane, "run_onboarding", lambda payload, actor_profile_id=None: {"school": {"id": SCHOOL_ID, "school_code": payload["school_code"], "slug": payload["slug"], "name": payload["name"], "timezone": "Asia/Kolkata", "status": "active", "is_active": True, "student_count": 0, "teacher_count": 0, "staff_count": 0, "metadata": {}}, "roles_created": 5, "permissions_seeded": True, "batches_created": 2, "subscription_initialized": True, "usage_initialized": True, "ai_wallet_initialized": True, "admin_membership_created": False})

    assert client.get("/api/platform/search", params={"q": "Aarav"}).status_code == 200
    support_response = client.post(f"/api/platform/support/{SCHOOL_ID}", json={"action": "recalculate_usage"})
    assert support_response.status_code == 200
    assert support_response.json()["audited"] is True
    assert client.get("/api/platform/audit-center").status_code == 200
    assert client.get("/api/platform/notifications").status_code == 200
    assert client.post("/api/platform/notifications", json={"title": "Maintenance", "message": "Tonight", "notification_type": "maintenance", "severity": "warning", "audience_scope": "all"}).status_code == 200
    onboarding_response = client.post("/api/platform/onboarding", json={"school_code": "NEW1", "slug": "new-1", "name": "New School"})
    assert onboarding_response.status_code == 200
    assert onboarding_response.json()["roles_created"] == 5
