"""Lightweight per-request phase profiler.

Logs a timing breakdown for every request that exceeds
``slow_threshold_ms``.  Plug it in right after the
SystemObservabilityEngine middleware.

Usage in main.py:
    from app.middleware.request_profiler import RequestProfilerMiddleware
    app.add_middleware(RequestProfilerMiddleware, slow_threshold_ms=800)
"""
from __future__ import annotations

import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("request_profiler")


class RequestProfilerMiddleware(BaseHTTPMiddleware):
    """Attach a ``_profiler`` stopwatch to each request.

    Route handlers / dependencies call ``request.state.profiler.hit(name)``
    to record phase timestamps.  At the end of the request the middleware
    serialises the timeline and emits a WARNING for slow requests.
    """

    def __init__(self, app, *, slow_threshold_ms: int = 800) -> None:
        super().__init__(app)
        self.slow_threshold_ms = slow_threshold_ms

    async def dispatch(self, request: Request, call_next) -> Response:
        prof = _Profiler()
        request.state.profiler = prof
        prof.hit("request_start")
        try:
            response = await call_next(request)
        except Exception:
            prof.hit("request_error")
            raise
        else:
            prof.hit("response_sent")
            prof.set_status(getattr(response, "status_code", 0))
        finally:
            duration_ms = prof.total_ms()
            if duration_ms >= self.slow_threshold_ms:
                logger.warning(
                    "SLOW_REQUEST [%dms] %s %s phases=%s",
                    int(duration_ms),
                    request.method,
                    request.url.path,
                    prof.summary(),
                )
        return response


class _Profiler:
    """Lightweight in-request stopwatch."""

    __slots__ = ("_marks", "_status")

    def __init__(self) -> None:
        self._marks: list[tuple[str, float]] = [("init", time.perf_counter())]
        self._status: int = 0

    # -- public API --

    def hit(self, name: str) -> None:
        self._marks.append((name, time.perf_counter()))

    def set_status(self, code: int) -> None:
        self._status = code

    def total_ms(self) -> float:
        if len(self._marks) < 2:
            return 0.0
        return (self._marks[-1][1] - self._marks[0][1]) * 1000

    def summary(self) -> str:
        parts: list[str] = []
        for i in range(1, len(self._marks)):
            name, ts = self._marks[i]
            prev_name, prev_ts = self._marks[i - 1]
            delta_ms = (ts - prev_ts) * 1000
            parts.append(f"{name}={delta_ms:.0f}ms")
        return " ".join(parts)

    def to_dict(self) -> dict:
        phases: dict[str, float] = {}
        for i in range(1, len(self._marks)):
            name, ts = self._marks[i]
            prev_name, prev_ts = self._marks[i - 1]
            phases[f"{prev_name}->{name}"] = round((ts - prev_ts) * 1000, 2)
        return {"status": self._status, "total_ms": round(self.total_ms(), 2), "phases": phases}
