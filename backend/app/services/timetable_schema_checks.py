import logging

from sqlalchemy import text

from app.database import SessionLocal
from app.services.supabase_timetable import (
    TIMETABLE_SCHEMA,
    TIMETABLE_TABLE,
    validate_timetable_schema_resolution,
)

logger = logging.getLogger(__name__)


def verify_timetable_schema() -> None:
    db = SessionLocal()
    try:
        logger.info(
            "timetable.schema_check.database.start schema=%s table=%s",
            TIMETABLE_SCHEMA,
            TIMETABLE_TABLE,
        )
        row = db.execute(
            text(
                """
                select 1
                from information_schema.tables
                where table_schema = :schema_name
                  and table_name = :table_name
                """
            ),
            {"schema_name": TIMETABLE_SCHEMA, "table_name": TIMETABLE_TABLE},
        ).scalar_one_or_none()
        if not row:
            raise RuntimeError(f"Missing timetable table: {TIMETABLE_SCHEMA}.{TIMETABLE_TABLE}")
        logger.info(
            "timetable.schema_check.database.ok schema=%s table=%s",
            TIMETABLE_SCHEMA,
            TIMETABLE_TABLE,
        )
    finally:
        db.close()

    validate_timetable_schema_resolution()
