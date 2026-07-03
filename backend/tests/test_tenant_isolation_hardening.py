from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from app.routes import account_security, analytics, attendance, lms, reports, students
from app.models import UserRole
from app.services import supabase_account_security, supabase_analytics
from app.services.scope_engine import PermissionScopeContext


SCHOOL_A = "11111111-1111-1111-1111-111111111111"
SCHOOL_B = "22222222-2222-2222-2222-222222222222"


def _dummy_db():
    yield None


def _school_scope(permission_key: str, school_id: str = SCHOOL_A) -> PermissionScopeContext:
    user = SimpleNamespace(role=UserRole.ADMIN, role_key="school_admin", user_type="staff")
    return PermissionScopeContext(
        user=user,
        permission_key=permission_key,
        scope="school",
        role_key="school_admin",
        school_id=school_id,
        profile_id="profile-admin",
    )


def test_resolve_login_requires_school_context_for_username():
    with pytest.raises(HTTPException) as exc_info:
        supabase_account_security.resolve_login_email("student01")
    assert exc_info.value.status_code == 400
    assert "School context is required" in str(exc_info.value.detail)


def test_resolve_login_scopes_lookup_to_active_school_memberships(monkeypatch):
    captured: dict[str, list[tuple[str, object]]] = {}

    class FakeQuery:
        def __init__(self, table_name: str):
            self.table_name = table_name
            self.filters: list[tuple[str, object]] = []

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, column: str, value: object):
            self.filters.append((column, value))
            return self

        def in_(self, column: str, values: list[str]):
            self.filters.append((column, tuple(values)))
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def execute(self):
            captured[self.table_name] = list(self.filters)
            if self.table_name == "school_memberships":
                return SimpleNamespace(data=[{"profile_id": "profile-a"}])
            if self.table_name == "profiles":
                return SimpleNamespace(
                    data=[
                        {
                            "id": "profile-a",
                            "email": "student01@school-a.student.local",
                            "display_name": "student01",
                            "metadata": {"portal_access": {"username": "student01"}},
                        }
                    ]
                )
            return SimpleNamespace(data=[])

    monkeypatch.setattr(
        supabase_account_security,
        "_public_table",
        lambda table_name, supabase=None: FakeQuery(table_name),
    )

    resolved = supabase_account_security.resolve_login_email("student01", school_id=SCHOOL_A)
    assert resolved == {"email": "student01@school-a.student.local"}
    assert ("school_id", SCHOOL_A) in captured["school_memberships"]
    assert ("id", ("profile-a",)) in captured["profiles"]


def test_analytics_batch_lookup_is_scoped_to_school(monkeypatch):
    captured: list[tuple[str, object]] = []

    class FakeQuery:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, column: str, value: object):
            captured.append((column, value))
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"id": "batch-1", "school_id": SCHOOL_A, "name": "Class 10 A"}])

    monkeypatch.setattr(supabase_analytics, "_public_table", lambda _name: FakeQuery())
    row = supabase_analytics._get_batch(SCHOOL_A, "batch-1")
    assert row["school_id"] == SCHOOL_A
    assert ("school_id", SCHOOL_A) in captured
    assert ("id", "batch-1") in captured


def test_account_security_route_forwards_school_context(monkeypatch):
    app = FastAPI()
    app.include_router(account_security.router)

    captured: dict[str, str | None] = {}
    monkeypatch.setattr(
        account_security,
        "resolve_login_email",
        lambda identifier, school_id=None: captured.update({"identifier": identifier, "school_id": school_id}) or {"email": "x@example.com"},
    )

    client = TestClient(app)
    response = client.get("/api/account-security/resolve-login", params={"identifier": "student01", "school_id": SCHOOL_A})
    assert response.status_code == 200
    assert captured == {"identifier": "student01", "school_id": SCHOOL_A}


def test_school_analytics_blocks_cross_tenant_access_for_school_admin():
    app = FastAPI()
    app.include_router(analytics.router)
    school_admin = SimpleNamespace(role=analytics.UserRole.ADMIN, role_key="school_admin", user_type="staff")
    app.dependency_overrides[analytics.resolve_school_id_from_actor] = lambda: SCHOOL_A
    app.dependency_overrides[analytics.get_authenticated_actor_context] = lambda: {"profile_id": "profile-admin"}
    app.dependency_overrides[analytics.require_school_analytics_user] = lambda: school_admin

    client = TestClient(app)
    response = client.get(f"/api/analytics/school/{SCHOOL_B}")
    assert response.status_code == 403
    assert "Cross-school analytics" in response.json()["detail"]


