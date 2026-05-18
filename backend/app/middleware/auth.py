"""
Middleware and shared auth helpers.
"""
from typing import Callable, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole
from app.utils.auth import decode_token


async def verify_token(request: Request) -> dict:
    """
    Verify JWT token from request headers.
    
    Returns:
        Decoded token payload
    
    Raises:
        HTTPException: If token is invalid or missing
    """
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    
    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header"
        )
    
    # Extract token
    tokens = auth_header.split()
    if len(tokens) != 2 or tokens[0].lower() != 'bearer':
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format"
        )
    
    token = tokens[1]
    
    # Decode and validate token
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
    """Best-effort JWT extraction from Authorization header."""
    if not authorization:
        return None

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    return decode_token(parts[1])


def build_actor_context(
    authorization: Optional[str],
    x_user_role: Optional[str],
    x_user_name: Optional[str],
) -> Dict[str, str]:
    """
    Build actor context using JWT first, with header fallback for compatibility.

    This keeps current modules working while shifting trust toward verified tokens.
    """
    payload = extract_token_payload(authorization)

    fallback_role = (x_user_role or UserRole.VIEWER.value).strip().lower()
    fallback_name = (x_user_name or "Unknown User").strip() or "Unknown User"

    if payload:
        token_role = str(payload.get("role") or fallback_role).strip().lower() or UserRole.ADMIN.value
        token_name = (
            str(payload.get("full_name") or payload.get("username") or payload.get("email") or fallback_name).strip()
            or fallback_name
        )
        return {
            "role": token_role,
            "name": token_name,
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

    return {
        "role": fallback_role,
        "name": fallback_name,
        "email": "",
        "username": "",
        "user_id": "",
        "profile_id": "",
        "school_id": "",
        "auth_source": "headers",
    }


def get_actor_context(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_user_role: Optional[str] = Header(default="viewer"),
    x_user_name: Optional[str] = Header(default="Unknown User"),
) -> Dict[str, str]:
    return build_actor_context(authorization, x_user_role, x_user_name)


def get_authenticated_user(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_user_role: Optional[str] = Header(default=None),
    x_user_name: Optional[str] = Header(default=None),
    x_user_email: Optional[str] = Header(default=None),
    x_user_permissions: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    payload = extract_token_payload(authorization)
    if payload:
        if payload.get("type") not in {None, "access"}:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token type",
            )

        user_id_raw = payload.get("sub")
        try:
            user_id = int(str(user_id_raw))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token payload",
            )

        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authenticated user is inactive or missing",
            )
        return user

    fallback_role = (x_user_role or "").strip().lower()
    fallback_name = (x_user_name or "").strip()
    fallback_email = (x_user_email or "").strip().lower()
    fallback_permissions = ",".join(
        item.strip().lower()
        for item in (x_user_permissions or "").split(",")
        if item and item.strip()
    )

    if not fallback_role or not fallback_name:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
        )

    role_aliases = {
        "platform_admin": UserRole.ADMIN.value,
        "school_admin": UserRole.ADMIN.value,
    }
    normalized_role = role_aliases.get(fallback_role, fallback_role)

    try:
        resolved_role = UserRole(normalized_role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token payload",
        )

    fallback_user = User(
        id=0,
        username=fallback_email.split("@")[0] if fallback_email and "@" in fallback_email else fallback_name.lower().replace(" ", "_"),
        email=fallback_email or None,
        full_name=fallback_name,
        password_hash="",
        role=resolved_role,
        user_type="non_teaching",
        permissions=fallback_permissions,
        is_active=True,
        is_verified=True,
    )
    return fallback_user


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
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    x_user_role: Optional[str] = Header(default=None),
    x_user_name: Optional[str] = Header(default=None),
) -> Dict[str, str]:
    actor = build_actor_context(authorization, x_user_role, x_user_name)
    has_verified_jwt = actor.get("auth_source") == "jwt"
    has_fallback_identity = bool((x_user_role or "").strip()) and bool((x_user_name or "").strip())

    if not has_verified_jwt and not has_fallback_identity:
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

    def dependency(user: User = Depends(get_authenticated_user)) -> User:
        if user.role == UserRole.ADMIN:
            return user
        if not normalized:
            return user
        if any(user_has_permission(user, permission) for permission in normalized):
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )

    return dependency


def require_admin_actor(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if actor["role"] != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Only admin can manage users")
    return actor
