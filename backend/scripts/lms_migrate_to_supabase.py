"""One-time migration: copy LMS data from local SQLite to Supabase.

Usage:
    cd backend
    python -m scripts.lms_migrate_to_supabase

Requires:
    - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
    - The 20260614_052_lms_public_views.sql migration applied
    - The 20260613_037_lms_schema.sql and 038 migrations applied
"""

import os
import sqlite3
import uuid
import sys
from datetime import datetime, timezone
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.supabase_admin import get_supabase_admin_client


_SCHOOL_ID = "2a427cb2-4194-43ba-9e4a-f2558c508162"
_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "seating_planner.db")

TABLES = {
    "courses": {
        "pk": "id",
        "cols": ["id", "school_id", "title", "description", "subject", "grade", "thumbnail_url", "is_published", "metadata", "created_at", "updated_at"],
    },
    "course_modules": {
        "pk": "id",
        "cols": ["id", "course_id", "school_id", "title", "description", "display_order", "metadata", "created_at", "updated_at"],
    },
    "lessons": {
        "pk": "id",
        "cols": ["id", "module_id", "course_id", "school_id", "title", "description", "content_type", "content_url", "content_data", "duration_minutes", "display_order", "is_free", "metadata", "created_at", "updated_at"],
    },
    "lesson_resources": {
        "pk": "id",
        "cols": ["id", "lesson_id", "school_id", "resource_type", "title", "url", "metadata", "created_at", "updated_at"],
    },
    "student_progress": {
        "pk": "id",
        "cols": ["id", "student_id", "course_id", "module_id", "lesson_id", "school_id", "progress_percentage", "status", "time_spent_seconds", "last_accessed_at", "metadata", "created_at", "updated_at"],
    },
    "assignments": {
        "pk": "id",
        "cols": ["id", "course_id", "module_id", "school_id", "title", "description", "assignment_type", "due_date", "max_score", "pass_score", "metadata", "created_at", "updated_at"],
    },
    "assignment_submissions": {
        "pk": "id",
        "cols": ["id", "assignment_id", "student_id", "school_id", "submission_url", "submission_data", "score", "feedback", "status", "submitted_at", "graded_at", "metadata", "created_at", "updated_at"],
    },
}


def _normalize(val):
    if val is None:
        return None
    return str(val)


def _normalize_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return str(uuid.UUID(text))
    except (ValueError, TypeError, AttributeError):
        return None


def _resolve_default_profile_id(supabase) -> str | None:
    membership_rows = (
        supabase.table("school_memberships")
        .select("profile_id")
        .eq("school_id", _SCHOOL_ID)
        .eq("is_active", True)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
        or []
    )
    if membership_rows:
        return _normalize_uuid(membership_rows[0].get("profile_id"))

    profile_rows = (
        supabase.table("profiles")
        .select("id")
        .limit(1)
        .execute()
        .data
        or []
    )
    if profile_rows:
        return _normalize_uuid(profile_rows[0].get("id"))
    return None


def _sanitize_row(table_name: str, row_dict: dict[str, Any], *, fallback_profile_id: str | None) -> dict[str, Any]:
    sanitized = dict(row_dict)
    sanitized["school_id"] = _SCHOOL_ID

    for key in (
        "created_by_profile_id",
        "updated_by_profile_id",
        "deleted_by_profile_id",
        "submitted_by_profile_id",
        "graded_by_profile_id",
    ):
        if key in sanitized:
            sanitized[key] = _normalize_uuid(sanitized.get(key)) or fallback_profile_id

    for key in ("subject_id", "batch_id", "module_id", "lesson_id", "student_id", "assignment_id", "course_id"):
        if key in sanitized:
            sanitized[key] = _normalize_uuid(sanitized.get(key))

    return sanitized


def _resolve_existing_course_id(supabase, *, school_id: str, course_code: str | None) -> str | None:
    code = _normalize(course_code)
    if not code:
        return None
    rows = (
        supabase.table("lms_courses")
        .select("id")
        .eq("school_id", school_id)
        .eq("course_code", code)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    return _normalize_uuid(rows[0].get("id"))


def main():
    if not os.path.exists(_DB_PATH):
        print(f"SQLite DB not found: {_DB_PATH}")
        return

    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    supabase = get_supabase_admin_client()
    fallback_profile_id = _resolve_default_profile_id(supabase)
    id_map: dict[str, dict[str, str]] = {table_name: {} for table_name in TABLES}

    for table_name, info in TABLES.items():
        lms_table = f"lms_{table_name}"
        pk = info["pk"]
        cols = info["cols"]

        sqlite_rows = cur.execute(f"SELECT * FROM lms_{table_name}").fetchall()
        if not sqlite_rows:
            print(f"{table_name}: 0 rows (skipping)")
            continue

        for row in sqlite_rows:
            row_dict = _sanitize_row(table_name, dict(row), fallback_profile_id=fallback_profile_id)
            original_id = _normalize_uuid(row_dict.get("id"))

            if table_name in {"course_modules", "lessons", "student_progress", "assignments"}:
                course_id = _normalize_uuid(row_dict.get("course_id"))
                if course_id and course_id in id_map["courses"]:
                    row_dict["course_id"] = id_map["courses"][course_id]
            if table_name in {"lessons", "student_progress", "assignments"}:
                module_id = _normalize_uuid(row_dict.get("module_id"))
                if module_id and module_id in id_map["course_modules"]:
                    row_dict["module_id"] = id_map["course_modules"][module_id]
            if table_name in {"lesson_resources", "student_progress", "assignments"}:
                lesson_id = _normalize_uuid(row_dict.get("lesson_id"))
                if lesson_id and lesson_id in id_map["lessons"]:
                    row_dict["lesson_id"] = id_map["lessons"][lesson_id]
            if table_name == "assignment_submissions":
                assignment_id = _normalize_uuid(row_dict.get("assignment_id"))
                if assignment_id and assignment_id in id_map["assignments"]:
                    row_dict["assignment_id"] = id_map["assignments"][assignment_id]

            found = supabase.table(lms_table).select("id").eq("id", row_dict.get("id")).limit(1).execute()
            if found.data:
                print(f"{table_name}: {row_dict.get('id')} exists (skipping)")
                existing_id = _normalize_uuid(found.data[0].get("id"))
                if original_id and existing_id:
                    id_map[table_name][original_id] = existing_id
                continue

            try:
                response = supabase.table(lms_table).insert(row_dict).execute()
                print(f"{table_name}: {row_dict.get('id')} inserted")
                inserted_rows = list(response.data or [])
                inserted_id = _normalize_uuid(inserted_rows[0].get("id")) if inserted_rows else _normalize_uuid(row_dict.get("id"))
                if original_id and inserted_id:
                    id_map[table_name][original_id] = inserted_id
            except Exception as e:
                if table_name == "courses" and "lms_courses_school_code_active_key" in str(e):
                    existing_id = _resolve_existing_course_id(
                        supabase,
                        school_id=_SCHOOL_ID,
                        course_code=row_dict.get("course_code"),
                    )
                    if original_id and existing_id:
                        id_map["courses"][original_id] = existing_id
                        print(
                            f"{table_name}: {row_dict.get('id')} mapped to existing course {existing_id} "
                            f"via course_code={row_dict.get('course_code')}"
                        )
                        continue
                print(f"{table_name}: {row_dict.get('id')} FAILED: {e}")

    conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()
