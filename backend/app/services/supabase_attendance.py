"""Supabase-native attendance repository for production-safe read routes."""

from __future__ import annotations

from datetime import date, datetime
import logging
import time
from typing import Any
from uuid import UUID

from app.services.supabase_admin import get_supabase_admin_client

logger = logging.getLogger(__name__)

ATTENDANCE_LOOKUP_CHUNK_SIZE = 100
MAX_STUDENT_LOOKUP = 5000
ATTENDANCE_CHUNK_RETRY_COUNT = 2
ATTENDANCE_CHUNK_RETRY_DELAY_SECONDS = 0.35


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    return value


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _cf(value: Any) -> str:
    return _normalize(value).casefold()


def _is_valid_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _sanitize_lookup_ids(values: list[Any], *, require_uuid: bool = False) -> list[str]:
    normalized: list[str] = []
    for value in values:
        if isinstance(value, (list, tuple, set, dict)):
            continue
        text = _normalize(value)
        if not text or text == "None":
            continue
        if require_uuid and not _is_valid_uuid(text):
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _chunk_values(values: list[str], chunk_size: int) -> list[list[str]]:
    return [
        values[index : index + chunk_size]
        for index in range(0, len(values), chunk_size)
    ]


def _normalize_batch_filters(
    batch_filters: list[tuple[str, str | None]] | None,
) -> list[dict[str, str]]:
    if not batch_filters:
        return []

    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for class_name, section in batch_filters:
        normalized_class = _normalize(class_name)
        normalized_section = _normalize(section)
        if not normalized_class:
            continue
        key = (normalized_class.casefold(), normalized_section.casefold())
        if key in seen:
            continue
        seen.add(key)
        payload = {"class_name": normalized_class}
        if normalized_section:
            payload["section"] = normalized_section
        normalized.append(payload)
    return normalized


def _rpc_list_student_records(
    school_id: str,
    *,
    class_name: str | None = None,
    section: str | None = None,
    student_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    skip: int = 0,
    limit: int = 100,
    batch_filters: list[tuple[str, str | None]] | None = None,
) -> list[dict[str, Any]]:
    batch_filter_payload = _normalize_batch_filters(batch_filters)
    params = {
        "p_school_id": school_id,
        "p_class_name": _normalize(class_name) or None,
        "p_section": _normalize(section) or None,
        "p_student_name": _normalize(student_name) or None,
        "p_date_from": date_from[:10] if date_from else None,
        "p_date_to": date_to[:10] if date_to else None,
        "p_skip": max(skip, 0),
        "p_limit": max(limit, 1),
        "p_batch_filters": batch_filter_payload or None,
    }
    started_at = time.monotonic()
    response = get_supabase_admin_client().rpc("attendance_student_report_rows", params).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    logger.info(
        "attendance.student_records.rpc_complete",
        extra={
            "school_id": school_id,
            "row_count": len(rows),
            "duration_ms": duration_ms,
            "skip": skip,
            "limit": limit,
            "has_batch_filters": bool(batch_filter_payload),
        },
    )
    return rows


def _execute_student_attendance_chunk(
    school_id: str,
    chunk_ids: list[str],
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, ATTENDANCE_CHUNK_RETRY_COUNT + 1):
        start = time.monotonic()
        try:
            query = (
                get_supabase_admin_client()
                .schema("attendance")
                .table("student_attendance")
                .select("id, school_id, student_id, subject_id, attendance_date, status, absence_reason, metadata, created_at")
                .eq("school_id", school_id)
            )
            if date_from:
                query = query.gte("attendance_date", date_from[:10])
            if date_to:
                query = query.lte("attendance_date", date_to[:10])
            response = query.in_("student_id", chunk_ids).order("attendance_date", desc=True).execute()
            duration_ms = round((time.monotonic() - start) * 1000)
            rows = list(response.data or [])
            logger.info(
                "attendance.chunk.complete",
                extra={
                    "chunk_size": len(chunk_ids),
                    "duration_ms": duration_ms,
                    "row_count": len(rows),
                    "attempt": attempt,
                    "school_id": school_id,
                },
            )
            return rows
        except Exception as exc:
            duration_ms = round((time.monotonic() - start) * 1000)
            last_error = exc
            logger.warning(
                "attendance.chunk.failed",
                extra={
                    "chunk_size": len(chunk_ids),
                    "duration_ms": duration_ms,
                    "attempt": attempt,
                    "school_id": school_id,
                    "sample": chunk_ids[:3],
                    "error_type": type(exc).__name__,
                },
            )
            if attempt < ATTENDANCE_CHUNK_RETRY_COUNT:
                time.sleep(ATTENDANCE_CHUNK_RETRY_DELAY_SECONDS)
    if last_error:
        raise last_error
    return []


