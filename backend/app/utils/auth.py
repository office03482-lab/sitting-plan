"""Authentication utilities."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
import secrets
import uuid
from typing import Optional
from gotrue import SyncGoTrueClient
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.config import settings

# Password hashing
# Keep pbkdf2 first so new hashes do not depend on bcrypt backend quirks.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _encode_jwt(data: dict, *, token_type: str, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    now = _utcnow()
    expire = now + expires_delta
    to_encode.update(
        {
            "exp": expire,
            "iat": now,
            "nbf": now,
            "type": token_type,
            "jti": str(uuid.uuid4()),
        }
    )
    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )
    return encoded_jwt


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token."""
    return _encode_jwt(
        data,
        token_type="access",
        expires_delta=expires_delta or timedelta(minutes=settings.access_token_expiration_minutes),
    )


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT refresh token."""
    return _encode_jwt(
        data,
        token_type="refresh",
        expires_delta=expires_delta or timedelta(days=settings.refresh_token_expiration_days),
    )


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate JWT token.

    Tries local JWT secret first (HS256 tokens issued by this server).
    Falls back to Supabase JWT secret (ES256 or HS256 tokens issued by Supabase Auth).
    """
    logger = logging.getLogger(__name__)

    # 1) Try local HS256 secret
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],  # default HS256
        )
        logger.info("decode_token.success.using_local_secret")
        return payload
    except JWTError as exc:
        logger.info("decode_token.local_secret_failed", extra={"error": str(exc)})

    # 2) Try Supabase JWT secret (if configured)
    supabase_secret = settings.supabase_jwt_secret
    if supabase_secret:
        for alg in ["HS256", "ES256"]:
            try:
                payload = jwt.decode(token, supabase_secret, algorithms=[alg])
                logger.info("decode_token.success.using_supabase_secret", extra={"algorithm": alg})
                return payload
            except JWTError as exc:
                logger.info("decode_token.supabase_secret_failed", extra={"algorithm": alg, "error": str(exc)})
                continue

    # 3) Ask Supabase Auth to validate the token when JWT secret is not present
    # or the token is signed by a different runtime secret.
    supabase_url = (
        settings.supabase_url
        or os.getenv("SUPABASE_URL")
        or os.getenv("VITE_SUPABASE_URL")
        or ""
    ).strip()
    supabase_anon_key = (
        settings.supabase_anon_key
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
        or ""
    ).strip()
    if supabase_url and supabase_anon_key:
        try:
            auth_client = SyncGoTrueClient(
                url=f"{supabase_url.rstrip('/')}/auth/v1",
                headers={"apikey": supabase_anon_key},
            )
            response = auth_client.get_user(jwt=token)
            user = getattr(response, "user", None)
            if user:
                app_metadata = getattr(user, "app_metadata", None) or {}
                user_metadata = getattr(user, "user_metadata", None) or {}
                payload = {
                    "sub": str(getattr(user, "id", "") or ""),
                    "email": str(getattr(user, "email", "") or ""),
                    "role": str(app_metadata.get("role") or user_metadata.get("role") or ""),
                    "full_name": str(
                        user_metadata.get("full_name")
                        or user_metadata.get("name")
                        or getattr(user, "email", "")
                        or ""
                    ),
                    "profile_id": str(getattr(user, "id", "") or ""),
                    "school_id": str(app_metadata.get("school_id") or user_metadata.get("school_id") or ""),
                    "active_school_id": str(
                        app_metadata.get("active_school_id") or user_metadata.get("active_school_id") or ""
                    ),
                    "current_school_id": str(
                        app_metadata.get("current_school_id") or user_metadata.get("current_school_id") or ""
                    ),
                    "type": "access",
                }
                logger.info("decode_token.success.using_supabase_auth_api")
                return payload
        except Exception as exc:
            logger.info("decode_token.supabase_auth_api_failed", extra={"error": str(exc)})

    logger.warning("decode_token.all_attempts_failed")
    return None


def generate_otp(length: int = 6) -> str:
    import random
    return ''.join(random.choices('0123456789', k=length))


def generate_secure_token(length: int = 48) -> str:
    """Generate a URL-safe random token."""
    return secrets.token_urlsafe(length)


def hash_token_value(value: str) -> str:
    """Hash a token or OTP value before persisting it."""
    secret = (settings.jwt_secret or "").encode("utf-8")
    return hmac.new(secret, value.encode("utf-8"), hashlib.sha256).hexdigest()


def require_admin(user_role: Optional[str]) -> bool:
    """
    Check if user has admin role.
    
    Args:
        user_role: User role from token payload
    
    Returns:
        True if user is admin, False otherwise
    """
    return user_role == "admin"
