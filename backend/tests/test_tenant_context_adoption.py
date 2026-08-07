from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.tenant_context import TenantContext
from datetime import datetime
from io import BytesIO

from app.routes import (
    admin_office,
    auth,
    ai_tutor,
    analytics,
    ai_agents,
    ai_assistants,
    account_security,
    bi,
    bulk_action_requests,
    credits,
    dashboard,
    doubts,
    edupay,
    hostels,
    inventory,
    live_classes,
    lms,
    monetization,
    parent_links,
    predictions,
    question_bank,
    rooms,
    school_self_service,
    seating,
    study_planner,
    students,
    online_tests,
    settings,
    teachers,
    uploads,
)
from app.services.scope_engine import PermissionScopeContext

SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _dummy_db():
    yield None


def _school_scope(permission_key: str) -> PermissionScopeContext:
    user = SimpleNamespace(role=None, role_key="school_admin", user_type="staff")
    return PermissionScopeContext(
        user=user,
        permission_key=permission_key,
        scope="school",
        role_key="school_admin",
        school_id=SCHOOL_ID,
        profile_id=PROFILE_ID,
    )


def _school_self_service_profile() -> dict[str, object]:
    return {
        "school_id": SCHOOL_ID,
        "branding": {},
        "portal_settings": {},
        "domain_settings": {},
        "email_templates": {},
        "messaging_templates": {},
        "preferences": {},
        "assets": [],
        "storage": {"total_files": 0, "total_size_bytes": 0, "total_size_mb": 0, "assets": []},
        "backups": {"items": [], "total_count": 0},
        "school_summary": {},
    }


def test_teachers_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(teachers.router, prefix="/api/teachers")
    app.dependency_overrides[teachers.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[teachers.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        teachers.supabase_teachers,
        "list_teachers",
        lambda school_id, skip=0, limit=100: captured.update(
            {"school_id": school_id, "skip": skip, "limit": limit}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/teachers")

    assert response.status_code == 200
    assert response.json() == []
    assert captured == {"school_id": SCHOOL_ID, "skip": 0, "limit": 100}


def test_online_tests_scope_uses_tenant_context_school_id():
    user = SimpleNamespace(role=online_tests.UserRole.ADMIN, role_key="school_admin", user_type="staff")
    context = online_tests.require_online_tests_manage_scope(
        tenant=TenantContext(school_id=SCHOOL_ID),
        actor={"profile_id": PROFILE_ID},
        user=user,
    )

    assert isinstance(context, PermissionScopeContext)
    assert context.school_id == SCHOOL_ID
    assert context.profile_id == PROFILE_ID
    assert context.permission_key == "online_tests.manage"


def test_ai_tutor_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(ai_tutor.router)
    user = SimpleNamespace(
        id=1,
        role=None,
        role_key="student",
        permissions=[],
        user_type="student",
        school_id=SCHOOL_ID,
        email="student@example.com",
        username="student",
    )
    app.dependency_overrides[ai_tutor.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[ai_tutor.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[ai_tutor.require_ai_tutor_chat_user] = lambda: user

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        ai_tutor,
        "tutor_chat",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, **kwargs}) or {
            "mode": "chat",
            "topic": "Maths",
            "student_profile": {},
            "personalization": {},
            "explanation": "ok",
        },
    )
    monkeypatch.setattr(
        ai_tutor,
        "prepare_route_retrofit",
        lambda **kwargs: SimpleNamespace(enabled=False),
    )
    monkeypatch.setattr(ai_tutor, "commit_route_retrofit", lambda _reservation: None)

    client = TestClient(app)
    response = client.post("/api/ai/chat", json={"topic": "Maths", "question": "What is x?"})

    assert response.status_code == 200
    assert response.json()["mode"] == "chat"
    assert captured["school_id"] == SCHOOL_ID
    assert captured["profile_id"] == PROFILE_ID


def test_inventory_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(inventory.router)
    app.dependency_overrides[inventory.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        inventory,
        "svc_list_suppliers",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, "kwargs": kwargs}) or [],
    )

    client = TestClient(app)
    response = client.get("/api/inventory/suppliers")

    assert response.status_code == 200
    assert response.json() == []
    assert captured["school_id"] == SCHOOL_ID
    assert captured["kwargs"] == {"search": None, "is_active": None}


