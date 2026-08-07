from __future__ import annotations

from types import SimpleNamespace

from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from app.main import app
from app.middleware import tenant_context
from app.middleware.anonymous_access import (
    ANONYMOUS_EXACT_PATHS,
    ANONYMOUS_PATH_PREFIXES,
    is_anonymous_request,
    normalize_request_path,
)
from app.middleware.auth import get_authenticated_user
from app.middleware.tenant_context import TenantContext, TenantContextMiddleware, get_tenant_context
from app.models import UserRole

SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def test_anonymous_allowlist_inventory_is_explicit():
    expected_exact = {
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
    assert ANONYMOUS_EXACT_PATHS == expected_exact
    assert ANONYMOUS_PATH_PREFIXES == ("/static/",)


def test_public_endpoints_allow_anonymous_access():
    client = TestClient(app)
    try:
        health = client.get("/health")
        assert health.status_code == 200

        readyz = client.get("/readyz")
        assert readyz.status_code == 200

        logout = client.post("/api/auth/logout")
        assert logout.status_code == 200

        preflight = client.options(
            "/api/students",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert preflight.status_code in {200, 204}
    finally:
        client.close()


def test_protected_endpoints_reject_anonymous_access():
    protected_requests = [
        ("GET", "/api/students"),
        ("GET", "/api/teachers"),
        ("GET", "/api/attendance/overview"),
        ("GET", "/api/reports/pdf/test-plan"),
        ("GET", "/api/online-tests/tests"),
        ("GET", "/api/offline-exams"),
        ("GET", "/api/question-bank/questions"),
        ("GET", "/api/inventory/dashboard"),
        ("POST", "/api/teacher-ai/question-paper"),
    ]

    client = TestClient(app)
    try:
        for method, path in protected_requests:
            response = client.request(method, path)
            assert response.status_code == 401, (method, path, response.status_code, response.text)
            assert "authorization" in response.json()["detail"].lower()
    finally:
        client.close()


def test_path_normalization_does_not_mark_malformed_protected_paths_as_anonymous():
    malformed_paths = [
        "/api//students",
        "/api/students/",
        "/api/auth/../students",
        "/api/auth/../../api/students",
        "/api/authentication/login-password",
    ]
    for path in malformed_paths:
        assert not is_anonymous_request("GET", path), path


def test_path_normalization_keeps_intended_public_routes_public():
    assert normalize_request_path("//api//auth//login-password//") == "/api/auth/login-password"
    assert normalize_request_path("/api/school-self-service/./public-branding/") == "/api/school-self-service/public-branding"
    assert is_anonymous_request("GET", "//api//auth//login-password//")
    assert is_anonymous_request("GET", "/api/school-self-service/./public-branding/")


def _authenticated_tenant_app() -> FastAPI:
    tenant_app = FastAPI()
    tenant_app.add_middleware(TenantContextMiddleware, enabled=True)

    @tenant_app.get("/secure")
    async def secure(request: Request, ctx: TenantContext = Depends(get_tenant_context)):
        state_ctx = getattr(request.state, "tenant_context", None)
        return {
            "school_id": ctx.school_id,
            "role": ctx.role,
            "profile_id": ctx.profile_id,
            "state_school_id": state_ctx.school_id if isinstance(state_ctx, TenantContext) else None,
        }

    return tenant_app


def test_authenticated_requests_continue_to_resolve_tenant_context(monkeypatch):
    tenant_app = _authenticated_tenant_app()

    def fake_user(request: Request):
        request.state.resolved_auth_principal = {
            "user": SimpleNamespace(
                id=1,
                role=UserRole.ADMIN,
                role_key="school_admin",
                permissions=[],
                user_type="staff",
                school_id=SCHOOL_ID,
                email="admin@example.com",
                username="admin",
            ),
            "actor": {
                "role": "school_admin",
                "role_key": "school_admin",
                "profile_id": PROFILE_ID,
                "school_id": SCHOOL_ID,
                "user_id": "1",
                "auth_source": "jwt",
            },
        }
        return request.state.resolved_auth_principal["user"]

    monkeypatch.setattr(
        tenant_context,
        "resolve_school_id_from_actor",
        lambda request, explicit_school_id, actor: actor.get("school_id") or explicit_school_id,
    )
    tenant_app.dependency_overrides[get_authenticated_user] = fake_user

    client = TestClient(tenant_app)
    try:
        response = client.get("/secure")
        assert response.status_code == 200
        body = response.json()
        assert body["school_id"] == SCHOOL_ID
        assert body["state_school_id"] == SCHOOL_ID
        assert body["role"] == "school_admin"
        assert body["profile_id"] == PROFILE_ID
    finally:
        client.close()
        tenant_app.dependency_overrides.clear()


def test_anonymous_requests_never_receive_tenant_context():
    tenant_app = FastAPI()
    tenant_app.add_middleware(TenantContextMiddleware, enabled=True)

    @tenant_app.get("/health")
    async def health(request: Request):
        return {"has_tenant": hasattr(request.state, "tenant_context")}

    client = TestClient(tenant_app)
    try:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"has_tenant": False}
    finally:
        client.close()