def test_students_list_uses_actor_school_context(monkeypatch):
    app = FastAPI()
    app.include_router(students.router, prefix="/api/students")
    app.dependency_overrides[students.resolve_school_id_from_actor] = lambda: SCHOOL_A
    app.dependency_overrides[students.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}
    app.dependency_overrides[students.require_student_directory_scope] = lambda: _school_scope("admin_office.students")
    app.dependency_overrides[students.get_db] = _dummy_db

    captured: dict[str, object] = {}

    def fake_list_students(school_id: str, **kwargs):
        captured["school_id"] = school_id
        captured["kwargs"] = kwargs
        return []

    monkeypatch.setattr(students, "list_students_supabase", fake_list_students)

    client = TestClient(app)
    response = client.get("/api/students")
    assert response.status_code == 200
    assert response.json() == []
    assert captured["school_id"] == SCHOOL_A


def test_lms_courses_use_actor_school_context(monkeypatch):
    app = FastAPI()
    app.include_router(lms.router)
    school_admin = SimpleNamespace(role=lms.UserRole.ADMIN, role_key="school_admin", user_type="staff")
    app.dependency_overrides[lms.resolve_school_id_from_actor] = lambda: SCHOOL_A
    app.dependency_overrides[lms.get_authenticated_actor_context] = lambda: {"profile_id": "profile-admin"}
    app.dependency_overrides[lms.require_lms_view_user] = lambda: school_admin
    app.dependency_overrides[lms.require_lms_view_scope] = lambda: _school_scope("lms.view")

    captured: dict[str, object] = {}

    def fake_list_courses(school_id: str, include_inactive: bool = False, student=None):
        captured["school_id"] = school_id
        captured["include_inactive"] = include_inactive
        captured["student"] = student
        return []

    monkeypatch.setattr(lms, "list_courses", fake_list_courses)

    client = TestClient(app)
    response = client.get("/api/lms/courses")
    assert response.status_code == 200
    assert response.json() == []
    assert captured["school_id"] == SCHOOL_A
    assert captured["include_inactive"] is True


def test_attendance_reports_use_actor_school_context(monkeypatch):
    app = FastAPI()
    app.include_router(attendance.router)
    app.dependency_overrides[attendance.resolve_school_id_from_actor] = lambda: SCHOOL_A
    captured: dict[str, object] = {}

    async def fake_collect_student_report_records(school_id, class_name, section, batch_names, date_from, date_to):
        captured["school_id"] = school_id
        return []

    monkeypatch.setattr(attendance, "collect_student_report_records", fake_collect_student_report_records)

    client = TestClient(app)
    response = client.get("/api/attendance/reports/data", params={"school_id": SCHOOL_A, "report_type": "student_summary"})
    assert response.status_code == 200
    assert captured["school_id"] == SCHOOL_A


def test_reports_export_uses_actor_school_context(monkeypatch):
    app = FastAPI()
    app.include_router(reports.router, prefix="/api/reports")
    app.dependency_overrides[reports.resolve_school_id_from_seating_plan_context] = lambda: SCHOOL_A
    app.dependency_overrides[reports.require_reports_scope] = lambda: _school_scope("admin_office.reports")
    app.dependency_overrides[reports.get_db] = _dummy_db

    captured: dict[str, object] = {}

    def fake_build_single_room_plan(school_id: str, plan_id: str):
        captured["school_id"] = school_id
        captured["plan_id"] = plan_id
        return {"plan_data": {"assignment": {}}, "room_data": {"name": "Room 1"}}

    monkeypatch.setattr(reports, "_build_supabase_single_room_plan", fake_build_single_room_plan)
    monkeypatch.setattr(reports, "create_seating_report_pdf", lambda plan_data, room_data: BytesIO(b"pdf"))

    client = TestClient(app)
    response = client.get("/api/reports/pdf/plan-1")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert captured == {"school_id": SCHOOL_A, "plan_id": "plan-1"}
