from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest

from app.middleware import tenant_context
from app.middleware.anonymous_access import is_anonymous_request, normalize_request_path
from app.middleware.auth import get_authenticated_user
from app.middleware.tenant_context import (
    TenantContext,
    TenantContextMiddleware,
    get_tenant_context,
    is_anonymous_path,
)
from app.models import User, UserRole

SCHOOL_A = "11111111-1111-1111-1111-111111111111"
SCHOOL_B = "22222222-2222-2222-2222-222222222222"
PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _user(*, role_key: str = "school_admin", school_id: str = SCHOOL_A):
    return SimpleNamespace(
        id=1,
        role=UserRole.ADMIN,
        role_key=role_key,
        permissions=[],
        user_type="staff",
        school_id=school_id,
        email="admin@example.com",
        username="admin",
    )


def _actor(*, role_key: str = "school_admin", school_id: str = SCHOOL_A) -> dict:
    return {
        "role": role_key,
        "role_key": role_key,
        "profile_id": PROFILE_ID,
        "school_id": school_id,
        "user_id": "1",
        "auth_source": "jwt",
    }


def _resolver_stub(actor: dict, explicit_school_id) -> str:
    school_id = actor.get("school_id") or explicit_school_id
    if not school_id:
        raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")
    return school_id


def _patch_resolver(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_context,
        "resolve_school_id_from_actor",
        lambda request, explicit_school_id, actor: _resolver_stub(actor, explicit_school_id),
    )


def _tenant_app() -> FastAPI:
    app = FastAPI()

    @app.get("/tenant-test")
    async def tenant_route(ctx: TenantContext = Depends(get_tenant_context)):
        return {
            "school_id": ctx.school_id,
            "role": ctx.role,
            "profile_id": ctx.profile_id,
            "source": ctx.source,
        }

    return app


def _override_auth(app: FastAPI, actor: dict) -> None:
    def _fake_user(request: Request):
        request.state.resolved_auth_principal = {"user": _user(), "actor": actor}
        return _user()

    app.dependency_overrides[get_authenticated_user] = _fake_user


# --- get_tenant_context dependency ---


def test_tenant_context_route_resolves_validated_school_id(monkeypatch):
    app = _tenant_app()
    _override_auth(app, _actor(school_id=SCHOOL_A))
    _patch_resolver(monkeypatch)

    client = TestClient(app)
    response = client.get("/tenant-test")
    assert response.status_code == 200
    body = response.json()
    assert body["school_id"] == SCHOOL_A
    assert body["role"] == "school_admin"
    assert body["profile_id"] == PROFILE_ID
    assert body["source"].startswith("tenant_context")


def test_tenant_context_platform_admin_explicit_school(monkeypatch):
    app = _tenant_app()
    _override_auth(app, _actor(role_key="platform_admin", school_id=""))
    _patch_resolver(monkeypatch)

    client = TestClient(app)
    response = client.get("/tenant-test", params={"school_id": SCHOOL_B})
    assert response.status_code == 200
    assert response.json()["school_id"] == SCHOOL_B


def test_tenant_context_missing_school_rejected(monkeypatch):
    app = _tenant_app()
    _override_auth(app, _actor(school_id=""))
    _patch_resolver(monkeypatch)

    client = TestClient(app)
    response = client.get("/tenant-test")
    assert response.status_code == 403
    assert "school_id" in response.json()["detail"].lower()


def test_tenant_context_options_returns_empty_context():
    scope = {
        "type": "http",
        "method": "OPTIONS",
        "path": "/tenant-test",
        "raw_path": b"/tenant-test",
        "headers": [],
        "query_string": b"",
        "scheme": "http",
        "server": ("test", 80),
        "client": ("test", 123),
        "state": {},
        "app": None,
        "root_path": "",
    }
    request = StarletteRequest(scope)
    ctx = asyncio.run(get_tenant_context(request=request, user=None))
    assert isinstance(ctx, TenantContext)
    assert ctx.school_id == ""