def split_batch_to_class_section(batch_name: str | None) -> tuple[str, str]:
    normalized = _normalize(batch_name)
    if not normalized:
        return "General", "A"
    if "|" in normalized:
        left, right = normalized.split("|", 1)
        return left.strip() or "General", right.strip() or "A"
    if "-" in normalized:
        left, right = normalized.split("-", 1)
        return left.strip() or "General", right.strip() or "A"
    return normalized, "A"


def _fetch_students(
    school_id: str,
    *,
    search: str | None = None,
    batch: str | None = None,
    skip: int = 0,
    limit: int = 500,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin_client()
        .table("students")
        .select("id, school_id, batch_id, admission_no, roll_number, full_name, father_name, phone, class_name, section, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("full_name")
    )
    response = query.execute()
    rows = list(response.data or [])
    search_term = _cf(search)
    batch_term = _cf(batch)
    filtered: list[dict[str, Any]] = []
    for row in rows:
        class_name = _normalize(row.get("class_name"))
        section = _normalize(row.get("section"))
        batch_label = f"{class_name} | {section}" if class_name else ""
        if search_term:
            haystack = " ".join(
                [
                    _normalize(row.get("full_name")),
                    _normalize(row.get("roll_number")),
                    _normalize(row.get("father_name")),
                    batch_label,
                ]
            ).casefold()
            if search_term not in haystack:
                continue
        if batch_term and batch_term not in batch_label.casefold():
            continue
        filtered.append(row)
    return filtered[skip : skip + limit]


def _fetch_batches(school_id: str) -> dict[str, dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name, class_name, section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


def _fetch_staff_members(
    school_id: str,
    *,
    search: str | None = None,
    department: str | None = None,
    source: str | None = None,
    skip: int = 0,
    limit: int = 500,
) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id, school_id, employee_code, full_name, email, phone, staff_type, department, designation, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("full_name")
        .execute()
    )
    rows = list(response.data or [])
    search_term = _cf(search)
    department_term = _cf(department)
    source_value = _cf(source or "all")
    filtered: list[dict[str, Any]] = []
    for row in rows:
        staff_type = _cf(row.get("staff_type"))
        if source_value == "teachers" and staff_type != "teaching":
            continue
        if source_value == "invigilators" and staff_type not in {"invigilator", "non_teaching", "admin", "contract"}:
            continue
        if search_term:
            haystack = " ".join(
                [
                    _normalize(row.get("full_name")),
                    _normalize(row.get("employee_code")),
                    _normalize(row.get("department")),
                    _normalize(row.get("designation")),
                ]
            ).casefold()
            if search_term not in haystack:
                continue
        if department_term and department_term not in _cf(row.get("department")) and department_term not in _cf(row.get("designation")):
            continue
        filtered.append(row)
    return filtered[skip : skip + limit]


def _fetch_subjects(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, school_id, name, class_name, batch_id, metadata, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("class_name")
        .order("name")
        .execute()
    )
    return list(response.data or [])


def _fetch_notifications(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("notifications")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(8)
        .execute()
    )
    return list(response.data or [])


def _fetch_holidays(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("holidays")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("holiday_date")
        .execute()
    )
    return list(response.data or [])


def _fetch_settings(school_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("settings")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if rows:
        row = rows[0]
        return {
            "minimum_attendance_threshold": float(row.get("minimum_attendance_threshold") or 75),
            "working_hours_start": _normalize(row.get("working_hours_start")) or "09:00",
            "working_hours_end": _normalize(row.get("working_hours_end")) or "17:00",
            "updated_at": _iso(row.get("updated_at")),
        }
    return {
        "minimum_attendance_threshold": 75.0,
        "working_hours_start": "09:00",
        "working_hours_end": "17:00",
        "updated_at": datetime.utcnow().isoformat(),
    }


def _serialize_subject(row: dict[str, Any], batch_lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    batch = batch_lookup.get(str(row.get("batch_id")) or "")
    metadata = row.get("metadata") or {}
    section = _normalize(metadata.get("section")) if isinstance(metadata, dict) else ""
    if not section and batch:
        section = _normalize(batch.get("section"))
    class_name = _normalize(row.get("class_name")) or _normalize((batch or {}).get("class_name"))
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "name": row.get("name") or "",
        "class_name": class_name or "General",
        "section": section or "A",
        "is_active": bool(row.get("is_active", True)),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _serialize_notification(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    return {
        "id": row.get("id"),
        "user_name": metadata.get("user_name") if isinstance(metadata, dict) else None,
        "user_role": metadata.get("user_role") if isinstance(metadata, dict) else None,
        "message": row.get("message") or "",
        "notification_type": row.get("notification_type") or "system",
        "is_read": bool(row.get("is_read", False)),
        "school_id": row.get("school_id"),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _serialize_holiday(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": row.get("title") or "",
        "holiday_date": _iso(row.get("holiday_date")),
        "description": row.get("description"),
        "school_id": row.get("school_id"),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _serialize_student(row: dict[str, Any], batch_lookup: dict[str, dict[str, Any]]) -> dict[str, Any]:
    batch = batch_lookup.get(str(row.get("batch_id")) or "")
    class_name = _normalize(row.get("class_name")) or _normalize((batch or {}).get("class_name"))
    section = _normalize(row.get("section")) or _normalize((batch or {}).get("section"))
    if not class_name and batch:
        class_name, section = split_batch_to_class_section(batch.get("name"))
    return {
        "id": row.get("id"),
        "name": row.get("full_name") or "",
        "class_name": class_name or "General",
        "section": section or "A",
        "roll_no": row.get("roll_number") or "",
        "parent_contact": row.get("phone"),
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _serialize_staff(row: dict[str, Any]) -> dict[str, Any]:
    designation = _normalize(row.get("designation")) or ("Teacher" if _cf(row.get("staff_type")) == "teaching" else "Staff")
    return {
        "id": row.get("id"),
        "staff_id": _normalize(row.get("employee_code")) or _normalize(row.get("id")),
        "name": row.get("full_name") or "",
        "department": _normalize(row.get("department")) or designation,
        "designation": designation,
        "shift": None,
        "email": row.get("email"),
        "phone": row.get("phone"),
        "school_id": row.get("school_id"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def get_overview(school_id: str) -> dict[str, Any]:
    students = _fetch_students(school_id, limit=5000)
    staff = _fetch_staff_members(school_id, limit=5000)
    batches = _fetch_batches(school_id)
    subjects = _fetch_subjects(school_id)
    notifications = _fetch_notifications(school_id)
    holidays = _fetch_holidays(school_id)
    settings = _fetch_settings(school_id)

    class_options = sorted({item["class_name"] for item in [_serialize_student(row, batches) for row in students] if item["class_name"]})
    section_options = sorted({item["section"] for item in [_serialize_student(row, batches) for row in students] if item["section"]})
    department_options = sorted({_serialize_staff(row)["department"] for row in staff if _serialize_staff(row)["department"]})

    return {
        "student_count": len(students),
        "staff_count": len(staff),
        "class_options": class_options,
        "section_options": section_options,
        "subject_options": [_serialize_subject(row, batches) for row in subjects],
        "department_options": department_options,
        "notifications": [_serialize_notification(row) for row in notifications],
        "holidays": [_serialize_holiday(row) for row in holidays],
        "settings": settings,
    }


def list_students(school_id: str, *, skip: int = 0, limit: int = 100, search: str | None = None) -> list[dict[str, Any]]:
    batches = _fetch_batches(school_id)
    rows = _fetch_students(school_id, search=search, skip=skip, limit=limit)
    return [_serialize_student(row, batches) for row in rows]


def list_staff(
    school_id: str,
    *,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    department: str | None = None,
    source: str | None = None,
) -> list[dict[str, Any]]:
    rows = _fetch_staff_members(
        school_id,
        search=search,
        department=department,
        source=source,
        skip=skip,
        limit=limit,
    )
    return [_serialize_staff(row) for row in rows]


def list_subjects(school_id: str) -> list[dict[str, Any]]:
    batches = _fetch_batches(school_id)
    return [_serialize_subject(row, batches) for row in _fetch_subjects(school_id)]


def list_integrated_students(
    school_id: str,
    *,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    batch: str | None = None,
) -> list[dict[str, Any]]:
    batches = _fetch_batches(school_id)
    rows = _fetch_students(school_id, search=search, batch=batch, skip=skip, limit=limit)
    return [_serialize_student(row, batches) for row in rows]


def list_integrated_staff(
    school_id: str,
    *,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    department: str | None = None,
    source: str | None = None,
) -> list[dict[str, Any]]:
    return list_staff(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    )


def get_integrated_overview(school_id: str) -> dict[str, Any]:
    return get_overview(school_id)


def list_student_records(
    school_id: str,
    *,
    class_name: str | None = None,
    section: str | None = None,
    student_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    skip: int = 0,
    limit: int = 100,
    batch_filters: list[tuple[str, str | None]] | None = None,
) -> list[dict[str, Any]]:
    try:
        return _rpc_list_student_records(
            school_id,
            class_name=class_name,
            section=section,
            student_name=student_name,
            date_from=date_from,
            date_to=date_to,
            skip=skip,
            limit=limit,
            batch_filters=batch_filters,
        )
    except Exception:
        logger.exception(
            "attendance.student_records.rpc_failed_fallback",
            extra={
                "school_id": school_id,
                "skip": skip,
                "limit": limit,
                "has_batch_filters": bool(batch_filters),
            },
        )

    students = _fetch_students(school_id, limit=MAX_STUDENT_LOOKUP)
    batches = _fetch_batches(school_id)
    student_rows = [_serialize_student(row, batches) for row in students]
    normalized_batch_filters = _normalize_batch_filters(batch_filters)
    filtered_students = [
        row
        for row in student_rows
        if (not class_name or _cf(row.get("class_name")) == _cf(class_name))
        and (not section or _cf(row.get("section")) == _cf(section))
        and (not student_name or _cf(student_name) in _cf(row.get("name")))
        and (
            not normalized_batch_filters
            or any(
                _cf(row.get("class_name")) == _cf(filter_item.get("class_name"))
                and (
                    not filter_item.get("section")
                    or _cf(row.get("section")) == _cf(filter_item.get("section"))
                )
                for filter_item in normalized_batch_filters
            )
        )
    ]
    student_ids = _sanitize_lookup_ids(
        [row.get("id") for row in filtered_students],
        require_uuid=True,
    )
    logger.info(
        "attendance.student_records.student_ids",
        extra={
            "count": len(student_ids),
            "sample": student_ids[:5],
            "school_id": school_id,
        },
    )
    if not student_ids:
        return []
    if len(student_ids) > MAX_STUDENT_LOOKUP:
        logger.warning(
            "attendance.student_records.lookup_cap_reached",
            extra={
                "student_count": len(student_ids),
                "max_student_lookup": MAX_STUDENT_LOOKUP,
                "school_id": school_id,
            },
        )
        student_ids = student_ids[:MAX_STUDENT_LOOKUP]
    student_id_chunks = _chunk_values(student_ids, ATTENDANCE_LOOKUP_CHUNK_SIZE)
    logger.info(
        "attendance.student_records.chunking",
        extra={
            "student_count": len(student_ids),
            "chunk_count": len(student_id_chunks),
            "chunk_size": ATTENDANCE_LOOKUP_CHUNK_SIZE,
            "school_id": school_id,
        },
    )
    rows: list[dict[str, Any]] = []
    failed_chunks = 0
    for chunk in student_id_chunks:
        try:
            rows.extend(
                _execute_student_attendance_chunk(
                    school_id,
                    chunk,
                    date_from=date_from,
                    date_to=date_to,
                )
            )
        except Exception:
            failed_chunks += 1
            logger.exception(
                "attendance.chunk.give_up",
                extra={
                    "chunk_size": len(chunk),
                    "school_id": school_id,
                    "sample": chunk[:3],
                },
            )
    subjects = {str(item.get("id")): item for item in _fetch_subjects(school_id)}
    student_lookup = {str(item.get("id")): item for item in filtered_students}
    payload = [
        {
            "id": row.get("id"),
            "student_id": row.get("student_id"),
            "student_name": student_lookup.get(str(row.get("student_id")), {}).get("name", ""),
            "roll_no": student_lookup.get(str(row.get("student_id")), {}).get("roll_no", ""),
            "class_name": student_lookup.get(str(row.get("student_id")), {}).get("class_name", ""),
            "section": student_lookup.get(str(row.get("student_id")), {}).get("section", ""),
            "date": _iso(row.get("attendance_date")),
            "subject_id": row.get("subject_id"),
            "subject_name": subjects.get(str(row.get("subject_id")), {}).get("name", ""),
            "status": row.get("status") or "present",
            "absence_reason": row.get("absence_reason"),
            "marked_by": _normalize((row.get("metadata") or {}).get("marked_by")) or "System",
            "created_at": _iso(row.get("created_at")),
        }
        for row in rows
    ]
    logger.info(
        "attendance.student_records.response_size",
        extra={
            "student_count": len(student_ids),
            "record_count": len(payload),
            "failed_chunks": failed_chunks,
            "school_id": school_id,
        },
    )
    return payload[skip : skip + limit]


def list_staff_records(
    school_id: str,
    *,
    department: str | None = None,
    staff_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    staff_rows = list_staff(school_id, skip=0, limit=5000, department=department)
    filtered_staff = [
        row
        for row in staff_rows
        if not staff_name or _cf(staff_name) in _cf(row.get("name"))
    ]
    staff_ids = _sanitize_lookup_ids([row.get("id") for row in filtered_staff])
    if not staff_ids:
        return []
    query = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("staff_attendance")
        .select("id, school_id, staff_member_id, attendance_date, status, check_in, check_out, metadata, created_at")
        .eq("school_id", school_id)
    )
    if date_from:
        query = query.gte("attendance_date", date_from[:10])
    if date_to:
        query = query.lte("attendance_date", date_to[:10])
    response = query.in_("staff_member_id", staff_ids).order("attendance_date", desc=True).execute()
    rows = list(response.data or [])
    staff_lookup = {str(item.get("id")): item for item in filtered_staff}
    payload = [
        {
            "id": row.get("id"),
            "staff_member_id": row.get("staff_member_id"),
            "staff_id": staff_lookup.get(str(row.get("staff_member_id")), {}).get("staff_id", ""),
            "staff_name": staff_lookup.get(str(row.get("staff_member_id")), {}).get("name", ""),
            "department": staff_lookup.get(str(row.get("staff_member_id")), {}).get("department", ""),
            "designation": staff_lookup.get(str(row.get("staff_member_id")), {}).get("designation"),
            "date": _iso(row.get("attendance_date")),
            "status": row.get("status") or "present",
            "check_in": _normalize(row.get("check_in")) or None,
            "check_out": _normalize(row.get("check_out")) or None,
            "marked_by": _normalize((row.get("metadata") or {}).get("marked_by")) or "System",
            "created_at": _iso(row.get("created_at")),
        }
        for row in rows
    ]
    return payload[skip : skip + limit]


def get_staff_dashboard(
    school_id: str,
    *,
    department: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    records = list_staff_records(
        school_id,
        department=department,
        date_from=date_from,
        date_to=date_to,
        skip=0,
        limit=5000,
    )
    present_count = sum(1 for row in records if row.get("status") == "present")
    absent_count = sum(1 for row in records if row.get("status") == "absent")
    late_count = sum(1 for row in records if row.get("status") == "late")
    half_day_count = sum(1 for row in records if row.get("status") == "half_day")
    total = len(records) or 1
    department_summary_map: dict[str, dict[str, Any]] = {}
    for row in records:
        department_name = _normalize(row.get("department")) or "General"
        bucket = department_summary_map.setdefault(
            department_name,
            {"department": department_name, "present_count": 0, "absent_count": 0, "late_count": 0, "half_day_count": 0},
        )
        status_value = row.get("status")
        if status_value == "present":
            bucket["present_count"] += 1
        elif status_value == "absent":
            bucket["absent_count"] += 1
        elif status_value == "late":
            bucket["late_count"] += 1
        elif status_value == "half_day":
            bucket["half_day_count"] += 1
    return {
        "present_count": present_count,
        "absent_count": absent_count,
        "late_count": late_count,
        "half_day_count": half_day_count,
        "monthly_attendance_percentage": round((present_count / total) * 100, 2),
        "department_summary": list(department_summary_map.values()),
    }
