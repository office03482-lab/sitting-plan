from __future__ import annotations

from datetime import datetime
from io import BytesIO

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import UserRole
from app.routes import timetable
from app.services.scope_engine import PermissionScopeContext
from app.services import supabase_timetable


def _build_app(actor: dict[str, str] | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(timetable.router, prefix="/api/timetable")
    app.include_router(timetable.utility_router, prefix="/api/timetable")
    app.dependency_overrides[timetable.resolve_school_id_from_actor] = lambda: "school-1"
    app.dependency_overrides[timetable.get_authenticated_actor_context] = lambda: actor or {
        "role": "school_admin",
        "name": "Admin User",
        "email": "admin@example.com",
    }
    return app


def _context(*, role: UserRole, role_key: str, scope: str, staff_member_id: str | None = None) -> PermissionScopeContext:
    user = type("TestUser", (), {"role": role, "role_key": role_key, "user_type": "staff"})()
    return PermissionScopeContext(
        user=user,
        permission_key="timetable.view" if scope != "manage" else "timetable.manage",
        scope=scope,
        role_key=role_key,
        school_id="school-1",
        profile_id="profile-1",
        staff_member_id=staff_member_id,
    )


def _row(entry_id: str, teacher_id: str = "teacher-1", teacher_name: str = "Teacher One", room_id: str = "room-1", room_name: str = "Room 1", class_name: str = "10 | A") -> dict[str, object]:
    now = datetime.utcnow()
    return {
        "id": entry_id,
        "teacher_id": teacher_id,
        "room_id": room_id,
        "school_id": "school-1",
        "session_mode": "offline",
        "session_type": "regular_class",
        "day_of_week": "monday",
        "start_time": "09:00",
        "end_time": "10:00",
        "class_name": class_name,
        "subject": "Math",
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "teacher_name": teacher_name,
        "room_name": room_name,
        "start_date": None,
        "end_date": None,
        "notes": None,
        "extra_class_scope": None,
        "online_platform": None,
        "online_link": None,
        "online_provider": None,
        "meeting_link": None,
        "meeting_id": None,
        "meeting_password": None,
        "recording_url": None,
    }


def test_teacher_scope_is_enforced_for_list_count_get_and_export(monkeypatch):
    actor = {"role": "teacher", "name": "Teacher One", "email": "teacher1@example.com"}
    app = _build_app(actor)
    app.dependency_overrides[timetable.require_timetable_view_scope] = lambda: _context(
        role=UserRole.TEACHER,
        role_key="teacher",
        scope="assigned",
        staff_member_id="teacher-1",
    )
    client = TestClient(app)

    monkeypatch.setattr(timetable, "_resolve_actor_teacher_scope", lambda school_id, actor: ("teacher-1", "teacher one"))
    monkeypatch.setattr(
        timetable,
        "list_timetable_entries_supabase",
        lambda *args, **kwargs: [
            _row("entry-1", teacher_id="teacher-1", teacher_name="Teacher One"),
            _row("entry-2", teacher_id="teacher-2", teacher_name="Teacher Two"),
        ],
    )
    monkeypatch.setattr(
        timetable,
        "get_timetable_entry_supabase",
        lambda school_id, entry_id: _row(entry_id, teacher_id="teacher-2", teacher_name="Teacher Two") if entry_id == "entry-2" else _row(entry_id),
    )
    monkeypatch.setattr(timetable, "create_timetable_pdf", lambda entries, view_by, session_mode_filter="all": BytesIO(b"pdf"))

    list_response = client.get("/api/timetable")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["id"] == "entry-1"

    count_response = client.get("/api/timetable/count")
    assert count_response.status_code == 200
    assert count_response.json() == 1

    own_response = client.get("/api/timetable/entry-1")
    assert own_response.status_code == 200

    denied_response = client.get("/api/timetable/entry-2")
    assert denied_response.status_code == 403

    export_response = client.get("/api/timetable/export", params={"export_format": "pdf", "view_by": "teacher"})
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("application/pdf")


def test_admin_crud_conflict_and_export_routes(monkeypatch):
    app = _build_app()
    app.dependency_overrides[timetable.require_timetable_view_scope] = lambda: _context(
        role=UserRole.ADMIN,
        role_key="school_admin",
        scope="school",
    )
    app.dependency_overrides[timetable.require_timetable_manage_scope] = lambda: _context(
        role=UserRole.ADMIN,
        role_key="school_admin",
        scope="school",
    )
    client = TestClient(app)
    created_payloads: list[dict[str, object]] = []

    monkeypatch.setattr(timetable, "create_timetable_entry_supabase", lambda school_id, payload: created_payloads.append({"school_id": school_id, **payload}) or _row("entry-created"))
    monkeypatch.setattr(timetable, "update_timetable_entry_supabase", lambda school_id, entry_id, payload: _row(entry_id))
    monkeypatch.setattr(timetable, "delete_timetable_entry_supabase", lambda school_id, entry_id: {"message": "Timetable entry deleted successfully"})
    monkeypatch.setattr(timetable, "delete_all_timetable_entries_supabase", lambda school_id: {"message": "3 timetable entries deleted successfully"})
    monkeypatch.setattr(timetable, "list_timetable_entries_supabase", lambda *args, **kwargs: [_row("entry-1")])
    monkeypatch.setattr(timetable, "get_timetable_entry_supabase", lambda school_id, entry_id: _row(entry_id))
    monkeypatch.setattr(timetable, "create_timetable_excel", lambda entries, view_by, session_mode_filter="all": BytesIO(b"xlsx"))
    monkeypatch.setattr(timetable, "create_timetable_pdf", lambda entries, view_by, session_mode_filter="all": BytesIO(b"pdf"))
    monkeypatch.setattr(timetable, "check_teacher_conflicts_supabase", lambda *args, **kwargs: [])
    monkeypatch.setattr(timetable, "check_room_conflicts_supabase", lambda *args, **kwargs: [])
    monkeypatch.setattr(timetable, "check_batch_conflicts_supabase", lambda *args, **kwargs: [])

    create_response = client.post(
        "/api/timetable",
        json={
            "teacher_id": "teacher-1",
            "room_id": "room-1",
            "session_mode": "offline",
            "session_type": "regular_class",
            "day_of_week": "monday",
            "start_time": "09:00",
            "end_time": "10:00",
            "class_name": "10 | A",
            "subject": "Math",
        },
    )
    assert create_response.status_code == 200
    assert created_payloads[0]["school_id"] == "school-1"

    update_response = client.put("/api/timetable/entry-1", json={"subject": "Science"})
    assert update_response.status_code == 200

    delete_response = client.delete("/api/timetable/entry-1")
    assert delete_response.status_code == 200

    delete_all_response = client.delete("/api/timetable", params={"is_admin": True})
    assert delete_all_response.status_code == 200

    excel_export_response = client.get("/api/timetable/export", params={"export_format": "excel"})
    assert excel_export_response.status_code == 200
    assert "spreadsheetml.sheet" in excel_export_response.headers["content-type"]

    pdf_export_response = client.get("/api/timetable/export", params={"export_format": "pdf"})
    assert pdf_export_response.status_code == 200
    assert pdf_export_response.headers["content-type"].startswith("application/pdf")

    monkeypatch.setattr(timetable, "check_room_conflicts_supabase", lambda *args, **kwargs: [{"id": "entry-room"}])
    room_conflict_response = client.post(
        "/api/timetable/check-conflict",
        json={
            "teacher_id": "teacher-1",
            "room_id": "room-1",
            "class_name": "10 | A",
            "day_of_week": "monday",
            "start_time": "09:00",
            "end_time": "10:00",
        },
    )
    assert room_conflict_response.status_code == 200
    assert room_conflict_response.json()["has_conflict"] is True
    assert "Room is already assigned" in room_conflict_response.json()["message"]


def test_service_rejects_room_and_batch_conflicts(monkeypatch):
    monkeypatch.setattr(supabase_timetable, "_check_room_exists", lambda school_id, room_id: room_id)
    monkeypatch.setattr(supabase_timetable, "_ensure_active_staff_member", lambda school_id, staff_member_id: str(staff_member_id))
    monkeypatch.setattr(supabase_timetable, "_fetch_staff_lookup", lambda school_id, staff_ids: {"teacher-1": {"full_name": "Teacher One"}})
    monkeypatch.setattr(supabase_timetable, "_fetch_room_lookup", lambda school_id, room_ids: {"room-1": {"name": "Room 1"}})
    monkeypatch.setattr(supabase_timetable, "_resolve_subject_id_for_timetable", lambda school_id, class_name, subject_name: "subject-1")
    monkeypatch.setattr(supabase_timetable, "check_teacher_conflicts", lambda *args, **kwargs: [])
    monkeypatch.setattr(supabase_timetable, "check_room_conflicts", lambda *args, **kwargs: [{"id": "room-conflict"}])

    try:
        supabase_timetable.create_timetable_entry(
            "school-1",
            {
                "teacher_id": "teacher-1",
                "room_id": "room-1",
                "day_of_week": "monday",
                "start_time": "09:00",
                "end_time": "10:00",
                "class_name": "10 | A",
                "subject": "Math",
                "session_type": "regular_class",
            },
        )
        assert False, "Expected room conflict exception"
    except Exception as exc:
        assert "Room conflict" in str(exc.detail)

    monkeypatch.setattr(supabase_timetable, "check_room_conflicts", lambda *args, **kwargs: [])
    monkeypatch.setattr(supabase_timetable, "check_batch_conflicts", lambda *args, **kwargs: [{"id": "batch-conflict"}])

    try:
        supabase_timetable.create_timetable_entry(
            "school-1",
            {
                "teacher_id": "teacher-1",
                "room_id": "room-1",
                "day_of_week": "monday",
                "start_time": "09:00",
                "end_time": "10:00",
                "class_name": "10 | A",
                "subject": "Math",
                "session_type": "regular_class",
            },
        )
        assert False, "Expected batch conflict exception"
    except Exception as exc:
        assert "Batch conflict" in str(exc.detail)
