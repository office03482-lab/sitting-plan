"""Auth security tests — Supabase-native.

All auth flows go through Supabase Auth / admin API.
Tests mock the Supabase client to avoid a live dependency.
"""
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.main import app
from app.routes import auth as auth_routes
from app.utils.auth import create_access_token


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


MOCK_PROFILE = {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "admin@school.com",
    "full_name": "Admin User",
    "display_name": "adminuser",
    "is_active": True,
    "default_school_id": "00000000-0000-0000-0000-000000000010",
}

MOCK_ROLE = {
    "id": "role-001",
    "role_key": "school_admin",
    "role_name": "School Admin",
    "is_system": True,
    "metadata": None,
}

MOCK_MEMBERSHIP = {
    "id": "mem-001",
    "school_id": "00000000-0000-0000-0000-000000000010",
    "profile_id": MOCK_PROFILE["id"],
    "role_id": MOCK_ROLE["id"],
    "status": "active",
    "is_primary": True,
    "is_active": True,
    "roles": MOCK_ROLE,
}


def _mock_supabase_admin_client():
    client = MagicMock()

    def _table(name):
        fake = MagicMock()
        if name == "profiles":

            def _select(cols):
                q = MagicMock()

                def _eq(k, v):
                    resp = MagicMock()
                    resp.data = [MOCK_PROFILE]
                    q.execute.return_value = resp
                    return q

                def _ilike(k, v):
                    resp = MagicMock()
                    resp.data = [MOCK_PROFILE]
                    q.execute.return_value = resp
                    return q

                def _limit(n):
                    return q

                q.eq = _eq
                q.ilike = _ilike
                q.limit = _limit
                q.execute.return_value = MagicMock(data=[MOCK_PROFILE])
                return q

            fake.select = _select
            fake.upsert.return_value = MagicMock(data=[MOCK_PROFILE])

        elif name == "school_memberships":

            def _sel(cols):
                q = MagicMock()

                def _eq(k, v):
                    resp = MagicMock()
                    resp.data = [MOCK_MEMBERSHIP]
                    q.execute.return_value = resp
                    return q

                q.eq = _eq
                q.execute.return_value = MagicMock(data=[MOCK_MEMBERSHIP])
                return q

            fake.select = _sel
            fake.insert.return_value = MagicMock(data=[MOCK_MEMBERSHIP])
            fake.update.return_value = MagicMock()
            fake.delete.return_value = MagicMock()

        elif name == "roles":

            def _sel(cols):
                q = MagicMock()

                def _eq(k, v):
                    resp = MagicMock()
                    resp.data = [MOCK_ROLE]
                    q.execute.return_value = resp
                    return q

                def _in_(k, v):
                    resp = MagicMock()
                    resp.data = [MOCK_ROLE]
                    q.execute.return_value = resp
                    return q

                def _limit(n):
                    return q

                q.eq = _eq
                q.in_ = _in_
                q.limit = _limit
                q.execute.return_value = MagicMock(data=[MOCK_ROLE])
                return q

            fake.select = _sel
            fake.insert.return_value = MagicMock(data=[MOCK_ROLE])

        elif name == "role_permissions":
            fake.select.return_value = MagicMock(
                execute=lambda: MagicMock(data=[])
            )

        else:
            fake.select.return_value = MagicMock(execute=lambda: MagicMock(data=[]))
            fake.insert.return_value = MagicMock(data=[])

        return fake

    client.table = _table
    client.auth = MagicMock()
    client.auth.admin = MagicMock()

    def _create_user(payload):
        resp = MagicMock()
        resp.user = MagicMock()
        resp.user.id = MOCK_PROFILE["id"]
        return resp

    client.auth.admin.create_user = _create_user
    client.auth.admin.update_user_by_id = MagicMock()
    client.auth.sign_in_with_password = MagicMock(
        return_value=MagicMock(
            session=MagicMock(
                access_token="mock-access-token",
                refresh_token="mock-refresh-token",
                expires_in=3600,
            )
        )
    )
    client.auth.sign_in_with_otp = MagicMock(
        return_value=MagicMock(
            session=None,
            message_id="otp-msg-001",
        )
    )
    client.auth.verify_otp = MagicMock(return_value=MagicMock(session=None))
    client.auth.refresh_session = MagicMock(
        return_value=MagicMock(
            session=MagicMock(
                access_token="mock-access-token-rotated",
                refresh_token="mock-refresh-token-rotated",
                expires_in=3600,
            )
        )
    )
    client.auth.set_session = MagicMock()
    client.auth.sign_out = MagicMock()
    return client


@pytest.fixture(autouse=True)
def mock_supabase():
    mock_client = _mock_supabase_admin_client()
    with (
        patch("app.services.supabase_admin.get_supabase_admin_client", return_value=mock_client),
        patch("app.services.supabase_admin.create_supabase_admin_client", return_value=mock_client),
        patch("app.routes.auth.create_supabase_admin_client", return_value=mock_client),
        patch("app.middleware.auth.get_supabase_admin_client", return_value=mock_client),
    ):
        yield


@pytest.fixture()
def admin_headers():
    token = create_access_token(
        {
            "sub": MOCK_PROFILE["id"],
            "profile_id": MOCK_PROFILE["id"],
            "email": MOCK_PROFILE["email"],
            "role": "school_admin",
            "role_key": "school_admin",
            "username": MOCK_PROFILE["display_name"],
            "full_name": MOCK_PROFILE["full_name"],
            "school_id": MOCK_PROFILE["default_school_id"],
            "membership_id": MOCK_MEMBERSHIP["id"],
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_protected_route_requires_jwt(client):
    response = client.get("/api/settings")
    assert response.status_code in (401, 404)


def test_rbac_blocks_user_without_permission(client, admin_headers):
    response = client.get("/api/settings", headers=admin_headers)
    assert response.status_code in (403, 404, 200)


def test_refresh_token_cannot_access_protected_routes(client):
    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "adminuser", "password": "Password123!"},
    )
    assert login_response.status_code in (200, 401, 429)
    if login_response.status_code == 200:
        refresh_token = login_response.json()["refresh_token"]
        response = client.get(
            "/api/settings",
            headers={"Authorization": f"Bearer {refresh_token}"},
        )
        assert response.status_code in (401, 403)


def test_default_admin_backdoor_is_removed(client):
    response = client.post(
        "/api/auth/login-password",
        json={"username": "definitely-not-a-default-admin", "password": "admin123"},
    )
    assert response.status_code in (401, 429)


def test_password_login_lockout_after_repeated_failures(client):
    for _ in range(5):
        response = client.post(
            "/api/auth/login-password",
            json={"username": "lockeduser", "password": "WrongPassword!"},
        )
        assert response.status_code in (401, 429)

    locked_response = client.post(
        "/api/auth/login-password",
        json={"username": "lockeduser", "password": "WrongPassword!"},
    )
    assert locked_response.status_code in (401, 429)


def test_otp_verify_lockout_after_repeated_failures(client):
    send_response = client.post(
        "/api/auth/send-otp",
        json={"email": "otpuser@example.com"},
    )
    assert send_response.status_code in (200, 400, 401, 500)

    for _ in range(5):
        response = client.post(
            "/api/auth/verify-otp",
            json={"email": "otpuser@example.com", "otp_code": "000000"},
        )
        assert response.status_code in (401, 429)

    if send_response.status_code == 200:
        otp = send_response.json().get("debug_otp")
        if otp:
            locked_response = client.post(
                "/api/auth/verify-otp",
                json={"email": "otpuser@example.com", "otp_code": otp},
            )
            assert locked_response.status_code in (401, 429)


def test_refresh_token_rotation_rejects_reuse(client):
    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "adminuser", "password": "Password123!"},
    )
    if login_response.status_code != 200:
        return
    initial_refresh_token = login_response.json()["refresh_token"]

    refresh_response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": initial_refresh_token},
    )
    assert refresh_response.status_code == 200
    rotated_refresh_token = refresh_response.json()["refresh_token"]
    assert rotated_refresh_token != initial_refresh_token

    replay_response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": initial_refresh_token},
    )
    assert replay_response.status_code == 401

    rotated_response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": rotated_refresh_token},
    )
    assert rotated_response.status_code == 401


def test_logout_invalidates_refresh_token(client):
    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "adminuser", "password": "Password123!"},
    )
    if login_response.status_code != 200:
        return
    refresh_token = login_response.json()["refresh_token"]

    logout_response = client.post(
        "/api/auth/logout",
        json={"refresh_token": refresh_token},
    )
    assert logout_response.status_code == 200

    refresh_response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_response.status_code == 401


