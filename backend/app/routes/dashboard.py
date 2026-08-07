"""Combined dashboard endpoint - returns all metrics in one cached response."""

from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from typing import Any, Callable

from fastapi import APIRouter, Depends, Response

from app.middleware.auth import get_authenticated_actor_context
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_metrics import (
    get_dashboard_metrics_rpc,
    get_edupay_dashboard_summary_rpc,
    get_school_core_counts_cached,
)
from app.services.supabase_timetable import get_timetable_table_query
from app.utils.dashboard_tracing import begin_dashboard_request, finish_dashboard_request

logger = logging.getLogger(__name__)

router = APIRouter()

_dashboard_cache: dict[str, dict[str, Any]] = {}
_DASHBOARD_CACHE_TTL = 120  # seconds
_dashboard_rpc_missing_until = 0.0
_DASHBOARD_IN_FLIGHT: dict[str, dict[str, Any]] = {}
_DASHBOARD_IN_FLIGHT_LOCK = Lock()


def _perf_log(label: str, school_id: str, duration_ms: float, **extra):
    logger.info(
        "perf.dashboard.%s",
        label,
        extra={"school_id": school_id, "duration_ms": round(duration_ms, 1), **extra},
    )


def _is_missing_dashboard_rpc_error(exc: Exception) -> bool:
    error_text = str(exc or "")
    error_code = getattr(exc, "code", None)
    return error_code == "PGRST202" or "PGRST202" in error_text or "get_dashboard_metrics" in error_text


def _is_missing_relation_error(exc: Exception) -> bool:
    error_text = str(exc or "")
    error_code = getattr(exc, "code", None)
    lowered = error_text.lower()
    return (
        error_code in {"PGRST202", "PGRST205", "42P01"}
        or "pgrst202" in lowered
        or "pgrst205" in lowered
        or "schema cache" in lowered
        or "could not find the table" in lowered
        or "relation " in lowered and " does not exist" in lowered
        or "schema " in lowered and " does not exist" in lowered
    )


def _is_optional_lookup_error(exc: Exception) -> bool:
    error_text = str(exc or "")
    error_code = getattr(exc, "code", None)
    lowered = error_text.lower()
    return _is_missing_relation_error(exc) or error_code == "22P02" or "invalid input syntax for type uuid" in lowered


def _get_cached_dashboard_payload(school_id: str) -> dict[str, Any] | None:
    cached = _dashboard_cache.get(school_id)
    if cached and cached["expires_at"] > time.monotonic():
        return cached["payload"]
    if cached:
        _dashboard_cache.pop(school_id, None)
    return None


