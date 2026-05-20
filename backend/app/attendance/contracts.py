from fastapi import HTTPException
from sqlalchemy.exc import ProgrammingError


def normalize_attendance_exception(exc: Exception) -> Exception:
    message = str(exc).lower()
    if isinstance(exc, ProgrammingError) or "undefinedtable" in message:
        if "attendance_settings" in message:
            return HTTPException(
                status_code=503,
                detail="Attendance schema is not deployed correctly in production.",
            )
    return exc

