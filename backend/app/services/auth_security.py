"""Centralized auth abuse protection, auditing, OTP, and refresh token handling."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import uuid

from fastapi import HTTPException, Request, status
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuthSecurityEvent, AuthThrottle, School, Token, User
from app.utils.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_otp,
    hash_token_value,
)


@dataclass
class AuthTokenBundle:
    access_token: str
    refresh_token: str
    access_token_expires_in_seconds: int
    refresh_token_expires_in_seconds: int


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class AuthSchemaCapabilities:
    has_auth_throttles: bool
    has_auth_security_events: bool
    token_columns: set[str]


_LEGACY_SQLITE_AUTH_PATCH_ATTEMPTED = False


def _patch_legacy_sqlite_auth_schema(db: Session) -> None:
    global _LEGACY_SQLITE_AUTH_PATCH_ATTEMPTED
    if _LEGACY_SQLITE_AUTH_PATCH_ATTEMPTED:
        return
    if settings.is_production or not settings.database_url.startswith("sqlite:///"):
        _LEGACY_SQLITE_AUTH_PATCH_ATTEMPTED = True
        return

    inspector = inspect(db.bind)
    table_names = set(inspector.get_table_names())
    connection = db.connection()

    if "tokens" in table_names:
        token_columns = {column["name"] for column in inspector.get_columns("tokens")}
        missing_token_columns = {
            "user_id": "ALTER TABLE tokens ADD COLUMN user_id INTEGER",
            "token_jti": "ALTER TABLE tokens ADD COLUMN token_jti VARCHAR(64)",
            "token_family": "ALTER TABLE tokens ADD COLUMN token_family VARCHAR(64)",
            "failure_count": "ALTER TABLE tokens ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0",
            "replaced_by_jti": "ALTER TABLE tokens ADD COLUMN replaced_by_jti VARCHAR(64)",
            "ip_address": "ALTER TABLE tokens ADD COLUMN ip_address VARCHAR(64)",
            "user_agent": "ALTER TABLE tokens ADD COLUMN user_agent VARCHAR(512)",
            "last_used_at": "ALTER TABLE tokens ADD COLUMN last_used_at DATETIME",
            "revoked_at": "ALTER TABLE tokens ADD COLUMN revoked_at DATETIME",
        }
        for column_name, ddl in missing_token_columns.items():
            if column_name not in token_columns:
                connection.exec_driver_sql(ddl)

    if "auth_throttles" not in table_names:
        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS auth_throttles (
                id INTEGER PRIMARY KEY,
                scope_key VARCHAR(255) NOT NULL UNIQUE,
                action VARCHAR(50) NOT NULL,
                failure_count INTEGER NOT NULL DEFAULT 0,
                locked_until DATETIME NULL,
                window_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_throttles_id ON auth_throttles (id)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_throttles_scope_key ON auth_throttles (scope_key)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_throttles_action ON auth_throttles (action)")

    if "auth_security_events" not in table_names:
        connection.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS auth_security_events (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NULL,
                email VARCHAR(255) NULL,
                event_type VARCHAR(50) NOT NULL,
                outcome VARCHAR(50) NOT NULL,
                ip_address VARCHAR(64) NULL,
                user_agent VARCHAR(512) NULL,
                detail TEXT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_security_events_id ON auth_security_events (id)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_security_events_user_id ON auth_security_events (user_id)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_security_events_email ON auth_security_events (email)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_security_events_event_type ON auth_security_events (event_type)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_auth_security_events_outcome ON auth_security_events (outcome)")

    _LEGACY_SQLITE_AUTH_PATCH_ATTEMPTED = True


def _get_schema_capabilities(db: Session) -> AuthSchemaCapabilities:
    _patch_legacy_sqlite_auth_schema(db)
    inspector = inspect(db.bind)
    table_names = set(inspector.get_table_names())
    token_columns: set[str] = set()
    if "tokens" in table_names:
        token_columns = {column["name"] for column in inspector.get_columns("tokens")}
    return AuthSchemaCapabilities(
        has_auth_throttles="auth_throttles" in table_names,
        has_auth_security_events="auth_security_events" in table_names,
        token_columns=token_columns,
    )


def _has_token_column(capabilities: AuthSchemaCapabilities, name: str) -> bool:
    return name in capabilities.token_columns


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def get_client_ip(request: Request | None) -> str:
    if request is None:
        return "unknown"
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def get_user_agent(request: Request | None) -> str:
    if request is None:
        return ""
    return (request.headers.get("user-agent") or "")[:512]


def record_auth_event(
    db: Session,
    *,
    event_type: str,
    outcome: str,
    email: str | None = None,
    user: User | None = None,
    request: Request | None = None,
    detail: str | None = None,
) -> None:
    capabilities = _get_schema_capabilities(db)
    if not capabilities.has_auth_security_events:
        return
    event = AuthSecurityEvent(
        user_id=user.id if user else None,
        email=email or (user.email if user else None),
        event_type=event_type,
        outcome=outcome,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
        detail=detail,
    )
    db.add(event)


def _normalize_scope_value(value: str) -> str:
    return value.strip().lower()


def _get_scope_key(action: str, scope_type: str, value: str) -> str:
    return f"{action}:{scope_type}:{_normalize_scope_value(value)}"


def _get_or_create_throttle(db: Session, *, action: str, scope_key: str, now: datetime) -> AuthThrottle:
    capabilities = _get_schema_capabilities(db)
    if not capabilities.has_auth_throttles:
        raise RuntimeError("auth_throttles table is not available")
    throttle = db.query(AuthThrottle).filter(AuthThrottle.scope_key == scope_key).first()
    if throttle:
        window_start = _as_utc(throttle.window_started_at) or now
        if window_start + timedelta(minutes=settings.auth_rate_limit_window_minutes) <= now:
            throttle.failure_count = 0
            throttle.locked_until = None
            throttle.window_started_at = now
        throttle.last_attempt_at = now
        return throttle

    throttle = AuthThrottle(
        scope_key=scope_key,
        action=action,
        failure_count=0,
        window_started_at=now,
        last_attempt_at=now,
    )
    db.add(throttle)
    return throttle


def assert_not_locked(db: Session, *, action: str, scope_type: str, value: str) -> None:
    capabilities = _get_schema_capabilities(db)
    if not capabilities.has_auth_throttles:
        return
    now = utcnow()
    throttle = db.query(AuthThrottle).filter(
        AuthThrottle.scope_key == _get_scope_key(action, scope_type, value)
    ).first()
    if not throttle:
        return
    locked_until = _as_utc(throttle.locked_until)
    if locked_until and locked_until > now:
        remaining_seconds = max(1, int((locked_until - now).total_seconds()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {remaining_seconds} seconds.",
        )


def assert_not_rate_limited(db: Session, *, action: str, email: str | None, request: Request | None) -> None:
    if email:
        assert_not_locked(db, action=action, scope_type="email", value=email)
    ip_address = get_client_ip(request)
    if ip_address and ip_address != "unknown":
        assert_not_locked(db, action=action, scope_type="ip", value=ip_address)


def register_failure(
    db: Session,
    *,
    action: str,
    email: str | None,
    request: Request | None,
    email_max_attempts: int,
    ip_max_attempts: int,
) -> None:
    capabilities = _get_schema_capabilities(db)
    if not capabilities.has_auth_throttles:
        return
    now = utcnow()
    lockout_until = now + timedelta(minutes=settings.auth_lockout_minutes)

    def increment(scope_type: str, value: str, max_attempts: int) -> None:
        throttle = _get_or_create_throttle(
            db,
            action=action,
            scope_key=_get_scope_key(action, scope_type, value),
            now=now,
        )
        throttle.failure_count += 1
        if throttle.failure_count >= max_attempts:
            throttle.locked_until = lockout_until

    if email:
        increment("email", email, email_max_attempts)
    ip_address = get_client_ip(request)
    if ip_address and ip_address != "unknown":
        increment("ip", ip_address, ip_max_attempts)


def reset_failures(db: Session, *, action: str, email: str | None, request: Request | None) -> None:
    capabilities = _get_schema_capabilities(db)
    if not capabilities.has_auth_throttles:
        return
    scope_keys: list[str] = []
    if email:
        scope_keys.append(_get_scope_key(action, "email", email))
    ip_address = get_client_ip(request)
    if ip_address and ip_address != "unknown":
        scope_keys.append(_get_scope_key(action, "ip", ip_address))
    if not scope_keys:
        return
    throttles = db.query(AuthThrottle).filter(AuthThrottle.scope_key.in_(scope_keys)).all()
    now = utcnow()
    for throttle in throttles:
        throttle.failure_count = 0
        throttle.locked_until = None
        throttle.window_started_at = now
        throttle.last_attempt_at = now


def _token_claims_for_user(user: User, db: Session | None = None) -> dict:
    school_id: str | None = None
    role_key: str | None = None
    if db is not None:
        try:
            school = db.query(School).filter(School.admin_id == user.id).first()
            if school is not None:
                school_id = str(school.id)
                # Resolve integer local school ID to Supabase UUID
                if school_id and not _is_likely_uuid(school_id):
                    try:
                        from app.services.supabase_admin import get_supabase_admin_client
                        supabase = get_supabase_admin_client()
                        resp = supabase.table("schools").select("id").limit(1).execute()
                        rows = list(resp.data or [])
                        if rows:
                            school_id = str(rows[0]["id"])
                    except Exception:
                        pass
            # Resolve Supabase role_key from profile membership
            if user.email:
                try:
                    from app.services.supabase_admin import get_supabase_admin_client
                    supabase = get_supabase_admin_client()
                    profile_resp = supabase.table("profiles").select("id").ilike("email", user.email).limit(1).execute()
                    profiles = list(profile_resp.data or [])
                    if profiles:
                        profile_id = str(profiles[0]["id"])
                        membership_resp = (
                            supabase.table("school_memberships")
                            .select("roles(role_key)")
                            .eq("profile_id", profile_id)
                            .eq("is_active", True)
                            .eq("status", "active")
                            .limit(1)
                            .execute()
                        )
                        memberships = list(membership_resp.data or [])
                        if memberships:
                            role_data = memberships[0].get("roles")
                            if isinstance(role_data, dict):
                                role_key = str(role_data.get("role_key") or "")
                except Exception:
                    pass

            # Fallback: if user is local school admin, resolve role_key from
            # a platform_admin membership for the resolved school
            if not role_key and school_id and _is_likely_uuid(school_id):
                try:
                    from app.services.supabase_admin import get_supabase_admin_client
                    supabase = get_supabase_admin_client()
                    pa_memberships = (
                        supabase.table("school_memberships")
                        .select("roles!inner(role_key)")
                        .eq("school_id", school_id)
                        .eq("is_active", True)
                        .eq("status", "active")
                        .eq("roles.role_key", "platform_admin")
                        .limit(1)
                        .execute()
                    )
                    memberships = list(pa_memberships.data or [])
                    if memberships:
                        role_key = "platform_admin"
                except Exception:
                    pass
        except Exception:
            school_id = None
    claims: dict[str, Any] = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "username": user.username,
        "full_name": user.full_name,
        "user_type": user.user_type or "non_teaching",
        "school_id": school_id,
    }
    if role_key:
        claims["role_key"] = role_key
    return claims


def _is_likely_uuid(value: str) -> bool:
    import uuid
    try:
        uuid.UUID(value)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _decode_expiration(payload: dict, fallback: timedelta) -> datetime:
    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        return datetime.fromtimestamp(exp, tz=timezone.utc)
    if isinstance(exp, datetime):
        return _as_utc(exp) or (utcnow() + fallback)
    return utcnow() + fallback


def issue_auth_tokens(
    db: Session,
    *,
    user: User,
    request: Request | None = None,
    previous_refresh_record: Token | None = None,
) -> AuthTokenBundle:
    capabilities = _get_schema_capabilities(db)
    claims = _token_claims_for_user(user, db)
    refresh_family = previous_refresh_record.token_family if previous_refresh_record else uuid.uuid4().hex

    access_token = create_access_token(claims)
    refresh_token = create_refresh_token({**claims, "family": refresh_family})
    refresh_payload = decode_token(refresh_token)
    if not refresh_payload:
        raise RuntimeError("Failed to decode freshly issued refresh token.")

    now = utcnow()
    refresh_record_data = {
        "email": user.email,
        "token": hash_token_value(refresh_token),
        "token_type": "refresh",
        "expires_at": _decode_expiration(
            refresh_payload,
            timedelta(days=settings.refresh_token_expiration_days),
        ),
    }
    if _has_token_column(capabilities, "user_id"):
        refresh_record_data["user_id"] = user.id
    if _has_token_column(capabilities, "token_jti"):
        refresh_record_data["token_jti"] = str(refresh_payload.get("jti") or "")
    if _has_token_column(capabilities, "token_family"):
        refresh_record_data["token_family"] = refresh_family
    if _has_token_column(capabilities, "ip_address"):
        refresh_record_data["ip_address"] = get_client_ip(request)
    if _has_token_column(capabilities, "user_agent"):
        refresh_record_data["user_agent"] = get_user_agent(request)
    refresh_record = Token(**refresh_record_data)
    db.add(refresh_record)

    if previous_refresh_record:
        previous_refresh_record.is_used = True
        previous_refresh_record.used_at = now
        if _has_token_column(capabilities, "revoked_at"):
            previous_refresh_record.revoked_at = now
        if _has_token_column(capabilities, "last_used_at"):
            previous_refresh_record.last_used_at = now
        if _has_token_column(capabilities, "replaced_by_jti") and _has_token_column(capabilities, "token_jti"):
            previous_refresh_record.replaced_by_jti = refresh_record.token_jti

    user.last_login = now

    return AuthTokenBundle(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_in_seconds=settings.access_token_expiration_minutes * 60,
        refresh_token_expires_in_seconds=settings.refresh_token_expiration_days * 24 * 60 * 60,
    )


def hash_otp_value(otp_code: str) -> str:
    return hash_token_value(otp_code)


def issue_email_otp(
    db: Session,
    *,
    email: str,
    request: Request | None = None,
) -> str:
    now = utcnow()
    capabilities = _get_schema_capabilities(db)
    active_otps = db.query(Token).filter(
        Token.email == email,
        Token.token_type == "otp",
        Token.is_used.is_(False),
    ).all()
    if _has_token_column(capabilities, "revoked_at"):
        active_otps = [token for token in active_otps if token.revoked_at is None]
    for token in active_otps:
        if _has_token_column(capabilities, "revoked_at"):
            token.revoked_at = now
        else:
            token.is_used = True
            token.used_at = now

    otp_code = generate_otp()
    otp_hash = hash_otp_value(otp_code)
    token_data = {
        "email": email,
        "token": otp_hash,
        "otp_code": otp_hash,
        "token_type": "otp",
        "expires_at": now + timedelta(minutes=settings.otp_expiration_minutes),
    }
    if _has_token_column(capabilities, "ip_address"):
        token_data["ip_address"] = get_client_ip(request)
    if _has_token_column(capabilities, "user_agent"):
        token_data["user_agent"] = get_user_agent(request)
    token = Token(**token_data)
    db.add(token)
    return otp_code


def _load_active_otp(db: Session, *, email: str) -> Token | None:
    now = utcnow()
    capabilities = _get_schema_capabilities(db)
    query = db.query(Token).filter(
        Token.email == email,
        Token.token_type == "otp",
        Token.is_used.is_(False),
        Token.expires_at > now,
    )
    tokens = query.order_by(Token.created_at.desc()).all()
    if _has_token_column(capabilities, "revoked_at"):
        tokens = [token for token in tokens if token.revoked_at is None]
    return tokens[0] if tokens else None


def consume_otp(db: Session, *, email: str, otp_code: str) -> Token:
    capabilities = _get_schema_capabilities(db)
    token = _load_active_otp(db, email=email)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )
    if token.token != hash_otp_value(otp_code):
        if _has_token_column(capabilities, "failure_count"):
            token.failure_count += 1
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )
    now = utcnow()
    token.is_used = True
    token.used_at = now
    if _has_token_column(capabilities, "last_used_at"):
        token.last_used_at = now
    return token


def revoke_refresh_token_family(
    db: Session,
    *,
    token_family: str,
    reason: str | None = None,
) -> None:
    capabilities = _get_schema_capabilities(db)
    if not _has_token_column(capabilities, "token_family") or not _has_token_column(capabilities, "revoked_at"):
        return
    now = utcnow()
    records = db.query(Token).filter(
        Token.token_type == "refresh",
        Token.token_family == token_family,
        Token.revoked_at.is_(None),
    ).all()
    for record in records:
        record.revoked_at = now
        if reason and not record.replaced_by_jti:
            record.replaced_by_jti = reason[:64]


def validate_refresh_token(
    db: Session,
    *,
    refresh_token: str,
) -> tuple[dict, Token, User]:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    capabilities = _get_schema_capabilities(db)
    token_hash = hash_token_value(refresh_token)
    record = db.query(Token).filter(
        Token.token == token_hash,
        Token.token_type == "refresh",
    ).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if _has_token_column(capabilities, "token_jti") and record.token_jti and record.token_jti != str(payload.get("jti") or ""):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    now = utcnow()
    if _as_utc(record.expires_at) and (_as_utc(record.expires_at) or now) <= now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

    record_revoked = _has_token_column(capabilities, "revoked_at") and bool(record.revoked_at)
    if record_revoked or record.is_used:
        if _has_token_column(capabilities, "token_family") and record.token_family:
            revoke_refresh_token_family(db, token_family=record.token_family, reason="refresh_replay_detected")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is no longer valid")

    user_id = record.user_id if _has_token_column(capabilities, "user_id") else payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first() if user_id else None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated user is inactive or missing")

    return payload, record, user


def revoke_refresh_token(
    db: Session,
    *,
    refresh_token: str,
) -> Token | None:
    capabilities = _get_schema_capabilities(db)
    token_hash = hash_token_value(refresh_token)
    record = db.query(Token).filter(
        Token.token == token_hash,
        Token.token_type == "refresh",
    ).first()
    if not record:
        return None
    now = utcnow()
    if _has_token_column(capabilities, "revoked_at"):
        record.revoked_at = now
    else:
        record.is_used = True
        record.used_at = now
    if _has_token_column(capabilities, "last_used_at"):
        record.last_used_at = now
    return record


def serialize_auth_detail(data: dict | None) -> str | None:
    if not data:
        return None
    return json.dumps(data, separators=(",", ":"), sort_keys=True)
