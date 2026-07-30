from types import SimpleNamespace
from unittest.mock import patch


class FakePostgrestError(Exception):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


class _Query:
    def __init__(self, response=None, error: Exception | None = None):
        self._response = response
        self._error = error

    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def execute(self):
        if self._error:
            raise self._error
        return self._response


class _SchemaClient:
    def __init__(self, name: str):
        self.name = name

    def table(self, table_name: str):
        missing_error = FakePostgrestError(
            f"Could not find the table '{self.name}.{table_name}' in the schema cache",
            "PGRST205",
        )
        return _Query(error=missing_error)


class _SupabaseClient:
    def table(self, table_name: str):
        if table_name == "students":
            return _Query(response=SimpleNamespace(count=42, data=[]))
        if table_name == "staff_members":
            return _Query(
                response=SimpleNamespace(
                    count=8,
                    data=[
                        {"department": "Science", "designation": "Teacher"},
                        {"department": "Math", "designation": "Teacher"},
                    ],
                )
            )
        if table_name == "rooms":
            return _Query(response=SimpleNamespace(data=[{"id": "r1", "capacity": 30}, {"id": "r2", "capacity": 40}]))
        if table_name == "batches":
            return _Query(
                response=SimpleNamespace(
                    data=[{"id": "b1", "name": "Batch A", "class_name": "10", "section": "A"}]
                )
            )
        if table_name == "subjects":
            return _Query(response=SimpleNamespace(data=[]))
        return _Query(response=SimpleNamespace(data=[]))

    def schema(self, schema_name: str):
        return _SchemaClient(schema_name)


def test_dashboard_fallback_ignores_missing_optional_schemas():
    from app.routes import dashboard as dashboard_route

    fake_counts = {
        "students_count": 42,
        "teachers_count": 8,
        "rooms_summary": {"count": 2, "totalCapacity": 70},
    }

    with (
        patch("app.routes.dashboard.get_supabase_admin_client", return_value=_SupabaseClient()),
        patch("app.routes.dashboard.get_school_core_counts_cached", return_value=fake_counts),
    ):
        payload = dashboard_route._fallback_dashboard("school-1", 0.0)

    assert payload["students_count"] == 42
    assert payload["teachers_count"] == 8
    assert payload["rooms_summary"] == {"count": 2, "totalCapacity": 70}
    assert payload["attendance_overview"]["notifications"] == []
    assert payload["inventory_dashboard"]["total_materials_registered"] == 0
    assert payload["hostel_summary"]["total_hostels"] == 0
