from fastapi import HTTPException

from app.config import settings
from app.services.supabase_context import is_legacy_sqlite_mode


def ensure_native_attendance_mode() -> None:
    if settings.is_production and is_legacy_sqlite_mode():
        raise RuntimeError(
            "Attendance backend misconfigured: legacy attendance mode is disabled in production."
        )


def reject_legacy_attendance_request() -> None:
    if settings.is_production:
        raise HTTPException(
            status_code=503,
            detail="Attendance legacy backend is disabled in production.",
        )