def test_tenant_context_anonymous_request_returns_401_unaffected():
    app = _tenant_app()
    app.add_middleware(TenantContextMiddleware, enabled=True)
    client = TestClient(app)
    response = client.get("/tenant-test")
    assert response.status_code == 401


# --- TenantContextMiddleware ---


def _middleware_app(enabled: bool = True) -> FastAPI:
    app = FastAPI()
    app.add_middleware(TenantContextMiddleware, enabled=enabled)

    @app.get("/secure")
    async def secure_route(request: Request):
        ctx = getattr(request.state, "tenant_context", None)
        return {"school_id": ctx.school_id if isinstance(ctx, TenantContext) else None}

    return app


def test_middleware_allowlist_skips_anonymous_paths(monkeypatch):
    app = FastAPI()
    app.add_middleware(TenantContextMiddleware, enabled=True)

    @app.get("/readyz")
    async def readyz():
        return {"status": "ready"}

    called: list[str] = []
    monkeypatch.setattr(
        tenant_context,
        "_resolve_actor_from_request",
        lambda request: called.append(request.url.path) or {},
    )
    client = TestClient(app)
    response = client.get("/readyz")
    assert response.status_code == 200
    assert called == []


def test_middleware_enriches_tenant_context(monkeypatch):
    app = _middleware_app(enabled=True)
    monkeypatch.setattr(
        tenant_context,
        "_resolve_actor_from_request",
        lambda request: _actor(role_key="teacher", school_id=SCHOOL_A),
    )
    _patch_resolver(monkeypatch)
    client = TestClient(app)
    response = client.get("/secure")
    assert response.status_code == 200
    assert response.json()["school_id"] == SCHOOL_A


def test_middleware_disabled_is_noop(monkeypatch):
    app = _middleware_app(enabled=False)
    monkeypatch.setattr(
        tenant_context,
        "_resolve_actor_from_request",
        lambda request: _actor(school_id=SCHOOL_A),
    )
    _patch_resolver(monkeypatch)
    client = TestClient(app)
    response = client.get("/secure")
    assert response.status_code == 200
    assert response.json()["school_id"] is None


def test_middleware_never_rejects_anonymous_flows(monkeypatch):
    app = _middleware_app(enabled=True)
    monkeypatch.setattr(tenant_context, "_resolve_actor_from_request", lambda request: {})
    resolver_calls: list[str] = []
    monkeypatch.setattr(
        tenant_context,
        "resolve_school_id_from_actor",
        lambda request, explicit_school_id, actor: resolver_calls.append("resolver") or "",
    )
    client = TestClient(app)
    response = client.get("/secure")
    assert response.status_code == 200
    assert response.json()["school_id"] is None
    assert resolver_calls == []


# --- anonymous allow-list ---


def test_is_anonymous_path_covers_allowlist():
    assert is_anonymous_path("/readyz")
    assert is_anonymous_path("/health")
    assert is_anonymous_path("/docs")
    assert is_anonymous_path("/redoc")
    assert is_anonymous_path("/openapi.json")
    assert is_anonymous_path("/api/auth/login-password")
    assert is_anonymous_path("/api/auth/refresh")
    assert is_anonymous_path("/api/account-security/resolve-login")
    assert is_anonymous_path("/api/school-self-service/public-branding")
    assert not is_anonymous_path("/api/online-tests")
    assert not is_anonymous_path("/api/exams/some-id")
    assert not is_anonymous_path("/api/platform/schools")


def test_anonymous_request_normalizes_duplicate_slashes_and_trailing_slashes():
    assert normalize_request_path("//api//auth//login-password//") == "/api/auth/login-password"
    assert is_anonymous_request("GET", "//api//auth//login-password//")
    assert is_anonymous_request("GET", "/health/")


def test_anonymous_request_normalizes_traversal_without_bypass():
    assert normalize_request_path("/api/auth/../students") == "/api/students"
    assert not is_anonymous_request("GET", "/api/auth/../students")
    assert not is_anonymous_request("GET", "/api/auth/../../api/students")


def test_options_requests_are_always_anonymous():
    assert is_anonymous_request("OPTIONS", "/api/students")
