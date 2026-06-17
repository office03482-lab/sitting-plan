from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import attendance, invigilators, teachers
from app.services import supabase_attendance


def _build_attendance_app() -> FastAPI:
    app = FastAPI()
    app.include_router(attendance.router)
    app.dependency_overrides[attendance.resolve_school_id_from_actor] = lambda: "school-ctx"
    app.dependency_overrides[attendance.get_authenticated_actor_context] = lambda: {
        "profile_id": "profile-1",
        "role": "school_admin",
        "name": "QA Admin",
    }
    app.dependency_overrides[attendance.get_authenticated_user] = lambda: SimpleNamespace(
        role=attendance.UserRole.ADMIN,
        role_key="school_admin",
        user_type="staff",
    )
    return app


def _build_staff_app() -> FastAPI:
    app = FastAPI()
    app.include_router(teachers.router, prefix="/api/teachers")
    app.include_router(invigilators.router)
    app.dependency_overrides[teachers.resolve_school_id_from_actor] = lambda: "school-ctx"
    app.dependency_overrides[teachers.get_authenticated_actor_context] = lambda: {"user_id": "user-1"}
    app.dependency_overrides[invigilators.resolve_school_id_from_actor] = lambda: "school-ctx"
    return app


def test_attendance_save_rejects_invalid_student_ids(monkeypatch):
    app = _build_attendance_app()
    client = TestClient(app)

    monkeypatch.setattr(supabase_attendance, "get_supabase_admin_client", lambda: None)

    response = client.post(
        "/api/attendance/student-marking",
        params={"school_id": "school-ctx"},
        json={
            "date": "2026-06-16",
            "subject_id": "subject-1",
            "entries": [{"student_id": "123", "status": "present"}],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "No valid student IDs were provided for attendance save."


def test_attendance_save_rejects_invalid_staff_ids():
    app = _build_attendance_app()
    client = TestClient(app)

    response = client.post(
        "/api/attendance/staff-marking",
        params={"school_id": "school-ctx"},
        json={
            "date": "2026-06-16",
            "entries": [{"staff_member_id": "not-a-uuid", "status": "present"}],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "No valid staff member IDs were provided for attendance save."


def test_attendance_export_accepts_csv(monkeypatch):
    app = _build_attendance_app()
    client = TestClient(app)

    async def fake_collect_student_report_records(*args, **kwargs):
        return []

    monkeypatch.setattr(attendance, "collect_student_report_records", fake_collect_student_report_records)
    monkeypatch.setattr(attendance, "list_supabase_staff_records", lambda *args, **kwargs: [])
    monkeypatch.setattr(attendance, "list_supabase_attendance_leaves", lambda *args, **kwargs: [])

    response = client.get(
        "/api/attendance/reports/export",
        params={
            "school_id": "school-ctx",
            "report_type": "student_summary",
            "export_format": "csv",
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=\"student_summary.csv\"" == response.headers["content-disposition"]


def test_attendance_settings_and_delete_routes_use_resolved_school_scope(monkeypatch):
    app = _build_attendance_app()
    client = TestClient(app)
    captured: dict[str, object] = {}
    now = datetime.utcnow()

    monkeypatch.setattr(
        attendance,
        "get_attendance_settings",
        lambda school_id: {
            "minimum_attendance_threshold": 75.0,
            "working_hours_start": "09:00",
            "working_hours_end": "17:00",
            "updated_at": now,
        },
    )

    def fake_update_attendance_settings(school_id, minimum_attendance_threshold, working_hours_start, working_hours_end):
        captured["attendance_settings_update"] = (
            school_id,
            minimum_attendance_threshold,
            working_hours_start,
            working_hours_end,
        )
        return {
            "minimum_attendance_threshold": minimum_attendance_threshold,
            "working_hours_start": working_hours_start,
            "working_hours_end": working_hours_end,
            "updated_at": now,
        }

    def fake_delete_staff_record(school_id, record_id):
        captured["attendance_staff_delete"] = (school_id, record_id)
        return {"message": "Staff attendance record deleted successfully"}

    monkeypatch.setattr(attendance, "update_attendance_settings", fake_update_attendance_settings)
    monkeypatch.setattr(attendance, "delete_supabase_staff_record", fake_delete_staff_record)
    monkeypatch.setattr(attendance, "create_notification", lambda *args, **kwargs: None)

    get_response = client.get("/api/attendance/settings", params={"school_id": "school-ctx"})
    assert get_response.status_code == 200
    assert get_response.json()["minimum_attendance_threshold"] == 75.0

    put_response = client.put(
        "/api/attendance/settings",
        params={"school_id": "school-ctx"},
        json={
            "minimum_attendance_threshold": 80,
            "working_hours_start": "08:30",
            "working_hours_end": "16:30",
        },
    )
    assert put_response.status_code == 200
    assert captured["attendance_settings_update"] == ("school-ctx", 80.0, "08:30", "16:30")

    delete_response = client.delete("/api/attendance/staff-records/record-1", params={"school_id": "school-ctx"})
    assert delete_response.status_code == 200
    assert captured["attendance_staff_delete"] == ("school-ctx", "record-1")


def test_attendance_reports_and_analytics_routes_return_scoped_data(monkeypatch):
    app = _build_attendance_app()
    client = TestClient(app)

    async def fake_collect_student_report_records(*args, **kwargs):
        return [
            {
                "student_id": "student-1",
                "student_name": "Student One",
                "class_name": "10",
                "section": "A",
                "status": "present",
            }
        ]

    monkeypatch.setattr(attendance, "collect_student_report_records", fake_collect_student_report_records)
    monkeypatch.setattr(
        attendance,
        "get_supabase_student_dashboard",
        lambda school_id, **kwargs: {
            "scope": kwargs.get("scope") or "daily",
            "date": kwargs.get("date_value") or "2026-06-16",
            "class_name": kwargs.get("class_name"),
            "batch_name": kwargs.get("batch_name"),
            "total_count": 10,
            "present_count": 8,
            "absent_count": 1,
            "late_count": 1,
            "class_summary": [],
            "batch_summary": [],
            "date_summary": [],
        },
    )
    monkeypatch.setattr(
        attendance,
        "get_supabase_staff_dashboard",
        lambda school_id, **kwargs: {
            "present_count": 12,
            "absent_count": 1,
            "late_count": 2,
            "half_day_count": 0,
            "monthly_attendance_percentage": 92.3,
            "department_summary": [{"department": "Science", "present_count": 5}],
        },
    )

    report_response = client.get(
        "/api/attendance/reports/data",
        params={"school_id": "school-ctx", "report_type": "student_summary"},
    )
    assert report_response.status_code == 200
    assert report_response.json()["report_type"] == "student_summary"
    assert report_response.json()["total_records"] >= 1

    daily_response = client.get(
        "/api/attendance/dashboard",
        params={"school_id": "school-ctx", "date": "2026-06-16", "scope": "daily"},
    )
    assert daily_response.status_code == 200
    assert daily_response.json()["present_count"] == 8

    monthly_response = client.get(
        "/api/attendance/staff-dashboard",
        params={"school_id": "school-ctx", "date_from": "2026-06-01", "date_to": "2026-06-30"},
    )
    assert monthly_response.status_code == 200
    assert monthly_response.json()["monthly_attendance_percentage"] == 92.3


def test_teacher_and_invigilator_routes_use_resolved_school_scope(monkeypatch):
    app = _build_staff_app()
    client = TestClient(app)
    captured: dict[str, object] = {}
    now = datetime.utcnow()

    def fake_create_teacher(school_id, payload):
        captured["teacher_create"] = (school_id, payload)
        return {
            "id": "teacher-1",
            "school_id": school_id,
            "name": payload["name"],
            "subject": payload["subject"],
            "employee_code": payload.get("employee_code"),
            "email": payload.get("email"),
            "phone": payload.get("phone"),
            "department": payload.get("department"),
            "designation": payload.get("designation"),
            "joining_date": payload.get("joining_date"),
            "shift_timing": payload.get("shift_timing"),
            "is_active": payload.get("is_active", True),
            "metadata": payload.get("metadata") or {},
            "photoDataUrl": payload.get("photoDataUrl"),
            "created_at": now,
            "updated_at": now,
        }

    def fake_list_teachers(school_id, skip=0, limit=100):
        captured["teacher_list"] = (school_id, skip, limit)
        return []

    def fake_create_invigilator(school_id, payload):
        captured["invigilator_create"] = (school_id, payload)
        return {
            "id": "inv-1",
            "school_id": school_id,
            "staff_id": payload["staff_id"],
            "name": payload["name"],
            "email": payload.get("email"),
            "phone": payload.get("phone"),
            "department": payload.get("department"),
            "designation": payload.get("designation"),
            "joining_date": payload.get("joining_date"),
            "shift_timing": payload.get("shift_timing"),
            "is_active": payload.get("is_active", True),
            "metadata": payload.get("metadata") or {},
            "photoDataUrl": payload.get("photoDataUrl"),
            "created_at": now,
            "updated_at": now,
        }

    def fake_list_invigilators(school_id, is_active=None, skip=0, limit=100):
        captured["invigilator_list"] = (school_id, is_active, skip, limit)
        return []

    def fake_update_teacher(school_id, teacher_id, payload):
        captured["teacher_update"] = (school_id, teacher_id, payload)
        return {
            "id": teacher_id,
            "school_id": school_id,
            "name": payload.get("name", "Teacher One"),
            "subject": payload.get("subject", "Math"),
            "employee_code": payload.get("employee_code"),
            "email": payload.get("email"),
            "phone": payload.get("phone"),
            "department": payload.get("department"),
            "designation": payload.get("designation"),
            "joining_date": payload.get("joining_date"),
            "shift_timing": payload.get("shift_timing"),
            "is_active": payload.get("is_active", True),
            "metadata": payload.get("metadata") or {},
            "photoDataUrl": payload.get("photoDataUrl"),
            "created_at": now,
            "updated_at": now,
        }

    def fake_delete_teacher(school_id, teacher_id):
        captured["teacher_delete"] = (school_id, teacher_id)
        return {"message": "Teacher deleted successfully"}

    def fake_update_invigilator(school_id, invigilator_id, payload):
        captured["invigilator_update"] = (school_id, invigilator_id, payload)
        return {
            "id": invigilator_id,
            "school_id": school_id,
            "staff_id": payload.get("staff_id", "NT-1"),
            "name": payload.get("name", "Staff One"),
            "email": payload.get("email"),
            "phone": payload.get("phone"),
            "department": payload.get("department"),
            "designation": payload.get("designation"),
            "joining_date": payload.get("joining_date"),
            "shift_timing": payload.get("shift_timing"),
            "is_active": payload.get("is_active", True),
            "metadata": payload.get("metadata") or {},
            "photoDataUrl": payload.get("photoDataUrl"),
            "created_at": now,
            "updated_at": now,
        }

    def fake_delete_invigilator(school_id, invigilator_id):
        captured["invigilator_delete"] = (school_id, invigilator_id)
        return {"message": "Invigilator deleted successfully"}

    monkeypatch.setattr(
        teachers.supabase_teachers,
        "create_teacher",
        fake_create_teacher,
    )
    monkeypatch.setattr(
        teachers.supabase_teachers,
        "list_teachers",
        fake_list_teachers,
    )
    monkeypatch.setattr(teachers.supabase_teachers, "update_teacher", fake_update_teacher)
    monkeypatch.setattr(teachers.supabase_teachers, "delete_teacher", fake_delete_teacher)
    monkeypatch.setattr(
        invigilators,
        "create_invigilator",
        fake_create_invigilator,
    )
    monkeypatch.setattr(
        invigilators,
        "list_invigilators",
        fake_list_invigilators,
    )
    monkeypatch.setattr(invigilators, "update_invigilator", fake_update_invigilator)
    monkeypatch.setattr(invigilators, "delete_invigilator", fake_delete_invigilator)

    teacher_response = client.post(
        "/api/teachers",
        params={"school_id": "school-ctx"},
        json={"name": "Teacher One", "subject": "Math"},
    )
    assert teacher_response.status_code == 200
    assert captured["teacher_create"][0] == "school-ctx"

    teacher_list_response = client.get("/api/teachers", params={"school_id": "school-ctx", "skip": 2, "limit": 5})
    assert teacher_list_response.status_code == 200
    assert captured["teacher_list"] == ("school-ctx", 2, 5)

    teacher_update_response = client.put(
        "/api/teachers/teacher-1",
        params={"school_id": "school-ctx"},
        json={"name": "Teacher Updated"},
    )
    assert teacher_update_response.status_code == 200
    assert captured["teacher_update"] == ("school-ctx", "teacher-1", {"name": "Teacher Updated"})

    teacher_delete_response = client.delete("/api/teachers/teacher-1", params={"school_id": "school-ctx"})
    assert teacher_delete_response.status_code == 200
    assert captured["teacher_delete"] == ("school-ctx", "teacher-1")

    invigilator_response = client.post(
        "/api/invigilators",
        params={"school_id": "school-ctx"},
        json={"staff_id": "NT-1", "name": "Staff One"},
    )
    assert invigilator_response.status_code == 200
    assert captured["invigilator_create"][0] == "school-ctx"

    invigilator_list_response = client.get(
        "/api/invigilators",
        params={"school_id": "school-ctx", "skip": 1, "limit": 3},
    )
    assert invigilator_list_response.status_code == 200
    assert captured["invigilator_list"] == ("school-ctx", None, 1, 3)

    invigilator_update_response = client.put(
        "/api/invigilators/inv-1",
        params={"school_id": "school-ctx"},
        json={"name": "Staff Updated"},
    )
    assert invigilator_update_response.status_code == 200
    assert captured["invigilator_update"] == ("school-ctx", "inv-1", {"name": "Staff Updated"})

    invigilator_delete_response = client.delete("/api/invigilators/inv-1", params={"school_id": "school-ctx"})
    assert invigilator_delete_response.status_code == 200
    assert captured["invigilator_delete"] == ("school-ctx", "inv-1")
