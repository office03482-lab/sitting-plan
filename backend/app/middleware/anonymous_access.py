"""Centralized anonymous request allow-list and path normalization."""

from __future__ import annotations

from typing import Final

# Exact public routes. Keep this list explicit and intentionally small.
ANONYMOUS_EXACT_PATHS: Final[frozenset[str]] = frozenset(
    {
        "/",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/health",
        "/readyz",
        "/internal/observability",
        "/api/account-security/resolve-login",
        "/api/school-self-service/public-branding",
        "/api/billing/webhooks/razorpay",
        "/api/ai/health",
        "/api/ai/test",
        "/api/auth/send-otp",
        "/api/auth/verify-otp",
        "/api/auth/login-password",
        "/api/auth/refresh",
        "/api/auth/logout",
    }
)

# Prefixes are reserved for assets or similarly bounded public trees.
ANONYMOUS_PATH_PREFIXES: Final[tuple[str, ...]] = (
    "/static/",
)


def normalize_request_path(path: str | None) -> str:
    """Normalize request paths before public-route matching.

    This collapses duplicate separators, removes ``.`` segments, applies
    traversal semantics for ``..`` segments, and strips trailing slashes except
    for the root path.
    """
    raw_path = str(path or "").strip()
    if not raw_path:
        return "/"

    path_only = raw_path.split("?", 1)[0].split("#", 1)[0].replace("\\", "/")
    if not path_only.startswith("/"):
        path_only = f"/{path_only}"

    parts: list[str] = []
    for part in path_only.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)

    normalized = "/" + "/".join(parts)
    return normalized if normalized != "" else "/"


def is_anonymous_request(method: str | None, path: str | None) -> bool:
    """Return ``True`` when a request is intentionally public."""
    if str(method or "").upper() == "OPTIONS":
        return True

    normalized_path = normalize_request_path(path)
    if normalized_path in ANONYMOUS_EXACT_PATHS:
        return True
    return any(normalized_path.startswith(prefix) for prefix in ANONYMOUS_PATH_PREFIXES)


def is_anonymous_path(path: str | None) -> bool:
    """Backward-compatible path-only helper for existing callers/tests."""
    return is_anonymous_request("GET", path)
