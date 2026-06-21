"""Authentication utilities."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
import secrets
import time
import uuid
from typing import Optional
import httpx
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.config import settings

# Password hashing
# Keep pbkdf2 first so new hashes do not depend on bcrypt backend quirks.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
_DECODED_TOKEN_CACHE: dict[str, tuple[float, Optional[dict]]] = {}
_TOKEN_CACHE_TTL_SECONDS = 300


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
    token_cache_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    cached = _DECODED_TOKEN_CACHE.get(token_cache_key)
    now = time.monotonic()
    if cached:
      expires_at, payload = cached
      if now < expires_at:
          logger.info("decode_token.cache_hit")
          return payload
      _DECODED_TOKEN_CACHE.pop(token_cache_key, None)

    def _cache_payload(payload: Optional[dict]) -> Optional[dict]:
        _DECODED_TOKEN_CACHE[token_cache_key] = (now + _TOKEN_CACHE_TTL_SECONDS, payload)
        return payload

    # 1) Try local HS256 secret
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],  # default HS256
        )
        logger.info("decode_token.success.using_local_secret")
        return _cache_payload(payload)
    except JWTError as exc:
        logger.info("decode_token.local_secret_failed", extra={"error": str(exc)})

    # 2) Try Supabase JWT secret (if configured)
    # Supabase tokens include an `aud` claim (e.g. "authenticated").
    # python-jose 3.3.0 requires `audience` to be provided when the token
    # contains `aud` and `verify_aud` is True.  Disable audience/issuer
    # verification here – the signature check is still enforced.
    supabase_secret = settings.supabase_jwt_secret
    if supabase_secret:
        for alg in ["HS256", "ES256"]:
            try:
                payload = jwt.decode(token, supabase_secret, algorithms=[alg], options={"verify_aud": False, "verify_iss": False})
                logger.info("decode_token.success.using_supabase_secret", extra={"algorithm": alg})
                return _cache_payload(payload)
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
    supabase_service_role_key = (
        settings.supabase_service_role_key
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    ).strip()
    supabase_api_key = supabase_anon_key or supabase_service_role_key
    if supabase_url and supabase_api_key:
        try:
            response = httpx.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": supabase_api_key,
                    "Authorization": f"Bearer {token}",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            user = response.json()
            if user:
                app_metadata = user.get("app_metadata") or {}
                user_metadata = user.get("user_metadata") or {}
                payload = {
                    "sub": str(user.get("id") or ""),
                    "email": str(user.get("email") or ""),
                    "role": str(app_metadata.get("role") or user_metadata.get("role") or ""),
                    "full_name": str(
                        user_metadata.get("full_name")
                        or user_metadata.get("name")
                        or user.get("email")
                        or ""
                    ),
                    "profile_id": str(user.get("id") or ""),
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
                return _cache_payload(payload)
        except Exception as exc:
            logger.info("decode_token.supabase_auth_api_failed", extra={"error": str(exc)})

    logger.warning("decode_token.all_attempts_failed")
    _cache_payload(None)
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
