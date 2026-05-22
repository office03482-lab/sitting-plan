from app.config import settings
from app.attendance.guards import reject_legacy_attendance_request
from app.attendance.native.service import NativeAttendanceService
from app.services.supabase_context import is_legacy_sqlite_mode, should_use_supabase_native_services


class LegacyAttendanceService:
    def __getattr__(self, name: str):
        reject_legacy_attendance_request()
        raise RuntimeError(f"Legacy attendance access blocked for method: {name}")


def get_attendance_service():
    if settings.is_production:
        if is_legacy_sqlite_mode():
            raise RuntimeError("Legacy attendance mode is not allowed in production")
        return NativeAttendanceService()

    if should_use_supabase_native_services():
        return NativeAttendanceService()
    return LegacyAttendanceService()
