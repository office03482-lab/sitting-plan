"""Combined dashboard endpoint — returns all metrics in ONE database call."""

import logging
import time
from fastapi import APIRouter, Depends
from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_metrics import get_dashboard_metrics_rpc

logger = logging.getLogger(__name__)

router = APIRouter()

# Cache: school_id -> {payload, expires_at}
_dashboard_cache: dict[str, dict] = {}
_DASHBOARD_CACHE_TTL = 30  # seconds
_dashboard_rpc_missing_until = 0.0


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


@router.get("/dashboard/metrics")
def get_dashboard_metrics(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    global _dashboard_rpc_missing_until
    started_at = time.monotonic()

    # Check cache
    cached = _dashboard_cache.get(school_id)
    if cached and cached["expires_at"] > time.monotonic():
        _perf_log("cache_hit", school_id, (time.monotonic() - started_at) * 1000)
        return cached["payload"]

    def cache_payload(payload: dict) -> dict:
        _dashboard_cache[school_id] = {
            "payload": payload,
            "expires_at": time.monotonic() + _DASHBOARD_CACHE_TTL,
        }
        return payload

    should_try_rpc = time.monotonic() >= _dashboard_rpc_missing_until

    if not should_try_rpc:
        _perf_log("rpc_skipped_missing", school_id, (time.monotonic() - started_at) * 1000)
        return cache_payload(_fallback_dashboard(school_id, started_at))

    rpc_started_at = time.monotonic()
    try:
        payload = get_dashboard_metrics_rpc(school_id)
        rpc_duration = (time.monotonic() - rpc_started_at) * 1000
    except Exception as exc:
        rpc_duration = (time.monotonic() - rpc_started_at) * 1000
        if _is_missing_dashboard_rpc_error(exc):
            _dashboard_rpc_missing_until = time.monotonic() + 300
        _perf_log("rpc_error", school_id, rpc_duration, error=str(exc)[:200])
        return cache_payload(_fallback_dashboard(school_id, started_at))

    if not payload:
        return cache_payload(_fallback_dashboard(school_id, started_at))

    # Cache the payload
    cache_payload(payload)

    total_ms = (time.monotonic() - started_at) * 1000
    _perf_log("ok", school_id, total_ms, rpc_ms=round(rpc_duration, 1))

    return payload


def _fallback_dashboard(school_id: str, started_at: float) -> dict:
    """Fallback when RPC does not exist (migration not yet applied)."""
    supabase = get_supabase_admin_client()

    def count_active_rows(table: str, schema: str | None = None) -> int:
        q = supabase.table(table) if schema is None else supabase.schema(schema).table(table)
        resp = q.select("id", count="exact").eq("school_id", school_id).eq("is_active", True).limit(1).execute()
        return int(getattr(resp, "count", 0) or 0)

    def fetch_all(table: str, select_cols: str, schema: str | None = None, **filters) -> list[dict]:
        q = supabase.table(table) if schema is None else supabase.schema(schema).table(table)
        q = q.select(select_cols)
        for k, v in filters.items():
            q = q.eq(k, v)
        return list((q.execute()).data or [])

    students_count = count_active_rows("students")
    teachers_count = supabase.table("staff_members").select("id", count="exact")\
        .eq("staff_type", "teaching").eq("school_id", school_id).eq("is_active", True).limit(1).execute()
    teachers_count = int(getattr(teachers_count, "count", 0) or 0)

    rooms = fetch_all("rooms", "id, capacity", school_id=school_id, is_active=True)
    rooms_summary = {"count": len(rooms), "totalCapacity": sum(int(r.get("capacity") or 0) for r in rooms)}

    batches = fetch_all("batches", "id, name, class_name, section", school_id=school_id, is_active=True)
    notifications_raw = fetch_all("notifications", "*", schema="attendance", school_id=school_id, is_active=True)
    holidays_raw = fetch_all("holidays", "*", schema="attendance", school_id=school_id, is_active=True)
    staff_dept = fetch_all("staff_members", "department, designation", school_id=school_id, is_active=True)

    hostel_raw = fetch_all("hostels", "*", schema="hostel", school_id=school_id, is_active=True)
    hostel_rooms_raw = fetch_all("hostel_rooms", "*", schema="hostel", school_id=school_id)
    hostel_active_rooms = [r for r in hostel_rooms_raw if r.get("is_active")]
    inventory_materials = fetch_all("material_items", "*", schema="inventory", school_id=school_id)
    stock_in = fetch_all("stock_in_entries", "quantity_received", schema="inventory", school_id=school_id)
    stock_out = fetch_all("stock_out_entries", "quantity_issued", schema="inventory", school_id=school_id)
    student_issue = fetch_all("student_issue_entries", "quantity_issued", schema="inventory", school_id=school_id)
    subjects_raw = fetch_all("subjects", "id, school_id, name, class_name, is_active, created_at, updated_at",
                             school_id=school_id, is_active=True)

    total_in = sum(int(r.get("quantity_received") or 0) for r in stock_in)
    total_out = sum(int(r.get("quantity_issued") or 0) for r in stock_out) + sum(int(r.get("quantity_issued") or 0) for r in student_issue)
    low_stock = [m for m in inventory_materials if bool(m.get("is_active", True)) and int(m.get("current_stock") or 0) <= int(m.get("low_stock_threshold") or 10)]

    dept_options = sorted({d for item in staff_dept if (d := (item.get("department") or "").strip())})
    class_opts = sorted({b["class_name"] for b in batches if b.get("class_name")})
    section_opts = sorted({b["section"] for b in batches if b.get("section")})

    payload = {
        "students_count": students_count,
        "teachers_count": teachers_count,
        "rooms_summary": rooms_summary,
        "hostel_summary": {
            "total_hostels": len(hostel_raw),
            "total_rooms": len(hostel_active_rooms),
            "total_occupied": sum(int(r.get("occupied_beds") or 0) for r in hostel_active_rooms),
            "total_capacity": sum(int(r.get("total_beds") or 0) for r in hostel_active_rooms),
        },
        "attendance_overview": {
            "student_count": students_count,
            "staff_count": count_active_rows("staff_members"),
            "class_options": class_opts,
            "section_options": section_opts,
            "notifications": sorted(notifications_raw, key=lambda n: n.get("created_at", ""), reverse=True)[:8],
            "holidays": sorted(holidays_raw, key=lambda h: h.get("holiday_date", "")),
            "department_options": dept_options,
        },
        "inventory_dashboard": {
            "total_materials_registered": len(inventory_materials),
            "current_stock_available": sum(int(m.get("current_stock") or 0) for m in inventory_materials),
            "low_stock_alert_count": len(low_stock),
            "total_books_in_inventory": total_in,
            "total_books_distributed": total_out,
        },
        "batch_options": [{"id": b["id"], "name": b["name"], "class_name": b.get("class_name"), "section": b.get("section")} for b in batches],
        "subject_options": subjects_raw,
    }

    total_ms = (time.monotonic() - started_at) * 1000
    _perf_log("fallback", school_id, total_ms)
    return payload
