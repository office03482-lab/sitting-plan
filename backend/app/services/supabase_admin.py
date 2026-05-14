"""Minimal Supabase admin helpers for backend-side persistence tasks."""

from __future__ import annotations

import os
from typing import Any, Dict, List

from supabase import Client, create_client


def get_supabase_admin_client() -> Client:
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip()
    service_role_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    if not url:
        raise RuntimeError("SUPABASE_URL is required for Supabase persistence.")
    if not service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for Supabase persistence.")

    return create_client(url, service_role_key)


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
