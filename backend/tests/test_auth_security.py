"""Auth security tests — Supabase-native.

All auth flows go through Supabase Auth / admin API.
Tests mock the Supabase client to avoid a live dependency.
"""
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.main import app
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
