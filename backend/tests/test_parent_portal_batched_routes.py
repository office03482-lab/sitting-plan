"""Regression tests for the parent portal batched route builders.

The /parent/academic-progress, /parent/test-results, /parent/assignments and
/parent/alerts routes previously built each child via the per-student
_build_* builders, issuing one or more Supabase queries per child (N+1). They
now load all data in batched queries and build children via the _build_*_from_batch
builders. These tests lock in:
  1. Each batched builder is output-identical to the per-student builder.
  2. Each route uses the batched loaders / builders.
"""
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services import parent_portal_service as pps


def _attendance_rows():
    return [
        {"attendance_date": "2026-07-15", "status": "present"},
        {"attendance_date": "2026-07-16", "status": "present"},
        {"attendance_date": "2026-06-10", "status": "present"},
    ]


def _result_rows():
    return [
        {"id": "r1", "test_title": "Maths Test", "subject": "Maths", "marks": 85, "total_marks": 100, "percentage": 85.0, "rank": 3, "created_at": "2026-07-10T10:00:00Z"},
        {"id": "r2", "test_title": "Science Test", "subject": "Science", "marks": 60, "total_marks": 100, "percentage": 60.0, "rank": 5, "created_at": "2026-06-20T10:00:00Z"},
    ]


def _assignment_rows():
    return [
        {"id": "a1", "title": "Homework 1", "course_name": "Maths", "due_date": "2026-07-20", "submission": None, "grade": None, "max_grade": 10},
        {"id": "a2", "title": "Project", "course_name": "Science", "due_date": "2026-06-15", "submission": {"id": "s1"}, "grade": 9, "max_grade": 10},
    ]


def _student():
    return {"id": "stu-1", "full_name": "Alice", "class_name": "10", "section": "A", "batch_id": "batch-1"}


class TestBatchedBuilderEquivalence:
    def test_academic_progress_batched_matches_single_builder(self, monkeypatch):
        monkeypatch.setattr(pps, "get_progress_dashboard", lambda school_id, *, student: {"progress_items": [], "revision_tracker": []})
        monkeypatch.setattr(pps, "list_assignments", lambda school_id, *, student: _assignment_rows())
        monkeypatch.setattr(pps, "_get_student_analytics_data", lambda school_id, student_id: {"weak_topics": ["algebra"], "strong_topics": ["geometry"], "suggestions": []})
        student = _student()
        single = pps._build_academic_progress("school-1", student)
        batched = pps._build_academic_progress_from_batch("school-1", student, _assignment_rows(), [], [])
        assert single == batched

    def test_test_results_batched_matches_single_builder(self, monkeypatch):
        monkeypatch.setattr(pps, "list_results", lambda school_id, student_id, *, limit: _result_rows())
        student = _student()
        single = pps._build_test_results("school-1", student)
        batched = pps._build_test_results_from_batch(student, _result_rows())
        assert single == batched

    def test_assignments_batched_matches_single_builder(self, monkeypatch):
        monkeypatch.setattr(pps, "list_assignments", lambda school_id, *, student: _assignment_rows())
        student = _student()
        single = pps._build_assignments("school-1", student)
        batched = pps._build_assignments_from_batch(student, _assignment_rows())
        assert single == batched

    def test_alerts_batched_matches_single_builder(self, monkeypatch):
        monkeypatch.setattr(pps, "_load_attendance_rows", lambda school_id, student_id, *, days=90: _attendance_rows())
        monkeypatch.setattr(pps, "list_results", lambda school_id, student_id, *, limit: [])
        monkeypatch.setattr(pps, "list_assignments", lambda school_id, *, student: [])
        monkeypatch.setattr(pps, "_get_fee_status", lambda school_id, student_id: {"due_amount": 0, "status": "paid"})
        student = {"id": "stu-1", "full_name": "Alice", "class_name": "10", "section": "A"}
        single = pps._build_alerts("school-1", student)
        batched = pps._build_alerts_from_batch(
            "school-1",
            student,
            attendance_rows=_attendance_rows(),
            test_results_list=[],
            assignments=[],
            shared_tests=[],
            fee_data={"due_amount": 0, "status": "paid"},
        )
        assert single == batched

    def test_alerts_from_batch_does_not_query_fees_when_preloaded(self, monkeypatch):
        def boom(school_id, student_id):
            raise AssertionError("_get_fee_status must not be called when fee_data is provided")

        monkeypatch.setattr(pps, "_get_fee_status", boom)
        result = pps._build_alerts_from_batch(
            "school-1",
            _student(),
            attendance_rows=_attendance_rows(),
            test_results_list=[],
            assignments=[],
            shared_tests=[],
            fee_data={"due_amount": 0, "status": "paid"},
        )
        assert result["total_alerts"] == 0


class TestRoutesUseBatchedBuilders:
    def test_academic_progress_route_uses_batched_loader(self):
        import inspect
        from app.routes.parent_portal import api_get_academic_progress
        source = inspect.getsource(api_get_academic_progress)
        assert "_batch_load_assignments" in source
        assert "_batch_load_progress" in source
        assert "_batch_load_test_results" in source
        assert "_build_academic_progress_from_batch" in source
        assert "_build_academic_progress(school_id" not in source

    def test_test_results_route_uses_batched_loader(self):
        import inspect
        from app.routes.parent_portal import api_get_test_results
        source = inspect.getsource(api_get_test_results)
        assert "_batch_load_test_results" in source
        assert "_build_test_results_from_batch" in source
        assert "_build_test_results(school_id" not in source

    def test_assignments_route_uses_batched_loader(self):
        import inspect
        from app.routes.parent_portal import api_get_assignments
        source = inspect.getsource(api_get_assignments)
        assert "_batch_load_assignments" in source
        assert "_build_assignments_from_batch" in source
        assert "_build_assignments(school_id" not in source

    def test_alerts_route_uses_batched_loader(self):
        import inspect
        from app.routes.parent_portal import api_get_alerts
        source = inspect.getsource(api_get_alerts)
        assert "_batch_load_attendance" in source
        assert "_batch_load_test_results" in source
        assert "_batch_load_assignments" in source
        assert "_batch_load_fees" in source
        assert "_build_alerts_from_batch" in source
        assert "_build_alerts(school_id" not in source

    def test_attendance_route_has_no_debug_logging(self):
        import inspect
        from app.routes.parent_portal import api_get_attendance
        source = inspect.getsource(api_get_attendance)
        assert "logger" not in source
        assert "[parent-attendance-debug]" not in source
