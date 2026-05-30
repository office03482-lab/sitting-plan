"""Authentication utilities."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import secrets
import uuid
from typing import Optional
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
