"""
Middleware and shared auth helpers.

JWT-ONLY authentication. No header-based fallback.
No Supabase token fallback. No synthetic User objects.
"""
import logging
from typing import Callable, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, UserRole
from app.utils.auth import decode_token

logger = logging.getLogger(__name__)


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


def build_actor_context(
    authorization: Optional[str],
) -> Dict[str, str]:
    """
    Build actor context from JWT only.
    No header fallback.
    """
    payload = extract_token_payload(authorization)

    if not payload:
        return {
            "role": "",
            "name": "",
            "email": "",
            "username": "",
            "user_id": "",
            "profile_id": "",
            "school_id": "",
            "auth_source": "",
        }

    return {
        "role": str(payload.get("role") or "").strip().lower(),
        "name": str(payload.get("full_name") or payload.get("username") or payload.get("email") or "").strip(),
        "email": str(payload.get("email") or "").strip(),
        "username": str(payload.get("username") or "").strip(),
        "user_id": str(payload.get("sub") or "").strip(),
        "profile_id": str(payload.get("profile_id") or payload.get("sub") or "").strip(),
        "school_id": str(
            payload.get("school_id")
            or payload.get("school_uuid")
            or payload.get("active_school_id")
            or payload.get("current_school_id")
            or ""
        ).strip(),
        "auth_source": "jwt",
    }


def get_actor_context(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, str]:
    return build_actor_context(authorization)


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

    auth_header_present = bool((authorization or "").strip())
    if not auth_header_present:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
        )

    payload = extract_token_payload(authorization)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
        )

    if payload.get("type") not in {None, "access"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token type",
        )

    user_id_raw = payload.get("sub")
    try:
        user_id = int(str(user_id_raw))
    except (TypeError, ValueError):
        logger.warning(
            "auth.invalid_user_id_in_token",
            extra={"sub": str(user_id_raw or "")},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token payload",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(
            "auth.user_not_found",
            extra={"user_id": user_id},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user not found",
        )

    if not user.is_active:
        logger.warning(
            "auth.user_inactive",
            extra={
                "user_id": user_id,
                "username": user.username or "",
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user is inactive",
        )

    return user


def build_authenticated_actor_context(user: User) -> Dict[str, str]:
    return {
        "role": (user.role.value if hasattr(user.role, "value") else str(user.role)).strip().lower(),
        "name": (user.full_name or user.username or user.email or "User").strip(),
        "email": (user.email or "").strip(),
        "username": (user.username or "").strip(),
        "user_id": str(user.id),
        "profile_id": str(user.id),
        "school_id": "",
        "auth_source": "jwt",
    }


def get_authenticated_actor_context(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
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

    actor = build_actor_context(authorization)
    if not actor.get("auth_source"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
        )

    return actor


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
