"""Migrate legacy SQLite ERP data into the current Supabase schema.

This script is intentionally scoped to the existing frontend-backed master data:
  - public.batches
  - public.students
  - public.rooms
  - public.staff_members

It does not redesign workflows or create new tables. Instead, it maps old local
SQLite data into the current Supabase schema so the existing frontend pages can
read the migrated records immediately.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Recommended environment variables:
  SUPABASE_TARGET_SCHOOL_ID   UUID of the destination school in Supabase
  LEGACY_SQLITE_PATH          Defaults to backend/seating_planner.db

Example:
  set SUPABASE_URL=https://your-project.supabase.co
  set SUPABASE_SERVICE_ROLE_KEY=...
  set SUPABASE_TARGET_SCHOOL_ID=...
  python backend/scripts/migrate_legacy_sqlite_to_supabase.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SQLITE_PATH = ROOT_DIR / "backend" / "seating_planner.db"
PUBLIC_SCHEMA = "public"
SYSTEM_TEACHER_NAMES = {"__BREAK_SESSION__", "__SELF_STUDY_SESSION__"}


def normalize_code(value: str, prefix: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    if not cleaned:
        cleaned = fallback.lower()
    code = f"{prefix}-{cleaned}" if prefix else cleaned
    return code[:80]


def compact_json(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value not in (None, "", [], {})}


def rows_to_dicts(cursor: sqlite3.Cursor, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    result = cursor.execute(query, params)
    columns = [description[0] for description in result.description]
    return [dict(zip(columns, row)) for row in result.fetchall()]


@dataclass
class SupabaseConfig:
    url: str
    service_role_key: str
    school_id: str | None


class SupabaseSdkClient:
    def __init__(self, config: SupabaseConfig):
        self.config = config
        self.client: Client = create_client(config.url.rstrip("/"), config.service_role_key)

    def close(self) -> None:
        close_method = getattr(self.client, "close", None)
        if callable(close_method):
            close_method()

    def fetch_rows(
        self,
        table: str,
        *,
        select: str = "*",
        filters: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        query = self.client.table(table).select(select)
        if filters:
            for key, value in filters.items():
                query = query.eq(key, value)
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
        return list(response.data or [])

    def upsert_rows(
        self,
        table: str,
        rows: list[dict[str, Any]],
        *,
        on_conflict: str,
        chunk_size: int = 200,
    ) -> tuple[int, list[dict[str, Any]]]:
        if not rows:
            return 0, []

        migrated_count = 0
        failed_records: list[dict[str, Any]] = []

        for start in range(0, len(rows), chunk_size):
            chunk = rows[start : start + chunk_size]
            print(
                f"Upsert debug: table={table}, on_conflict={on_conflict}, chunk_size={len(chunk)}"
            )
            try:
                self.client.table(table).upsert(chunk, on_conflict=on_conflict).execute()
                migrated_count += len(chunk)
            except Exception as chunk_error:
                for row in chunk:
                    try:
                        self.client.table(table).upsert(row, on_conflict=on_conflict).execute()
                        migrated_count += 1
                    except Exception as row_error:
                        failed_records.append(
                            {
                                "table": table,
                                "row_hint": self._row_hint(table, row),
                                "error": str(row_error),
                                "chunk_error": str(chunk_error),
                            }
                        )

        return migrated_count, failed_records

    @staticmethod
    def _row_hint(table: str, row: dict[str, Any]) -> dict[str, Any]:
        hints_by_table = {
            "batches": ("batch_code", "name"),
            "rooms": ("room_code", "name"),
            "staff_members": ("employee_code", "full_name"),
            "students": ("roll_number", "full_name"),
            "schools": ("id", "name"),
        }
        keys = hints_by_table.get(table, ())
        return {key: row.get(key) for key in keys if key in row}


def load_environment() -> SupabaseConfig:
    load_dotenv(ROOT_DIR / "backend" / ".env")
    load_dotenv(ROOT_DIR / "frontend" / ".env")
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    school_id = os.getenv("SUPABASE_TARGET_SCHOOL_ID")

    if not url:
        raise RuntimeError("SUPABASE_URL is required.")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for bulk migration.")

    # Remove any leading/trailing whitespace that might cause auth issues
    service_role_key = service_role_key.strip()

    return SupabaseConfig(url=url, service_role_key=service_role_key, school_id=school_id)


def resolve_target_school_id(client: SupabaseSdkClient, configured_school_id: str | None) -> str:
    if configured_school_id:
        rows = client.fetch_rows("schools", filters={"id": configured_school_id})
        if not rows:
            raise RuntimeError(f"Supabase school not found: {configured_school_id}")
        print(f"School lookup successful: using configured school {rows[0]['name']} ({configured_school_id})")
        return configured_school_id

    schools = client.fetch_rows("schools", select="id,name")
    if len(schools) == 1:
        print(f"School lookup successful: resolved single school {schools[0]['name']} ({schools[0]['id']})")
        return schools[0]["id"]

    school_labels = ", ".join(f"{row['name']} ({row['id']})" for row in schools[:10])
    raise RuntimeError(
        "SUPABASE_TARGET_SCHOOL_ID is required because multiple schools exist in Supabase. "
        f"Available schools: {school_labels}"
    )


def get_legacy_school(cursor: sqlite3.Cursor) -> dict[str, Any]:
    row = cursor.execute(
        "select id, name, address, phone, email from schools order by id asc limit 1"
    ).fetchone()
    if row is None:
        raise RuntimeError("No school row found in legacy SQLite database.")
    return {
        "id": row[0],
        "name": row[1],
        "address": row[2],
        "phone": row[3],
        "email": row[4],
    }


def build_batch_rows(cursor: sqlite3.Cursor, target_school_id: str) -> tuple[list[dict[str, Any]], dict[int, str]]:
    legacy_batches = rows_to_dicts(
        cursor,
        """
        select id, school_id, name, category, syllabus, display_order, is_active
        from batches
        order by display_order asc, id asc
        """,
    )
    students = rows_to_dicts(
        cursor,
        """
        select batch_id, class_name, section, academic_session
        from students
        where batch_id is not null
        """,
    )

    batch_student_hints: dict[int, dict[str, Any]] = {}
    for student in students:
        batch_id = student["batch_id"]
        if batch_id is None or batch_id in batch_student_hints:
            continue
        batch_student_hints[batch_id] = student

    rows: list[dict[str, Any]] = []
    batch_code_map: dict[int, str] = {}
    seen_codes: set[str] = set()

    for legacy_batch in legacy_batches:
        legacy_id = int(legacy_batch["id"])
        hint = batch_student_hints.get(legacy_id, {})
        base_code = normalize_code(legacy_batch["name"], "batch", f"batch-{legacy_id}")
        batch_code = base_code
        suffix = 2
        while batch_code.lower() in seen_codes:
            batch_code = f"{base_code}-{suffix}"
            suffix += 1
        seen_codes.add(batch_code.lower())
        batch_code_map[legacy_id] = batch_code

        rows.append(
            {
                "school_id": target_school_id,
                "batch_code": batch_code,
                "name": legacy_batch["name"],
                "category": legacy_batch["category"] or "batch",
                "class_name": hint.get("class_name"),
                "section": hint.get("section"),
                "academic_session": hint.get("academic_session"),
                "syllabus": legacy_batch["syllabus"],
                "display_order": legacy_batch["display_order"] or 0,
                "is_active": bool(legacy_batch["is_active"]),
                "metadata": compact_json(
                    {
                        "legacy_id": legacy_id,
                        "legacy_source": "sqlite",
                        "legacy_school_id": legacy_batch["school_id"],
                    }
                ),
            }
        )

    return rows, batch_code_map


def build_room_rows(cursor: sqlite3.Cursor, target_school_id: str) -> list[dict[str, Any]]:
    legacy_rooms = rows_to_dicts(
        cursor,
        """
        select
          id, school_id, name, length_feet, width_feet, desk_length_feet, desk_width_feet,
          num_benches, capacity, teaching_zone_clearance_feet, aisle_width_feet,
          door_location, window_location, glare_mitigation, is_accessible, is_active
        from rooms
        order by id asc
        """,
    )

    rows: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    for legacy_room in legacy_rooms:
        legacy_id = int(legacy_room["id"])
        base_code = normalize_code(legacy_room["name"], "room", f"room-{legacy_id}")
        room_code = base_code
        suffix = 2
        while room_code.lower() in seen_codes:
            room_code = f"{base_code}-{suffix}"
            suffix += 1
        seen_codes.add(room_code.lower())

        rows.append(
            {
                "school_id": target_school_id,
                "room_code": room_code,
                "name": legacy_room["name"],
                "room_type": "classroom",
                "capacity": legacy_room["capacity"] or 0,
                "exam_capacity": legacy_room["capacity"] or 0,
                "length_feet": legacy_room["length_feet"],
                "width_feet": legacy_room["width_feet"],
                "desk_length_feet": legacy_room["desk_length_feet"],
                "desk_width_feet": legacy_room["desk_width_feet"],
                "num_benches": legacy_room["num_benches"],
                "teaching_zone_clearance_feet": legacy_room["teaching_zone_clearance_feet"],
                "aisle_width_feet": legacy_room["aisle_width_feet"],
                "door_location": str(legacy_room["door_location"]).lower() if legacy_room["door_location"] else None,
                "window_location": legacy_room["window_location"],
                "is_accessible": bool(legacy_room["is_accessible"]),
                "is_exam_room": True,
                "is_active": bool(legacy_room["is_active"]),
                "metadata": compact_json(
                    {
                        "legacy_id": legacy_id,
                        "legacy_source": "sqlite",
                        "legacy_school_id": legacy_room["school_id"],
                        "glare_mitigation": bool(legacy_room["glare_mitigation"]),
                    }
                ),
            }
        )

    return rows


def build_staff_rows(cursor: sqlite3.Cursor, target_school_id: str) -> list[dict[str, Any]]:
    teachers = rows_to_dicts(
        cursor,
        """
        select id, school_id, name, subject, email, phone, is_active
        from teachers
        order by id asc
        """,
    )
    invigilators = rows_to_dicts(
        cursor,
        """
        select id, school_id, staff_id, name, email, phone, department, designation, is_active
        from invigilators
        order by id asc
        """,
    )

    rows: list[dict[str, Any]] = []
    seen_codes: set[str] = set()

    for teacher in teachers:
        teacher_name = (teacher["name"] or "").strip()
        teacher_subject = (teacher["subject"] or "").strip().lower()
        if teacher_name in SYSTEM_TEACHER_NAMES or teacher_subject == "system":
            continue
        legacy_id = int(teacher["id"])
        employee_code = normalize_code(teacher["email"] or teacher_name, "tchr", str(legacy_id))
        if employee_code.lower() in seen_codes:
            employee_code = f"tchr-{legacy_id}"
        seen_codes.add(employee_code.lower())
        rows.append(
            {
                "school_id": target_school_id,
                "employee_code": employee_code,
                "full_name": teacher_name,
                "email": teacher["email"],
                "phone": teacher["phone"],
                "staff_type": "teaching",
                "department": teacher["subject"],
                "designation": "Teacher",
                "employment_status": "active" if teacher["is_active"] else "inactive",
                "is_active": bool(teacher["is_active"]),
                "metadata": compact_json(
                    {
                        "legacy_id": legacy_id,
                        "legacy_source": "sqlite",
                        "legacy_school_id": teacher["school_id"],
                        "subject": teacher["subject"],
                    }
                ),
            }
        )

    for invigilator in invigilators:
        legacy_id = int(invigilator["id"])
        employee_code = (invigilator["staff_id"] or "").strip() or f"INV-{legacy_id}"
        employee_code = employee_code[:80]
        if employee_code.lower() in seen_codes:
            employee_code = f"INV-{legacy_id}"
        seen_codes.add(employee_code.lower())
        rows.append(
            {
                "school_id": target_school_id,
                "employee_code": employee_code,
                "full_name": invigilator["name"],
                "email": invigilator["email"],
                "phone": invigilator["phone"],
                "staff_type": "invigilator",
                "department": invigilator["department"],
                "designation": invigilator["designation"] or "Invigilator",
                "employment_status": "active" if invigilator["is_active"] else "inactive",
                "is_active": bool(invigilator["is_active"]),
                "metadata": compact_json(
                    {
                        "legacy_id": legacy_id,
                        "legacy_source": "sqlite",
                        "legacy_school_id": invigilator["school_id"],
                        "legacy_staff_id": invigilator["staff_id"],
                    }
                ),
            }
        )

    return rows


def build_student_rows(
    cursor: sqlite3.Cursor,
    target_school_id: str,
    batch_code_map: dict[int, str],
    supabase_batch_id_by_code: dict[str, str],
) -> list[dict[str, Any]]:
    legacy_students = rows_to_dicts(
        cursor,
        """
        select
          id, school_id, roll_number, name, father_name, batch, batch_id, class_name, section,
          academic_session, email, phone, is_active, special_needs, requires_near_exit,
          requires_extra_time, boarding_type, hostel_required, preferred_hostel_id,
          hostel_request_status, assigned_hostel_id, assigned_room_id, assigned_bed_label,
          hostel_notes, reference_name, reference_number, reference_remark
        from students
        order by id asc
        """,
    )

    rows: list[dict[str, Any]] = []
    for legacy_student in legacy_students:
        legacy_id = int(legacy_student["id"])
        batch_id = legacy_student["batch_id"]
        batch_code = batch_code_map.get(batch_id) if batch_id is not None else None
        target_batch_id = supabase_batch_id_by_code.get(batch_code.lower()) if batch_code else None

        rows.append(
            {
                "school_id": target_school_id,
                "batch_id": target_batch_id,
                "admission_no": None,
                "roll_number": legacy_student["roll_number"],
                "full_name": legacy_student["name"],
                "father_name": legacy_student["father_name"],
                "email": legacy_student["email"],
                "phone": legacy_student["phone"],
                "guardian_name": legacy_student["reference_name"] or legacy_student["father_name"],
                "guardian_phone": legacy_student["reference_number"],
                "class_name": legacy_student["class_name"],
                "section": legacy_student["section"],
                "academic_session": legacy_student["academic_session"],
                "special_needs": legacy_student["special_needs"],
                "requires_near_exit": bool(legacy_student["requires_near_exit"]),
                "requires_extra_time": bool(legacy_student["requires_extra_time"]),
                "boarding_type": legacy_student["boarding_type"],
                "hostel_required": bool(legacy_student["hostel_required"]),
                "fee_status": "active" if legacy_student["is_active"] else "inactive",
                "is_active": bool(legacy_student["is_active"]),
                "metadata": compact_json(
                    {
                        "legacy_id": legacy_id,
                        "legacy_source": "sqlite",
                        "legacy_school_id": legacy_student["school_id"],
                        "legacy_batch_label": legacy_student["batch"],
                        "preferred_hostel_id": legacy_student["preferred_hostel_id"],
                        "hostel_request_status": legacy_student["hostel_request_status"],
                        "assigned_hostel_id": legacy_student["assigned_hostel_id"],
                        "assigned_room_id": legacy_student["assigned_room_id"],
                        "assigned_bed_label": legacy_student["assigned_bed_label"],
                        "hostel_notes": legacy_student["hostel_notes"],
                        "reference_remark": legacy_student["reference_remark"],
                    }
                ),
            }
        )

    return rows


def fetch_batch_id_map(client: SupabaseSdkClient, target_school_id: str) -> dict[str, str]:
    rows = client.fetch_rows(
        "batches",
        select="id,batch_code",
        filters={"school_id": target_school_id},
    )
    return {row["batch_code"].lower(): row["id"] for row in rows}


def print_plan_summary(
    legacy_school: dict[str, Any],
    target_school_id: str,
    batch_rows: list[dict[str, Any]],
    room_rows: list[dict[str, Any]],
    staff_rows: list[dict[str, Any]],
    student_rows: list[dict[str, Any]],
) -> None:
    summary = {
        "legacy_school": legacy_school,
        "target_school_id": target_school_id,
        "batches": len(batch_rows),
        "rooms": len(room_rows),
        "staff_members": len(staff_rows),
        "students": len(student_rows),
    }
    print(json.dumps(summary, indent=2, default=str))


def print_migration_diagnostics(results: dict[str, dict[str, Any]]) -> None:
    diagnostics = {
        table: {
            "migrated_count": table_result["migrated_count"],
            "failed_count": len(table_result["failed_records"]),
        }
        for table, table_result in results.items()
    }
    print(json.dumps({"migration_results": diagnostics}, indent=2, default=str))

    for table, table_result in results.items():
        failed_records = table_result["failed_records"]
        if failed_records:
            print(f"Failed records for {table}:")
            print(json.dumps(failed_records[:20], indent=2, default=str))


def migrate(apply_changes: bool, sqlite_path: Path) -> None:
    if not sqlite_path.exists():
        raise RuntimeError(f"Legacy SQLite database not found: {sqlite_path}")

    config = load_environment()
    
    # Validate authentication and show diagnostic info
    print(f"Supabase URL: {config.url}")
    print(f"Using service role key: {'Yes' if config.service_role_key else 'No'}")
    
    # Mask the key for display (show first 8 and last 4 chars)
    if config.service_role_key and len(config.service_role_key) > 12:
        masked_key = f"{config.service_role_key[:8]}...{config.service_role_key[-4:]}"
    else:
        masked_key = "***"
    print(f"Service role key (masked): {masked_key}")
    
    # Create client to test authentication
    client = SupabaseSdkClient(config)

    # Test authentication by fetching schools and show request info
    try:
        print("Testing authentication with schools lookup...")
        schools = client.fetch_rows("schools", select="id,name", limit=1)
        print(f"School lookup successful: Found {len(schools)} school(s)")
        if schools:
            school = schools[0]
            print(f"First school: {school['name']} ({school['id']})")
    except Exception as e:
        raise RuntimeError(f"Authentication failed: {str(e)}")
    
    connection = sqlite3.connect(str(sqlite_path))
    connection.row_factory = sqlite3.Row

    try:
        target_school_id = resolve_target_school_id(client, config.school_id)
        cursor = connection.cursor()
        legacy_school = get_legacy_school(cursor)
        batch_rows, batch_code_map = build_batch_rows(cursor, target_school_id)
        room_rows = build_room_rows(cursor, target_school_id)
        staff_rows = build_staff_rows(cursor, target_school_id)

        if apply_changes:
            batch_migrated_count, batch_failed_records = client.upsert_rows(
                "batches",
                batch_rows,
                on_conflict="batch_code",
            )
            batch_id_map = fetch_batch_id_map(client, target_school_id)
        else:
            batch_id_map = {code.lower(): f"preview-{index}" for index, code in enumerate(batch_code_map.values(), start=1)}
            batch_migrated_count = 0
            batch_failed_records = []

        student_rows = build_student_rows(cursor, target_school_id, batch_code_map, batch_id_map)
        print_plan_summary(legacy_school, target_school_id, batch_rows, room_rows, staff_rows, student_rows)

        if not apply_changes:
            print("Dry run complete. Re-run with --apply to write into Supabase.")
            return

        room_migrated_count, room_failed_records = client.upsert_rows(
            "rooms",
            room_rows,
            on_conflict="room_code",
        )
        staff_migrated_count, staff_failed_records = client.upsert_rows(
            "staff_members",
            staff_rows,
            on_conflict="employee_code",
        )
        student_migrated_count, student_failed_records = client.upsert_rows(
            "students",
            student_rows,
            on_conflict="roll_number",
        )
        print_migration_diagnostics(
            {
                "batches": {
                    "migrated_count": batch_migrated_count,
                    "failed_records": batch_failed_records,
                },
                "rooms": {
                    "migrated_count": room_migrated_count,
                    "failed_records": room_failed_records,
                },
                "staff_members": {
                    "migrated_count": staff_migrated_count,
                    "failed_records": staff_failed_records,
                },
                "students": {
                    "migrated_count": student_migrated_count,
                    "failed_records": student_failed_records,
                },
            }
        )
        print("Migration applied successfully.")
    finally:
        connection.close()
        client.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate legacy SQLite data into Supabase.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write into Supabase. Without this flag, the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--sqlite-path",
        default=os.getenv("LEGACY_SQLITE_PATH", str(DEFAULT_SQLITE_PATH)),
        help="Path to the legacy SQLite database file.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    migrate(apply_changes=args.apply, sqlite_path=Path(args.sqlite_path))


if __name__ == "__main__":
    main()