def _cache_dashboard_payload(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    _dashboard_cache[school_id] = {
        "payload": payload,
        "expires_at": time.monotonic() + _DASHBOARD_CACHE_TTL,
    }
    return payload


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _get_timetable_entries_count(school_id: str) -> int:
    try:
        response = (
            get_timetable_table_query()
            .select("id", count="exact")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_optional_lookup_error(exc):
            return 0
        raise
    return int(getattr(response, "count", 0) or 0)


def _load_edupay_dashboard_summary(school_id: str) -> dict[str, Any]:
    try:
        payload = get_edupay_dashboard_summary_rpc(school_id)
    except Exception as exc:
        if _is_optional_lookup_error(exc):
            return {}
        raise
    if not payload:
        return {}
    return {
        "total_collected": round(_to_float(payload.get("total_collected")), 2),
        "pending_amount": round(_to_float(payload.get("pending_amount")), 2),
        "overdue_amount": round(_to_float(payload.get("overdue_amount")), 2),
        "today_collection": round(_to_float(payload.get("today_collection")), 2),
        "upcoming_dues": _to_int(payload.get("upcoming_dues")),
        "total_students": _to_int(payload.get("total_students")),
        "active_fee_structures": _to_int(payload.get("active_fee_structures")),
        "reminders_queued": _to_int(payload.get("reminders_queued")),
        "collection_trend": list(payload.get("collection_trend") or []),
        "payment_method_split": list(payload.get("payment_method_split") or []),
        "reminders": list(payload.get("reminders") or []),
        "recent_payments": list(payload.get("recent_payments") or []),
    }


def _augment_dashboard_payload(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload or {})
    if "timetable_entries_count" not in normalized:
        try:
            normalized["timetable_entries_count"] = _get_timetable_entries_count(school_id)
        except Exception as exc:
            _perf_log("augment.timetable_count_error", school_id, 0, error=str(exc)[:200])
    if "edupay_dashboard" not in normalized:
        try:
            edupay_summary = _load_edupay_dashboard_summary(school_id)
            if edupay_summary:
                normalized["edupay_dashboard"] = edupay_summary
        except Exception as exc:
            _perf_log("augment.edupay_summary_error", school_id, 0, error=str(exc)[:200])
    return normalized


@router.get("/dashboard/metrics")
async def get_dashboard_metrics(
    response: Response,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    del actor
    global _dashboard_rpc_missing_until
    trace = begin_dashboard_request("dashboard_metrics", school_id)
    response.headers["X-Dashboard-Request-Id"] = str(trace["request_id"])
    started_at = time.monotonic()
    cache_status = "miss"
    execution_path = "pending"

    cache_lookup_started_at = time.monotonic()
    cached = _get_cached_dashboard_payload(school_id)
    cache_lookup_ms = round((time.monotonic() - cache_lookup_started_at) * 1000, 1)
    if cached is not None:
        cache_status = "hit"
        execution_path = "cache"
        _perf_log("cache_hit", school_id, (time.monotonic() - started_at) * 1000, cache_lookup_ms=cache_lookup_ms)
        finish_dashboard_request(trace, cache_status=cache_status, execution_path=execution_path, cache_lookup_ms=cache_lookup_ms)
        return cached

    waiter: dict[str, Any] | None = None
    is_leader = False
    with _DASHBOARD_IN_FLIGHT_LOCK:
        cached = _get_cached_dashboard_payload(school_id)
        if cached is not None:
            cache_status = "hit_race"
            execution_path = "cache"
            _perf_log("cache_hit_raced", school_id, (time.monotonic() - started_at) * 1000, cache_lookup_ms=cache_lookup_ms)
            finish_dashboard_request(trace, cache_status=cache_status, execution_path=execution_path, cache_lookup_ms=cache_lookup_ms)
            return cached
        waiter = _DASHBOARD_IN_FLIGHT.get(school_id)
        if waiter is None:
            waiter = {"event": Event(), "payload": None, "error": None}
            _DASHBOARD_IN_FLIGHT[school_id] = waiter
            is_leader = True

    if not is_leader:
        wait_started_at = time.monotonic()
        await asyncio.to_thread(waiter["event"].wait)
        wait_ms = round((time.monotonic() - wait_started_at) * 1000, 1)
        if waiter.get("error"):
            finish_dashboard_request(trace, cache_status="shared_error", execution_path="inflight_wait", wait_ms=wait_ms)
            raise waiter["error"]
        payload = waiter.get("payload") or _get_cached_dashboard_payload(school_id) or {}
        _perf_log("inflight_reused", school_id, (time.monotonic() - started_at) * 1000, wait_ms=wait_ms)
        finish_dashboard_request(trace, cache_status="shared", execution_path="inflight_wait", wait_ms=wait_ms)
        return payload

    try:
        should_try_rpc = time.monotonic() >= _dashboard_rpc_missing_until
        if not should_try_rpc:
            execution_path = "fallback_skipped_rpc"
            payload = _cache_dashboard_payload(school_id, await _fallback_dashboard_async(school_id, started_at))
            _perf_log("rpc_skipped_missing", school_id, (time.monotonic() - started_at) * 1000, cache_lookup_ms=cache_lookup_ms)
        else:
            rpc_started_at = time.monotonic()
            try:
                payload = await asyncio.to_thread(get_dashboard_metrics_rpc, school_id)
                payload = await asyncio.to_thread(_augment_dashboard_payload, school_id, payload)
                rpc_duration = round((time.monotonic() - rpc_started_at) * 1000, 1)
                execution_path = "rpc"
            except Exception as exc:
                rpc_duration = round((time.monotonic() - rpc_started_at) * 1000, 1)
                if _is_missing_dashboard_rpc_error(exc):
                    _dashboard_rpc_missing_until = time.monotonic() + 300
                _perf_log("rpc_error", school_id, rpc_duration, error=str(exc)[:200])
                payload = {}
                execution_path = "rpc_error"

            if not payload:
                _dashboard_rpc_missing_until = max(_dashboard_rpc_missing_until, time.monotonic() + 300)
                payload = _cache_dashboard_payload(school_id, await _fallback_dashboard_async(school_id, started_at))
                execution_path = "fallback_after_rpc"
                _perf_log(
                    "fallback_after_rpc",
                    school_id,
                    (time.monotonic() - started_at) * 1000,
                    cache_lookup_ms=cache_lookup_ms,
                    rpc_ms=rpc_duration,
                )
            else:
                payload = _cache_dashboard_payload(school_id, payload)
                _perf_log(
                    "ok",
                    school_id,
                    (time.monotonic() - started_at) * 1000,
                    cache_lookup_ms=cache_lookup_ms,
                    rpc_ms=rpc_duration,
                )

        waiter["payload"] = payload
        finish_dashboard_request(
            trace,
            cache_status=cache_status,
            execution_path=execution_path,
            cache_lookup_ms=cache_lookup_ms,
        )
        return payload
    except Exception as exc:
        waiter["error"] = exc
        finish_dashboard_request(trace, cache_status=cache_status, execution_path=execution_path, error=str(exc)[:200])
        raise
    finally:
        waiter["event"].set()
        with _DASHBOARD_IN_FLIGHT_LOCK:
            _DASHBOARD_IN_FLIGHT.pop(school_id, None)


async def _fallback_dashboard_async(school_id: str, started_at: float) -> dict[str, Any]:
    return await asyncio.to_thread(_fallback_dashboard, school_id, started_at)


def _fallback_dashboard(school_id: str, started_at: float) -> dict[str, Any]:
    """Fallback when RPC is unavailable or returns no payload."""
    supabase = get_supabase_admin_client()
    timings: dict[str, float] = {}

    def run_step(label: str, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        step_started_at = time.monotonic()
        try:
            return fn(*args, **kwargs)
        finally:
            timings[label] = round((time.monotonic() - step_started_at) * 1000, 1)
            _perf_log(f"step.{label}", school_id, timings[label])

    def count_active_rows(table: str, schema: str | None = None) -> int:
        try:
            query = supabase.table(table) if schema is None else supabase.schema(schema).table(table)
            response = (
                query
                .select("id", count="exact")
                .eq("school_id", school_id)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            return int(getattr(response, "count", 0) or 0)
        except Exception as exc:
            if _is_optional_lookup_error(exc):
                return 0
            raise

    def fetch_all(table: str, select_cols: str, schema: str | None = None, **filters: Any) -> list[dict[str, Any]]:
        try:
            query = supabase.table(table) if schema is None else supabase.schema(schema).table(table)
            query = query.select(select_cols)
            for key, value in filters.items():
                query = query.eq(key, value)
            return list((query.execute()).data or [])
        except Exception as exc:
            if _is_optional_lookup_error(exc):
                return []
            raise

    core_counts = run_step("core_counts", get_school_core_counts_cached, school_id)
    students_count = int(core_counts.get("students_count") or 0)
    teachers_count = int(core_counts.get("teachers_count") or 0)
    rooms_summary = core_counts.get("rooms_summary") if isinstance(core_counts.get("rooms_summary"), dict) else None

    jobs: dict[str, tuple[Callable[..., Any], tuple[Any, ...], dict[str, Any]]] = {
        "batches": (fetch_all, ("batches", "id, name, class_name, section", None), {"school_id": school_id, "is_active": True}),
        "notifications": (fetch_all, ("notifications", "*", "attendance"), {"school_id": school_id, "is_active": True}),
        "holidays": (fetch_all, ("holidays", "*", "attendance"), {"school_id": school_id, "is_active": True}),
        "staff_departments": (fetch_all, ("staff_members", "department, designation", None), {"school_id": school_id, "is_active": True}),
        "hostels": (fetch_all, ("hostels", "*", "hostel"), {"school_id": school_id, "is_active": True}),
        "hostel_rooms": (fetch_all, ("hostel_rooms", "*", "hostel"), {"school_id": school_id}),
        "inventory_materials": (fetch_all, ("material_items", "*", "inventory"), {"school_id": school_id}),
        "stock_in": (fetch_all, ("stock_in_entries", "quantity_received", "inventory"), {"school_id": school_id}),
        "stock_out": (fetch_all, ("stock_out_entries", "quantity_issued", "inventory"), {"school_id": school_id}),
        "student_issue": (fetch_all, ("student_issue_entries", "quantity_issued", "inventory"), {"school_id": school_id}),
        "subjects": (fetch_all, ("subjects", "id, school_id, name, class_name, is_active, created_at, updated_at", None), {"school_id": school_id, "is_active": True}),
        "staff_count": (count_active_rows, ("staff_members",), {}),
        "timetable_count": (_get_timetable_entries_count, (school_id,), {}),
        "edupay_dashboard": (_load_edupay_dashboard_summary, (school_id,), {}),
    }
    if not rooms_summary:
        jobs["rooms_fallback"] = (fetch_all, ("rooms", "id, capacity", None), {"school_id": school_id, "is_active": True})

    results: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        future_map = {
            key: executor.submit(run_step, key, fn, *args, **kwargs)
            for key, (fn, args, kwargs) in jobs.items()
        }
        for key, future in future_map.items():
            results[key] = future.result()

    batches = results["batches"]
    notifications_raw = results["notifications"]
    holidays_raw = results["holidays"]
    staff_dept = results["staff_departments"]
    hostel_raw = results["hostels"]
    hostel_rooms_raw = results["hostel_rooms"]
    inventory_materials = results["inventory_materials"]
    stock_in = results["stock_in"]
    stock_out = results["stock_out"]
    student_issue = results["student_issue"]
    subjects_raw = results["subjects"]
    staff_count = results["staff_count"]

    if not rooms_summary:
        room_rows = results.get("rooms_fallback") or []
        rooms_summary = {
            "count": len(room_rows),
            "totalCapacity": sum(int(row.get("capacity") or 0) for row in room_rows),
        }

    hostel_active_rooms = [row for row in hostel_rooms_raw if row.get("is_active")]
    total_in = sum(int(row.get("quantity_received") or 0) for row in stock_in)
    total_out = sum(int(row.get("quantity_issued") or 0) for row in stock_out) + sum(
        int(row.get("quantity_issued") or 0) for row in student_issue
    )
    low_stock = [
        row
        for row in inventory_materials
        if bool(row.get("is_active", True)) and int(row.get("current_stock") or 0) <= int(row.get("low_stock_threshold") or 10)
    ]

    dept_options = sorted({department for item in staff_dept if (department := (item.get("department") or "").strip())})
    class_opts = sorted({row["class_name"] for row in batches if row.get("class_name")})
    section_opts = sorted({row["section"] for row in batches if row.get("section")})

    payload = {
        "students_count": students_count,
        "teachers_count": teachers_count,
        "timetable_entries_count": _to_int(results.get("timetable_count")),
        "rooms_summary": rooms_summary,
        "hostel_summary": {
            "total_hostels": len(hostel_raw),
            "total_rooms": len(hostel_active_rooms),
            "total_occupied": sum(int(row.get("occupied_beds") or 0) for row in hostel_active_rooms),
            "total_capacity": sum(int(row.get("total_beds") or 0) for row in hostel_active_rooms),
        },
        "attendance_overview": {
            "student_count": students_count,
            "staff_count": int(staff_count or 0),
            "class_options": class_opts,
            "section_options": section_opts,
            "notifications": sorted(notifications_raw, key=lambda item: item.get("created_at", ""), reverse=True)[:8],
            "holidays": sorted(holidays_raw, key=lambda item: item.get("holiday_date", "")),
            "department_options": dept_options,
        },
        "inventory_dashboard": {
            "total_materials_registered": len(inventory_materials),
            "current_stock_available": sum(int(row.get("current_stock") or 0) for row in inventory_materials),
            "low_stock_alert_count": len(low_stock),
            "total_books_in_inventory": total_in,
            "total_books_distributed": total_out,
        },
        "edupay_dashboard": results.get("edupay_dashboard") or {},
        "batch_options": [
            {"id": row["id"], "name": row["name"], "class_name": row.get("class_name"), "section": row.get("section")}
            for row in batches
        ],
        "subject_options": subjects_raw,
    }

    total_ms = round((time.monotonic() - started_at) * 1000, 1)
    _perf_log("fallback", school_id, total_ms, timings=timings)
    return payload
