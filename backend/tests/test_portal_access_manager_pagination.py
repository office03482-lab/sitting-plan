from app.services import supabase_account_security


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self._start = 0
        self._end = len(rows) - 1

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self._start = start
        self._end = end
        return self

    def execute(self):
        return _FakeResponse(self._rows[self._start : self._end + 1])


class _FakeClient:
    def __init__(self, student_rows):
        self._student_rows = student_rows

    def table(self, name):
        if name != "students":
            raise AssertionError(f"Unexpected table: {name}")
        return _FakeQuery(self._student_rows)


def test_load_students_for_scope_fetches_past_supabase_default_cap(monkeypatch):
    student_rows = [
        {
            "id": f"student-{index}",
            "school_id": "school-1",
            "profile_id": None,
            "batch_id": None,
            "roll_number": f"R{index:04d}",
            "full_name": f"Student {index}",
            "email": None,
            "phone": None,
            "class_name": "12",
            "section": "A",
            "created_at": None,
            "metadata": {},
            "is_active": True,
        }
        for index in range(1248)
    ]

    fake_client = _FakeClient(student_rows)
    monkeypatch.setattr(supabase_account_security, "_public_table", lambda _name, supabase=None: fake_client.table(_name))
    monkeypatch.setattr(supabase_account_security, "_load_batch_names_for_students", lambda *_args, **_kwargs: {})

    rows = supabase_account_security._load_students_for_scope("school-1")

    assert len(rows) == 1248
    assert rows[0]["roll_number"] == "R0000"
    assert rows[-1]["roll_number"] == "R1247"
