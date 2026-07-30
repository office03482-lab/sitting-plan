from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

_TRACE_LOCK = Lock()
_REQUEST_SEQUENCE = 0
_ACTIVE_DASHBOARD_REQUESTS = 0
_ACTIVE_BY_ENDPOINT: dict[str, int] = {}


def begin_dashboard_request(endpoint: str, school_id: str) -> dict[str, Any]:
    global _REQUEST_SEQUENCE, _ACTIVE_DASHBOARD_REQUESTS
    with _TRACE_LOCK:
        _REQUEST_SEQUENCE += 1
        _ACTIVE_DASHBOARD_REQUESTS += 1
        _ACTIVE_BY_ENDPOINT[endpoint] = _ACTIVE_BY_ENDPOINT.get(endpoint, 0) + 1
        request_id = f"{endpoint}-{_REQUEST_SEQUENCE:06d}"
        concurrent_total = _ACTIVE_DASHBOARD_REQUESTS
        concurrent_endpoint = _ACTIVE_BY_ENDPOINT[endpoint]

    trace = {
        "request_id": request_id,
        "endpoint": endpoint,
        "school_id": school_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "started_monotonic": time.monotonic(),
        "concurrent_total": concurrent_total,
        "concurrent_endpoint": concurrent_endpoint,
    }
    logger.info(
        "dashboard.request.start",
        extra={
            "request_id": request_id,
            "endpoint": endpoint,
            "school_id": school_id,
            "started_at": trace["started_at"],
            "concurrent_request_count": concurrent_total,
            "endpoint_concurrent_request_count": concurrent_endpoint,
        },
    )
    return trace


def finish_dashboard_request(trace: dict[str, Any], **extra: Any) -> None:
    endpoint = str(trace.get("endpoint") or "unknown")
    global _ACTIVE_DASHBOARD_REQUESTS
    duration_ms = round((time.monotonic() - float(trace.get("started_monotonic") or time.monotonic())) * 1000, 1)
    with _TRACE_LOCK:
        _ACTIVE_DASHBOARD_REQUESTS = max(0, _ACTIVE_DASHBOARD_REQUESTS - 1)
        current_endpoint_count = max(0, _ACTIVE_BY_ENDPOINT.get(endpoint, 1) - 1)
        if current_endpoint_count:
            _ACTIVE_BY_ENDPOINT[endpoint] = current_endpoint_count
        else:
            _ACTIVE_BY_ENDPOINT.pop(endpoint, None)
        concurrent_remaining = _ACTIVE_DASHBOARD_REQUESTS

    logger.info(
        "dashboard.request.finish",
        extra={
            "request_id": trace.get("request_id"),
            "endpoint": endpoint,
            "school_id": trace.get("school_id"),
            "started_at": trace.get("started_at"),
            "duration_ms": duration_ms,
            "concurrent_request_count_at_start": trace.get("concurrent_total"),
            "endpoint_concurrent_request_count_at_start": trace.get("concurrent_endpoint"),
            "concurrent_request_count_remaining": concurrent_remaining,
            **extra,
        },
    )
