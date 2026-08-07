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

    def in_(self, *_args, **_kwargs):
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


def test_load_guardians_for_scope_includes_legacy_null_is_active_rows(monkeypatch):
    guardian_rows = [
        {
            "id": "guardian-1",
            "school_id": "school-1",
            "profile_id": None,
            "guardian_code": "G001",
            "full_name": "Active Guardian",
            "email": None,
            "phone": None,
            "relation_type": "parent",
            "address": None,
            "metadata": {},
            "is_active": True,
            "created_at": None,
        },
        {
            "id": "guardian-2",
            "school_id": "school-1",
            "profile_id": None,
            "guardian_code": "G002",
            "full_name": "Legacy Guardian",
            "email": None,
            "phone": None,
            "relation_type": "parent",
            "address": None,
            "metadata": {},
            "is_active": None,
            "created_at": None,
        },
        {
            "id": "guardian-3",
            "school_id": "school-1",
            "profile_id": None,
            "guardian_code": "G003",
            "full_name": "Inactive Guardian",
            "email": None,
            "phone": None,
            "relation_type": "parent",
            "address": None,
            "metadata": {},
            "is_active": False,
            "created_at": None,
        },
    ]

    monkeypatch.setattr(
        supabase_account_security,
        "_schema_table",
        lambda schema, table, supabase=None: _FakeQuery(guardian_rows),
    )

    rows = supabase_account_security._load_guardians_for_scope("school-1")

    assert [row["id"] for row in rows] == ["guardian-1", "guardian-2"]


def test_backfill_guardians_from_student_contacts_uses_student_guardian_fields(monkeypatch):
    student_rows = [
        {
            "id": "student-1",
            "school_id": "school-1",
            "full_name": "Student One",
            "guardian_name": "Parent One",
            "guardian_phone": "9999999999",
            "metadata": {"parent_email": "parent.one@example.com", "parent_relation": "mother"},
            "is_active": True,
            "batch_id": None,
            "class_name": "10",
        },
        {
            "id": "student-2",
            "school_id": "school-1",
            "full_name": "Student Two",
            "guardian_name": "",
            "guardian_phone": "8888888888",
            "metadata": {},
            "is_active": True,
            "batch_id": None,
            "class_name": "10",
        },
    ]
    created = []

    monkeypatch.setattr(
        supabase_account_security,
        "_public_table",
        lambda _name, supabase=None: _FakeQuery(student_rows),
    )

    from app.services import supabase_parent_links

    monkeypatch.setattr(
        supabase_parent_links,
        "create_or_link_parent",
        lambda school_id, student_id, **kwargs: created.append((school_id, student_id, kwargs)) or {"id": "guardian-1"},
    )

    count = supabase_account_security._backfill_guardians_from_student_contacts("school-1", limit=10, offset=0)

    assert count == 1
    assert created == [
        (
            "school-1",
            "student-1",
            {
                "full_name": "Parent One",
                "email": "parent.one@example.com",
                "phone": "9999999999",
                "relation_type": "mother",
                "create_login": False,
            },
        )
    ]


def test_backfill_guardians_from_student_contacts_respects_limit_and_offset(monkeypatch):
    student_rows = [
        {
            "id": "student-1",
            "school_id": "school-1",
            "full_name": "Student One",
            "guardian_name": "Parent One",
            "guardian_phone": "9999999999",
            "metadata": {},
            "is_active": True,
            "batch_id": None,
            "class_name": "10",
        },
        {
            "id": "student-2",
            "school_id": "school-1",
            "full_name": "Student Two",
            "guardian_name": "Parent Two",
            "guardian_phone": "8888888888",
            "metadata": {},
            "is_active": True,
            "batch_id": None,
            "class_name": "10",
        },
    ]
    created = []

    monkeypatch.setattr(
        supabase_account_security,
        "_public_table",
        lambda _name, supabase=None: _FakeQuery(student_rows),
    )

    from app.services import supabase_parent_links

    monkeypatch.setattr(
        supabase_parent_links,
        "create_or_link_parent",
        lambda school_id, student_id, **kwargs: created.append(student_id) or {"id": f"guardian-{student_id}"},
    )

    count = supabase_account_security._backfill_guardians_from_student_contacts("school-1", limit=1, offset=1)

    assert count == 1
    assert created == ["student-2"]
