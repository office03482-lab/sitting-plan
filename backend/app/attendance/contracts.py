from __future__ import annotations

from datetime import date, datetime
import logging

from fastapi import HTTPException
from sqlalchemy.exc import ProgrammingError

logger = logging.getLogger(__name__)


def normalize_attendance_exception(exc: Exception) -> Exception:
    message = str(exc).lower()
    if isinstance(exc, ProgrammingError) or "undefinedtable" in message:
        if "attendance_settings" in message:
            return HTTPException(
                status_code=503,
                detail="Attendance schema is not deployed correctly in production.",
            )
    return exc


def normalize_nullable_datetimes(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    text = str(value).strip()
    return text or None


def sanitize_response_payload(
    payload,
    *,
    datetime_fields: tuple[str, ...] = ("created_at", "updated_at"),
    log_label: str = "attendance.response_payload",
):
    if isinstance(payload, list):
        sanitized_rows = []
        invalid_counts = {field: 0 for field in datetime_fields}
        for row in payload:
            if not isinstance(row, dict):
                sanitized_rows.append(row)
                continue
            next_row = dict(row)
            for field in datetime_fields:
                normalized = normalize_nullable_datetimes(next_row.get(field))
                if next_row.get(field) is None:
                    invalid_counts[field] += 1
                next_row[field] = normalized
            sanitized_rows.append(next_row)
        if any(invalid_counts.values()):
            logger.warning(
                "%s.null_datetimes_detected",
                log_label,
                extra={"invalid_counts": invalid_counts, "row_count": len(sanitized_rows)},
            )
        return sanitized_rows

    if isinstance(payload, dict):
        next_payload = dict(payload)
        for field in datetime_fields:
            next_payload[field] = normalize_nullable_datetimes(next_payload.get(field))
        return next_payload

    return payload
