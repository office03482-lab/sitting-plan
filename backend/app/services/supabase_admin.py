"""Minimal Supabase admin helpers for backend-side persistence tasks."""

from __future__ import annotations

import os
import threading
import time
from functools import lru_cache
from typing import Any, Dict, List

import httpx
from postgrest._sync.client import SyncPostgrestClient
from supabase import Client, create_client
from app.config import BASE_DIR, settings

_SUPABASE_RETRYABLE_METHODS = {"GET", "HEAD", "OPTIONS", "DELETE", "PUT"}
_SUPABASE_TRANSPORT_RETRIES = 3
_SUPABASE_RETRY_BACKOFF_SECONDS = 0.35
_SUPABASE_REQUEST_TIMEOUT = httpx.Timeout(
    connect=10.0,
    read=30.0,
    write=30.0,
    pool=10.0,
)


class _RetryableSupabaseClient(httpx.Client):
    def __init__(self, retries: int = _SUPABASE_TRANSPORT_RETRIES, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._supabase_retries = retries

    def send(self, request: httpx.Request, *args, **kwargs) -> httpx.Response:
        idempotent = request.method.upper() in _SUPABASE_RETRYABLE_METHODS
        last_exc = None
        for attempt in range(self._supabase_retries + 1):
            try:
                return super().send(request, *args, **kwargs)
            except httpx.TransportError as exc:
                last_exc = exc
                if not idempotent or attempt >= self._supabase_retries:
                    raise
                time.sleep(_SUPABASE_RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise last_exc


def _inject_supabase_transport_retries() -> None:
    original_init = SyncPostgrestClient.__init__

    def _init_with_retries(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        session = getattr(self, "session", None)
        if session is None or isinstance(session, _RetryableSupabaseClient):
            return
        self.session = _RetryableSupabaseClient(
            base_url=session.base_url,
            headers=session.headers,
            timeout=_SUPABASE_REQUEST_TIMEOUT,
            follow_redirects=True,
            transport=getattr(session, "_transport", None),
        )

    SyncPostgrestClient.__init__ = _init_with_retries


_inject_supabase_transport_retries()

_SUPABASE_SCHEMA_CLIENT_CACHE: dict[tuple[str, str, tuple], SyncPostgrestClient] = {}
_SUPABASE_SCHEMA_CLIENT_CACHE_LOCK = threading.Lock()


def _inject_schema_client_reuse() -> None:
    """Cache per-schema PostgREST clients.

    ``SyncPostgrestClient.schema()`` builds a brand-new httpx session every
    call, so each non-public-schema query pays a fresh TCP/TLS handshake
    (~1-4s against Cloudflare-fronted Supabase). Reusing one client per
    (base_url, schema, headers) lets connection pooling kick in and drops the
    per-query cost to ~0.2s. This is the dominant latency source for the
    parent portal (which hits academic/attendance/exam schemas heavily).
    """
    original_schema = SyncPostgrestClient.schema

    def _schema_cached(self, schema: str) -> SyncPostgrestClient:
        headers_tuple = tuple(sorted((str(k), str(v)) for k, v in dict(self.headers).items()))
        key = (str(self.base_url), schema, headers_tuple)
        with _SUPABASE_SCHEMA_CLIENT_CACHE_LOCK:
            cached = _SUPABASE_SCHEMA_CLIENT_CACHE.get(key)
            if cached is None:
                cached = original_schema(self, schema)
                _SUPABASE_SCHEMA_CLIENT_CACHE[key] = cached
            return cached

    SyncPostgrestClient.schema = _schema_cached


_inject_schema_client_reuse()


def _read_env_file_value(key: str) -> str:
    candidate_files = [
        BASE_DIR / ".env",
        BASE_DIR.parent / "frontend" / ".env",
    ]

    for env_file in candidate_files:
        try:
            if not env_file.exists():
                continue
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                current_key, value = line.split("=", 1)
                if current_key.strip() != key:
                    continue
                return value.strip().strip('"').strip("'")
        except OSError:
            continue

    return ""


@lru_cache(maxsize=1)
def _build_supabase_admin_client(url: str, service_role_key: str) -> Client:
    return create_client(url, service_role_key)


def _invalidate_admin_client_cache() -> None:
    """Clear the cached Supabase admin client so the next call creates a fresh one."""
    _build_supabase_admin_client.cache_clear()


def _resolve_supabase_admin_config() -> tuple[str, str]:
    url = (
        os.getenv("SUPABASE_URL")
        or os.getenv("VITE_SUPABASE_URL")
        or settings.supabase_url
        or _read_env_file_value("SUPABASE_URL")
        or _read_env_file_value("VITE_SUPABASE_URL")
        or ""
    ).strip()
    service_role_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or settings.supabase_service_role_key
        or _read_env_file_value("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()

    if not url:
        raise RuntimeError("SUPABASE_URL is required for Supabase persistence.")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for Supabase persistence.")

    return url, service_role_key


def create_supabase_admin_client() -> Client:
    url, service_role_key = _resolve_supabase_admin_config()
    return create_client(url, service_role_key)


def get_supabase_admin_client() -> Client:
    url, service_role_key = _resolve_supabase_admin_config()
    return _build_supabase_admin_client(url, service_role_key)


def fetch_all(
    client: Client,
    table: str,
    *,
    select: str = "*",
    filters: Dict[str, Any] | None = None,
    schema: str | None = None,
) -> List[Dict[str, Any]]:
    query = client.schema(schema).table(table).select(select) if schema else client.table(table).select(select)
    if filters:
        for key, value in filters.items():
            query = query.eq(key, value)
    response = query.execute()
    return list(response.data or [])


def insert_rows(
    client: Client,
    table: str,
    rows: List[Dict[str, Any]],
    *,
    schema: str | None = None,
) -> None:
    if not rows:
        return
    query = client.schema(schema).table(table) if schema else client.table(table)
    query.insert(rows).execute()


def upsert_rows(
    client: Client,
    table: str,
    rows: List[Dict[str, Any]],
    *,
    on_conflict: str,
    schema: str | None = None,
) -> None:
    if not rows:
        return
    query = client.schema(schema).table(table) if schema else client.table(table)
    query.upsert(rows, on_conflict=on_conflict).execute()
