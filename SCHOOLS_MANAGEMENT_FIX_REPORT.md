## SCHOOLS MANAGEMENT FIX REPORT

**Root Cause**

The production error `column students.staff_type does not exist` came from the Platform Control Plane school counter helper in:

- `backend/app/services/platform_control_plane.py`
- Function: `_resolve_counts(school_ids: list[str])`

That helper executed a shared select against both `students` and `staff_members`, but requested `staff_type` for both tables. Since `students` does not have a `staff_type` column, the `students` query failed at runtime.

Affected runtime paths:

- Schools Management list
- School Detail
- Platform Analytics overview

Call chain:

- `backend/app/routes/platform.py::list_platform_schools`
- `backend/app/services/platform_control_plane.py::list_schools`
- `backend/app/services/platform_control_plane.py::_resolve_counts`

Also:

- `backend/app/routes/platform.py::get_platform_school_detail`
- `backend/app/services/platform_control_plane.py::get_school_detail`
- `backend/app/services/platform_control_plane.py::_resolve_counts`

- `backend/app/routes/platform.py::get_platform_analytics_overview`
- `backend/app/services/platform_control_plane.py::get_platform_analytics_overview`
- `backend/app/services/platform_control_plane.py::list_schools`
- `backend/app/services/platform_control_plane.py::_resolve_counts`

**Backend Audit Result**

Search scope:

- `students.staff_type`
- `select("staff_type")`
- `staff_type`
- `students`

Exact invalid runtime query found:

- `backend/app/services/platform_control_plane.py::_resolve_counts`

No remaining `students.staff_type` backend reference was found after the fix.

**Old Query**

```python
for table_name, key in (("students", "students"), ("staff_members", "staff"), ("staff_members", "teachers")):
    rows = _public_table(table_name).select("school_id,staff_type").in_("school_id", school_ids).eq("is_active", True).execute().data or []
    for row in rows:
        school_id = _normalize(row.get("school_id"))
        if school_id not in counters:
            continue
        if table_name == "students":
            counters[school_id]["students"] += 1
        elif key == "teachers":
            if _normalize(row.get("staff_type")) == "teaching":
                counters[school_id]["teachers"] += 1
        else:
            counters[school_id]["staff"] += 1
```

**New Query**

```python
student_rows = (
    _public_table("students")
    .select("school_id")
    .in_("school_id", school_ids)
    .eq("is_active", True)
    .execute()
    .data
    or []
)

staff_rows = (
    _public_table("staff_members")
    .select("school_id,staff_type")
    .in_("school_id", school_ids)
    .eq("is_active", True)
    .execute()
    .data
    or []
)
```

New counting behavior:

- Student counts come only from `students`
- Teacher counts come only from `staff_members` where `staff_type == "teaching"`
- Non-teaching counts come only from `staff_members` where `staff_type == "non_teaching"`

Related usage dashboard tightening:

- `_usage_item_for_school(...)` now counts:
  - `students` from `students`
  - `teachers` from `staff_members.staff_type == "teaching"`
  - `staff` from `staff_members.staff_type == "non_teaching"`

**Files Modified**

- `backend/app/services/platform_control_plane.py`
- `SCHOOLS_MANAGEMENT_FIX_REPORT.md`

**Validation**

- `python -m compileall app`
- `pytest`

Verification target coverage from the fixed service path:

- Schools Management
- Platform Dashboard
- School Summary
- Analytics
- School Detail

**PASS / FAIL**

PASS
