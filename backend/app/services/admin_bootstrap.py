"""Environment-driven initial admin bootstrap helpers."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User, UserRole
from app.utils.auth import hash_password


def count_admin_users(db: Session) -> int:
    """Return the number of active admin users."""
    return (
        db.query(func.count(User.id))
        .filter(User.role == UserRole.ADMIN, User.is_active.is_(True))
        .scalar()
        or 0
    )


def bootstrap_initial_admin(db: Session) -> User:
    """Create the first admin user from environment variables when explicitly enabled."""
    if not settings.initial_admin_enabled:
        raise RuntimeError(
            "Initial admin bootstrap is disabled. Set INITIAL_ADMIN_ENABLED=true only for the one-time bootstrap command."
        )

    username = (settings.initial_admin_username or "").strip().lower()
    email = (settings.initial_admin_email or "").strip().lower()
    password = settings.initial_admin_password or ""
    full_name = (settings.initial_admin_full_name or "System Administrator").strip()

    if not username or not email or not password:
        raise RuntimeError(
            "INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD are required for bootstrap."
        )
    if len(password) < 12:
        raise RuntimeError("INITIAL_ADMIN_PASSWORD must be at least 12 characters long.")

    existing_username_user = db.query(User).filter(func.lower(User.username) == username).first()
    existing_email_user = db.query(User).filter(func.lower(User.email) == email).first()

    if existing_username_user or existing_email_user:
        existing_user = existing_username_user or existing_email_user
        if (
            existing_username_user
            and existing_email_user
            and existing_username_user.id != existing_email_user.id
        ):
            raise RuntimeError("Initial admin bootstrap conflict: username and email belong to different users.")
        if existing_user and existing_user.role == UserRole.ADMIN:
            return existing_user
        raise RuntimeError("Initial admin bootstrap conflict: the requested username or email is already in use.")

    admin = User(
        username=username,
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        user_type="non_teaching",
        permissions="admin_office,timetable,attendance,inventory,edupay,settings",
        is_active=True,
        is_verified=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin
