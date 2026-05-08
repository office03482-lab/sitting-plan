from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.database import Base, get_db
from app.main import app
from app.models import User, UserRole
from app.utils.auth import create_access_token, hash_password


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def create_user(
    db_session,
    *,
    username: str,
    email: str,
    password: str,
    role: UserRole = UserRole.VIEWER,
    permissions: str | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        username=username,
        email=email,
        full_name=username.title(),
        password_hash=hash_password(password),
        role=role,
        user_type="non_teaching",
        permissions=permissions,
        is_active=is_active,
        is_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def auth_headers_for(user: User):
    token = create_access_token(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value,
            "username": user.username,
            "full_name": user.full_name,
            "user_type": user.user_type,
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_protected_route_requires_jwt(client):
    response = client.get("/api/settings")
    assert response.status_code == 401


def test_rbac_blocks_user_without_permission(client, db_session):
    user = create_user(
        db_session,
        username="viewer1",
        email="viewer1@example.com",
        password="Password123!",
        role=UserRole.VIEWER,
        permissions="attendance.view",
    )
    response = client.get("/api/settings", headers=auth_headers_for(user))
    assert response.status_code == 403


def test_refresh_token_cannot_access_protected_routes(client, db_session):
    user = create_user(
        db_session,
        username="settingsadmin",
        email="settingsadmin@example.com",
        password="Password123!",
        role=UserRole.ADMIN,
        permissions="settings",
    )
    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "settingsadmin", "password": "Password123!"},
    )
    assert login_response.status_code == 200
    refresh_token = login_response.json()["refresh_token"]
    response = client.get("/api/settings", headers={"Authorization": f"Bearer {refresh_token}"})
    assert response.status_code == 401


def test_default_admin_backdoor_is_removed(client, db_session):
    response = client.post(
        "/api/auth/login-password",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 401
    assert db_session.query(User).count() == 0


def test_password_login_lockout_after_repeated_failures(client, db_session):
    create_user(
        db_session,
        username="lockeduser",
        email="locked@example.com",
        password="Password123!",
    )

    for _ in range(5):
        response = client.post(
            "/api/auth/login-password",
            json={"username": "lockeduser", "password": "WrongPassword!"},
        )
        assert response.status_code == 401

    locked_response = client.post(
        "/api/auth/login-password",
        json={"username": "lockeduser", "password": "WrongPassword!"},
    )
    assert locked_response.status_code == 429


def test_otp_verify_lockout_after_repeated_failures(client):
    send_response = client.post("/api/auth/send-otp", json={"email": "otpuser@example.com"})
    assert send_response.status_code == 200
    otp = send_response.json()["debug_otp"]
    assert otp

    for _ in range(5):
        response = client.post(
            "/api/auth/verify-otp",
            json={"email": "otpuser@example.com", "otp_code": "000000"},
        )
        assert response.status_code == 401

    locked_response = client.post(
        "/api/auth/verify-otp",
        json={"email": "otpuser@example.com", "otp_code": otp},
    )
    assert locked_response.status_code == 429


def test_refresh_token_rotation_rejects_reuse(client, db_session):
    create_user(
        db_session,
        username="rotator",
        email="rotator@example.com",
        password="Password123!",
        role=UserRole.ADMIN,
        permissions="settings",
    )

    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "rotator", "password": "Password123!"},
    )
    assert login_response.status_code == 200
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


def test_logout_invalidates_refresh_token(client, db_session):
    create_user(
        db_session,
        username="logoutuser",
        email="logoutuser@example.com",
        password="Password123!",
        role=UserRole.ADMIN,
        permissions="settings",
    )

    login_response = client.post(
        "/api/auth/login-password",
        json={"username": "logoutuser", "password": "Password123!"},
    )
    assert login_response.status_code == 200
    refresh_token = login_response.json()["refresh_token"]

    logout_response = client.post("/api/auth/logout", json={"refresh_token": refresh_token})
    assert logout_response.status_code == 200

    refresh_response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_response.status_code == 401
