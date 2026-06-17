from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import online_tests
from app.services import supabase_online_tests


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(online_tests.router)
    app.dependency_overrides[online_tests.resolve_school_id_from_actor] = lambda: "school-1"
    app.dependency_overrides[online_tests.get_authenticated_actor_context] = lambda: {"profile_id": "profile-1"}
    return app


def test_attempt_routes_use_student_scope(monkeypatch):
    app = _build_app()
    student_user = SimpleNamespace(role_key="student", user_type="student", role=None)
    app.dependency_overrides[online_tests.require_view_user] = lambda: student_user
    app.dependency_overrides[online_tests.require_attempt_user] = lambda: student_user

    captured: dict[str, object] = {}

    def fake_list_attempts(school_id, **kwargs):
        captured["attempt_list"] = (school_id, kwargs)
        return []

    def fake_list_results(school_id, **kwargs):
        captured["result_list"] = (school_id, kwargs)
        return []

    monkeypatch.setattr(online_tests, "list_attempts", fake_list_attempts)
    monkeypatch.setattr(online_tests, "list_results", fake_list_results)
    monkeypatch.setattr(
        online_tests,
        "get_attempt",
        lambda school_id, attempt_id: {
            "id": attempt_id,
            "school_id": school_id,
            "test_id": "test-1",
            "student_id": "student-1",
            "attempt_number": 1,
            "status": "in_progress",
            "started_at": None,
            "submitted_at": None,
            "auto_submitted_at": None,
            "evaluated_at": None,
            "total_questions_snapshot": 0,
            "answered_questions_snapshot": 0,
            "time_spent_seconds": 0,
            "metadata": {},
            "is_active": True,
            "responses": [],
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(
        online_tests,
        "start_attempt",
        lambda school_id, test_id, profile_id: {
            "id": "attempt-1",
            "school_id": school_id,
            "test_id": test_id,
            "student_id": "student-1",
            "attempt_number": 1,
            "status": "in_progress",
            "started_at": None,
            "submitted_at": None,
            "auto_submitted_at": None,
            "evaluated_at": None,
            "total_questions_snapshot": 0,
            "answered_questions_snapshot": 0,
            "time_spent_seconds": 0,
            "metadata": {"profile_id": profile_id},
            "is_active": True,
            "responses": [],
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(
        online_tests,
        "save_attempt",
        lambda school_id, attempt_id, profile_id, payload: {
            "id": attempt_id,
            "school_id": school_id,
            "test_id": "test-1",
            "student_id": "student-1",
            "attempt_number": 1,
            "status": "in_progress",
            "started_at": None,
            "submitted_at": None,
            "auto_submitted_at": None,
            "evaluated_at": None,
            "total_questions_snapshot": 2,
            "answered_questions_snapshot": 1,
            "time_spent_seconds": 30,
            "metadata": {"profile_id": profile_id, "payload": payload},
            "is_active": True,
            "responses": [],
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(
        online_tests,
        "submit_attempt",
        lambda school_id, attempt_id, profile_id: {
            "id": "result-1",
            "school_id": school_id,
            "attempt_id": attempt_id,
            "test_id": "test-1",
            "student_id": "student-1",
            "status": "evaluated",
            "total_questions": 2,
            "attempted_questions": 1,
            "correct_answers": 1,
            "incorrect_answers": 0,
            "unanswered_questions": 1,
            "score_obtained": 5.0,
            "max_score": 10.0,
            "percentage": 50.0,
            "rank_in_batch": 1,
            "rank_in_school": 1,
            "passed": True,
            "pass_marks": 5.0,
            "published_at": None,
            "metadata": {"profile_id": profile_id},
            "is_active": True,
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "_get_student_by_profile_id",
        lambda school_id, profile_id: {"id": "student-1", "school_id": school_id, "profile_id": profile_id},
    )

    client = TestClient(app)

    response = client.get("/api/online-tests/attempts", params={"test_id": "test-1"})
    assert response.status_code == 200
    assert captured["attempt_list"] == (
        "school-1",
        {"student_id": "student-1", "test_id": "test-1", "skip": 0, "limit": 100},
    )

    response = client.get("/api/online-tests/results", params={"test_id": "test-1"})
    assert response.status_code == 200
    assert captured["result_list"] == (
        "school-1",
        {"test_id": "test-1", "student_id": "student-1", "skip": 0, "limit": 100},
    )

    response = client.get("/api/online-tests/attempts/attempt-1")
    assert response.status_code == 200
    assert response.json()["id"] == "attempt-1"

    response = client.post("/api/online-tests/attempts", json={"test_id": "test-1"})
    assert response.status_code == 200
    assert response.json()["test_id"] == "test-1"

    response = client.post(
        "/api/online-tests/attempts/attempt-1/save",
        json={"question_id": "q1", "response_payload": {"selected_option_id": "a"}, "is_marked_for_review": False},
    )
    assert response.status_code == 200
    assert response.json()["answered_questions_snapshot"] == 1

    response = client.post("/api/online-tests/attempts/attempt-1/submit")
    assert response.status_code == 200
    assert response.json()["id"] == "result-1"


def test_manage_routes_cover_test_and_question_crud(monkeypatch):
    app = _build_app()
    admin_user = SimpleNamespace(role_key="school_admin", user_type="staff", role=online_tests.UserRole.ADMIN)
    app.dependency_overrides[online_tests.require_manage_user] = lambda: admin_user
    app.dependency_overrides[online_tests.require_view_user] = lambda: admin_user
    app.dependency_overrides[online_tests.require_reports_user] = lambda: admin_user

    monkeypatch.setattr(
        online_tests,
        "create_test",
        lambda school_id, profile_id, payload: {
            "id": "test-1",
            "school_id": school_id,
            "title": payload["title"],
            "description": payload.get("description"),
            "instructions": payload.get("instructions"),
            "test_code": payload.get("test_code"),
            "subject_id": payload.get("subject_id"),
            "batch_id": payload.get("batch_id"),
            "test_type": payload.get("test_type", "objective"),
            "delivery_mode": payload.get("delivery_mode", "scheduled"),
            "status": payload.get("status", "draft"),
            "duration_minutes": payload.get("duration_minutes", 60),
            "total_marks": payload.get("total_marks", 0),
            "pass_marks": payload.get("pass_marks"),
            "max_attempts": payload.get("max_attempts", 1),
            "shuffle_questions": payload.get("shuffle_questions", False),
            "shuffle_options": payload.get("shuffle_options", False),
            "show_result_immediately": payload.get("show_result_immediately", False),
            "allow_review": payload.get("allow_review", True),
            "starts_at": None,
            "ends_at": None,
            "published_at": None,
            "metadata": payload.get("metadata", {}),
            "is_active": True,
            "sections": [],
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(online_tests, "update_test", lambda school_id, test_id, profile_id, payload: online_tests.create_test(school_id, profile_id, {"title": payload.get("title", "Updated Test"), **payload}))
    monkeypatch.setattr(online_tests, "delete_test", lambda school_id, test_id, profile_id: {"message": "Online test deleted successfully"})
    monkeypatch.setattr(
        online_tests,
        "create_question",
        lambda school_id, payload, profile_id: {
            "id": "question-1",
            "school_id": school_id,
            "test_id": payload["test_id"],
            "section_id": payload.get("section_id") or "section-1",
            "question_code": payload.get("question_code"),
            "display_order": payload.get("display_order", 1),
            "question_type": payload.get("question_type", "single_choice"),
            "difficulty_level": payload.get("difficulty_level", "medium"),
            "prompt_text": payload["prompt_text"],
            "option_items": payload.get("option_items", []),
            "answer_key": payload.get("answer_key", {}),
            "explanation": payload.get("explanation"),
            "marks": payload.get("marks", 1),
            "negative_marks": payload.get("negative_marks", 0),
            "metadata": payload.get("metadata", {}),
            "is_active": True,
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(online_tests, "update_question", lambda school_id, question_id, payload, profile_id: online_tests.create_question(school_id, {"test_id": "test-1", "prompt_text": payload.get("prompt_text", "Updated"), **payload}, profile_id) | {"id": question_id})
    monkeypatch.setattr(online_tests, "delete_question", lambda school_id, question_id, profile_id: {"message": "Question deleted successfully"})
    monkeypatch.setattr(online_tests, "publish_test", lambda school_id, test_id, profile_id: online_tests.create_test(school_id, profile_id, {"title": "Published Test", "status": "published"}))
    monkeypatch.setattr(online_tests, "unpublish_test", lambda school_id, test_id, profile_id: online_tests.create_test(school_id, profile_id, {"title": "Draft Test", "status": "draft"}))
    monkeypatch.setattr(online_tests, "duplicate_test", lambda school_id, test_id, profile_id: online_tests.create_test(school_id, profile_id, {"title": "Draft Test (Copy)", "status": "draft"}))
    monkeypatch.setattr(
        online_tests,
        "get_results_analytics",
        lambda school_id, **kwargs: {
            "scope": "school",
            "school_id": school_id,
            "test_id": kwargs.get("test_id"),
            "total_tests": 1,
            "total_attempts": 1,
            "completed_attempts": 1,
            "evaluated_results": 1,
            "average_score": 5.0,
            "average_percentage": 50.0,
            "highest_score": 5.0,
            "lowest_score": 5.0,
            "published_results": 1,
        },
    )

    client = TestClient(app)

    response = client.post("/api/online-tests/tests", json={"title": "Physics Test"})
    assert response.status_code == 200
    assert response.json()["title"] == "Physics Test"

    response = client.put("/api/online-tests/tests/test-1", json={"title": "Physics Test Updated"})
    assert response.status_code == 200
    assert response.json()["title"] == "Physics Test Updated"

    response = client.delete("/api/online-tests/tests/test-1")
    assert response.status_code == 200
    assert response.json()["message"] == "Online test deleted successfully"

    response = client.post(
        "/api/online-tests/tests/test-1/questions",
        json={"test_id": "test-1", "prompt_text": "What is g?", "question_type": "numeric"},
    )
    assert response.status_code == 200
    assert response.json()["question_type"] == "numeric"

    response = client.put("/api/online-tests/questions/question-1", json={"prompt_text": "Updated prompt"})
    assert response.status_code == 200
    assert response.json()["prompt_text"] == "Updated prompt"

    response = client.delete("/api/online-tests/questions/question-1")
    assert response.status_code == 200
    assert response.json()["message"] == "Question deleted successfully"

    assert client.post("/api/online-tests/tests/test-1/publish").status_code == 200
    assert client.post("/api/online-tests/tests/test-1/unpublish").status_code == 200
    assert client.post("/api/online-tests/tests/test-1/duplicate").status_code == 200

    response = client.get("/api/online-tests/results/analytics")
    assert response.status_code == 200
    assert response.json()["evaluated_results"] == 1


def test_submit_attempt_records_pass_and_auto_submit(monkeypatch):
    updates: list[tuple[str, dict[str, object]]] = []
    inserts: list[tuple[str, dict[str, object]]] = []
    recalc_calls: list[tuple[str, str]] = []

    class FakeMutation:
        def __init__(self, table_name: str, payload: dict[str, object], sink: list[tuple[str, dict[str, object]]]):
            self.table_name = table_name
            self.payload = payload
            self.sink = sink

        def eq(self, *_args, **_kwargs):
            return self

        def execute(self):
            self.sink.append((self.table_name, self.payload))
            if self.table_name == "test_results":
                return SimpleNamespace(data=[{"id": "result-1", **self.payload}])
            return SimpleNamespace(data=[])

    class FakeSelect:
        def __init__(self, table_name: str):
            self.table_name = table_name

        def eq(self, *_args, **_kwargs):
            return self

        def is_(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def execute(self):
            return SimpleNamespace(data=[])

    class FakeTable:
        def __init__(self, table_name: str):
            self.table_name = table_name

        def update(self, payload: dict[str, object]):
            return FakeMutation(self.table_name, payload, updates)

        def insert(self, payload: dict[str, object]):
            return FakeMutation(self.table_name, payload, inserts)

        def select(self, *_args, **_kwargs):
            return FakeSelect(self.table_name)

    monkeypatch.setattr(
        supabase_online_tests,
        "_get_attempt_row",
        lambda school_id, attempt_id: {
            "id": attempt_id,
            "school_id": school_id,
            "test_id": "test-1",
            "student_id": "student-1",
            "status": "in_progress",
            "started_at": "2026-06-16T00:00:00+00:00",
        },
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "_get_student_by_profile_id",
        lambda school_id, profile_id: {"id": "student-1", "school_id": school_id, "profile_id": profile_id},
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "_get_test_row",
        lambda school_id, test_id: {"id": test_id, "duration_minutes": 30, "pass_marks": 5},
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "_question_rows_for_test",
        lambda school_id, test_id: [
            {"id": "q1", "marks": 5, "negative_marks": 0},
            {"id": "q2", "marks": 5, "negative_marks": 0},
        ],
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "_attempt_responses_rows",
        lambda school_id, attempt_id: [
            {"id": "resp-1", "question_id": "q1", "response_payload": {"selected_option_id": "a"}},
        ],
    )
    monkeypatch.setattr(supabase_online_tests, "_score_response", lambda question, payload: (True, 5.0))
    monkeypatch.setattr(supabase_online_tests, "_table", lambda name: FakeTable(name))
    monkeypatch.setattr(
        supabase_online_tests,
        "_recalculate_result_ranks",
        lambda school_id, test_id: recalc_calls.append((school_id, test_id)),
    )
    monkeypatch.setattr(
        supabase_online_tests,
        "get_result",
        lambda school_id, result_id: {
            "id": result_id,
            "school_id": school_id,
            "attempt_id": "attempt-1",
            "test_id": "test-1",
            "student_id": "student-1",
            "status": "evaluated",
            "total_questions": 2,
            "attempted_questions": 1,
            "correct_answers": 1,
            "incorrect_answers": 0,
            "unanswered_questions": 1,
            "score_obtained": 5.0,
            "max_score": 10.0,
            "percentage": 50.0,
            "rank_in_batch": 1,
            "rank_in_school": 1,
            "passed": True,
            "pass_marks": 5.0,
            "published_at": "2026-06-16T00:31:00+00:00",
            "metadata": {"passed": True, "pass_marks": 5.0, "auto_submitted": True},
            "is_active": True,
            "created_at": None,
            "updated_at": None,
        },
    )
    monkeypatch.setattr(supabase_online_tests, "_log_audit_entry", lambda **_kwargs: None)

    result = supabase_online_tests.submit_attempt("school-1", "attempt-1", "profile-1")

    assert result["passed"] is True
    assert result["rank_in_school"] == 1
    assert recalc_calls == [("school-1", "test-1")]
    attempt_update = next(payload for table_name, payload in updates if table_name == "test_attempts")
    assert attempt_update["auto_submitted_at"] is not None
    result_insert = next(payload for table_name, payload in inserts if table_name == "test_results")
    assert result_insert["metadata"]["passed"] is True
    assert result_insert["metadata"]["auto_submitted"] is True
