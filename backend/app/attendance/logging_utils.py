import logging

from app.services.supabase_context import is_legacy_sqlite_mode

logger = logging.getLogger(__name__)


def log_attendance_mode(route_name: str, school_id: str) -> None:
    logger.info(
        "attendance.route.mode",
        extra={
            "route": route_name,
            "school_id": school_id,
            "mode": "legacy" if is_legacy_sqlite_mode() else "supabase_native",
        },
    )

