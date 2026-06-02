"""Shared Supabase RPC helpers for dashboard and summary metrics."""

from __future__ import annotations

import time
from typing import Any

from app.services.supabase_admin import get_supabase_admin_client

_MISSING_RPC_TTL_SECONDS = 300
_missing_rpc_until: dict[str, float] = {}
_CORE_COUNTS_CACHE_TTL_SECONDS = 30
_core_counts_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _normalize_rpc_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            return first
    return {}


def _is_missing_rpc_error(function_name: str, exc: Exception) -> bool:
    error_text = str(exc or "")
    error_code = getattr(exc, "code", None)
    return (
        error_code == "PGRST202"
        or "PGRST202" in error_text
        or function_name in error_text
    )


def _rpc_json(function_name: str, school_id: str) -> dict[str, Any]:
    now = time.monotonic()
    if _missing_rpc_until.get(function_name, 0.0) > now:
        return {}

    try:
        response = (
            get_supabase_admin_client()
            .rpc(function_name, {"p_school_id": school_id})
            .execute()
        )
    except Exception as exc:
        if _is_missing_rpc_error(function_name, exc):
            _missing_rpc_until[function_name] = time.monotonic() + _MISSING_RPC_TTL_SECONDS
            return {}
        raise

    return _normalize_rpc_payload(getattr(response, "data", None))


def get_school_core_counts_rpc(school_id: str) -> dict[str, Any]:
    return _rpc_json("get_school_core_counts", school_id)


def get_school_core_counts_cached(school_id: str) -> dict[str, Any]:
    now = time.monotonic()
    cached = _core_counts_cache.get(school_id)
    if cached and cached[0] > now:
        return cached[1]

    payload = get_school_core_counts_rpc(school_id)
    if not payload:
        client = get_supabase_admin_client()
        students_response = (
            client.table("students")
            .select("id", count="exact")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        teachers_response = (
            client.table("staff_members")
            .select("id", count="exact")
            .eq("school_id", school_id)
            .eq("staff_type", "teaching")
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rooms_rows = list(
            (
                client.table("rooms")
                .select("id, capacity")
                .eq("school_id", school_id)
                .eq("is_active", True)
                .execute()
            ).data
            or []
        )
        payload = {
            "students_count": int(getattr(students_response, "count", 0) or 0),
            "teachers_count": int(getattr(teachers_response, "count", 0) or 0),
            "rooms_summary": {
                "count": len(rooms_rows),
                "totalCapacity": sum(int(row.get("capacity") or 0) for row in rooms_rows),
            },
        }

    _core_counts_cache[school_id] = (now + _CORE_COUNTS_CACHE_TTL_SECONDS, payload)
    return payload


def get_attendance_overview_rpc(school_id: str) -> dict[str, Any]:
    return _rpc_json("get_attendance_overview", school_id)


def get_inventory_dashboard_summary_rpc(school_id: str) -> dict[str, Any]:
    return _rpc_json("get_inventory_dashboard_summary", school_id)


def get_edupay_dashboard_summary_rpc(school_id: str) -> dict[str, Any]:
    return _rpc_json("get_edupay_dashboard_summary", school_id)


def get_dashboard_metrics_rpc(school_id: str) -> dict[str, Any]:
    return _rpc_json("get_dashboard_metrics", school_id)
