"""
Middleware and shared auth helpers.

JWT-only authentication with local-user and Supabase principal support.
"""
import logging
import time
from threading import Event, Lock
from typing import Any, Callable, Dict, Optional
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, UserRole
from app.services.supabase_admin import get_supabase_admin_client
from app.utils.auth import decode_token

logger = logging.getLogger(__name__)
_SUPABASE_PRINCIPAL_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SUPABASE_PRINCIPAL_CACHE_TTL_SECONDS = 180
_SUPABASE_PRINCIPAL_IN_FLIGHT: dict[str, dict[str, Any]] = {}
_SUPABASE_PRINCIPAL_IN_FLIGHT_LOCK = Lock()


async def verify_token(request: Request) -> dict:
    """
    Verify JWT token from request headers.

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or missing
    """
    auth_header = request.headers.get('Authorization')

    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header"
        )

    tokens = auth_header.split()
    if len(tokens) != 2 or tokens[0].lower() != 'bearer':
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format"
        )

    token = tokens[1]

    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    if payload.get("type") not in {None, "access"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type"
        )

    return payload


def extract_token_payload(authorization: Optional[str]) -> Optional[dict]:
    """Extract and validate JWT from Authorization header."""
    if not authorization:
        return None

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token = parts[1]
    payload = decode_token(token)
    return payload


def _get_request_token_payload(request: Request, authorization: Optional[str]) -> Optional[dict]:
    cached_payload = getattr(request.state, "decoded_auth_payload", None)
    if cached_payload is not None:
        return cached_payload

    payload = extract_token_payload(authorization)
    request.state.decoded_auth_payload = payload
    return payload


def _normalize_role_key(role_key: str | None) -> str:
    return str(role_key or "").strip().lower()


def _map_supabase_role_to_legacy_role(role_key: str | None, role_metadata: dict[str, Any] | None = None) -> UserRole:
    if isinstance(role_metadata, dict):
        legacy_role = _normalize_role_key(role_metadata.get("legacy_role"))
        if legacy_role == "admin":
            return UserRole.ADMIN
        if legacy_role == "teacher":
            return UserRole.TEACHER
        if legacy_role == "store_manager":
            return UserRole.STORE_MANAGER
        if legacy_role == "viewer":
            return UserRole.VIEWER
    normalized = _normalize_role_key(role_key)
    if normalized in {"platform_admin", "school_admin"}:
        return UserRole.ADMIN
    if normalized == "teacher":
        return UserRole.TEACHER
    if normalized == "store_manager":
        return UserRole.STORE_MANAGER
    return UserRole.VIEWER


def _map_supabase_role_to_user_type(role_key: str | None, role_metadata: dict[str, Any] | None = None) -> str:
    if isinstance(role_metadata, dict):
        configured = str(role_metadata.get("user_type") or "").strip().lower()
        if configured in {"teaching", "non_teaching", "student"}:
            return configured
    normalized = _normalize_role_key(role_key)
    if normalized == "teacher":
        return "teaching"
    if normalized == "student":
        return "student"
    return "non_teaching"


def _normalize_school_id(value: Any) -> str:
    return str(value or "").strip()


def _complete_supabase_principal_fetch(cache_key: str, *, principal: Optional[dict[str, Any]] = None, error: Optional[Exception] = None) -> None:
    with _SUPABASE_PRINCIPAL_IN_FLIGHT_LOCK:
        inflight = _SUPABASE_PRINCIPAL_IN_FLIGHT.get(cache_key)
        if not inflight:
            return
        inflight["principal"] = dict(principal) if principal else None
        inflight["error"] = error
        inflight["event"].set()
        _SUPABASE_PRINCIPAL_IN_FLIGHT.pop(cache_key, None)