def test_students_hostel_request_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(students.router, prefix="/api/students")
    app.dependency_overrides[students.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[students.get_authenticated_actor_context] = lambda: {"user_id": "user-1", "profile_id": PROFILE_ID}
    app.dependency_overrides[students.require_student_directory_scope] = lambda: _school_scope("admin_office.students")
    app.dependency_overrides[students.get_db] = _dummy_db

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        students,
        "get_student_supabase",
        lambda school_id, student_id: {"id": student_id, "school_id": school_id, "class_name": "10", "section": "A", "batch_name": "Batch A"},
    )
    monkeypatch.setattr(
        students,
        "create_or_update_hostel_request_supabase",
        lambda school_id, student_id, hostel_id, requested_notes=None: captured.update(
            {
                "school_id": school_id,
                "student_id": student_id,
                "hostel_id": hostel_id,
                "requested_notes": requested_notes,
            }
        ) or {
            "id": "request-1",
            "student_id": student_id,
            "student_name": "Student One",
            "roll_number": "R-1",
            "batch": "Batch A",
            "class_name": "10",
            "section": "A",
            "hostel_id": hostel_id,
            "hostel_name": "Hostel A",
            "requested_notes": requested_notes,
            "status": "pending",
            "request_status": "pending",
            "allocation_active": False,
            "requested_at": datetime.utcnow().isoformat(),
        },
    )

    client = TestClient(app)
    response = client.post(
        "/api/students/student-1/hostel-request",
        json={"hostel_id": "hostel-1", "requested_notes": "Near library"},
    )

    assert response.status_code == 200
    assert captured == {
        "school_id": SCHOOL_ID,
        "student_id": "student-1",
        "hostel_id": "hostel-1",
        "requested_notes": "Near library",
    }


def test_live_classes_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(live_classes.router)
    app.dependency_overrides[live_classes.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[live_classes.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[live_classes.require_live_class_view_user] = lambda: SimpleNamespace(
        role=live_classes.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
        email="admin@example.com",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        live_classes,
        "list_live_classes",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, **kwargs}) or [
            {
                "id": "session-1",
                "school_id": school_id,
                "timetable_entry_id": "tt-1",
                "session_date": "2026-08-06",
                "provider": "google_meet",
                "status": "scheduled",
                "metadata": {},
                "is_active": True,
                "participation_count": 0,
            }
        ],
    )

    client = TestClient(app)
    response = client.get("/api/live-classes")

    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_ID
    assert captured["profile_id"] == PROFILE_ID
    assert captured["role_key"] == "school_admin"


