"""Supabase-native attendance repository for production-safe read routes."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
import calendar
import json
import logging
import re
import time
from typing import Any
from uuid import UUID

from fastapi import HTTPException

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
ATTENDANCE_STUDENT_DASHBOARD_CACHE_TTL_SECONDS = 45
ATTENDANCE_STUDENT_DASHBOARD_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
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


def _canonical_class_key(value: Any) -> str:
    normalized = _normalize(value)
    if not normalized:
        return ""
    tokens = re.sub(r"\s+", " ", normalized).split(" ")
    first_numeric_index = next((index for index, token in enumerate(tokens) if re.search(r"\d", token)), -1)
    relevant_tokens = tokens[first_numeric_index:] if first_numeric_index >= 0 else tokens
    canonical = " ".join(relevant_tokens)
    canonical = re.sub(r"\b(\d+)(st|nd|rd|th)\b", r"\1", canonical, flags=re.IGNORECASE)
    return canonical.strip().casefold()


def _canonical_batch_key(value: Any) -> str:
    normalized = _normalize(value)
    if not normalized:
        return ""
    if "|" in normalized:
        left, right = normalized.split("|", 1)
        return f"{_canonical_class_key(left)}|{_cf(right)}"
    hyphen_match = re.match(r"^(.*\S)\s*-\s*([A-Za-z0-9]{1,3})$", normalized)
    if hyphen_match:
        return f"{_canonical_class_key(hyphen_match.group(1))}|{_cf(hyphen_match.group(2))}"
    spaced_match = re.match(r"^(.*\S)\s+([A-Za-z0-9]{1,3})$", normalized)
    if spaced_match:
        return f"{_canonical_class_key(spaced_match.group(1))}|{_cf(spaced_match.group(2))}"
    return _canonical_class_key(normalized)


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


def _normalize_batch_filter_names(
    batch_filters: list[tuple[str, str | None]] | None,
) -> list[str]:
    if not batch_filters:
        return []
    normalized_names: list[str] = []
    seen: set[str] = set()
    for batch_name, _raw_section in batch_filters:
        normalized_name = _normalize(batch_name)
        if not normalized_name:
            continue
        key = _canonical_batch_key(normalized_name) or _cf(normalized_name)
        if key in seen:
            continue
        seen.add(key)
        normalized_names.append(normalized_name)
    return normalized_names


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
            str(max(min(limit, 500), 1)),
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
    # Resolve batch names to actual batch records so we can filter by class/section in SQL.
    batches = _fetch_batches(school_id)
    resolved_batch_filter_payload: list[dict[str, str]] = []

    if batch_filters:
        for raw_name, raw_section in batch_filters:
            normalized_name = _normalize(raw_name)
            if not normalized_name:
                continue
            # Try to find a batch whose name matches
            matched = None
            for b in batches.values():
                b_name = _normalize(b.get("name"))
                if _cf(b_name) == _cf(normalized_name) or _canonical_batch_key(b_name) == _canonical_batch_key(normalized_name):
                    matched = b
                    break
            b_class = ""
            b_section = ""
            if matched:
                b_class = _normalize(matched.get("class_name"))
                b_section = _normalize(matched.get("section")) or _normalize(raw_section) or ""
            if matched and b_class:
                resolved_batch_filter_payload.append({"class_name": b_class, "section": b_section})
            else:
                # No matching batch found, or batch has no class_name --
                # try to find class/section from student records, or split the name.
                batch_name_clean = normalized_name
                matched_class_section = _resolve_class_section_from_student_data(school_id, batch_name_clean)
                if matched_class_section:
                    resolved_batch_filter_payload.append({
                        "class_name": matched_class_section[0],
                        "section": matched_class_section[1],
                    })
                else:
                    fallback_class, fallback_section = split_batch_to_class_section(batch_name_clean)
                    raw_section_val = _normalize(raw_section) or fallback_section
                    resolved_batch_filter_payload.append({"class_name": fallback_class, "section": raw_section_val})

    # Always use SQL class/section batch filters when batch_filters are provided,
    # regardless of whether batch IDs were resolved (since batch_id is not returned by RPC).
    batch_filter_payload = None
    if resolved_batch_filter_payload:
        normalized_batch_filters = _normalize_batch_filters(
            [(item["class_name"], item.get("section") or None) for item in resolved_batch_filter_payload]
        )
        batch_filter_payload = normalized_batch_filters or None
    params = {
        "p_school_id": school_id,
        "p_class_name": _normalize(class_name) or None,
        "p_section": _normalize(section) or None,
        "p_student_name": _normalize(student_name) or None,
        "p_date_from": date_from[:10] if date_from else None,
        "p_date_to": date_to[:10] if date_to else None,
        "p_skip": max(skip, 0),
        "p_limit": max(limit, 1),
        "p_batch_filters": batch_filter_payload,
    }
    logger.info(
        "attendance.student_records.rpc_call",
        extra={
            "school_id": school_id,
            "p_class_name": params["p_class_name"],
            "p_section": params["p_section"],
            "p_student_name": params["p_student_name"],
            "p_date_from": params["p_date_from"],
            "p_date_to": params["p_date_to"],
            "p_skip": params["p_skip"],
            "p_limit": params["p_limit"],
            "p_batch_filters": json.dumps(params["p_batch_filters"]) if params["p_batch_filters"] else None,
        },
    )
    started_at = time.monotonic()
    response = get_supabase_admin_client().rpc("attendance_student_report_rows", params).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    logger.info(
        "attendance.student_records.rpc_result",
        extra={
            "school_id": school_id,
            "row_count": len(rows),
            "duration_ms": duration_ms,
        },
    )

    # Augment rows when class/section or subject_name are missing by fetching student details.
    try:
        student_ids_need = [str(r.get("student_id")) for r in rows if not _normalize(r.get("class_name")) or not _normalize(r.get("subject_name"))]
        student_map: dict[str, dict[str, Any]] = {}
        if student_ids_need:
            student_query = (
                get_supabase_admin_client()
                .table("students")
                .select("id, class_name, section, batch_id, full_name, roll_number")
                .eq("school_id", school_id)
                .in_("id", student_ids_need)
                .execute()
            )
            for s in list(student_query.data or []):
                sid = str(s.get("id") or "")
                if sid:
                    student_map[sid] = s
    except Exception:
        student_map = {}

    augmented: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        sid = str(row.get("student_id") or "")
        class_val = _normalize(row.get("class_name"))
        section_val = _normalize(row.get("section"))

        # Prefer class_name/section stored in metadata at marking time (actual batch context)
        metadata = row.get("metadata")
        meta_class = ""
        meta_section = ""
        if isinstance(metadata, dict):
            meta_class = _normalize(metadata.get("class_name"))
            meta_section = _normalize(metadata.get("section"))
            if meta_class:
                class_val = meta_class
            if meta_section:
                section_val = meta_section

        # Resolve batch_name: prefer matching a batch from metadata class/section, else from student's batch_id
        batch_id = _normalize(row.get("batch_id"))
        batch_obj = None
        batch_name_val = ""
        if meta_class:
            for b in batches.values():
                b_class = _normalize(b.get("class_name"))
                b_section = _normalize(b.get("section"))
                if b_class == meta_class and b_section == meta_section:
                    batch_name_val = _normalize(b.get("name"))
                    batch_obj = b
                    break
        if not batch_name_val and batch_id:
            batch_obj = batches.get(batch_id)
            batch_name_val = _normalize(batch_obj.get("name")) if batch_obj else ""

        # If class/section are still missing, prefer batch metadata before leaving them empty.
        if batch_obj:
            batch_class = _normalize(batch_obj.get("class_name"))
            batch_section = _normalize(batch_obj.get("section"))
            if class_val == "General" and batch_class:
                class_val = batch_class
                if section_val == "A" and batch_section:
                    section_val = batch_section
            if not class_val and batch_name_val:
                parsed_class, parsed_section = split_batch_to_class_section(batch_name_val)
                class_val = class_val or parsed_class
                section_val = section_val or parsed_section

        # Fallback: try student_map for rows that still need class/section
        if (not class_val or not section_val) and student_map.get(sid):
            stud = student_map.get(sid)
            class_val = class_val or _normalize(stud.get("class_name"))
            section_val = section_val or _normalize(stud.get("section"))
            if not batch_name_val and stud.get("batch_id"):
                batch_obj = batches.get(str(stud.get("batch_id")))
                batch_name_val = _normalize(batch_obj.get("name") if batch_obj else "")
            if not class_val and batch_name_val:
                parsed_class, parsed_section = split_batch_to_class_section(batch_name_val)
                class_val = class_val or parsed_class
                section_val = section_val or parsed_section

        row["class_name"] = class_val
        row["section"] = section_val
        row["batch_name"] = batch_name_val

        # Subject name fallback
        subj_name = _normalize(row.get("subject_name"))
        subj_id = _normalize(row.get("subject_id"))
        if not subj_name and subj_id:
            try:
                subj_name = _fetch_subject_name(school_id, subj_id)
            except Exception:
                subj_name = ""
        row["subject_name"] = subj_name

        # Marked by normalization
        row["marked_by"] = _normalize(row.get("marked_by")) or _normalize((row.get("metadata") or {}).get("marked_by")) or ""

        augmented.append(row)

    logger.info(
        "attendance.student_records.rpc_complete",
        extra={
            "school_id": school_id,
            "row_count": len(augmented),
            "duration_ms": duration_ms,
            "skip": skip,
            "limit": limit,
            "has_batch_filters": bool(batch_filter_payload),
        },
    )
    return augmented


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
        return "", ""
    if "|" in normalized:
        left, right = normalized.split("|", 1)
        return left.strip(), right.strip()
    hyphen_match = re.match(r"^(.*\S)\s*-\s*([A-Za-z0-9]{1,3})$", normalized)
    if hyphen_match:
        return hyphen_match.group(1).strip(), hyphen_match.group(2).strip()
    spaced_match = re.match(r"^(.*\S)\s+([A-Za-z0-9]{1,3})$", normalized)
    if spaced_match:
        return spaced_match.group(1).strip(), spaced_match.group(2).strip()
    return normalized, ""


def _resolve_class_section_from_batch_name(
    school_id: str,
    batch_name: str | None,
    class_name: str | None = None,
    section: str | None = None,
) -> tuple[str, str]:
    normalized_batch_name = _normalize(batch_name)
    normalized_class_name = _normalize(class_name)
    normalized_section = _normalize(section)

    if not normalized_batch_name:
        return normalized_class_name, normalized_section

    batches = list(_fetch_batches(school_id).values())
    matched_batch = next(
        (
            row
            for row in batches
            if _cf(row.get("name")) == _cf(normalized_batch_name)
            or _canonical_class_key(row.get("name")) == _canonical_class_key(normalized_batch_name)
        ),
        None,
    )

    resolved_class_name = normalized_class_name
    resolved_section = normalized_section

    if matched_batch:
        resolved_class_name = resolved_class_name or _normalize(matched_batch.get("class_name"))
        resolved_section = resolved_section or _normalize(matched_batch.get("section"))

        if (not resolved_class_name or not resolved_section) and matched_batch.get("id"):
            try:
                student_rows = (
                    get_supabase_admin_client()
                    .table("students")
                    .select("class_name, section")
                    .eq("school_id", school_id)
                    .eq("batch_id", matched_batch.get("id"))
                    .eq("is_active", True)
                    .limit(1)
                    .execute()
                )
                first_student = (student_rows.data or [None])[0] or {}
                resolved_class_name = resolved_class_name or _normalize(first_student.get("class_name"))
                resolved_section = resolved_section or _normalize(first_student.get("section"))
            except Exception:
                logger.exception(
                    "attendance.batch_current_class.student_lookup_failed",
                    extra={"school_id": school_id, "batch_name": normalized_batch_name},
                )

        if not resolved_class_name:
            parsed_class_name, parsed_section = split_batch_to_class_section(matched_batch.get("name"))
            resolved_class_name = _normalize(parsed_class_name)
            resolved_section = resolved_section or _normalize(parsed_section)

    return resolved_class_name, resolved_section


def _resolve_class_section_from_student_data(
    school_id: str,
    batch_name: str,
) -> tuple[str, str] | None:
    """Try to find (class_name, section) by matching batch_name against student records
    where the batch label (class_name + section concatenation or formatted name) matches."""
    normalized = _normalize(batch_name)
    if not normalized:
        return None
    try:
        response = (
            get_supabase_admin_client()
            .table("students")
            .select("class_name, section")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .limit(500)
            .execute()
        )
        students = list(response.data or [])
        if not students:
            return None
        # Collect unique (class_name, section) pairs
        seen: set[tuple[str, str]] = set()
        candidates: list[tuple[str, str]] = []
        for s in students:
            cn = _normalize(s.get("class_name"))
            sec = _normalize(s.get("section"))
            if cn and (cn, sec) not in seen:
                seen.add((cn, sec))
                candidates.append((cn, sec))
        # Try to find a pair whose batch key or combined label matches
        wanted_key = _canonical_batch_key(normalized)
        for cn, sec in candidates:
            combined = f"{cn} {sec}"
            if _cf(cn) == _cf(normalized):
                return (cn, sec)
            if _cf(combined) == _cf(normalized):
                return (cn, sec)
            candidate_key = _canonical_batch_key(f"{cn} | {sec}")
            if candidate_key and candidate_key == wanted_key:
                return (cn, sec)
            candidate_key = _canonical_batch_key(f"{cn}-{sec}")
            if candidate_key and candidate_key == wanted_key:
                return (cn, sec)
            candidate_key = _canonical_batch_key(f"{cn}{sec}")
            if candidate_key and candidate_key == wanted_key:
                return (cn, sec)
        return None
    except Exception:
        logger.exception(
            "attendance.resolve_class_section.student_lookup_failed",
            extra={"school_id": school_id, "batch_name": batch_name},
        )
        return None


def _split_timetable_batches(value: str | None) -> list[str]:
    normalized = _normalize(value)
    if not normalized:
        return []
    return [item.strip() for item in normalized.split(",") if item.strip()]


def _batch_label_matches(selected_batch_name: str | None, timetable_class_name: str | None) -> bool:
    wanted_batch = _canonical_batch_key(selected_batch_name)
    if not wanted_batch:
        return False
    for batch_name in _split_timetable_batches(timetable_class_name):
        if _canonical_batch_key(batch_name) == wanted_batch:
            return True
    return False


def _batch_matches_timetable_entry(class_name: str, section: str, timetable_class_name: str | None) -> bool:
    wanted_class = _canonical_class_key(class_name)
    wanted_section = _cf(section)
    if not wanted_class or not wanted_section:
        return False
    for batch_name in _split_timetable_batches(timetable_class_name):
        entry_class_name, entry_section = split_batch_to_class_section(batch_name)
        if _canonical_class_key(entry_class_name) == wanted_class and _cf(entry_section) == wanted_section:
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
    batch_name: str | None = None,
) -> str:
    time_bucket = _normalize_time_hhmm(current_time) or "00:00"
    return "|".join(
        [
            school_id,
            _cf(class_name),
            _cf(section),
            _canonical_batch_key(batch_name),
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
        .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
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
    batch_name: str | None = None,
) -> list[dict[str, Any]]:
    normalized_class = _normalize(class_name)
    normalized_section = _normalize(section)
    escaped_pipe = _escape_postgrest_like(f"{normalized_class} | {normalized_section}")
    escaped_dash = _escape_postgrest_like(f"{normalized_class}-{normalized_section}")
    escaped_space = _escape_postgrest_like(f"{normalized_class} {normalized_section}")
    escaped_class = _escape_postgrest_like(normalized_class)
    escaped_batch = _escape_postgrest_like(_normalize(batch_name))
    response = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("day_of_week", weekday)
        .eq("is_active", True)
        .or_(
            ",".join(
                [
                    f"class_name.ilike.%{escaped_pipe}%",
                    f"class_name.ilike.%{escaped_dash}%",
                    f"class_name.ilike.%{escaped_space}%",
                    f"class_name.ilike.%{escaped_class}%",
                    *([f"class_name.ilike.%{escaped_batch}%"] if escaped_batch else []),
                    f"section.eq.{_escape_postgrest_like(normalized_section)}",
                ]
            )
        )
        .order("start_time")
        .order("id")
        .execute()
    )
    return list(response.data or [])


def _fetch_timetable_candidates_any_day(
    school_id: str,
    *,
    class_name: str,
    section: str,
    batch_name: str | None = None,
) -> list[dict[str, Any]]:
    join_rows = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entry_batches")
        .select("timetable_entry_id")
        .eq("school_id", school_id)
        .eq("class_name", class_name)
        .eq("section", section)
        .execute()
    )
    entry_ids = _sanitize_lookup_ids([row.get("timetable_entry_id") for row in list(join_rows.data or [])])
    if entry_ids:
        response = (
            get_supabase_admin_client()
            .schema("scheduling")
            .table("timetable_entries")
            .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .in_("id", entry_ids)
            .order("day_of_week")
            .order("start_time")
            .order("id")
            .execute()
        )
        rows = list(response.data or [])
        if rows:
            return rows

    normalized_class = _normalize(class_name)
    normalized_section = _normalize(section)
    escaped_pipe = _escape_postgrest_like(f"{normalized_class} | {normalized_section}")
    escaped_dash = _escape_postgrest_like(f"{normalized_class}-{normalized_section}")
    escaped_space = _escape_postgrest_like(f"{normalized_class} {normalized_section}")
    escaped_class = _escape_postgrest_like(normalized_class)
    escaped_batch = _escape_postgrest_like(_normalize(batch_name))
    response = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .or_(
            ",".join(
                [
                    f"class_name.ilike.%{escaped_pipe}%",
                    f"class_name.ilike.%{escaped_dash}%",
                    f"class_name.ilike.%{escaped_space}%",
                    f"class_name.ilike.%{escaped_class}%",
                    *([f"class_name.ilike.%{escaped_batch}%"] if escaped_batch else []),
                    f"section.eq.{_escape_postgrest_like(normalized_section)}",
                ]
            )
        )
        .order("day_of_week")
        .order("start_time")
        .order("id")
        .execute()
    )
    return list(response.data or [])


def _fetch_timetable_candidates_by_batch_name(
    school_id: str,
    *,
    weekday: str | None = None,
    batch_name: str | None = None,
) -> list[dict[str, Any]]:
    normalized_batch = _normalize(batch_name)
    if not normalized_batch:
        return []
    escaped_batch = _escape_postgrest_like(normalized_batch)
    query = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .ilike("class_name", f"%{escaped_batch}%")
    )
    if weekday:
        query = query.eq("day_of_week", weekday)
    response = query.order("day_of_week").order("start_time").order("id").execute()
    return list(response.data or [])


def _merge_timetable_candidates(*candidate_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for group in candidate_groups:
        for row in group:
            row_id = str(row.get("id") or "")
            if row_id and row_id in seen_ids:
                continue
            if row_id:
                seen_ids.add(row_id)
            merged.append(row)
    return merged


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


def _fetch_subject_name(school_id: str, subject_id: str | None) -> str:
    if not subject_id:
        return ""
    response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("name")
        .eq("school_id", school_id)
        .eq("id", subject_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return _normalize(rows[0].get("name")) if rows else ""


def _fetch_subject_row(school_id: str, subject_id: str | None) -> dict[str, Any] | None:
    if not subject_id:
        return None
    response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, school_id, name, class_name, batch_id, metadata, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("id", subject_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return dict(rows[0]) if rows else None


def _find_teaching_staff_member_for_actor(school_id: str, actor: dict[str, Any]) -> dict[str, Any] | None:
    actor_email = _normalize(actor.get("email")).casefold()
    actor_name = _normalize(actor.get("name"))

    if actor_email:
        response = (
            get_supabase_admin_client()
            .table("staff_members")
            .select("id, full_name, email, staff_type, is_active")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .eq("staff_type", "teaching")
            .ilike("email", actor_email)
            .limit(1)
            .execute()
        )
        rows = list(response.data or [])
        if rows:
            return rows[0]

    if actor_name:
        response = (
            get_supabase_admin_client()
            .table("staff_members")
            .select("id, full_name, email, staff_type, is_active")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .eq("staff_type", "teaching")
            .ilike("full_name", actor_name)
            .limit(5)
            .execute()
        )
        rows = list(response.data or [])
        if rows:
            return rows[0]

    return None


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
        .select("id, name, class_name, section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .eq("class_name", class_name)
        .eq("section", section)
        .execute()
    )
    batch_rows_list = list(batch_rows.data or [])
    primary_batch = batch_rows_list[0] if batch_rows_list else None
    batch_ids = {str(row.get("id")) for row in batch_rows_list if row.get("id")}

    def _subject_priority(candidate: dict[str, Any]) -> tuple[int, int, int, str, str]:
        metadata = candidate.get("metadata") or {}
        metadata_section = _normalize(metadata.get("section")) if isinstance(metadata, dict) else ""
        row_class_name = _normalize(candidate.get("class_name"))
        exact_class_match = bool(row_class_name and _canonical_class_key(row_class_name) == _canonical_class_key(class_name))
        exact_section_match = exact_class_match and _cf(metadata_section) == _cf(section)
        batch_match = str(candidate.get("batch_id") or "") in batch_ids
        created_at = _normalize(candidate.get("created_at") or "")
        subject_name = _normalize(candidate.get("name"))
        return (
            0 if exact_section_match else 1,
            0 if exact_class_match else 1,
            0 if batch_match else 1,
            subject_name,
            created_at,
        )

    subject_rows = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name, class_name, batch_id, metadata, created_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .ilike("name", normalized_subject_name)
        .limit(25)
        .execute()
    )
    candidates = list(subject_rows.data or [])
    if candidates:
        candidates.sort(key=_subject_priority)
    best_fallback: dict[str, Any] | None = None
    for row in candidates:
        metadata = row.get("metadata") or {}
        metadata_section = _normalize(metadata.get("section")) if isinstance(metadata, dict) else ""
        row_class_name = _normalize(row.get("class_name"))
        if row_class_name and _canonical_class_key(row_class_name) == _canonical_class_key(class_name):
            if metadata_section and _cf(metadata_section) == _cf(section):
                return row
            if not best_fallback:
                best_fallback = row
        if batch_ids and str(row.get("batch_id")) in batch_ids:
            return row
    if best_fallback:
        return best_fallback
    return None


def get_teacher_current_class(
    school_id: str,
    *,
    actor: dict[str, Any],
    target_date: str | None = None,
    current_time: str | None = None,
) -> dict[str, Any]:
    teacher = _find_teaching_staff_member_for_actor(school_id, actor)
    if not teacher:
        raise ValueError("Logged-in teacher mapping not found")

    selected_date = datetime.fromisoformat(target_date[:10]).date() if target_date else datetime.now().date()
    weekday = _day_of_week_value(selected_date)

    current_rows_response = (
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
        .eq("school_id", school_id)
        .eq("staff_member_id", teacher.get("id"))
        .eq("day_of_week", weekday)
        .eq("is_active", True)
        .order("start_time")
        .order("id")
        .execute()
    )
    current_rows = list(current_rows_response.data or [])
    candidate_rows = [
        row
        for row in current_rows
        if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
    ]
    matched_row, matched_by_current_time = _choose_timetable_row(candidate_rows, current_time)

    if not matched_row:
        fallback_rows_response = (
            get_supabase_admin_client()
            .schema("scheduling")
            .table("timetable_entries")
            .select("id, staff_member_id, subject_id, day_of_week, start_time, end_time, class_name, session_type, metadata, is_active")
            .eq("school_id", school_id)
            .eq("staff_member_id", teacher.get("id"))
            .eq("is_active", True)
            .order("day_of_week")
            .order("start_time")
            .order("id")
            .execute()
        )
        fallback_rows = [
            row
            for row in list(fallback_rows_response.data or [])
            if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
        ]
        matched_row, matched_by_current_time = _choose_timetable_row(fallback_rows, None)

    if not matched_row:
        return {
            "teacher_id": str(teacher.get("id") or ""),
            "teacher_name": _normalize(teacher.get("full_name")),
            "date": datetime.combine(selected_date, datetime.min.time()).isoformat(),
            "matched_by_current_time": False,
        }

    batch_name = _split_timetable_batches(matched_row.get("class_name"))[:1]
    class_name, section = split_batch_to_class_section(batch_name[0] if batch_name else matched_row.get("class_name"))
    metadata = matched_row.get("metadata") or {}
    subject_name = _normalize(metadata.get("subject")) if isinstance(metadata, dict) else ""
    if not subject_name:
        subject_name = _fetch_subject_name(school_id, str(matched_row.get("subject_id") or ""))
    subject_row = _fetch_subject_row(school_id, str(matched_row.get("subject_id") or "")) or _resolve_subject_for_batch_context(
        school_id,
        class_name=class_name,
        section=section,
        subject_name=subject_name,
    )

    return {
        "teacher_id": str(teacher.get("id") or ""),
        "teacher_name": _normalize(teacher.get("full_name")),
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


def get_batch_current_class(
    school_id: str,
    *,
    class_name: str,
    section: str,
    batch_name: str | None = None,
    target_date: str | None = None,
    current_time: str | None = None,
) -> dict[str, Any]:
    selected_date = datetime.fromisoformat(target_date[:10]).date() if target_date else datetime.now().date()
    weekday = _day_of_week_value(selected_date)
    class_name, section = _resolve_class_section_from_batch_name(
        school_id,
        batch_name=batch_name,
        class_name=class_name,
        section=section,
    )
    cache_key = _batch_current_class_cache_key(
        school_id,
        class_name,
        section,
        selected_date,
        current_time,
        batch_name=batch_name,
    )
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
        used_join_table = bool(join_rows)
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
    legacy_rows = [] if join_rows else _fetch_timetable_candidates_from_legacy_batches(
        school_id,
        weekday=weekday,
        class_name=class_name,
        section=section,
        batch_name=batch_name,
    )
    direct_batch_rows = [] if join_rows else _fetch_timetable_candidates_by_batch_name(
        school_id,
        weekday=weekday,
        batch_name=batch_name,
    )
    rows = _merge_timetable_candidates(join_rows, legacy_rows, direct_batch_rows)
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
        and (
            used_join_table
            or _batch_label_matches(batch_name, row.get("class_name"))
            or _batch_matches_timetable_entry(class_name, section, row.get("class_name"))
        )
    ]
    matched_row, matched_by_current_time = _choose_timetable_row(candidate_rows, current_time)

    if not matched_row:
        fallback_rows = _merge_timetable_candidates(
            _fetch_timetable_candidates_any_day(
                school_id,
                class_name=class_name,
                section=section,
                batch_name=batch_name,
            ),
            _fetch_timetable_candidates_by_batch_name(
                school_id,
                batch_name=batch_name,
            ),
        )
        candidate_rows = [
            row
            for row in fallback_rows
            if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
            and (
                _batch_label_matches(batch_name, row.get("class_name"))
                or _batch_matches_timetable_entry(class_name, section, row.get("class_name"))
            )
        ]
        matched_row, matched_by_current_time = _choose_timetable_row(candidate_rows, None)

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
        subject_name = _fetch_subject_name(school_id, str(matched_row.get("subject_id") or ""))
    staff_member_id = str(matched_row.get("staff_member_id") or "")
    teacher_name = _fetch_staff_member_name(school_id, staff_member_id)
    subject_row = _fetch_subject_row(school_id, str(matched_row.get("subject_id") or "")) or _resolve_subject_for_batch_context(
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


def list_batch_day_classes(
    school_id: str,
    *,
    class_name: str,
    section: str,
    batch_name: str | None = None,
    target_date: str | None = None,
    current_time: str | None = None,
) -> list[dict[str, Any]]:
    selected_date = datetime.fromisoformat(target_date[:10]).date() if target_date else datetime.now().date()
    weekday = _day_of_week_value(selected_date)
    class_name, section = _resolve_class_section_from_batch_name(
        school_id,
        batch_name=batch_name,
        class_name=class_name,
        section=section,
    )

    join_rows: list[dict[str, Any]] = []
    used_join_table = False
    try:
        join_rows = _fetch_timetable_candidates_from_normalized_batches(
            school_id,
            weekday=weekday,
            class_name=class_name,
            section=section,
        )
        used_join_table = bool(join_rows)
    except Exception:
        logger.exception(
            "attendance.batch_day_classes.join_lookup_failed",
            extra={"school_id": school_id, "class_name": class_name, "section": section},
        )

    legacy_rows = [] if join_rows else _fetch_timetable_candidates_from_legacy_batches(
        school_id,
        weekday=weekday,
        class_name=class_name,
        section=section,
        batch_name=batch_name,
    )
    direct_batch_rows = [] if join_rows else _fetch_timetable_candidates_by_batch_name(
        school_id,
        weekday=weekday,
        batch_name=batch_name,
    )
    rows = _merge_timetable_candidates(join_rows, legacy_rows, direct_batch_rows)
    candidate_rows = [
        row
        for row in rows
        if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
        and (
            used_join_table
            or _batch_label_matches(batch_name, row.get("class_name"))
            or _batch_matches_timetable_entry(class_name, section, row.get("class_name"))
        )
    ]

    fallback_mode = False
    if not candidate_rows:
        fallback_mode = True
        fallback_rows = _merge_timetable_candidates(
            _fetch_timetable_candidates_any_day(
                school_id,
                class_name=class_name,
                section=section,
                batch_name=batch_name,
            ),
            _fetch_timetable_candidates_by_batch_name(
                school_id,
                batch_name=batch_name,
            ),
        )
        candidate_rows = [
            row
            for row in fallback_rows
            if _normalize(((row.get("metadata") or {}).get("ui_session_type") if isinstance(row.get("metadata"), dict) else row.get("session_type"))) not in {"break_time", "self_study"}
            and (
                _batch_label_matches(batch_name, row.get("class_name"))
                or _batch_matches_timetable_entry(class_name, section, row.get("class_name"))
            )
        ]

    matched_row, _ = _choose_timetable_row(candidate_rows, None if fallback_mode else current_time)
    matched_row_id = str((matched_row or {}).get("id") or "")
    payloads: list[dict[str, Any]] = []
    for row in candidate_rows:
        metadata = row.get("metadata") or {}
        subject_name = _normalize(metadata.get("subject")) if isinstance(metadata, dict) else ""
        if not subject_name:
            subject_name = _fetch_subject_name(school_id, str(row.get("subject_id") or ""))
        staff_member_id = str(row.get("staff_member_id") or "")
        teacher_name = _fetch_staff_member_name(school_id, staff_member_id)
        subject_row = _fetch_subject_row(school_id, str(row.get("subject_id") or "")) or _resolve_subject_for_batch_context(
            school_id,
            class_name=class_name,
            section=section,
            subject_name=subject_name,
        )
        payloads.append(
            {
                "teacher_id": staff_member_id,
                "teacher_name": teacher_name,
                "date": datetime.combine(selected_date, datetime.min.time()).isoformat(),
                "class_name": class_name,
                "section": section,
                "subject": subject_name or None,
                "subject_id": (subject_row or {}).get("id"),
                "start_time": _normalize_time_hhmm(row.get("start_time")) or None,
                "end_time": _normalize_time_hhmm(row.get("end_time")) or None,
                "timetable_entry_id": row.get("id"),
                "matched_by_current_time": str(row.get("id") or "") == matched_row_id,
            }
        )
    return payloads


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
    normalized_search = _normalize(search)
    normalized_batch = _normalize(batch)
    try:
        query = (
            get_supabase_admin_client()
            .table("students")
            .select(
                "id, school_id, batch_id, roll_number, full_name, father_name, phone, class_name, section, is_active, created_at, updated_at"
            )
            .eq("school_id", school_id)
            .eq("is_active", True)
            .order("full_name")
        )

        if normalized_search:
            escaped = _escape_postgrest_like(normalized_search)
            query = query.or_(
                f"full_name.ilike.%{escaped}%,roll_number.ilike.%{escaped}%,father_name.ilike.%{escaped}%"
            )

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
    except Exception:
        logger.exception(
            "attendance.students.fetch_failed",
            extra={
                "school_id": school_id,
                "skip": safe_skip,
                "limit": safe_limit,
                "has_search": bool(normalized_search),
                "has_batch": bool(normalized_batch),
            },
        )
        return []


def _fetch_batches(school_id: str) -> dict[str, dict[str, Any]]:
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_BATCHES_CACHE, school_id)
    if cached_payload:
        logger.info("attendance.batches.cache_hit", extra={"school_id": school_id})
        return cached_payload

    try:
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
    except Exception:
        logger.exception("attendance.batches.fetch_failed", extra={"school_id": school_id})
        return {}


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
    try:
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
    except Exception:
        logger.exception("attendance.subjects.fetch_failed", extra={"school_id": school_id})
        return []


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
        "class_name": class_name or "General",
        "section": section or "A",
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
    batch_lookup = _fetch_batches(school_id)
    return sanitize_response_payload(
        [_serialize_student(row, batch_lookup) for row in rows],
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
    subject_id: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    batch_lookup = _fetch_batches(school_id)
    if not subject_id:
        raise HTTPException(status_code=422, detail="Subject selection is required to load student attendance marking.")
    subject_response = (
        get_supabase_admin_client()
        .table("subjects")
        .select("id, name, class_name, batch_id, metadata")
        .eq("school_id", school_id)
        .eq("id", subject_id)
        .limit(1)
        .execute()
    )
    subject_rows = list(subject_response.data or [])
    if not subject_rows:
        raise HTTPException(status_code=422, detail="Subject could not be resolved for the selected class and section.")
    subject = subject_rows[0]

    serialized_students = [
        _serialize_student(row, batch_lookup)
        for row in _fetch_students(
            school_id,
            search=search,
            skip=0,
            limit=MAX_STUDENT_LOOKUP,
        )
    ]

    def _build_student_marking_roster(target_class_name: str, target_section: str) -> list[dict[str, Any]]:
        return [
            {
                "id": row.get("id"),
                "full_name": row.get("name"),
                "roll_number": row.get("roll_no"),
                "class_name": row.get("class_name"),
                "section": row.get("section"),
            }
            for row in serialized_students
            if _cf(row.get("class_name")) == _cf(target_class_name)
            and _cf(row.get("section")) == _cf(target_section)
        ]

    resolved_class_name = _normalize(class_name)
    resolved_section = _normalize(section)
    students = _build_student_marking_roster(resolved_class_name, resolved_section)

    if not students:
        subject_metadata = subject.get("metadata") if isinstance(subject.get("metadata"), dict) else {}
        subject_batch = batch_lookup.get(str(subject.get("batch_id")) or "")
        subject_class_name = _normalize(subject.get("class_name")) or _normalize((subject_batch or {}).get("class_name"))
        subject_section = (
            _normalize(subject_metadata.get("section"))
            or _normalize((subject_batch or {}).get("section"))
        )
        if subject_class_name and subject_section:
            resolved_class_name = subject_class_name
            resolved_section = subject_section
            students = _build_student_marking_roster(resolved_class_name, resolved_section)

    existing_by_student_id: dict[str, dict[str, Any]] = {}
    student_ids = _sanitize_lookup_ids([row.get("id") for row in students], require_uuid=True)
    attendance_rows: list[dict[str, Any]] = []
    if student_ids or not students:
        try:
            attendance_response = (
                get_supabase_admin_client()
                .schema("attendance")
                .table("student_attendance")
                .select("student_id, status, absence_reason")
                .eq("school_id", school_id)
                .eq("subject_id", subject.get("id"))
                .eq("attendance_date", date_value[:10])
                .execute()
            )
            attendance_rows = list(attendance_response.data or [])
            existing_by_student_id = {
                str(row.get("student_id")): row
                for row in attendance_rows
            }
        except Exception:
            logger.exception(
                "attendance.student_marking.prefill_failed",
                extra={
                    "school_id": school_id,
                    "class_name": class_name,
                    "section": section,
                    "subject_id": subject.get("id"),
                    "student_count": len(student_ids),
                },
            )

    if not students and attendance_rows:
        attended_student_ids = _sanitize_lookup_ids(
            [row.get("student_id") for row in attendance_rows],
            require_uuid=True,
        )
        attended_student_id_set = set(attended_student_ids)
        students = [
            {
                "id": row.get("id"),
                "full_name": row.get("name"),
                "roll_number": row.get("roll_no"),
                "class_name": row.get("class_name"),
                "section": row.get("section"),
            }
            for row in serialized_students
            if str(row.get("id") or "") in attended_student_id_set
        ]

    students.sort(key=lambda row: (_normalize(row.get("roll_number")), _normalize(row.get("full_name"))))

    return {
        "date": datetime.fromisoformat(f"{date_value[:10]}T00:00:00").isoformat(),
        "class_name": resolved_class_name or class_name,
        "section": resolved_section or section,
        "subject_id": subject.get("id") if subject else None,
        "subject_name": subject.get("name") if subject else "",
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
    skipped_entries: list[str] = []
    for entry in entries or []:
        staff_member_id = _normalize(entry.get("staff_member_id"))
        if not staff_member_id:
            skipped_entries.append("empty")
            continue
        if not _is_valid_uuid(staff_member_id):
            skipped_entries.append(staff_member_id)
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

    if skipped_entries:
        logger.warning(
            "attendance.save_staff_marking.skipped_entries",
            extra={
                "skipped_count": len(skipped_entries),
                "skipped_ids": skipped_entries[:50],
                "school_id": str(school_id),
            },
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


def save_student_marking(
    school_id: str,
    *,
    date_value: str,
    subject_id: str | None = None,
    marked_by: str | None = None,
    entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    logger.info(
        "attendance.supabase.save.request",
        extra={
            "school_id": str(school_id),
            "date": str(date_value),
            "subject_id": str(subject_id),
            "entries": len(entries or []),
        },
    )
    normalized_entries = list(entries or [])
    raw_student_ids = [entry.get("student_id") for entry in normalized_entries]
    student_ids = _sanitize_lookup_ids(raw_student_ids, require_uuid=True)
    if not student_ids:
        logger.warning(
            "attendance.save_student_marking.no_valid_uuids",
            extra={
                "total_entries": len(normalized_entries),
                "raw_ids": raw_student_ids,
                "school_id": str(school_id),
            },
        )
        return {"message": "Student attendance saved successfully"}

    students_response = (
        get_supabase_admin_client()
        .table("students")
        .select("id, class_name, section")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .in_("id", student_ids)
        .execute()
    )
    students_by_id = {
        str(row.get("id")): row
        for row in list(students_response.data or [])
        if row.get("id")
    }
    shared_subject = _fetch_subject_row(school_id, subject_id) if subject_id else None

    skipped_entries: list[str] = []
    payload_rows: list[dict[str, Any]] = []
    for entry in normalized_entries:
        student_id = _normalize(entry.get("student_id"))
        if not student_id:
            skipped_entries.append("empty")
            continue
        student_row = students_by_id.get(student_id)
        if not student_row:
            skipped_entries.append(student_id)
            continue

        class_name = _normalize(student_row.get("class_name"))
        section = _normalize(student_row.get("section"))
        if not class_name or not section:
            raise HTTPException(
                status_code=422,
                detail="Student class/section mapping is incomplete for attendance marking.",
            )
        if not shared_subject:
            raise HTTPException(
                status_code=422,
                detail="Subject selection is required to save student attendance.",
            )
        resolved_subject = shared_subject
        if not resolved_subject:
            raise HTTPException(
                status_code=422,
                detail="Subject could not be resolved for the selected class and section.",
            )

        status = _normalize(entry.get("status")) or "present"
        payload_rows.append(
            {
                "school_id": school_id,
                "student_id": student_id,
                "subject_id": resolved_subject.get("id"),
                "attendance_date": date_value[:10],
                "status": status,
                "absence_reason": (
                    _normalize(entry.get("absence_reason")) or None
                    if status == "absent"
                    else None
                ),
                "metadata": {
                    "marked_by": marked_by or "Attendance Admin",
                    "class_name": class_name,
                    "section": section,
                },
            }
        )

    if skipped_entries:
        logger.warning(
            "attendance.save_student_marking.skipped_entries",
            extra={
                "skipped_count": len(skipped_entries),
                "skipped_ids": skipped_entries[:50],
                "school_id": str(school_id),
            },
        )

    if not payload_rows:
        return {"message": "Student attendance saved successfully"}

    unique_student_ids = sorted({str(row.get("student_id")) for row in payload_rows if row.get("student_id")})
    unique_subject_ids = sorted({str(row.get("subject_id")) for row in payload_rows if row.get("subject_id")})
    if unique_student_ids and unique_subject_ids:
        duplicate_check = (
            get_supabase_admin_client()
            .schema("attendance")
            .table("student_attendance")
            .select("id, student_id, subject_id, attendance_date", count="exact")
            .eq("school_id", school_id)
            .eq("attendance_date", date_value[:10])
            .in_("student_id", unique_student_ids)
            .in_("subject_id", unique_subject_ids)
            .limit(1)
            .execute()
        )
        if int(getattr(duplicate_check, "count", 0) or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="Attendance already saved for this batch, subject, and date.",
            )

    (
        get_supabase_admin_client()
        .schema("attendance")
        .table("student_attendance")
        .upsert(payload_rows, on_conflict="student_id,subject_id,attendance_date")
        .execute()
    )

    ATTENDANCE_STUDENT_RECORDS_CACHE.clear()
    ATTENDANCE_STUDENT_DASHBOARD_CACHE.clear()
    ATTENDANCE_OVERVIEW_CACHE.clear()
    return {"message": "Student attendance saved successfully"}


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
    safe_limit = max(min(limit, 500), 1)
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
        if batch_filters and not payload:
            logger.info(
                "attendance.student_records.rpc_empty_with_batch_filters",
                extra={
                    "school_id": school_id,
                    "skip": safe_skip,
                    "limit": safe_limit,
                },
            )
        else:
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
    resolved_batch_filter_pairs: list[tuple[str, str | None]] = []
    for raw_batch_name, raw_section in batch_filters or []:
        resolved_class_name, resolved_section = _resolve_class_section_from_batch_name(
            school_id,
            batch_name=raw_batch_name,
            class_name=None,
            section=raw_section,
        )
        normalized_class_name = _normalize(resolved_class_name)
        normalized_section = _normalize(resolved_section) or None
        if normalized_class_name:
            resolved_batch_filter_pairs.append((normalized_class_name, normalized_section))
    normalized_batch_filters = _normalize_batch_filters(resolved_batch_filter_pairs)
    normalized_batch_filter_names = _normalize_batch_filter_names(batch_filters)
    student_ids = _sanitize_lookup_ids(
        [row.get("id") for row in student_rows],
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
    student_lookup = {str(item.get("id")): item for item in student_rows}
    batch_rows = list(batches.values())

    def _resolve_payload_batch_name(
        student_row: dict[str, Any],
        effective_class_name: str,
        effective_section: str,
    ) -> str:
        explicit_batch_name = _normalize(student_row.get("batch_name"))
        if explicit_batch_name:
            return explicit_batch_name
        if not effective_class_name:
            return ""
        for batch_row in batch_rows:
            batch_class_name = _normalize(batch_row.get("class_name"))
            batch_section = _normalize(batch_row.get("section"))
            if _cf(batch_class_name) != _cf(effective_class_name):
                continue
            if effective_section and _cf(batch_section) != _cf(effective_section):
                continue
            return _normalize(batch_row.get("name"))
        return ""

    payload: list[dict[str, Any]] = []
    for row in rows:
        student_row = student_lookup.get(str(row.get("student_id")), {})
        effective_class_name = (
            _normalize((row.get("metadata") or {}).get("class_name"))
            or _normalize(student_row.get("class_name"))
        )
        effective_section = (
            _normalize((row.get("metadata") or {}).get("section"))
            or _normalize(student_row.get("section"))
        )
        payload.append(
            {
                "id": row.get("id"),
                "student_id": row.get("student_id"),
                "student_name": _normalize(student_row.get("name")),
                "roll_no": _normalize(student_row.get("roll_no")),
                "class_name": effective_class_name,
                "section": effective_section,
                "batch_name": _resolve_payload_batch_name(
                    student_row,
                    effective_class_name,
                    effective_section,
                ),
                "date": _iso_datetime(row.get("attendance_date")),
                "subject_id": row.get("subject_id"),
                "subject_name": subjects.get(str(row.get("subject_id")), {}).get("name", ""),
                "status": row.get("status") or "present",
                "absence_reason": row.get("absence_reason"),
                "marked_by": _normalize((row.get("metadata") or {}).get("marked_by")) or "System",
                "created_at": _iso(row.get("created_at")),
            }
        )

    wants_student_name = bool(student_name and student_name.strip())
    wants_class_name = bool(class_name and class_name.strip())
    wants_section = bool(section and section.strip())
    wants_batch_filters = bool(normalized_batch_filters or normalized_batch_filter_names)
    if wants_student_name or wants_class_name or wants_section or wants_batch_filters:
        wanted_student = _cf(student_name) if wants_student_name else ""
        wanted_class_name = _cf(class_name) if wants_class_name else ""
        wanted_section = _cf(section) if wants_section else ""

        def _payload_matches_filters(item: dict[str, Any]) -> bool:
            effective_class_name = _normalize(item.get("class_name"))
            effective_section = _normalize(item.get("section"))
            effective_batch_name = _normalize(item.get("batch_name"))
            effective_student_name = _normalize(item.get("student_name"))
            effective_roll_no = _normalize(item.get("roll_no"))

            if wants_student_name:
                if wanted_student not in _cf(effective_student_name) and wanted_student not in _cf(effective_roll_no):
                    return False
            if wants_class_name and _cf(effective_class_name) != wanted_class_name:
                return False
            if wants_section and _cf(effective_section) != wanted_section:
                return False
            if normalized_batch_filter_names:
                effective_batch_key = _canonical_batch_key(effective_batch_name)
                effective_class_section_key = _canonical_batch_key(f"{effective_class_name} | {effective_section}")
                if not any(
                    effective_batch_key == _canonical_batch_key(batch_name)
                    or effective_class_section_key == _canonical_batch_key(batch_name)
                    for batch_name in normalized_batch_filter_names
                ):
                    return False
            elif normalized_batch_filters and not any(
                _cf(effective_class_name) == _cf(filter_item.get("class_name"))
                and (
                    not filter_item.get("section")
                    or _cf(effective_section) == _cf(filter_item.get("section"))
                )
                for filter_item in normalized_batch_filters
            ):
                return False
            return True

        payload = [item for item in payload if _payload_matches_filters(item)]
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
    ATTENDANCE_STUDENT_RECORDS_CACHE.clear()
    ATTENDANCE_STUDENT_DASHBOARD_CACHE.clear()
    ATTENDANCE_OVERVIEW_CACHE.clear()
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

    candidate_rows: list[dict[str, Any]] = []
    for chunk in _chunk_values(student_ids, ATTENDANCE_LOOKUP_CHUNK_SIZE):
        query = (
            get_supabase_admin_client()
            .schema("attendance")
            .table("student_attendance")
            .select("id")
            .eq("school_id", school_id)
            .in_("student_id", chunk)
        )
        if date_from:
            query = query.gte("attendance_date", date_from[:10])
        if date_to:
            query = query.lte("attendance_date", date_to[:10])
        candidate_rows.extend(list(query.execute().data or []))
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

    ATTENDANCE_STUDENT_RECORDS_CACHE.clear()
    ATTENDANCE_STUDENT_DASHBOARD_CACHE.clear()
    ATTENDANCE_OVERVIEW_CACHE.clear()

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


def _student_dashboard_cache_key(
    school_id: str,
    *,
    date_value: str | None = None,
    class_name: str | None = None,
    batch_name: str | None = None,
    scope: str | None = None,
) -> str:
    return "|".join(
        [
            school_id,
            (date_value or "")[:10],
            _cf(class_name),
            _cf(batch_name),
            _cf(scope),
        ]
    )


def _student_calendar_cache_key(
    school_id: str,
    *,
    month: str | None = None,
    class_name: str | None = None,
    batch_name: str | None = None,
    scope: str | None = None,
) -> str:
    return "|".join([
        school_id,
        (month or "")[:7],
        _cf(class_name),
        _cf(batch_name),
        _cf(scope),
    ])


async def get_student_calendar(
    school_id: str,
    *,
    month: str | None = None,
    class_name: str | None = None,
    batch_name: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    """Return server-driven monthly calendar aggregation for students.

    Payload:
    - month: YYYY-MM
    - marked_dates: list of ISO date strings with attendance
    - day_summary: list of per-day summaries with present/absent/late/total/status
    - monthly_totals: totals for the month
    """
    cache_key = _student_calendar_cache_key(
        school_id, month=month, class_name=class_name, batch_name=batch_name, scope=scope
    )
    cached = _get_ttl_cache_entry(ATTENDANCE_STUDENT_DASHBOARD_CACHE, cache_key)
    if cached:
        logger.info("attendance.student_calendar.cache_hit", extra={"school_id": school_id, "cache_key": cache_key})
        return cached

    # Determine month range
    today = datetime.utcnow().date()
    month_text = (month or today.isoformat())[:7]
    try:
        year_int, month_int = map(int, month_text.split("-"))
    except Exception:
        year_int = today.year
        month_int = today.month
    first_day = date(year_int, month_int, 1)
    last_day = date(year_int, month_int, calendar.monthrange(year_int, month_int)[1])
    date_from = first_day.isoformat()
    date_to = last_day.isoformat()

    # Use list_student_records to obtain authoritative, augmented rows and page through results.
    page = 0
    page_size = 500
    all_rows: list[dict[str, Any]] = []
    max_pages = 100  # safety cap
    batch_filters = None
    if batch_name:
        batch_filters = [(batch_name, None)]

    while True:
        rows = await list_student_records(
            school_id,
            class_name=class_name,
            section=None,
            student_name=None,
            date_from=date_from,
            date_to=date_to,
            skip=page * page_size,
            limit=page_size,
            batch_filters=batch_filters,
        )
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
        if page >= max_pages:
            break

    # Aggregate per-day
    day_map: dict[str, dict[str, int | str]] = {}
    marked_dates_set: set[str] = set()
    for r in all_rows:
        dt = _normalize(r.get("date"))[:10]
        if not dt:
            continue
        marked_dates_set.add(dt)
        bucket = day_map.setdefault(dt, {"present": 0, "absent": 0, "late": 0, "total": 0})
        status = _normalize(r.get("status")) or "present"
        if status == "present":
            bucket["present"] += 1
        elif status == "absent":
            bucket["absent"] += 1
        elif status == "late":
            bucket["late"] += 1
        else:
            # treat unknown as present
            bucket["present"] += 1
        bucket["total"] += 1

    # Build ordered day summary for entire month
    days_in_month = calendar.monthrange(year_int, month_int)[1]
    day_summary: list[dict[str, Any]] = []
    monthly_present = monthly_absent = monthly_late = monthly_total = 0
    for day in range(1, days_in_month + 1):
        dt = date(year_int, month_int, day).isoformat()
        bucket = day_map.get(dt, {"present": 0, "absent": 0, "late": 0, "total": 0})
        present = int(bucket.get("present") or 0)
        absent = int(bucket.get("absent") or 0)
        late = int(bucket.get("late") or 0)
        total = int(bucket.get("total") or 0)
        if absent > 0:
            status = "absent"
        elif present > 0:
            status = "present"
        elif late > 0:
            status = "late"
        else:
            status = ""
        day_summary.append(
            {
                "date": dt,
                "day": day,
                "status": status,
                "present": present,
                "absent": absent,
                "late": late,
                "total": total,
            }
        )
        monthly_present += present
        monthly_absent += absent
        monthly_late += late
        monthly_total += total

    payload = {
        "month": f"{year_int:04d}-{month_int:02d}",
        "marked_dates": sorted(list(marked_dates_set)),
        "day_summary": day_summary,
        "monthly_totals": {
            "present_count": monthly_present,
            "absent_count": monthly_absent,
            "late_count": monthly_late,
            "total": monthly_total,
        },
    }

    _set_ttl_cache_entry(
        ATTENDANCE_STUDENT_DASHBOARD_CACHE,
        cache_key,
        payload,
        ATTENDANCE_STUDENT_DASHBOARD_CACHE_TTL_SECONDS,
    )
    logger.info(
        "attendance.student_calendar.complete",
        extra={
            "school_id": school_id,
            "month": payload["month"],
            "record_count": len(all_rows),
            "day_count": len(payload["day_summary"]),
        },
    )
    return payload


def _rpc_student_dashboard(
    school_id: str,
    *,
    date_value: str | None = None,
    class_name: str | None = None,
    batch_name: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    params = {
        "p_school_id": school_id,
        "p_date": date_value[:10] if date_value else None,
        "p_class_name": _normalize(class_name) or None,
        "p_batch_name": _normalize(batch_name) or None,
        "p_scope": _normalize(scope) or None,
    }
    started_at = time.monotonic()
    response = get_supabase_admin_client().rpc("attendance_student_dashboard_summary", params).execute()
    duration_ms = round((time.monotonic() - started_at) * 1000)
    rows = list(response.data or [])
    row = rows[0] if rows else {}
    class_summary = row.get("class_summary") or []
    batch_summary = row.get("batch_summary") or []
    date_summary = row.get("date_summary") or []
    if not isinstance(class_summary, list):
        class_summary = []
    if not isinstance(batch_summary, list):
        batch_summary = []
    if not isinstance(date_summary, list):
        date_summary = []
    payload = {
        "scope": params["p_scope"],
        "date": params["p_date"],
        "class_name": params["p_class_name"],
        "batch_name": params["p_batch_name"],
        "total_count": int(row.get("total_count") or 0),
        "present_count": int(row.get("present_count") or 0),
        "absent_count": int(row.get("absent_count") or 0),
        "late_count": int(row.get("late_count") or 0),
        "class_summary": class_summary,
        "batch_summary": batch_summary,
        "date_summary": date_summary,
    }
    logger.info(
        "attendance.student_dashboard.rpc_complete",
        extra={
            "school_id": school_id,
            "duration_ms": duration_ms,
            "date": params["p_date"],
            "class_name": params["p_class_name"],
            "batch_name": params["p_batch_name"],
            "scope": params["p_scope"],
            "total_count": payload["total_count"],
            "batch_count": len(batch_summary),
        },
    )
    return payload


def get_student_dashboard(
    school_id: str,
    *,
    date_value: str | None = None,
    class_name: str | None = None,
    batch_name: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    cache_key = _student_dashboard_cache_key(
        school_id,
        date_value=date_value,
        class_name=class_name,
        batch_name=batch_name,
        scope=scope,
    )
    cached_payload = _get_ttl_cache_entry(ATTENDANCE_STUDENT_DASHBOARD_CACHE, cache_key)
    if cached_payload:
        logger.info("attendance.student_dashboard.cache_hit", extra={"school_id": school_id, "cache_key": cache_key})
        return cached_payload

    started_at = time.monotonic()
    payload = _rpc_student_dashboard(
        school_id,
        date_value=date_value,
        class_name=class_name,
        batch_name=batch_name,
        scope=scope,
    )
    _set_ttl_cache_entry(
        ATTENDANCE_STUDENT_DASHBOARD_CACHE,
        cache_key,
        payload,
        ATTENDANCE_STUDENT_DASHBOARD_CACHE_TTL_SECONDS,
    )
    logger.info(
        "attendance.student_dashboard.complete",
        extra={
            "school_id": school_id,
            "duration_ms": round((time.monotonic() - started_at) * 1000),
            "date": date_value,
            "class_name": _normalize(class_name) or None,
            "batch_name": _normalize(batch_name) or None,
            "scope": _normalize(scope) or None,
        },
    )
    return payload


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