def _load_supabase_principal(payload: dict[str, Any], *, profile_id: str, email: str, token_school_id: str) -> Optional[dict[str, Any]]:
    _t0 = time.monotonic()
    if not profile_id and not email:
        return None

    try:
        supabase = get_supabase_admin_client()
    except Exception as exc:
        logger.warning("auth.supabase_client_unavailable", extra={"error": str(exc)})
        return None

    profile_query = (
        supabase.table("profiles")
        .select("id,email,full_name,display_name,is_active,default_school_id")
    )
    if profile_id:
        profile_query = profile_query.eq("id", profile_id)
    elif email:
        profile_query = profile_query.ilike("email", email)

    profile_response = profile_query.limit(1).execute()
    profiles = list(profile_response.data or [])
    if not profiles:
        logger.info(
            "auth.supabase_profile_not_found",
            extra={"profile_id": profile_id, "email": email},
        )
        return None

    profile = profiles[0]
    resolved_profile_id = str(profile.get("id") or profile_id or "").strip()
    memberships_response = (
        supabase.table("school_memberships")
        .select(
            """
            id,
            school_id,
            role_id,
            status,
            is_primary,
            is_active,
            roles (
              role_key,
              role_name,
              is_system,
              metadata
            )
            """
        )
        .eq("profile_id", resolved_profile_id)
        .eq("is_active", True)
        .eq("status", "active")
        .execute()
    )
    memberships = list(memberships_response.data or [])
    if not memberships:
        logger.info("auth.supabase_membership_not_found", extra={"profile_id": resolved_profile_id})
        return None

    default_school_id = _normalize_school_id(profile.get("default_school_id"))

    def first_role(item: dict[str, Any]) -> dict[str, Any] | None:
        role_data = item.get("roles")
        if isinstance(role_data, list):
            return role_data[0] if role_data else None
        return role_data if isinstance(role_data, dict) else None

    active_membership = None
    if token_school_id:
        active_membership = next(
            (item for item in memberships if _normalize_school_id(item.get("school_id")) == token_school_id),
            None,
        )
    if not active_membership and default_school_id:
        active_membership = next(
            (item for item in memberships if _normalize_school_id(item.get("school_id")) == default_school_id),
            None,
        )
    if not active_membership:
        active_membership = next((item for item in memberships if item.get("is_primary")), None) or memberships[0]

    role = first_role(active_membership) or {}
    role_id = str(active_membership.get("role_id") or "").strip()
    permissions: list[str] = []
    if role_id:
        permissions_response = (
            supabase.table("role_permissions")
            .select("permissions(permission_key)")
            .eq("role_id", role_id)
            .execute()
        )
        for item in list(permissions_response.data or []):
            permission_data = item.get("permissions")
            permission_key = (
                permission_data.get("permission_key")
                if isinstance(permission_data, dict)
                else None
            )
            if permission_key:
                permissions.append(str(permission_key).strip().lower())

    _t1 = time.monotonic()
    role_key = _normalize_role_key(role.get("role_key"))
    role_metadata = role.get("metadata") if isinstance(role.get("metadata"), dict) else None
    logger.info("auth.load_supabase_principal.timing", extra={
        "profile_id": profile_id,
        "duration_ms": round((_t1 - _t0) * 1000),
        "has_profile": True,
        "has_membership": True,
        "membership_count": len(memberships),
        "permission_count": len(permissions),
    })
    return {
        "profile_id": resolved_profile_id,
        "membership_id": str(active_membership.get("id") or "").strip(),
        "school_id": _normalize_school_id(active_membership.get("school_id")),
        "default_school_id": default_school_id,
        "email": str(profile.get("email") or payload.get("email") or "").strip(),
        "full_name": str(
            profile.get("full_name") or profile.get("display_name") or payload.get("email") or "User"
        ).strip(),
        "username": str(profile.get("display_name") or profile.get("email") or payload.get("email") or "").strip(),
        "is_active": bool(profile.get("is_active")),
        "role_key": role_key,
        "role": _map_supabase_role_to_legacy_role(role_key, role_metadata),
        "user_type": _map_supabase_role_to_user_type(role_key, role_metadata),
        "permissions": permissions,
        "role_metadata": role_metadata or {},
        "scope_assignments": dict((role_metadata or {}).get("scope_assignments") or {}) if isinstance((role_metadata or {}).get("scope_assignments"), dict) else {},
        "auth_source": "supabase",
    }


