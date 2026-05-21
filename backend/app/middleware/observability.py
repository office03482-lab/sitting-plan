from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from threading import Lock
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.config import settings

logger = logging.getLogger(__name__)


class SystemObservabilityEngine(BaseHTTPMiddleware):
    """Track in-flight requests and emit structured slow-request diagnostics."""

    def __init__(
        self,
        app,
        *,
        slow_request_threshold_ms: int = 1500,
        token_header_name: str = "X-Observability-Token",
    ) -> None:
        super().__init__(app)
        self.slow_request_threshold_ms = slow_request_threshold_ms
        self.token_header_name = token_header_name
        self._lock = Lock()
        self._inflight_requests = 0
        self._total_requests = 0
        self._slow_requests = 0
        self._last_duration_ms = 0

        self._metrics_token = os.getenv("OBSERVABILITY_METRICS_TOKEN", "").strip()
        hmac_secret = os.getenv("OBSERVABILITY_HMAC_SECRET", "").strip() or (settings.jwt_secret or "observability-secret")
        self._hmac_secret = hmac_secret.encode("utf-8")
        self._expected_digest = self._hash_token(self._metrics_token) if self._metrics_token else None

    def _hash_token(self, token: str) -> str:
        return hmac.new(self._hmac_secret, token.encode("utf-8"), hashlib.sha256).hexdigest()

    def _is_authorized(self, request: Request) -> bool:
        if not self._expected_digest:
            return False
        candidate = request.headers.get(self.token_header_name, "").strip()
        if not candidate:
            return False
        return hmac.compare_digest(self._hash_token(candidate), self._expected_digest)

    def _snapshot_metrics(self) -> dict[str, Any]:
        with self._lock:
            return {
                "inflight_requests": self._inflight_requests,
                "total_requests": self._total_requests,
                "slow_requests": self._slow_requests,
                "last_duration_ms": self._last_duration_ms,
            }

    async def dispatch(self, request: Request, call_next) -> Response:
        started_at = time.perf_counter()
        authorized_metrics = self._is_authorized(request)

        with self._lock:
            self._inflight_requests += 1
            self._total_requests += 1
            inflight_snapshot = self._inflight_requests

        request.state.observability = {
            "started_at": started_at,
            "inflight_requests": inflight_snapshot,
            "authorized_metrics": authorized_metrics,
        }

        if request.url.path == "/internal/observability" and not authorized_metrics:
            with self._lock:
                self._inflight_requests = max(self._inflight_requests - 1, 0)
            return JSONResponse(status_code=403, content={"detail": "Observability token invalid."})

        try:
            response = await call_next(request)
        finally:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            with self._lock:
                self._inflight_requests = max(self._inflight_requests - 1, 0)
                self._last_duration_ms = duration_ms
                current_inflight = self._inflight_requests
                if duration_ms >= self.slow_request_threshold_ms:
                    self._slow_requests += 1

            if duration_ms >= self.slow_request_threshold_ms:
                logger.warning(
                    "observability.slow_request",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "query": request.url.query,
                        "duration_ms": duration_ms,
                        "inflight_requests": current_inflight,
                        "client_host": request.client.host if request.client else None,
                    },
                )
            else:
                logger.info(
                    "observability.request_complete",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "duration_ms": duration_ms,
                        "inflight_requests": current_inflight,
                    },
                )

        if authorized_metrics:
            metrics = self._snapshot_metrics()
            response.headers["X-Observability-InFlight"] = str(metrics["inflight_requests"])
            response.headers["X-Observability-Total"] = str(metrics["total_requests"])
            response.headers["X-Observability-Slow"] = str(metrics["slow_requests"])
            response.headers["X-Observability-LastMs"] = str(metrics["last_duration_ms"])

        return response
