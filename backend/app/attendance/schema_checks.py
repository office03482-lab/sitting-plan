from sqlalchemy import text

from app.database import SessionLocal

REQUIRED_ATTENDANCE_TABLES = [
    ("attendance", "settings"),
    ("attendance", "student_attendance"),
    ("attendance", "staff_attendance"),
    ("attendance", "leave_requests"),
    ("attendance", "notifications"),
    ("attendance", "holidays"),
]

REQUIRED_ATTENDANCE_FUNCTIONS = [
    "attendance_student_report_rows",
]


def verify_attendance_schema() -> None:
    db = SessionLocal()
    try:
        for schema_name, table_name in REQUIRED_ATTENDANCE_TABLES:
            row = db.execute(
                text(
                    """
                    select 1
                    from information_schema.tables
                    where table_schema = :schema_name
                      and table_name = :table_name
                    """
                ),
                {"schema_name": schema_name, "table_name": table_name},
            ).scalar_one_or_none()
            if not row:
                raise RuntimeError(f"Missing attendance table: {schema_name}.{table_name}")

        for fn_name in REQUIRED_ATTENDANCE_FUNCTIONS:
            row = db.execute(
                text(
                    """
                    select 1
                    from pg_proc
                    where proname = :fn_name
                    """
                ),
                {"fn_name": fn_name},
            ).scalar_one_or_none()
            if not row:
                raise RuntimeError(f"Missing attendance function: {fn_name}")
    finally:
        db.close()