def _fetch_supabase_principal(payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    profile_id = str(payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    token_school_id = _normalize_school_id(
        payload.get("school_id")
        or payload.get("school_uuid")
        or payload.get("active_school_id")
        or payload.get("current_school_id")
    )
    cache_key = f"{profile_id}|{email}|{token_school_id}"
    cached = _SUPABASE_PRINCIPAL_CACHE.get(cache_key)
    now = time.monotonic()
    if cached:
        expires_at, principal = cached
        if now < expires_at:
            logger.info("auth.supabase_principal.cache_hit", extra={"profile_id": profile_id, "email": email})
            return dict(principal)
        _SUPABASE_PRINCIPAL_CACHE.pop(cache_key, None)

    waiter = None
    is_leader = False
    with _SUPABASE_PRINCIPAL_IN_FLIGHT_LOCK:
        waiter = _SUPABASE_PRINCIPAL_IN_FLIGHT.get(cache_key)
        if waiter is None:
            waiter = {"event": Event(), "principal": None, "error": None}
            _SUPABASE_PRINCIPAL_IN_FLIGHT[cache_key] = waiter
            is_leader = True

    if not is_leader:
        waiter["event"].wait()
        if waiter.get("error"):
            raise waiter["error"]
        principal = waiter.get("principal")
        return dict(principal) if principal else None

    try:
        principal = _load_supabase_principal(
            payload,
            profile_id=profile_id,
            email=email,
            token_school_id=token_school_id,
        )
    except Exception as exc:
        _complete_supabase_principal_fetch(cache_key, error=exc)
        raise

    if principal:
        _SUPABASE_PRINCIPAL_CACHE[cache_key] = (now + _SUPABASE_PRINCIPAL_CACHE_TTL_SECONDS, dict(principal))
    _complete_supabase_principal_fetch(cache_key, principal=principal)
    return principal


def _build_synthetic_user_from_supabase(principal: dict[str, Any]) -> User:
    synthetic_user = User(
        id=0,
        email=principal.get("email") or "supabase-user@example.com",
        username=principal.get("username") or None,
        full_name=principal.get("full_name") or "Supabase User",
        password_hash="",
        role=principal.get("role") or UserRole.VIEWER,
        user_type=principal.get("user_type") or "non_teaching",
        permissions=",".join(principal.get("permissions") or []),
        is_active=bool(principal.get("is_active", True)),
        is_verified=True,
    )
    synthetic_user.profile_id = principal.get("profile_id")
    synthetic_user.membership_id = principal.get("membership_id")
    synthetic_user.role_key = principal.get("role_key")
    synthetic_user.school_id = principal.get("school_id")
    synthetic_user.default_school_id = principal.get("default_school_id")
    synthetic_user.role_metadata = principal.get("role_metadata") or {}
    synthetic_user.scope_assignments = principal.get("scope_assignments") or {}
    return synthetic_user


def _resolve_request_principal(
    request: Request,
    payload: dict[str, Any],
    db: Session,
) -> dict[str, Any]:
    cached = getattr(request.state, "resolved_auth_principal", None)
    if cached:
        return cached

    user_id_raw = payload.get("sub")
    user = None

    try:
        try:
            user_id = int(str(user_id_raw))
            logger.info("auth.lookup.by_integer_id", extra={"user_id": user_id})
            user = db.query(User).filter(User.id == user_id).first()
        except (TypeError, ValueError):
            logger.info("auth.lookup.sub_is_not_integer", extra={"sub": str(user_id_raw or "")})

        if not user:
            token_email = str(payload.get("email") or "").strip().lower()
            if token_email:
                logger.info("auth.lookup.by_email", extra={"email": token_email})
                user = db.query(User).filter(func.lower(User.email) == token_email).first()
    except ProgrammingError:
        logger.warning("auth.lookup.users_table_missing", exc_info=True)

    auth_source = "local"
    role_key = ""
    membership_id = ""
    school_id = _normalize_school_id(
        payload.get("school_id")
        or payload.get("school_uuid")
        or payload.get("active_school_id")
        or payload.get("current_school_id")
    )

    if not user:
        principal = _fetch_supabase_principal(payload)
        if principal:
            user = _build_synthetic_user_from_supabase(principal)
            auth_source = principal.get("auth_source") or "supabase"
            role_key = str(principal.get("role_key") or "")
            membership_id = str(principal.get("membership_id") or "")
            if not school_id:
                school_id = _normalize_school_id(principal.get("school_id"))

    if not user:
        logger.warning(
            "auth.user_not_found",
            extra={"sub": str(user_id_raw or ""), "email": str(payload.get("email") or "")},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user not found",
        )

    # Extract role_key from JWT for local DB users
    if not role_key:
        role_key = str(payload.get("role_key") or "").strip().lower()
    if role_key and not getattr(user, "role_key", None):
        user.role_key = role_key

    actor_role = str(
        payload.get("role")
        or role_key
        or getattr(getattr(user, "role", None), "value", getattr(user, "role", ""))
    ).strip().lower()
    actor_name = str(
        payload.get("full_name")
        or payload.get("username")
        or getattr(user, "full_name", None)
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or ""
    ).strip()
    actor_email = str(payload.get("email") or getattr(user, "email", "") or "").strip()
    actor_username = str(
        payload.get("username")
        or getattr(user, "username", None)
        or getattr(user, "email", None)
        or ""
    ).strip()

    principal = {
        "user": user,
        "actor": {
            "role": actor_role,
            "name": actor_name,
            "email": actor_email,
            "username": actor_username,
            "user_id": str(user_id_raw or getattr(user, "id", "") or "").strip(),
            "profile_id": str(getattr(user, "profile_id", None) or user_id_raw or getattr(user, "id", "") or "").strip(),
            "school_id": school_id,
            "membership_id": membership_id,
            "auth_source": auth_source,
        },
    }
    request.state.resolved_auth_principal = principal
    return principal


def build_actor_context(
    authorization: Optional[str],
    payload: Optional[dict] = None,
) -> Dict[str, str]:
    """
    Build actor context from JWT only.
    No header fallback.
    """
    if not payload:
        return {
            "role": "",
            "name": "",
            "email": "",
            "username": "",
            "user_id": "",
            "profile_id": "",
            "school_id": "",
            "membership_id": "",
            "auth_source": "",
        }

    raw_profile_id = str(payload.get("profile_id") or "").strip()
    try:
        UUID(raw_profile_id)
    except (TypeError, ValueError, AttributeError):
        raw_profile_id = ""
    return {
        "role": str(payload.get("role") or "").strip().lower(),
        "name": str(payload.get("full_name") or payload.get("username") or payload.get("email") or "").strip(),
        "email": str(payload.get("email") or "").strip(),
        "username": str(payload.get("username") or "").strip(),
        "user_id": str(payload.get("sub") or "").strip(),
        "profile_id": raw_profile_id,
        "school_id": str(
            payload.get("school_id")
            or payload.get("school_uuid")
            or payload.get("active_school_id")
            or payload.get("current_school_id")
            or ""
        ).strip(),
        "membership_id": str(payload.get("membership_id") or "").strip(),
        "auth_source": "jwt",
    }


def get_actor_context(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, str]:
    return build_actor_context(authorization)


def _resolve_authorization_header(request: Request, di_header: Optional[str]) -> Optional[str]:
    """Resolve Authorization header from FastAPI DI or fall back to raw request headers.

    FastAPI's Header() dependency can miss the header if middleware transforms the
    ASGI scope.  Always fall back to request.headers.get() for robustness.
    """
    raw = request.headers.get("Authorization") or request.headers.get("authorization") or ""
    di = (di_header or "").strip()

    logger.info(
        "auth.header_resolve",
        extra={
            "di_value_preview": di[:50] if di else "(empty)",
            "raw_value_preview": raw[:50] if raw else "(empty)",
            "di_present": bool(di),
            "raw_present": bool(raw),
            "match": di == raw,
        },
    )
    # Trust the raw header over FastAPI DI (more reliable).
    if raw:
        return raw
    return di if di else None


def get_authenticated_user(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> User:
    if request.method == "OPTIONS":
        return User(
            id=0,
            username="preflight",
            email=None,
            full_name="CORS Preflight",
            password_hash="",
            role=UserRole.ADMIN,
            user_type="non_teaching",
            permissions="*",
            is_active=True,
            is_verified=True,
        )

    resolved_auth = _resolve_authorization_header(request, authorization)

    if not resolved_auth:
        logger.warning(
            "auth.missing_header",
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "all_headers": {k: v[:60] for k, v in request.headers.items()},
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    auth_header_present = bool(resolved_auth.strip())
    if not auth_header_present:
        logger.warning(
            "auth.empty_header",
            extra={
                "path": str(request.url.path),
                "method": request.method,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    parts = resolved_auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning(
            "auth.bad_header_format",
            extra={
                "path": str(request.url.path),
                "preview": resolved_auth[:60],
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
        )

    token = parts[1]
    logger.info("auth.token_extracted", extra={"preview": token[:30] + "..."})

    payload = getattr(request.state, "decoded_auth_payload", None)
    if payload is None:
        payload = decode_token(token)
        request.state.decoded_auth_payload = payload
    if not payload:
        logger.warning("auth.decode_failed", extra={"path": str(request.url.path)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
        )

    logger.info("auth.decode_succeeded", extra={"sub": str(payload.get("sub") or ""), "email": str(payload.get("email") or "")[:40]})

    if payload.get("type") not in {None, "access"}:
        logger.warning("auth.wrong_token_type", extra={"type": str(payload.get("type"))})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token type",
        )

    principal = _resolve_request_principal(request, payload, db)
    user = principal["user"]

    logger.info("auth.user_found", extra={"user_id": str(getattr(user, "id", "")), "email": str(getattr(user, "email", ""))[:40]})

    if not user.is_active:
        logger.warning(
            "auth.user_inactive",
            extra={
                "user_id": getattr(user, "id", ""),
                "username": user.username or "",
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user is inactive",
        )

    try:
        from app.services.supabase_account_security import validate_active_session

        profile_id = str(getattr(user, "profile_id", None) or getattr(user, "id", "") or "")
        validate_active_session(profile_id, request.headers.get("X-Active-Session"))
    except HTTPException:
        raise
    except Exception:
        pass

    return user


def build_authenticated_actor_context(user: User) -> Dict[str, str]:
    return {
        "role": (user.role.value if hasattr(user.role, "value") else str(user.role)).strip().lower(),
        "name": (user.full_name or user.username or user.email or "User").strip(),
        "email": (user.email or "").strip(),
        "username": (user.username or "").strip(),
        "user_id": str(user.id),
        "profile_id": str(getattr(user, "profile_id", None) or user.id),
        "school_id": "",
        "auth_source": "jwt",
    }


def get_authenticated_actor_context(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    if request.method == "OPTIONS":
        return {
            "role": UserRole.ADMIN.value,
            "name": "CORS Preflight",
            "email": "",
            "username": "preflight",
            "user_id": "0",
            "profile_id": "0",
            "school_id": "",
            "auth_source": "preflight",
        }

    resolved_auth = _resolve_authorization_header(request, authorization)
    logger.info("auth.actor_context_resolved", extra={"present": bool(resolved_auth)})

    payload = _get_request_token_payload(request, resolved_auth)
    actor = build_actor_context(resolved_auth, payload)
    if not actor.get("auth_source"):
        logger.warning(
            "auth.actor_context_missing",
            extra={"path": str(request.url.path), "method": request.method},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
        )
    if payload:
        try:
            principal = _resolve_request_principal(request, payload, db)
            resolved_actor = principal.get("actor") or {}
            for key in ("role", "name", "email", "username", "user_id", "profile_id", "school_id", "membership_id", "auth_source"):
                if resolved_actor.get(key):
                    actor[key] = str(resolved_actor.get(key))
        except HTTPException:
            # Keep JWT-derived actor context available for routes that only need claims.
            pass

    logger.info(
        "auth.actor_context_built",
        extra={
            "user_id": actor.get("user_id", ""),
            "role": actor.get("role", ""),
            "school_id": actor.get("school_id", ""),
        },
    )
    return actor


def _is_platform_admin_user(user: User) -> bool:
    return str(getattr(user, "role_key", "") or "").strip().lower() == "platform_admin"


def decode_user_permissions(user: User) -> list[str]:
    raw = (user.permissions or "").strip()
    if not raw:
        return []
    permissions: list[str] = []
    seen = set()
    for item in raw.split(","):
        value = item.strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        permissions.append(value)
    return permissions


def user_has_permission(user: User, permission: str) -> bool:
    if _is_platform_admin_user(user):
        return True
    if user.role == UserRole.ADMIN:
        return True

    wanted = (permission or "").strip().lower()
    if not wanted:
        return False

    permissions = decode_user_permissions(user)
    if wanted in permissions:
        return True

    return any(
        item.startswith(f"{wanted}.") or wanted.startswith(f"{item}.")
        for item in permissions
    )


def require_permissions(*permissions: str) -> Callable[[User], User]:
    normalized = [item.strip().lower() for item in permissions if item and item.strip()]

    def dependency(request: Request, user: User = Depends(get_authenticated_user)) -> User:
        if request.method == "OPTIONS":
            return user
        if _is_platform_admin_user(user):
            return user
        granted_permissions = decode_user_permissions(user)
        logger.info(
            "auth.permission_check",
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "user_id": str(getattr(user, "id", "")),
                "role": str(getattr(getattr(user, "role", ""), "value", getattr(user, "role", ""))),
                "required_permissions": normalized,
                "granted_permissions": granted_permissions,
                "username": getattr(user, "username", "") or "",
                "email": getattr(user, "email", "") or "",
            },
        )
        if user.role == UserRole.ADMIN:
            return user
        if not normalized:
            return user
        if any(user_has_permission(user, permission) for permission in normalized):
            return user
        logger.warning(
            "auth.permission_denied",
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "user_id": str(getattr(user, "id", "")),
                "role": str(getattr(getattr(user, "role", ""), "value", getattr(user, "role", ""))),
                "required_permissions": normalized,
                "granted_permissions": granted_permissions,
                "username": getattr(user, "username", "") or "",
                "email": getattr(user, "email", "") or "",
                "failure_reason": "missing_required_permission",
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )

    return dependency


def require_admin_actor(
    request: Request,
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if "platform_admin" in str(actor.get("role", "")).strip().lower():
        return actor
    if actor["role"] != UserRole.ADMIN.value:
        logger.warning(
            "auth.admin_actor_denied",
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "actor_user_id": str(actor.get("user_id") or ""),
                "actor_profile_id": str(actor.get("profile_id") or ""),
                "actor_role": str(actor.get("role") or ""),
                "failure_reason": "actor_not_admin",
            },
        )
        raise HTTPException(status_code=403, detail="Only admin can manage users")
    return actor