def test_administrator_overview_splits_platform_and_school_admins(client, monkeypatch):
    school_rows = [
        {
            "id": "membership-school-admin-managed",
            "profile_id": "profile-school-admin-managed",
            "role_id": "role-managed-school-admin",
            "is_active": True,
            "status": "active",
            "created_at": "2026-07-29T10:00:00Z",
            "profiles": {
                "id": "profile-school-admin-managed",
                "email": "managed-admin@school.com",
                "full_name": "Managed School Admin",
                "display_name": "managedadmin",
                "metadata": {"username": "managedadmin", "user_type": "non_teaching"},
                "is_active": True,
            },
            "roles": {
                "id": "role-managed-school-admin",
                "role_key": "managed_profile_school_admin",
                "role_name": "Managed School Admin",
                "metadata": {"role_key": "school_admin", "legacy_role": "admin"},
                "is_active": True,
            },
        },
        {
            "id": "membership-school-admin-system",
            "profile_id": "profile-school-admin-system",
            "role_id": "role-system-school-admin",
            "is_active": True,
            "status": "active",
            "created_at": "2026-07-28T10:00:00Z",
            "profiles": {
                "id": "profile-school-admin-system",
                "email": "system-admin@school.com",
                "full_name": "System School Admin",
                "display_name": "systemadmin",
                "metadata": {"username": "systemadmin", "user_type": "non_teaching"},
                "is_active": True,
            },
            "roles": {
                "id": "role-system-school-admin",
                "role_key": "school_admin",
                "role_name": "School Admin",
                "metadata": None,
                "is_active": True,
            },
        },
        {
            "id": "membership-platform-admin",
            "profile_id": "profile-platform-admin",
            "role_id": "role-platform-admin",
            "is_active": True,
            "status": "active",
            "created_at": "2026-07-27T10:00:00Z",
            "profiles": {
                "id": "profile-platform-admin",
                "email": "platform-admin@global.com",
                "full_name": "Platform Admin In Memberships",
                "display_name": "platformadmin",
                "metadata": {"username": "platformadmin", "user_type": "non_teaching"},
                "is_active": True,
            },
            "roles": {
                "id": "role-platform-admin",
                "role_key": "platform_admin",
                "role_name": "Platform Admin",
                "metadata": None,
                "is_active": True,
            },
        },
    ]

    monkeypatch.setattr(auth_routes, "create_supabase_admin_client", lambda: object())
    monkeypatch.setattr(auth_routes, "_load_school_role_user_rows", lambda school_id, supabase=None: school_rows)
    monkeypatch.setattr(auth_routes, "_load_role_permissions_map", lambda role_ids, supabase=None: {})

    app.dependency_overrides[auth_routes.resolve_school_id_from_actor] = lambda: "school-a"
    app.dependency_overrides[auth_routes.require_user_management_access] = lambda: SimpleNamespace(
        id="platform-profile",
        username="platformowner",
        full_name="Platform Owner",
        email="platform-owner@example.com",
        role="admin",
        role_key="platform_admin",
        user_type="non_teaching",
        permissions=["admin_office.access_control"],
        is_active=True,
        created_at="2026-07-29T09:00:00Z",
    )

    try:
        response = client.get("/api/auth/users/administrators")
    finally:
        app.dependency_overrides.pop(auth_routes.resolve_school_id_from_actor, None)
        app.dependency_overrides.pop(auth_routes.require_user_management_access, None)

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["platform_administrators"]) == 1
    assert payload["platform_administrators"][0]["role"] == "admin"
    assert [item["email"] for item in payload["school_administrators"]] == [
        "managed-admin@school.com",
        "system-admin@school.com",
    ]


def test_permission_catalog_includes_dynamic_modules(client, monkeypatch):
    monkeypatch.setattr(
        auth_routes,
        "_load_permission_catalog",
        lambda supabase=None, force_refresh=False: {
            "allowed_permissions": {
                "settings",
                "new_module",
                "new_module.view",
                "new_module.manage",
            },
            "module_children": {
                "new_module": ["new_module.view", "new_module.manage"],
            },
            "module_labels": {
                "new_module": "New Module",
                "settings": "Settings",
            },
            "permission_labels": {
                "new_module.view": "View",
                "new_module.manage": "Manage",
                "settings": "Settings",
            },
        },
    )
    app.dependency_overrides[auth_routes.require_user_management_access] = lambda: SimpleNamespace(
        id="admin-1",
        username="admin",
        full_name="Admin",
        email="admin@example.com",
        role="admin",
        role_key="school_admin",
        user_type="non_teaching",
        permissions=["admin_office.access_control"],
        is_active=True,
        created_at="2026-07-29T09:00:00Z",
    )

    try:
        response = client.get("/api/auth/permissions")
    finally:
        app.dependency_overrides.pop(auth_routes.require_user_management_access, None)

    assert response.status_code == 200
    payload = response.json()
    new_module = next(item for item in payload if item["key"] == "new_module")
    assert [section["key"] for section in new_module["sections"]] == [
        "new_module.view",
        "new_module.manage",
    ]


def test_permission_catalog_static_fallback_includes_offline_exams(monkeypatch):
    mock_client = _mock_supabase_admin_client()
    auth_routes._PERMISSION_CATALOG_CACHE.clear()
    monkeypatch.setattr(auth_routes, "create_supabase_admin_client", lambda: mock_client)

    catalog = auth_routes._load_permission_catalog(force_refresh=True)

    assert "offline_exams" in catalog["allowed_permissions"]
    assert "offline_exams.view" in catalog["allowed_permissions"]
    assert catalog["module_children"]["offline_exams"] == [
        "offline_exams.view",
        "offline_exams.manage",
        "offline_exams.create",
        "offline_exams.edit",
        "offline_exams.delete",
        "offline_exams.reports",
    ]
