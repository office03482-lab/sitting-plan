"""Supabase-native attendance repository for production-safe read routes."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
import logging
import time
from typing import Any
from uuid import UUID

from app.attendance.contracts import sanitize_response_payload
from app.config import settings
from app.services.supabase_admin import get_supabase_admin_client

logger = logging.getLogger(__name__)

ATTENDANCE_LOOKUP_CHUNK_SIZE = 100
STAFF_LOOKUP_CHUNK_SIZE = 100
MAX_STUDENT_LOOKUP = 1000
MAX_STAFF_LOOKUP = 200
ASYNC_ATTENDANCE_FETCH_CONCURRENCY = 8
ATTENDANCE_CHUNK_RETRY_COUNT = 2
ATTENDANCE_CHUNK_RETRY_DELAY_SECONDS = 0.35
BATCH_CURRENT_CLASS_CACHE_TTL_SECONDS = 45
BATCH_CURRENT_CLASS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
ATTENDANCE_OVERVIEW_CACHE_TTL_SECONDS = 60
ATTENDANCE_OVERVIEW_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
ATTENDANCE_BATCHES_CACHE_TTL_SECONDS = 60
ATTENDANCE_BATCHES_CACHE: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}
ATTENDANCE_SUBJECTS_CACHE_TTL_SECONDS = 120
ATTENDANCE_SUBJECTS_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
ATTENDANCE_STUDENT_RECORDS_CACHE_TTL_SECONDS = 60
ATTENDANCE_STUDENT_RECORDS_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
ATTENDANCE_STAFF_DASHBOARD_CACHE_TTL_SECONDS = 45
ATTENDANCE_STAFF_DASHBOARD_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    return value


def _iso_datetime(value: Any, *, end_of_day: bool = False) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        base_time = datetime.max.time().replace(microsecond=0) if end_of_day else datetime.min.time()
        return datetime.combine(value, base_time).isoformat()
    if isinstance(value, str):
        text = value.strip()
        if len(text) == 10:
            try:
                parsed_date = datetime.strptime(text, "%Y-%m-%d").date()
            except ValueError:
                return value
            return _iso_datetime(parsed_date, end_of_day=end_of_day)
    return value


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _cf(value: Any) -> str:
    return _normalize(value).casefold()


def _escape_postgrest_like(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
        .replace(",", "\\,")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


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


def _student_records_cache_key(
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
) -> str:
    normalized_batch_filters = _normalize_batch_filters(batch_filters)
    normalized_batch_filter_key = ",".join(
        f"{item.get('class_name','')}|{item.get('section','')}"
        for item in normalized_batch_filters
    )
    return "|".join(
        [
            school_id,
            _cf(class_name),
            _cf(section),
            _cf(student_name),
            (date_from or "")[:10],
            (date_to or "")[:10],
            str(max(skip, 0)),
            str(max(min(limit, 100), 1)),
            normalized_batch_filter_key,
        ]
    )


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


async def _fetch_student_attendance_chunks_async(
    school_id: str,
    student_id_chunks: list[list[str]],
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    semaphore = asyncio.Semaphore(ASYNC_ATTENDANCE_FETCH_CONCURRENCY)

    async def _run_chunk(chunk: list[str]) -> list[dict[str, Any]] | Exception:
        async with semaphore:
            try:
                return await asyncio.to_thread(
                    _execute_student_attendance_chunk,
                    school_id,
                    chunk,
                    date_from=date_from,
                    date_to=date_to,
                )
            except Exception as exc:
                return exc

    results = await asyncio.gather(
        *[_run_chunk(chunk) for chunk in student_id_chunks],
        return_exceptions=False,
    )

    aggregated_rows: list[dict[str, Any]] = []
    failed_chunks = 0

    for chunk, result in zip(student_id_chunks, results):
        if isinstance(result, Exception):
            failed_chunks += 1
            logger.exception(
                "attendance.chunk.give_up",
                extra={
                    "chunk_size": len(chunk),
                    "school_id": school_id,
                    "sample": chunk[:3],
                },
            )
            continue
        aggregated_rows.extend(result)

    return aggregated_rows, failed_chunks


async def _fetch_student_attendance_rows_batched(
    school_id: str,
    student_ids: list[str],
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
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
    return await _fetch_student_attendance_chunks_async(
        school_id,
        student_id_chunks,
        date_from=date_from,
        date_to=date_to,
    )


def _execute_staff_attendance_chunk(
    school_id: str,
    chunk_ids: list[str],
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
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
    response = query.in_("staff_member_id", chunk_ids).order("attendance_date", desc=True).execute()
    return list(response.data or [])


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


def _split_timetable_batches(value: str | None) -> list[str]:
    normalized = _normalize(value)
    if not normalized:
        return []
    return [item.strip() for item in normalized.split(",") if item.strip()]


def _batch_matches_timetable_entry(class_name: str, section: str, timetable_class_name: str | None) -> bool:
    wanted_class = _cf(class_name)
    wanted_section = _cf(section)
    if not wanted_class or not wanted_section:
        return False
    for batch_name in _split_timetable_batches(timetable_class_name):
        entry_class_name, entry_section = split_batch_to_class_section(batch_name)
        if _cf(entry_class_name) == wanted_class and _cf(entry_section) == wanted_section:
            return True
    return False


def _day_of_week_value(target_date: date) -> str:
    return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][target_date.weekday()]


def _normalize_time_hhmm(value: Any) -> str:
    return _normalize(value)[:5]


def _choose_timetable_row(
    entries: list[dict[str, Any]],
    current_time: str | None = None,
) -> tuple[dict[str, Any] | None, bool]:
    normalized_current_time = _normalize_time_hhmm(current_time)
    if normalized_current_time:
        for entry in entries:
            start_time = _normalize_time_hhmm(entry.get("start_time"))
            end_time = _normalize_time_hhmm(entry.get("end_time"))
            if start_time and end_time and start_time <= normalized_current_time <= end_time:
                return entry, True
    return (entries[0], False) if entries else (None, False)


def _batch_current_class_cache_key(
    school_id: str,
    class_name: str,
    section: str,
    target_date: date,
    current_time: str | None,
) -> str:
    time_bucket = _normalize_time_hhmm(current_time) or "00:00"
    return "|".join(
        [
            school_id,
            _cf(class_name),
            _cf(section),
            target_date.isoformat(),
            time_bucket,
        ]
    )


def _get_cached_batch_current_class(cache_key: str) -> dict[str, Any] | None:
    cached = BATCH_CURRENT_CLASS_CACHE.get(cache_key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.monotonic():
        BATCH_CURRENT_CLASS_CACHE.pop(cache_key, None)
        return None
    return dict(payload)


def _set_cached_batch_current_class(cache_key: str, payload: dict[str, Any]) -> None:
    BATCH_CURRENT_CLASS_CACHE[cache_key] = (
        time.monotonic() + BATCH_CURRENT_CLASS_CACHE_TTL_SECONDS,
        dict(payload),
    )


def _get_ttl_cache_entry(cache: dict[str, tuple[float, Any]], cache_key: str) -> Any | None:
    cached = cache.get(cache_key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.monotonic():
        cache.pop(cache_key, None)
        return None
    if isinstance(payload, dict):
        return dict(payload)
    if isinstance(payload, list):
        return list(payload)
    return payload


def _set_ttl_cache_entry(cache: dict[str, tuple[float, Any]], cache_key: str, payload: Any, ttl_seconds: int) -> None:
    cache[cache_key] = (time.monotonic() + ttl_seconds, payload)


def _fetch_timetable_candidates_from_normalized_batches(
    school_id: str,
    *,
    weekday: str,
    class_name: str,
    section: str,
) -> list[dict[str, Any]]:
    batch_rows = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entry_batches")
        .select("timetable_entry_id")
        .eq("school_id", school_id)
        .eq("class_name", class_name)
        .eq("section", section)
        .execute()
    )
    entry_ids = _sanitize_lookup_ids([row.get("timetable_entry_id") for row in list(batch_rows.data or [])])
    if not entry_ids:
        return []

    response = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, day_of_week, start_time, end_time, class_name, subject, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("day_of_week", weekday)
        .eq("is_active", True)
        .in_("id", entry_ids)
        .order("start_time")
        .order("id")
        .execute()
    )
    return list(response.data or [])


def _fetch_timetable_candidates_from_legacy_batches(
    school_id: str,
    *,
    weekday: str,
    class_name: str,
    section: str,
) -> list[dict[str, Any]]:
    normalized_class = _normalize(class_name)
    normalized_section = _normalize(section)
    escaped_pipe = _escape_postgrest_like(f"{normalized_class} | {normalized_section}")
    escaped_dash = _escape_postgrest_like(f"{normalized_class}-{normalized_section}")
    escaped_class = _escape_postgrest_like(normalized_class)
    response = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, day_of_week, start_time, end_time, class_name, subject, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("day_of_week", weekday)
        .eq("is_active", True)
        .or_(
            ",".join(
                [
                    f"class_name.ilike.%{escaped_pipe}%",
                    f"class_name.ilike.%{escaped_dash}%",
                    f"class_name.ilike.%{escaped_class}%",
                    f"section.eq.{_escape_postgrest_like(normalized_section)}",
                ]
            )
        )
        .order("start_time")
        .order("id")
        .execute()
    )
    return list(response.data or [])


def _fetch_staff_member_name(school_id: str, staff_member_id: str | None) -> str:
    if not staff_member_id:
        return ""
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("full_name")
        .eq("school_id", school_id)
        .eq("id", staff_member_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return _normalize(rows[0].get("full_name")) if rows else ""


def _resolve_subject_for_batch_context(
    school_id: str,
    *,
    class_name: str,
    section: str,
    subject_name: str | None,
) -> dict[str, Any] | None:
    normalized_subject_name = _normalize(subject_name)
    if not normalized_subject_name:
        return None

    batch_rows = (
        get_supabase_admin_client()
        .table("batches")
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .eq("class_name", class_name)
        .eq("section", section)
        .execute()
    )
    batch_ids = {str(row.get("id")) for row in list(batch_rows.data or []) if row.get("id")}

    subject_rows = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name, class_name, batch_id, metadata")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .ilike("name", normalized_subject_name)
        .limit(25)
        .execute()
    )
    candidates = list(subject_rows.data or [])
    best_fallback: dict[str, Any] | None = None
    for row in candidates:
        metadata = row.get("metadata") or {}
        metadata_section = _normalize(metadata.get("section")) if isinstance(metadata, dict) else ""
        row_class_name = _normalize(row.get("class_name"))
        if row_class_name and _cf(row_class_name) == _cf(class_name):
            if metadata_section and _cf(metadata_section) == _cf(section):
                return row
            if not best_fallback:
                best_fallback = row
        if batch_ids and str(row.get("batch_id")) in batch_ids:
            return row
    return best_fallback


def get_batch_current_class(
    school_id: str,
    *,
    class_name: str,
    section: str,
    target_date: str | None = None,
    current_time: str | None = None,
) -> dict[str, Any]:
    selected_date = datetime.fromisoformat(target_date[:10]).date() if target_date else datetime.now().date()
    weekday = _day_of_week_value(selected_date)
    cache_key = _batch_current_class_cache_key(school_id, class_name, section, selected_date, current_time)
    cached_payload = _get_cached_batch_current_class(cache_key)
    if cached_payload:
        logger.info(
            "attendance.batch_current_class.cache_hit",
            extra={"school_id": school_id, "class_name": class_name, "section": section, "target_date": selected_date.isoformat()},
        )
        return cached_payload

    logger.info(
        "attendance.batch_current_class.start",
        extra={
            "school_id": school_id,
            "class_name": class_name,
            "section": section,
            "target_date": selected_date.isoformat(),
            "current_time": _normalize_time_hhmm(current_time),
            "weekday": weekday,
        },
    )

    started_at = time.monotonic()
    join_rows: list[dict[str, Any]] = []
    used_join_table = False
    try:
        join_started_at = time.monotonic()
        join_rows = _fetch_timetable_candidates_from_normalized_batches(
            school_id,
            weekday=weekday,
            class_name=class_name,
            section=section,
        )
        used_join_table = True
        logger.info(
            "attendance.batch_current_class.join_lookup_complete",
            extra={
                "school_id": school_id,
                "row_count": len(join_rows),
                "duration_ms": round((time.monotonic() - join_started_at) * 1000),
            },
        )
    except Exception:
        logger.exception(
            "attendance.batch_current_class.join_lookup_failed",
            extra={"school_id": school_id, "class_name": class_name, "section": section},
        )

    query_started_at = time.monotonic()
    rows = join_rows or _fetch_timetable_candidates_from_legacy_batches(
        school_id,
        weekday=weekday,
        class_name=class_name,
        section=section,
    )
    logger.info(
        "attendance.batch_current_class.timetable_query_complete",
        extra={
            "school_id": school_id,
            "row_count": len(rows),
            "duration_ms": round((time.monotonic() - query_started_at) * 1000),
            "used_join_table": used_join_table,
        },
    )

    candidate_rows = [
        row
        for row in rows
        if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
        and _batch_matches_timetable_entry(class_name, section, row.get("class_name"))
    ]
    matched_row, matched_by_current_time = _choose_timetable_row(candidate_rows, current_time)

    if not matched_row:
        payload = {
            "teacher_id": "",
            "teacher_name": "",
            "date": datetime.combine(selected_date, datetime.min.time()).isoformat(),
            "class_name": class_name,
            "section": section,
            "matched_by_current_time": False,
        }
        _set_cached_batch_current_class(cache_key, payload)
        logger.info(
            "attendance.batch_current_class.no_match",
            extra={
                "school_id": school_id,
                "class_name": class_name,
                "section": section,
                "candidate_count": len(candidate_rows),
                "duration_ms": round((time.monotonic() - started_at) * 1000),
            },
        )
        return payload

    metadata = matched_row.get("metadata") or {}
    subject_name = _normalize(metadata.get("subject")) if isinstance(metadata, dict) else ""
    if not subject_name:
        subject_name = _normalize(matched_row.get("subject"))
    staff_member_id = str(matched_row.get("staff_member_id") or "")
    teacher_name = _fetch_staff_member_name(school_id, staff_member_id)
    subject_row = _resolve_subject_for_batch_context(
        school_id,
        class_name=class_name,
        section=section,
        subject_name=subject_name,
    )

    payload = {
        "teacher_id": staff_member_id,
        "teacher_name": teacher_name,
        "date": datetime.combine(selected_date, datetime.min.time()).isoformat(),
        "class_name": class_name,
        "section": section,
        "subject": subject_name or None,
        "subject_id": (subject_row or {}).get("id"),
        "start_time": _normalize_time_hhmm(matched_row.get("start_time")) or None,
        "end_time": _normalize_time_hhmm(matched_row.get("end_time")) or None,
        "timetable_entry_id": matched_row.get("id"),
        "matched_by_current_time": matched_by_current_time,
    }
    _set_cached_batch_current_class(cache_key, payload)
    logger.info(
        "attendance.batch_current_class.complete",
        extra={
            "school_id": school_id,
            "class_name": class_name,
            "section": section,
            "candidate_count": len(candidate_rows),
            "matched_by_current_time": matched_by_current_time,
            "duration_ms": round((time.monotonic() - started_at) * 1000),
            "cache_ttl_seconds": BATCH_CURRENT_CLASS_CACHE_TTL_SECONDS,
        },
    )
    return payload


def _fetch_students(
    school_id: str,
    *,
    search: str | None = None,
    batch: str | None = None,
    skip: int = 0,
    limit: int = 500,
) -> list[dict[str, Any]]:
    safe_skip = max(skip, 0)
    safe_limit = max(limit, 1)
    query = (
        get_supabase_admin_client()
        .table("students")
        .select("id, school_id, roll_number, full_name, class_name, section, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("full_name")
    )

    normalized_search = _normalize(search)
    if normalized_search:
        escaped = _escape_postgrest_like(normalized_search)
        query = query.or_(
            f"full_name.ilike.%{escaped}%,roll_number.ilike.%{escaped}%,father_name.ilike.%{escaped}%"
        )

    normalized_batch = _normalize(batch)
    if normalized_batch:
        class_name, section = split_batch_to_class_section(normalized_batch)
        if class_name:
            query = query.eq("class_name", class_name)
        if section:
            query = query.eq("section", section)

    started_at = time.monotonic()
    response = query.range(safe_skip, safe_skip + safe_limit - 1).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    logger.info(
        "attendance.students.fetch_complete",
        extra={
            "school_id": school_id,
            "row_count": len(rows),
            "duration_ms": duration_ms,
            "skip": safe_skip,
            "limit": safe_limit,
            "has_search": bool(normalized_search),
            "has_batch": bool(normalized_batch),
        },
    )
    return rows


def _fetch_batches(school_id: str) -> dict[str, dict[str, Any]]:
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_BATCHES_CACHE, school_id)
    if cached_payload:
        logger.info("attendance.batches.cache_hit", extra={"school_id": school_id})
        return cached_payload

    started_at = time.monotonic()
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name, class_name, section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    payload = {str(item["id"]): item for item in list(response.data or [])}
    _set_ttl_cache_entry(ATTENDANCE_BATCHES_CACHE, school_id, payload, ATTENDANCE_BATCHES_CACHE_TTL_SECONDS)
    logger.info(
        "attendance.batches.fetch_complete",
        extra={
            "school_id": school_id,
            "row_count": len(payload),
            "duration_ms": round((time.monotonic() - started_at) * 1000),
        },
    )
    return payload


def _count_active_rows(
    table_name: str,
    school_id: str,
    *,
    schema_name: str | None = None,
) -> int:
    client = get_supabase_admin_client()
    query = (
        (client.schema(schema_name).table(table_name) if schema_name else client.table(table_name))
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(1)
    )
    response = query.execute()
    return int(getattr(response, "count", 0) or 0)


def get_students_count(school_id: str) -> int:
    return _count_active_rows("students", school_id)


def get_staff_count(school_id: str) -> int:
    return _count_active_rows("staff_members", school_id)


def get_student_batch_summary(school_id: str) -> list[dict[str, Any]]:
    rows = sorted(
        _fetch_batches(school_id).values(),
        key=lambda item: (
            _normalize(item.get("class_name")) or split_batch_to_class_section(item.get("name"))[0],
            _normalize(item.get("section")) or split_batch_to_class_section(item.get("name"))[1],
        ),
    )
    seen: set[tuple[str, str]] = set()
    summary: list[dict[str, Any]] = []
    for row in rows:
        class_name = _normalize(row.get("class_name")) or split_batch_to_class_section(row.get("name"))[0]
        section = _normalize(row.get("section")) or split_batch_to_class_section(row.get("name"))[1]
        key = (_cf(class_name), _cf(section))
        if not class_name or key in seen:
            continue
        seen.add(key)
        summary.append(
            {
                "class_name": class_name,
                "section": section or "A",
                "batch_name": row.get("name") or f"{class_name} | {section or 'A'}",
            }
        )
    return summary


def _fetch_department_options(school_id: str) -> list[str]:
    started_at = time.monotonic()
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("department, designation")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    values = {
        _normalize(row.get("department")) or _normalize(row.get("designation"))
        for row in list(response.data or [])
    }
    payload = sorted(item for item in values if item)
    logger.info(
        "attendance.departments.fetch_complete",
        extra={
            "school_id": school_id,
            "row_count": len(payload),
            "duration_ms": round((time.monotonic() - started_at) * 1000),
        },
    )
    return payload


def _fetch_staff_members(
    school_id: str,
    *,
    search: str | None = None,
    department: str | None = None,
    source: str | None = None,
    skip: int = 0,
    limit: int = 200,
) -> list[dict[str, Any]]:
    safe_skip = max(skip, 0)
    safe_limit = max(limit, 1)
    query = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id, school_id, employee_code, full_name, email, phone, staff_type, department, designation, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("full_name")
    )
    normalized_search = _normalize(search)
    if normalized_search:
        escaped = _escape_postgrest_like(normalized_search)
        query = query.or_(
            f"full_name.ilike.%{escaped}%,employee_code.ilike.%{escaped}%,department.ilike.%{escaped}%,designation.ilike.%{escaped}%"
        )
    normalized_department = _normalize(department)
    if normalized_department:
        escaped_department = _escape_postgrest_like(normalized_department)
        query = query.or_(f"department.ilike.%{escaped_department}%,designation.ilike.%{escaped_department}%")
    normalized_source = _cf(source or "all")
    if normalized_source == "teachers":
        query = query.eq("staff_type", "teaching")
    elif normalized_source == "invigilators":
        query = query.in_("staff_type", ["invigilator", "non_teaching", "admin", "contract"])
    started_at = time.monotonic()
    response = query.range(safe_skip, safe_skip + safe_limit - 1).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    logger.info(
        "attendance.staff.fetch_complete",
        extra={
            "school_id": school_id,
            "row_count": len(rows),
            "duration_ms": duration_ms,
            "skip": safe_skip,
            "limit": safe_limit,
            "has_search": bool(normalized_search),
            "has_department": bool(normalized_department),
            "source": normalized_source,
        },
    )
    return rows


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
    batch_name = _normalize((batch or {}).get("name"))
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "name": row.get("name") or "",
        "class_name": class_name,
        "section": section,
        "batch_name": batch_name,
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


def _serialize_student(row: dict[str, Any], batch_lookup: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    batch = (batch_lookup or {}).get(str(row.get("batch_id")) or "")
    class_name = _normalize(row.get("class_name")) or _normalize((batch or {}).get("class_name"))
    section = _normalize(row.get("section")) or _normalize((batch or {}).get("section"))
    if not class_name and batch:
        class_name, section = split_batch_to_class_section(batch.get("name"))
    batch_name = _normalize((batch or {}).get("name"))
    return {
        "id": row.get("id"),
        "name": row.get("full_name") or "",
        "class_name": class_name,
        "section": section,
        "batch_name": batch_name,
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


def _resolve_actor_staff_member_id(school_id: str, actor: dict[str, Any] | None = None) -> str | None:
    if not actor or _cf(actor.get("role")) != "teacher":
        return None

    email = _normalize(actor.get("email"))
    name = _normalize(actor.get("name"))
    query = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )

    if email:
        query = query.eq("email", email)
    elif name:
        query = query.ilike("full_name", name)
    else:
        return None

    response = query.limit(1).execute()
    rows = list(response.data or [])
    return str(rows[0].get("id")) if rows and rows[0].get("id") else None


def _serialize_leave(row: dict[str, Any], *, staff_names_by_id: dict[str, str]) -> dict[str, Any]:
    staff_member_id = str(row.get("staff_member_id") or "")
    from_date = _normalize(row.get("from_date"))
    to_date = _normalize(row.get("to_date"))
    return {
        "id": row.get("id"),
        "staff_member_id": staff_member_id,
        "staff_name": staff_names_by_id.get(staff_member_id, ""),
        "leave_type": _normalize(row.get("leave_type")) or "",
        "from_date": f"{from_date}T00:00:00" if from_date else None,
        "to_date": f"{to_date}T23:59:59" if to_date else None,
        "reason": row.get("reason"),
        "status": _normalize(row.get("status")) or "pending",
        "approved_by": _normalize(row.get("approver_profile_id")) or None,
        "created_at": _iso(row.get("created_at")),
    }


def get_overview(school_id: str) -> dict[str, Any]:
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_OVERVIEW_CACHE, school_id)
    if cached_payload:
        logger.info("attendance.overview.cache_hit", extra={"school_id": school_id})
        return cached_payload

    started_at = time.monotonic()
    batch_summary = get_student_batch_summary(school_id)
    subjects = list_subjects(school_id)
    notifications = [_serialize_notification(row) for row in _fetch_notifications(school_id)]
    holidays = [_serialize_holiday(row) for row in _fetch_holidays(school_id)]
    settings_payload = _fetch_settings(school_id)
    payload = {
        "student_count": get_students_count(school_id),
        "staff_count": get_staff_count(school_id),
        "class_options": sorted({item["class_name"] for item in batch_summary if item.get("class_name")}),
        "section_options": sorted({item["section"] for item in batch_summary if item.get("section")}),
        "subject_options": subjects,
        "department_options": _fetch_department_options(school_id),
        "notifications": notifications,
        "holidays": holidays,
        "settings": settings_payload,
    }
    _set_ttl_cache_entry(ATTENDANCE_OVERVIEW_CACHE, school_id, payload, ATTENDANCE_OVERVIEW_CACHE_TTL_SECONDS)
    logger.info(
        "attendance.overview.complete",
        extra={
            "school_id": school_id,
            "duration_ms": round((time.monotonic() - started_at) * 1000),
            "student_count": payload["student_count"],
            "staff_count": payload["staff_count"],
            "batch_count": len(batch_summary),
            "subject_count": len(subjects),
        },
    )
    return payload


def list_students(school_id: str, *, skip: int = 0, limit: int = 100, search: str | None = None) -> list[dict[str, Any]]:
    rows = _fetch_students(school_id, search=search, skip=skip, limit=limit)
    return sanitize_response_payload(
        [_serialize_student(row) for row in rows],
        log_label="attendance.list_students",
    )


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
    return sanitize_response_payload(
        [_serialize_staff(row) for row in rows],
        log_label="attendance.list_staff",
    )


def list_subjects(school_id: str) -> list[dict[str, Any]]:
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_SUBJECTS_CACHE, school_id)
    if cached_payload:
        logger.info("attendance.subjects.cache_hit", extra={"school_id": school_id})
        return cached_payload
    batches = _fetch_batches(school_id)
    payload = sanitize_response_payload(
        [_serialize_subject(row, batches) for row in _fetch_subjects(school_id)],
        log_label="attendance.list_subjects",
    )
    _set_ttl_cache_entry(ATTENDANCE_SUBJECTS_CACHE, school_id, payload, ATTENDANCE_SUBJECTS_CACHE_TTL_SECONDS)
    return payload


def list_leaves(
    school_id: str,
    *,
    status_filter: str | None = None,
    actor: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    actor_staff_member_id = _resolve_actor_staff_member_id(school_id, actor)
    query = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("leave_requests")
        .select("id, school_id, staff_member_id, approver_profile_id, leave_type, from_date, to_date, reason, status, created_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
    )
    if actor_staff_member_id:
        query = query.eq("staff_member_id", actor_staff_member_id)
    normalized_status = _normalize(status_filter)
    if normalized_status:
        query = query.eq("status", normalized_status)

    response = query.execute()
    rows = list(response.data or [])
    staff_member_ids = _sanitize_lookup_ids([row.get("staff_member_id") for row in rows], require_uuid=True)
    staff_names_by_id: dict[str, str] = {}
    if staff_member_ids:
        staff_response = (
            get_supabase_admin_client()
            .table("staff_members")
            .select("id, full_name")
            .eq("school_id", school_id)
            .in_("id", staff_member_ids)
            .execute()
        )
        staff_names_by_id = {
            str(row.get("id")): _normalize(row.get("full_name")) or ""
            for row in list(staff_response.data or [])
            if row.get("id")
        }

    return sanitize_response_payload(
        [_serialize_leave(row, staff_names_by_id=staff_names_by_id) for row in rows],
        log_label="attendance.list_leaves",
    )


def get_student_marking(
    school_id: str,
    *,
    date_value: str,
    class_name: str,
    section: str,
    subject_id: str,
    search: str | None = None,
) -> dict[str, Any]:
    students_response = (
        get_supabase_admin_client()
        .table("students")
        .select("id, full_name, roll_number, class_name, section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .eq("class_name", class_name)
        .eq("section", section)
        .order("roll_number")
        .execute()
    )
    students = list(students_response.data or [])
    search_term = _cf(search)
    if search_term:
        students = [
            row
            for row in students
            if search_term in _cf(row.get("full_name")) or search_term in _cf(row.get("roll_number"))
        ]

    subject_response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name")
        .eq("school_id", school_id)
        .eq("id", subject_id)
        .limit(1)
        .execute()
    )
    subject_rows = list(subject_response.data or [])
    if not subject_rows:
        raise ValueError("Subject not found")
    subject = subject_rows[0]

    existing_by_student_id: dict[str, dict[str, Any]] = {}
    student_ids = _sanitize_lookup_ids([row.get("id") for row in students], require_uuid=True)
    if student_ids:
        try:
            attendance_response = (
                get_supabase_admin_client()
                .schema("attendance")
                .table("student_attendance")
                .select("student_id, status, absence_reason")
                .eq("school_id", school_id)
                .eq("subject_id", subject_id)
                .eq("attendance_date", date_value[:10])
                .in_("student_id", student_ids)
                .execute()
            )
            existing_by_student_id = {
                str(row.get("student_id")): row
                for row in list(attendance_response.data or [])
            }
        except Exception:
            logger.exception(
                "attendance.student_marking.prefill_failed",
                extra={
                    "school_id": school_id,
                    "class_name": class_name,
                    "section": section,
                    "subject_id": subject_id,
                    "student_count": len(student_ids),
                },
            )

    return {
        "date": datetime.fromisoformat(f"{date_value[:10]}T00:00:00").isoformat(),
        "class_name": class_name,
        "section": section,
        "subject_id": subject.get("id"),
        "subject_name": subject.get("name") or "",
        "students": [
            {
                "student_id": row.get("id"),
                "roll_no": row.get("roll_number") or "",
                "student_name": row.get("full_name") or "",
                "status": (existing_by_student_id.get(str(row.get("id"))) or {}).get("status") or "present",
                "absence_reason": (existing_by_student_id.get(str(row.get("id"))) or {}).get("absence_reason"),
            }
            for row in students
        ],
    }


def get_staff_marking(
    school_id: str,
    *,
    date_value: str,
    department: str,
    search: str | None = None,
) -> dict[str, Any]:
    staff_rows = list_staff(
        school_id,
        skip=0,
        limit=100,
        search=search,
        department=department,
    )
    staff_ids = _sanitize_lookup_ids([row.get("id") for row in staff_rows], require_uuid=True)
    attendance_by_staff_id: dict[str, dict[str, Any]] = {}
    if staff_ids:
        attendance_response = (
            get_supabase_admin_client()
            .schema("attendance")
            .table("staff_attendance")
            .select("staff_member_id, status, check_in, check_out")
            .eq("school_id", school_id)
            .eq("attendance_date", date_value[:10])
            .in_("staff_member_id", staff_ids)
            .execute()
        )
        attendance_by_staff_id = {
            str(row.get("staff_member_id")): row
            for row in list(attendance_response.data or [])
            if row.get("staff_member_id")
        }

    approved_leave_by_staff_id: dict[str, dict[str, Any]] = {}
    if staff_ids:
        leave_response = (
            get_supabase_admin_client()
            .schema("attendance")
            .table("leave_requests")
            .select("staff_member_id, leave_type, reason")
            .eq("school_id", school_id)
            .eq("status", "approved")
            .eq("is_active", True)
            .lte("from_date", date_value[:10])
            .gte("to_date", date_value[:10])
            .in_("staff_member_id", staff_ids)
            .execute()
        )
        approved_leave_by_staff_id = {
            str(row.get("staff_member_id")): row
            for row in list(leave_response.data or [])
            if row.get("staff_member_id")
        }

    return {
        "date": datetime.fromisoformat(f"{date_value[:10]}T00:00:00").isoformat(),
        "department": department,
        "staff": [
            {
                "staff_member_id": row.get("id"),
                "staff_id": row.get("staff_id") or "",
                "staff_name": row.get("name") or "",
                "department": row.get("department") or "",
                "designation": row.get("designation"),
                "status": (
                    (attendance_by_staff_id.get(str(row.get("id"))) or {}).get("status")
                    or ("absent" if approved_leave_by_staff_id.get(str(row.get("id"))) else "present")
                ),
                "check_in": _normalize((attendance_by_staff_id.get(str(row.get("id"))) or {}).get("check_in")) or None,
                "check_out": _normalize((attendance_by_staff_id.get(str(row.get("id"))) or {}).get("check_out")) or None,
                "is_on_approved_leave": approved_leave_by_staff_id.get(str(row.get("id"))) is not None,
                "leave_type": _normalize((approved_leave_by_staff_id.get(str(row.get("id"))) or {}).get("leave_type")) or None,
                "leave_reason": (approved_leave_by_staff_id.get(str(row.get("id"))) or {}).get("reason"),
            }
            for row in staff_rows
        ],
    }


def save_staff_marking(
    school_id: str,
    *,
    date_value: str,
    marked_by: str | None = None,
    entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_entries = []
    for entry in entries or []:
        staff_member_id = _normalize(entry.get("staff_member_id"))
        if not staff_member_id:
            continue
        normalized_entries.append(
            {
                "school_id": school_id,
                "staff_member_id": staff_member_id,
                "attendance_date": date_value[:10],
                "status": _normalize(entry.get("status")) or "present",
                "check_in": _normalize(entry.get("check_in")) or None,
                "check_out": _normalize(entry.get("check_out")) or None,
                "metadata": {"marked_by": marked_by or "HR Admin"},
            }
        )

    if not normalized_entries:
        return {"message": "Staff attendance saved successfully"}

    (
        get_supabase_admin_client()
        .schema("attendance")
        .table("staff_attendance")
        .upsert(normalized_entries, on_conflict="staff_member_id,attendance_date")
        .execute()
    )
    return {"message": "Staff attendance saved successfully"}


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
    return sanitize_response_payload(
        [_serialize_student(row, batches) for row in rows],
        log_label="attendance.list_integrated_students",
    )


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


async def list_student_records(
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
    safe_skip = max(skip, 0)
    safe_limit = max(min(limit, 100), 1)
    cache_key = _student_records_cache_key(
        school_id,
        class_name=class_name,
        section=section,
        student_name=student_name,
        date_from=date_from,
        date_to=date_to,
        skip=safe_skip,
        limit=safe_limit,
        batch_filters=batch_filters,
    )
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_STUDENT_RECORDS_CACHE, cache_key)
    if cached_payload:
        logger.info(
            "attendance.student_records.cache_hit",
            extra={
                "school_id": school_id,
                "skip": safe_skip,
                "limit": safe_limit,
                "payload_size": len(cached_payload),
            },
        )
        return cached_payload

    started_at = time.monotonic()
    try:
        payload = _rpc_list_student_records(
            school_id,
            class_name=class_name,
            section=section,
            student_name=student_name,
            date_from=date_from,
            date_to=date_to,
            skip=safe_skip,
            limit=safe_limit,
            batch_filters=batch_filters,
        )
        _set_ttl_cache_entry(
            ATTENDANCE_STUDENT_RECORDS_CACHE,
            cache_key,
            payload,
            ATTENDANCE_STUDENT_RECORDS_CACHE_TTL_SECONDS,
        )
        logger.info(
            "attendance.student_records.complete",
            extra={
                "school_id": school_id,
                "duration_ms": round((time.monotonic() - started_at) * 1000),
                "skip": safe_skip,
                "limit": safe_limit,
                "payload_size": len(payload),
                "source": "rpc",
            },
        )
        return payload
    except Exception:
        logger.exception(
            "attendance.student_records.rpc_failed_fallback",
            extra={
                "school_id": school_id,
                "skip": safe_skip,
                "limit": safe_limit,
                "has_batch_filters": bool(batch_filters),
            },
        )
        if settings.is_production:
            raise

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
    rows, failed_chunks = await _fetch_student_attendance_rows_batched(
        school_id,
        student_ids,
        date_from=date_from,
        date_to=date_to,
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
            "date": _iso_datetime(row.get("attendance_date")),
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
            "first_date_value": payload[0].get("date") if payload else None,
            "first_date_type": type(rows[0].get("attendance_date")).__name__ if rows else None,
        },
    )
    paginated_payload = payload[safe_skip : safe_skip + safe_limit]
    _set_ttl_cache_entry(
        ATTENDANCE_STUDENT_RECORDS_CACHE,
        cache_key,
        paginated_payload,
        ATTENDANCE_STUDENT_RECORDS_CACHE_TTL_SECONDS,
    )
    logger.info(
        "attendance.student_records.complete",
        extra={
            "school_id": school_id,
            "duration_ms": round((time.monotonic() - started_at) * 1000),
            "skip": safe_skip,
            "limit": safe_limit,
            "payload_size": len(paginated_payload),
            "source": "fallback",
        },
    )
    return paginated_payload


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
    lookup_limit = max(min(max(skip + limit, 100), MAX_STAFF_LOOKUP), limit)
    staff_rows = list_staff(
        school_id,
        skip=0,
        limit=lookup_limit,
        search=staff_name,
        department=department,
    )
    filtered_staff = [
        row
        for row in staff_rows
        if not staff_name or _cf(staff_name) in _cf(row.get("name"))
    ]
    staff_ids = _sanitize_lookup_ids([row.get("id") for row in filtered_staff])
    if not staff_ids:
        return []
    rows: list[dict[str, Any]] = []
    for chunk in _chunk_values(staff_ids, STAFF_LOOKUP_CHUNK_SIZE):
        rows.extend(
            _execute_staff_attendance_chunk(
                school_id,
                chunk,
                date_from=date_from,
                date_to=date_to,
            )
        )
    staff_lookup = {str(item.get("id")): item for item in filtered_staff}
    payload = [
        {
            "id": row.get("id"),
            "staff_member_id": row.get("staff_member_id"),
            "staff_id": staff_lookup.get(str(row.get("staff_member_id")), {}).get("staff_id", ""),
            "staff_name": staff_lookup.get(str(row.get("staff_member_id")), {}).get("name", ""),
            "department": staff_lookup.get(str(row.get("staff_member_id")), {}).get("department", ""),
            "designation": staff_lookup.get(str(row.get("staff_member_id")), {}).get("designation"),
            "date": _iso_datetime(row.get("attendance_date")),
            "status": row.get("status") or "present",
            "check_in": _normalize(row.get("check_in")) or None,
            "check_out": _normalize(row.get("check_out")) or None,
            "marked_by": _normalize((row.get("metadata") or {}).get("marked_by")) or "System",
            "created_at": _iso(row.get("created_at")),
        }
        for row in rows
    ]
    logger.info(
        "attendance.staff_records.response_size",
        extra={
            "school_id": school_id,
            "record_count": len(payload),
            "first_date_value": payload[0].get("date") if payload else None,
            "first_date_type": type(rows[0].get("attendance_date")).__name__ if rows else None,
        },
    )
    return payload[skip : skip + limit]


def delete_student_record(school_id: str, *, record_id: str) -> dict[str, Any]:
    normalized_record_id = _normalize(record_id)
    if not normalized_record_id:
        raise ValueError("Student attendance record id is required")

    response = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("student_attendance")
        .delete()
        .eq("school_id", school_id)
        .eq("id", normalized_record_id)
        .execute()
    )
    deleted_rows = list(response.data or [])
    if not deleted_rows:
        raise ValueError("Student attendance record not found")
    return {
        "message": "Student attendance record deleted successfully",
        "deleted_count": len(deleted_rows),
    }


def delete_all_student_records(
    school_id: str,
    *,
    class_name: str | None = None,
    section: str | None = None,
    student_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    filtered_students = list_students(
        school_id,
        skip=0,
        limit=MAX_STUDENT_LOOKUP,
        search=student_name,
    )
    matching_students = [
        row
        for row in filtered_students
        if (not class_name or _cf(row.get("class_name")) == _cf(class_name))
        and (not section or _cf(row.get("section")) == _cf(section))
        and (not student_name or _cf(student_name) in _cf(row.get("name")))
    ]
    student_ids = _sanitize_lookup_ids([row.get("id") for row in matching_students], require_uuid=True)
    if not student_ids:
        return {
            "message": "0 student attendance record(s) deleted successfully",
            "deleted_count": 0,
        }

    query = (
        get_supabase_admin_client()
        .schema("attendance")
        .table("student_attendance")
        .select("id")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
    )
    if date_from:
        query = query.gte("attendance_date", date_from[:10])
    if date_to:
        query = query.lte("attendance_date", date_to[:10])
    candidate_rows = list(query.execute().data or [])
    record_ids = _sanitize_lookup_ids([row.get("id") for row in candidate_rows], require_uuid=True)
    if not record_ids:
        return {
            "message": "0 student attendance record(s) deleted successfully",
            "deleted_count": 0,
        }

    deleted_count = 0
    for chunk in _chunk_values(record_ids, ATTENDANCE_LOOKUP_CHUNK_SIZE):
        deleted_response = (
            get_supabase_admin_client()
            .schema("attendance")
            .table("student_attendance")
            .delete()
            .eq("school_id", school_id)
            .in_("id", chunk)
            .execute()
        )
        deleted_count += len(list(deleted_response.data or []))

    return {
        "message": f"{deleted_count} student attendance record(s) deleted successfully",
        "deleted_count": deleted_count,
    }


def _staff_dashboard_cache_key(
    school_id: str,
    *,
    department: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> str:
    return "|".join(
        [
            school_id,
            _cf(department),
            (date_from or "")[:10],
            (date_to or "")[:10],
        ]
    )


def _rpc_staff_dashboard(
    school_id: str,
    *,
    department: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    params = {
        "p_school_id": school_id,
        "p_department": _normalize(department) or None,
        "p_date_from": date_from[:10] if date_from else None,
        "p_date_to": date_to[:10] if date_to else None,
    }
    started_at = time.monotonic()
    response = get_supabase_admin_client().rpc("attendance_staff_dashboard_summary", params).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    row = rows[0] if rows else {}
    department_summary = row.get("department_summary") or []
    if not isinstance(department_summary, list):
        department_summary = []
    payload = {
        "present_count": int(row.get("present_count") or 0),
        "absent_count": int(row.get("absent_count") or 0),
        "late_count": int(row.get("late_count") or 0),
        "half_day_count": int(row.get("half_day_count") or 0),
        "monthly_attendance_percentage": round(
            (
                (
                    int(row.get("present_count") or 0)
                    + int(row.get("late_count") or 0)
                    + int(row.get("half_day_count") or 0) * 0.5
                )
                / max(int(row.get("total_count") or 0), 1)
            )
            * 100,
            2,
        ),
        "department_summary": department_summary,
    }
    logger.info(
        "attendance.staff_dashboard.rpc_complete",
        extra={
            "school_id": school_id,
            "duration_ms": duration_ms,
            "department": _normalize(department) or None,
            "date_from": params["p_date_from"],
            "date_to": params["p_date_to"],
            "department_count": len(department_summary),
        },
    )
    return payload


def get_staff_dashboard(
    school_id: str,
    *,
    department: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    cache_key = _staff_dashboard_cache_key(
        school_id,
        department=department,
        date_from=date_from,
        date_to=date_to,
    )
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_STAFF_DASHBOARD_CACHE, cache_key)
    if cached_payload:
        logger.info("attendance.staff_dashboard.cache_hit", extra={"school_id": school_id, "cache_key": cache_key})
        return cached_payload

    started_at = time.monotonic()
    try:
        payload = _rpc_staff_dashboard(
            school_id,
            department=department,
            date_from=date_from,
            date_to=date_to,
        )
    except Exception:
        logger.exception(
            "attendance.staff_dashboard.rpc_failed_fallback",
            extra={
                "school_id": school_id,
                "department": _normalize(department) or None,
                "date_from": date_from,
                "date_to": date_to,
            },
        )
        if settings.is_production:
            raise
        records = list_staff_records(
            school_id,
            department=department,
            date_from=date_from,
            date_to=date_to,
            skip=0,
            limit=MAX_STAFF_LOOKUP,
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
                {"department": department_name, "present": 0, "absent": 0, "late": 0, "half_day": 0},
            )
            status_value = row.get("status")
            if status_value == "present":
                bucket["present"] += 1
            elif status_value == "absent":
                bucket["absent"] += 1
            elif status_value == "late":
                bucket["late"] += 1
            elif status_value == "half_day":
                bucket["half_day"] += 1
        payload = {
            "present_count": present_count,
            "absent_count": absent_count,
            "late_count": late_count,
            "half_day_count": half_day_count,
            "monthly_attendance_percentage": round(
                (((present_count + late_count + half_day_count * 0.5) / total) * 100),
                2,
            ),
            "department_summary": list(department_summary_map.values()),
        }

    _set_ttl_cache_entry(
        ATTENDANCE_STAFF_DASHBOARD_CACHE,
        cache_key,
        payload,
        ATTENDANCE_STAFF_DASHBOARD_CACHE_TTL_SECONDS,
    )
    logger.info(
        "attendance.staff_dashboard.complete",
        extra={
            "school_id": school_id,
            "duration_ms": round((time.monotonic() - started_at) * 1000),
            "department": _normalize(department) or None,
            "date_from": date_from,
            "date_to": date_to,
        },
    )
    return payload