def test_lms_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(lms.router)
    app.dependency_overrides[lms.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[lms.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[lms.require_lms_view_user] = lambda: SimpleNamespace(
        role=lms.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )
    app.dependency_overrides[lms.require_lms_view_scope] = lambda: _school_scope("lms.view")

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        lms,
        "list_courses",
        lambda school_id, include_inactive=False, student=None: captured.update(
            {"school_id": school_id, "include_inactive": include_inactive, "student": student}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/lms/courses")

    assert response.status_code == 200
    assert response.json() == []
    assert captured == {"school_id": SCHOOL_ID, "include_inactive": True, "student": None}


def test_auth_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(auth.router, prefix="/api/auth")
    app.dependency_overrides[auth.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[auth.require_user_management_access] = lambda: SimpleNamespace(
        id="platform-profile",
        username="platformowner",
        full_name="Platform Owner",
        email="platform-owner@example.com",
        role="admin",
        role_key="platform_admin",
        user_type="non_teaching",
        permissions=["admin_office.access_control"],
        is_active=True,
        created_at="2026-07-29T09:00:00Z",
    )

    school_rows = [
        {
            "id": "membership-1",
            "school_id": SCHOOL_ID,
            "profile_id": "school-profile-1",
            "role_id": "role-school-admin",
            "status": "active",
            "is_primary": True,
            "is_active": True,
            "profiles": {
                "id": "school-profile-1",
                "email": "managed-admin@school.com",
                "full_name": "Managed Admin",
                "display_name": "managedadmin",
                "metadata": {"username": "managedadmin", "user_type": "non_teaching"},
                "is_active": True,
            },
            "roles": {
                "id": "role-school-admin",
                "role_key": "school_admin",
                "role_name": "School Admin",
                "metadata": None,
                "is_active": True,
            },
        }
    ]

    monkeypatch.setattr(auth, "create_supabase_admin_client", lambda: object())
    monkeypatch.setattr(auth, "_load_school_role_user_rows", lambda school_id, supabase=None: school_rows)
    monkeypatch.setattr(auth, "_load_role_permissions_map", lambda role_ids, supabase=None: {})

    client = TestClient(app)
    response = client.get("/api/auth/users/administrators")

    assert response.status_code == 200
    assert response.json()["school_administrators"][0]["email"] == "managed-admin@school.com"


def test_account_security_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(account_security.router)
    app.dependency_overrides[account_security.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[account_security.require_access_control_user] = lambda: SimpleNamespace(
        role="admin",
        role_key="school_admin",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        account_security,
        "get_student_portal_access",
        lambda school_id, student_id: captured.update({"school_id": school_id, "student_id": student_id}) or {
            "student_id": student_id,
            "profile_id": "profile-1",
        },
    )

    client = TestClient(app)
    response = client.get("/api/account-security/students/student-1")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "student_id": "student-1"}


def test_school_self_service_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(school_self_service.router)
    app.dependency_overrides[school_self_service.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[school_self_service.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[school_self_service.require_school_admin_user] = lambda: SimpleNamespace(
        role=school_self_service.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        school_self_service,
        "get_school_self_service_profile",
        lambda school_id, actor_profile_id=None: captured.update(
            {"school_id": school_id, "actor_profile_id": actor_profile_id}
        ) or _school_self_service_profile(),
    )

    client = TestClient(app)
    response = client.get("/api/school-self-service/profile")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "actor_profile_id": PROFILE_ID}


def test_seating_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(seating.router, prefix="/api/seating")
    app.dependency_overrides[seating.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        seating,
        "list_seating_plans",
        lambda school_id, exam_id=None, room_id=None: captured.update(
            {"school_id": school_id, "exam_id": exam_id, "room_id": room_id}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/seating/plans")

    assert response.status_code == 200
    assert response.json() == []
    assert captured == {"school_id": SCHOOL_ID, "exam_id": None, "room_id": None}


def test_question_bank_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(question_bank.router)
    app.dependency_overrides[question_bank.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        question_bank.qb_service,
        "list_exam_types",
        lambda school_id: captured.update({"school_id": school_id}) or [],
    )

    client = TestClient(app)
    response = client.get("/api/question-bank/exam-types")

    assert response.status_code == 200
    assert response.json() == []
    assert captured == {"school_id": SCHOOL_ID}


def test_rooms_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(rooms.router, prefix="/api/rooms")
    app.dependency_overrides[rooms.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[rooms.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        rooms,
        "list_rooms_supabase",
        lambda school_id, skip=0, limit=100: captured.update(
            {"school_id": school_id, "skip": skip, "limit": limit}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/rooms?skip=5&limit=7")

    assert response.status_code == 200
    assert response.json() == []
    assert captured == {"school_id": SCHOOL_ID, "skip": 5, "limit": 7}


def test_admin_office_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(admin_office.router, prefix="/api/admin-office")
    app.dependency_overrides[admin_office.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)

    captured: list[str] = []
    monkeypatch.setattr(admin_office, "list_exams", lambda school_id: captured.append(f"exams:{school_id}") or [])
    monkeypatch.setattr(admin_office, "list_rooms", lambda school_id, skip=0, limit=1000: captured.append(f"rooms:{school_id}") or [])
    monkeypatch.setattr(
        admin_office,
        "get_school_core_counts_cached",
        lambda school_id: captured.append(f"counts:{school_id}") or {"students_count": 0, "rooms_summary": {"count": 0, "totalCapacity": 0}},
    )
    monkeypatch.setattr(admin_office, "list_seating_plans_with_lookups", lambda school_id, **kwargs: captured.append(f"plans:{school_id}") or [])
    monkeypatch.setattr(admin_office, "get_room_assignments", lambda school_id, **kwargs: captured.append(f"assignments:{school_id}") or [])

    client = TestClient(app)
    response = client.get("/api/admin-office/snapshot")

    assert response.status_code == 200
    assert captured == [
        f"exams:{SCHOOL_ID}",
        f"rooms:{SCHOOL_ID}",
        f"counts:{SCHOOL_ID}",
        f"plans:{SCHOOL_ID}",
        f"assignments:{SCHOOL_ID}",
    ]


def test_analytics_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(analytics.router)
    app.dependency_overrides[analytics.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[analytics.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[analytics.require_teacher_analytics_user] = lambda: SimpleNamespace(
        role=analytics.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(analytics, "prepare_route_retrofit", lambda **kwargs: SimpleNamespace(enabled=False))
    monkeypatch.setattr(analytics, "commit_route_retrofit", lambda _reservation: None)
    monkeypatch.setattr(
        analytics,
        "get_batch_analytics",
        lambda school_id, batch_id, actor_profile_id=None: captured.update(
            {"school_id": school_id, "batch_id": batch_id, "actor_profile_id": actor_profile_id}
        ) or {
            "school_id": school_id,
            "batch_id": batch_id,
            "batch_name": "Batch A",
            "overall_percentage": 82.5,
            "active_students": 24,
            "subject_percentages": [],
            "weak_students": [],
            "strong_students": [],
            "monthly_progress": [],
            "weak_topics": [],
            "suggestions": [],
        },
    )

    client = TestClient(app)
    response = client.get("/api/analytics/batch/batch-1")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "batch_id": "batch-1", "actor_profile_id": PROFILE_ID}


def test_bi_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(bi.router)
    app.dependency_overrides[bi.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[bi.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[bi.require_bi_school_user] = lambda: SimpleNamespace(
        role=bi.User.role if hasattr(bi.User, "role") else None,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        bi,
        "get_academic_dashboard",
        lambda school_id, period="monthly", actor_profile_id=None: captured.update(
            {"school_id": school_id, "period": period, "actor_profile_id": actor_profile_id}
        ) or {
            "scope": "school",
            "school_id": school_id,
            "period": period,
            "attendance_trends": [],
            "performance_trends": [],
            "completion_rates": [],
            "weak_topics": [],
            "student_count": 0,
            "generated_at": None,
        },
    )

    client = TestClient(app)
    response = client.get("/api/bi/academic", params={"period": "weekly"})

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "period": "weekly", "actor_profile_id": PROFILE_ID}


def test_dashboard_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(dashboard.router)
    app.dependency_overrides[dashboard.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[dashboard.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}

    captured: dict[str, object] = {}
    dashboard._dashboard_cache.clear()
    monkeypatch.setattr(
        dashboard,
        "get_dashboard_metrics_rpc",
        lambda school_id: captured.update({"school_id": school_id}) or {"students_count": 10},
    )
    monkeypatch.setattr(dashboard, "_augment_dashboard_payload", lambda school_id, payload: payload)

    client = TestClient(app)
    response = client.get("/dashboard/metrics")

    assert response.status_code == 200
    assert response.json()["students_count"] == 10
    assert captured == {"school_id": SCHOOL_ID}


def test_settings_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(settings.router, prefix="/api/settings")
    app.dependency_overrides[settings.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[settings.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        settings,
        "_load_school_row",
        lambda school_id: captured.update({"school_id": school_id}) or {
            "id": school_id,
            "name": "School 1",
            "contact_phone": "",
            "contact_email": "",
            "timezone": "Asia/Kolkata",
            "metadata": {},
        },
    )

    client = TestClient(app)
    response = client.get("/api/settings")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID}


def test_bulk_action_requests_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(bulk_action_requests.router)
    app.dependency_overrides[bulk_action_requests.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[bulk_action_requests.get_authenticated_actor_context] = lambda: {
        "profile_id": PROFILE_ID,
        "role": "school_admin",
    }
    app.dependency_overrides[bulk_action_requests.get_authenticated_user] = lambda: SimpleNamespace(
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(bulk_action_requests, "can_request_bulk_action", lambda user, module_name: True)
    monkeypatch.setattr(
        bulk_action_requests,
        "create_bulk_action_request",
        lambda **kwargs: captured.update(kwargs) or {
            "id": "req-1",
            "school_id": kwargs["school_id"],
            "module_name": kwargs["module_name"],
            "action_type": kwargs["action_type"],
            "status": "pending",
            "reason": kwargs["reason"],
            "payload_json": kwargs["payload_json"],
            "requested_by_profile_id": kwargs["requested_by_profile_id"],
            "requested_role": kwargs["requested_role"],
            "approved_by_profile_id": None,
            "approved_role": None,
            "approved_at": None,
            "rejected_by_profile_id": None,
            "rejected_role": None,
            "rejected_at": None,
            "rejection_reason": None,
                "executed_by_profile_id": None,
                "executed_at": None,
                "execution_result": {},
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
        )

    client = TestClient(app)
    response = client.post(
        "/api/bulk-action-requests",
        json={
            "module_name": "attendance",
            "action_type": "delete_all",
            "reason": "cleanup",
            "payload_json": {"scope": "all"},
        },
    )

    assert response.status_code == 201
    assert captured["school_id"] == SCHOOL_ID


def test_uploads_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(uploads.router)
    app.dependency_overrides[uploads.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[uploads.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[uploads.require_upload_manager] = lambda: SimpleNamespace(
        role=uploads.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(uploads, "prepare_route_retrofit", lambda **kwargs: SimpleNamespace(enabled=False))
    monkeypatch.setattr(uploads, "commit_route_retrofit", lambda _reservation: None)

    async def fake_upload_file_to_supabase_storage(*, school_id, category, file, folder):
        captured.update({"school_id": school_id, "category": category, "folder": folder, "filename": file.filename})
        return {"url": "https://example.test/file"}

    monkeypatch.setattr(uploads, "upload_file_to_supabase_storage", fake_upload_file_to_supabase_storage)

    client = TestClient(app)
    response = client.post(
        "/api/uploads/image",
        files={"file": ("diagram.png", BytesIO(b"image-bytes"), "image/png")},
    )

    assert response.status_code == 200
    assert captured == {
        "school_id": SCHOOL_ID,
        "category": "image",
        "folder": "online_test",
        "filename": "diagram.png",
    }


def test_hostels_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(hostels.router)
    app.dependency_overrides[hostels.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[hostels.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        hostels,
        "supabase_get_occupancy_report_data",
        lambda school_id: captured.update({"school_id": school_id}) or [],
    )

    client = TestClient(app)
    response = client.get("/api/hostels/reports/export", params={"report_type": "occupancy", "export_format": "csv"})

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID}


def test_edupay_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(edupay.router)
    app.dependency_overrides[edupay.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[edupay.get_authenticated_actor_context] = lambda: {"user_id": "user-1", "role": "admin"}

    captured: dict[str, object] = {}
    monkeypatch.setattr(edupay, "ensure_supabase_school_exists", lambda school_id: captured.update({"ensured": school_id}))
    monkeypatch.setattr(
        edupay,
        "get_supabase_edupay_dashboard",
        lambda school_id, trace=None: captured.update({"school_id": school_id}) or {
            "total_collected": 0.0,
            "pending_amount": 0.0,
            "overdue_amount": 0.0,
            "upcoming_dues": 0,
            "total_students": 0,
            "active_fee_structures": 0,
            "reminders_queued": 0,
            "collection_trend": [],
            "payment_method_split": [],
            "reminders": [],
            "recent_payments": [],
        },
    )

    client = TestClient(app)
    response = client.get("/api/edupay/dashboard")

    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_ID
    assert captured["ensured"] == SCHOOL_ID


def test_monetization_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(monetization.router)
    app.dependency_overrides[monetization.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[monetization.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID, "role_key": "school_admin"}
    app.dependency_overrides[monetization.get_authenticated_user] = lambda: SimpleNamespace(
        id=1,
        role=monetization.User.role if hasattr(monetization.User, "role") else None,
        role_key="school_admin",
        permissions="edupay.subscriptions,edupay.revenue",
        user_type="staff",
        role_metadata={},
        username="admin",
        email="admin@example.com",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        monetization,
        "list_subscriptions",
        lambda school_id, profile_id=None, include_school_scope=False: captured.update(
            {"school_id": school_id, "profile_id": profile_id, "include_school_scope": include_school_scope}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/subscriptions")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "profile_id": PROFILE_ID, "include_school_scope": True}


def test_parent_links_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(parent_links.router)
    app.dependency_overrides[parent_links.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[parent_links.require_parent_link_admin] = lambda: SimpleNamespace(role_key="school_admin")

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        parent_links,
        "list_parent_directory",
        lambda school_id, search=None, limit=100: captured.update(
            {"school_id": school_id, "search": search, "limit": limit}
        ) or [],
    )

    client = TestClient(app)
    response = client.get("/api/parent-links/guardians", params={"search": "mehta", "limit": 5})

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "search": "mehta", "limit": 5}


def test_doubts_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(doubts.router)
    app.dependency_overrides[doubts.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[doubts.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[doubts.require_doubt_solver_user] = lambda: SimpleNamespace(
        role=doubts.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
        email="admin@example.com",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        doubts,
        "solve_text_doubt",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, **kwargs}) or {
            "session_id": "session-1",
            "question_id": "question-1",
            "solution_id": "solution-1",
            "input_type": "text",
            "source_language": "en",
            "normalized_question": "What is x?",
            "extracted_text": "What is x?",
            "detected_subject": "Math",
            "detected_topic": "Algebra",
            "confidence_score": 0.9,
            "extracted_equations": [],
            "extracted_diagrams": [],
            "extracted_mcqs": [],
            "extracted_numericals": [],
            "explanation": "Solve normally.",
            "final_answer": "x=2",
            "shortcut_method": None,
            "common_mistakes": [],
            "step_by_step": [],
            "personalization": {},
            "recommendations": [],
            "escalation_status": "resolved",
            "teacher_resolution_notes": None,
            "generated_at": None,
        },
    )

    client = TestClient(app)
    response = client.post("/api/doubts/text", json={"prompt": "What is x?"})

    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_ID


def test_study_planner_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(study_planner.router)
    app.dependency_overrides[study_planner.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[study_planner.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[study_planner.require_study_planner_view_user] = lambda: SimpleNamespace(
        role=study_planner.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
        email="admin@example.com",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(study_planner, "prepare_route_retrofit", lambda **kwargs: SimpleNamespace(enabled=False))
    monkeypatch.setattr(study_planner, "commit_route_retrofit", lambda _reservation: None)
    monkeypatch.setattr(
        study_planner,
        "get_today_planner",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, **kwargs}) or {"role": "school_admin"},
    )

    client = TestClient(app)
    response = client.get("/api/study-planner/today")

    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_ID


def test_predictions_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(predictions.router)
    app.dependency_overrides[predictions.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[predictions.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[predictions.require_student_predictions_user] = lambda: SimpleNamespace(
        role=predictions.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
        email="admin@example.com",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        predictions,
        "get_student_predictions_dashboard",
        lambda school_id, **kwargs: captured.update({"school_id": school_id, **kwargs}) or {
            "scope": "school",
            "school_id": school_id,
            "generated_at": None,
            "students": [],
            "early_warnings": [],
            "automated_actions": [],
            "model_registry": [],
        },
    )

    client = TestClient(app)
    response = client.get("/api/predictions/student")

    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_ID


def test_ai_agents_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(ai_agents.router)
    app.dependency_overrides[ai_agents.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[ai_agents.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[ai_agents.require_ai_agents_view_user] = lambda: SimpleNamespace(
        role=ai_agents.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        ai_agents,
        "get_ai_agents_dashboard",
        lambda school_id, actor_profile_id=None: captured.update(
            {"school_id": school_id, "actor_profile_id": actor_profile_id}
        ) or {
            "scope": "school",
            "school_id": school_id,
            "generated_at": None,
            "summary": {"agents": 0, "recommendations": 0, "pending_approvals": 0, "critical_alerts": 0},
            "critical_alerts": [],
            "pending_approvals": [],
            "agent_cards": [],
        },
    )

    client = TestClient(app)
    response = client.get("/api/ai-agents/dashboard")

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "actor_profile_id": PROFILE_ID}


def test_ai_assistants_router_uses_tenant_context_school_id(monkeypatch):
    app = FastAPI()
    app.include_router(ai_assistants.router)
    app.dependency_overrides[ai_assistants.get_tenant_context] = lambda: TenantContext(school_id=SCHOOL_ID)
    app.dependency_overrides[ai_assistants.get_authenticated_actor_context] = lambda: {"profile_id": PROFILE_ID}
    app.dependency_overrides[ai_assistants.require_school_ai_user] = lambda: SimpleNamespace(
        role=ai_assistants.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )

    captured: dict[str, object] = {}
    monkeypatch.setattr(
        ai_assistants,
        "answer_school_ai_question",
        lambda school_id, question, actor_profile_id=None: captured.update(
            {"school_id": school_id, "question": question, "actor_profile_id": actor_profile_id}
        ) or {
            "question": question,
            "answer": "All good",
            "attendance_insights": [],
            "performance_insights": [],
            "risk_alerts": [],
            "generated_at": None,
        },
    )

    client = TestClient(app)
    response = client.post("/api/ai-assistants/school/query", json={"question": "How are we doing?"})

    assert response.status_code == 200
    assert captured == {"school_id": SCHOOL_ID, "question": "How are we doing?", "actor_profile_id": PROFILE_ID}
