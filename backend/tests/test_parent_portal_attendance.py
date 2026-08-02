"""Regression tests for the parent attendance center batched loader.

The /parent/attendance route previously built each child via _build_attendance,
issuing one Supabase query per child (N+1). It now loads attendance for all
visible students in a single batched query and builds children via
_build_attendance_from_batch. These tests lock in:
  1. The batched builder is output-identical to the per-student builder.
  2. The route uses the batched loader.
"""
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services import parent_portal_service as pps


def _attendance_rows():
    return [
        {"attendance_date": "2026-07-15", "status": "present"},
        {"attendance_date": "2026-07-16", "status": "absent"},
        {"attendance_date": "2026-06-10", "status": "present"},
    ]


class TestBatchedBuilderEquivalence:
    def test_batched_builder_matches_single_student_builder(self, monkeypatch):
        monkeypatch.setattr(
            pps,
            "_load_attendance_rows",
            lambda school_id, student_id, *, days=365: _attendance_rows(),
        )
        student = {"id": "stu-1", "full_name": "Alice"}
        single = pps._build_attendance("school-1", student)
        batched = pps._build_attendance_from_batch(student, _attendance_rows())
        assert single == batched

    def test_batch_loader_no_query_for_empty_students(self):
        assert pps._batch_load_attendance("school-1", []) == {}

    def test_batch_loader_groups_rows_by_student(self, monkeypatch):
        class Chainable:
            def __init__(self):
                self.rows = [
                    {"student_id": "stu-1", "attendance_date": "2026-07-15", "status": "present"},
                    {"student_id": "stu-2", "attendance_date": "2026-07-16", "status": "absent"},
                ]

            def select(self, *a, **k):
                return self

            def eq(self, *a, **k):
                return self

            def in_(self, column, values):
                self.in_ids = values
                return self

            def gte(self, *a, **k):
                return self

            def execute(self):
                return SimpleNamespace(data=self.rows)

        chainable = Chainable()
        monkeypatch.setattr(pps, "_schema_table", lambda schema, name: chainable)
        result = pps._batch_load_attendance("school-1", ["stu-1", "stu-2"])
        assert chainable.in_ids == ["stu-1", "stu-2"]
        assert set(result.keys()) == {"stu-1", "stu-2"}
        assert len(result["stu-1"]) == 1
        assert len(result["stu-2"]) == 1
        assert result["stu-1"][0]["status"] == "present"


class TestRouteUsesBatchedLoader:
    def test_attendance_route_uses_batched_loader(self):
        import inspect
        from app.routes.parent_portal import api_get_attendance
        source = inspect.getsource(api_get_attendance)
        assert "_batch_load_attendance" in source, (
            "api_get_attendance must load attendance in a single batched query"
        )
        assert "_build_attendance_from_batch" in source, (
            "api_get_attendance must build children from the batched rows"
        )
        assert "_build_attendance(school_id" not in source, (
            "api_get_attendance must not use the per-child N+1 builder"
        )
