"""Authentication and role-power management routes."""
import logging
from email.message import EmailMessage
import smtplib
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from app.services.supabase_context import resolve_school_id_from_actor
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, UserRole
from app.middleware.auth import get_authenticated_user, user_has_permission
from app.services.auth_security import (
    assert_not_rate_limited,
    consume_otp,
    issue_auth_tokens,
    issue_email_otp,
    record_auth_event,
    register_failure,
    reset_failures,
    revoke_refresh_token,
    serialize_auth_detail,
    validate_refresh_token,
)
from app.schemas import (
    LoginResponse,
    LogoutRequest,
    PasswordLoginRequest,
    RefreshTokenRequest,
    SendOTPRequest,
    UserRolePowerCreate,
    UserRolePowerResponse,
    UserRolePowerUpdate,
    VerifyOTPRequest,
)
from app.utils.auth import hash_password, verify_password
from app.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


def require_user_management_access(
    user: User = Depends(get_authenticated_user),
) -> User:
    if user.role == UserRole.ADMIN or user_has_permission(user, "admin_office.access_control"):
        return user
    raise HTTPException(status_code=403, detail="Only admin or access-control users can manage users")

ALLOWED_USER_TYPES = {"teaching", "non_teaching"}
ALLOWED_ROLE_VALUES = {item.value for item in UserRole}
ALLOWED_PERMISSIONS = {
    "admin_office",
    "admin_office.seating_generation",
    "admin_office.seating_plans",
    "admin_office.seating_comparison",
    "admin_office.rooms",
    "admin_office.batches",
    "admin_office.students",
    "admin_office.hostels",
    "admin_office.teachers",
    "admin_office.invigilators",
    "admin_office.non_teaching",
    "admin_office.reports",
    "admin_office.access_control",
    "timetable",
    "timetable.view",
    "timetable.manage",
    "attendance",
    "attendance.overview",
    "attendance.student",
    "attendance.staff",
    "attendance.leaves",
    "attendance.reports",
    "inventory",
    "inventory.dashboard",
    "inventory.materials",
    "inventory.suppliers",
    "inventory.stock_in",
    "inventory.stock_out",
    "inventory.reports",
    "edupay",
    "edupay.dashboard",
    "edupay.students",
    "edupay.fees",
    "edupay.payments",
    "edupay.parent_portal",
    "settings",
}

PERMISSION_CHILDREN = {
    "admin_office": [
        "admin_office.seating_generation",
        "admin_office.seating_plans",
        "admin_office.seating_comparison",
        "admin_office.rooms",
        "admin_office.batches",
        "admin_office.students",
        "admin_office.hostels",
        "admin_office.teachers",
        "admin_office.invigilators",
        "admin_office.non_teaching",
        "admin_office.reports",
        "admin_office.access_control",
    ],
    "timetable": ["timetable.view", "timetable.manage"],
    "attendance": [
        "attendance.overview",
        "attendance.student",
        "attendance.staff",
        "attendance.leaves",
        "attendance.reports",
    ],
    "inventory": [
        "inventory.dashboard",
        "inventory.materials",
        "inventory.suppliers",
        "inventory.stock_in",
        "inventory.stock_out",
        "inventory.reports",
    ],
    "edupay": [
        "edupay.dashboard",
        "edupay.students",
        "edupay.fees",
        "edupay.payments",
        "edupay.parent_portal",
    ],
}


def normalize_permissions(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    cleaned: List[str] = []
    seen = set()
    for item in values:
        value = (item or "").strip().lower()
        if value not in ALLOWED_PERMISSIONS or value in seen:
            continue
        seen.add(value)
        cleaned.append(value)

    cleaned_set = set(cleaned)
    for parent, children in PERMISSION_CHILDREN.items():
        if parent not in cleaned_set:
            continue
        selected_children = [child for child in children if child in cleaned_set]
        if selected_children and len(selected_children) < len(children):
            cleaned = [item for item in cleaned if item != parent]
            cleaned_set.discard(parent)
    return cleaned


def encode_permissions(values: List[str]) -> str:
    return ",".join(values)


def decode_permissions(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return normalize_permissions(value.split(","))


def validate_role_input(role: str) -> str:
    normalized = (role or "").strip().lower()
    if normalized not in ALLOWED_ROLE_VALUES:
        raise HTTPException(status_code=400, detail="Unsupported role")
    return normalized


def validate_user_type_input(user_type: str) -> str:
    normalized = (user_type or "").strip().lower()
    if normalized not in ALLOWED_USER_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported user_type")
    return normalized


def serialize_role_user(user: User) -> UserRolePowerResponse:
    fallback_username = (
        user.username
        or (user.email.split("@")[0] if user.email and "@" in user.email else None)
        or f"user_{user.id}"
    )
    return UserRolePowerResponse(
        id=user.id,
        username=fallback_username,
        full_name=user.full_name,
        email=user.email,
        password="",
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        user_type=user.user_type or "non_teaching",
        permissions=decode_permissions(user.permissions),
        is_active=user.is_active,
        created_at=user.created_at,
    )


def build_login_response(user: User, *, access_token: str, refresh_token: str) -> LoginResponse:
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_in_seconds=settings.access_token_expiration_minutes * 60,
        refresh_token_expires_in_seconds=settings.refresh_token_expiration_days * 24 * 60 * 60,
        user_id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        user_type=user.user_type or "non_teaching",
        permissions=decode_permissions(user.permissions),
    )


@router.post("/send-otp")
async def send_otp(payload: SendOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Send OTP to email for login/registration
    """
    normalized_email = payload.email.strip().lower()
    assert_not_rate_limited(db, action="otp_send", email=normalized_email, request=request)
    user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    otp_code = issue_email_otp(db, email=normalized_email, request=request)

    if not settings.smtp_email or not settings.smtp_password or settings.smtp_password in ["", "your-app-password"]:
        if settings.debug:
            logger.info("DEBUG OTP for %s: %s", normalized_email, otp_code)
            record_auth_event(
                db,
                event_type="otp_send",
                outcome="debug_generated",
                email=normalized_email,
                user=user,
                request=request,
            )
            db.commit()
            return {
                "message": "OTP generated in debug mode. Update SMTP settings to send real email.",
                "email": normalized_email,
                "expires_in_minutes": settings.otp_expiration_minutes,
                "debug_otp": otp_code,
            }

        register_failure(
            db,
            action="otp_send",
            email=normalized_email,
            request=request,
            email_max_attempts=settings.otp_send_max_attempts,
            ip_max_attempts=settings.otp_send_max_attempts,
        )
        record_auth_event(
            db,
            event_type="otp_send",
            outcome="smtp_unavailable",
            email=normalized_email,
            user=user,
            request=request,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SMTP is not configured. Set SMTP_EMAIL and SMTP_PASSWORD in .env."
        )

    # Send email with OTP
    try:
        msg = EmailMessage()
        msg["Subject"] = "Dr. Girish App - Your OTP for Verification"
        msg["From"] = settings.smtp_email
        msg["To"] = normalized_email
        msg.set_content(
            f"Your one-time login code is {otp_code}.\n\nThis code expires in {settings.otp_expiration_minutes} minutes."
        )

        with smtplib.SMTP(settings.smtp_server, settings.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_email, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as exc:
        register_failure(
            db,
            action="otp_send",
            email=normalized_email,
            request=request,
            email_max_attempts=settings.otp_send_max_attempts,
            ip_max_attempts=settings.otp_send_max_attempts,
        )
        record_auth_event(
            db,
            event_type="otp_send",
            outcome="send_failed",
            email=normalized_email,
            user=user,
            request=request,
            detail=str(exc),
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Unable to send OTP email. Check SMTP settings and network access. "
                f"Error: {exc}"
            )
        )

    reset_failures(db, action="otp_send", email=normalized_email, request=request)
    record_auth_event(
        db,
        event_type="otp_send",
        outcome="success",
        email=normalized_email,
        user=user,
        request=request,
    )
    db.commit()

    return {
        "message": "OTP sent to email",
        "email": normalized_email,
        "expires_in_minutes": settings.otp_expiration_minutes,
    }


@router.post("/verify-otp", response_model=LoginResponse)
async def verify_otp(payload: VerifyOTPRequest, request: Request, db: Session = Depends(get_db)):
    """
    Verify OTP and create login session
    """
    normalized_email = payload.email.strip().lower()
    assert_not_rate_limited(db, action="otp_verify", email=normalized_email, request=request)
    try:
        consume_otp(db, email=normalized_email, otp_code=payload.otp_code)
    except HTTPException:
        register_failure(
            db,
            action="otp_verify",
            email=normalized_email,
            request=request,
            email_max_attempts=settings.otp_verify_max_attempts,
            ip_max_attempts=settings.otp_verify_max_attempts,
        )
        record_auth_event(
            db,
            event_type="otp_verify",
            outcome="failed",
            email=normalized_email,
            request=request,
        )
        db.commit()
        raise

    user = db.query(User).filter(func.lower(User.email) == normalized_email).first()
    
    if not user:
        # Create new user from email
        user = User(
            email=normalized_email,
            full_name=normalized_email.split('@')[0],
            password_hash=hash_password(""),  # No password for OTP auth
            is_verified=True,
        )
        db.add(user)

    reset_failures(db, action="otp_verify", email=normalized_email, request=request)
    tokens = issue_auth_tokens(db, user=user, request=request)
    record_auth_event(
        db,
        event_type="otp_verify",
        outcome="success",
        email=normalized_email,
        user=user,
        request=request,
    )
    db.commit()
    db.refresh(user)

    return build_login_response(
        user,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )


@router.post("/login-password", response_model=LoginResponse)
async def login_password(payload: PasswordLoginRequest, request: Request, db: Session = Depends(get_db)):
    login_id = payload.username.strip()
    normalized_login_id = login_id.lower()
    if not normalized_login_id:
        raise HTTPException(status_code=400, detail="Username is required")

    assert_not_rate_limited(db, action="login_password", email=normalized_login_id, request=request)
    user = (
        db.query(User)
        .filter(
            (func.lower(User.username) == normalized_login_id)
            | (func.lower(User.email) == normalized_login_id)
        )
        .first()
    )

    if not user:
        register_failure(
            db,
            action="login_password",
            email=normalized_login_id,
            request=request,
            email_max_attempts=settings.login_max_attempts,
            ip_max_attempts=settings.login_ip_max_attempts,
        )
        record_auth_event(
            db,
            event_type="login_password",
            outcome="unknown_user",
            email=normalized_login_id,
            request=request,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid username or password")

    try:
        password_valid = verify_password(payload.password, user.password_hash)
    except Exception:
        password_valid = False

    if not password_valid:
        register_failure(
            db,
            action="login_password",
            email=normalized_login_id,
            request=request,
            email_max_attempts=settings.login_max_attempts,
            ip_max_attempts=settings.login_ip_max_attempts,
        )
        record_auth_event(
            db,
            event_type="login_password",
            outcome="invalid_password",
            email=normalized_login_id,
            user=user,
            request=request,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        record_auth_event(
            db,
            event_type="login_password",
            outcome="inactive_user",
            email=normalized_login_id,
            user=user,
            request=request,
        )
        db.commit()
        raise HTTPException(status_code=403, detail="User is inactive")

    reset_failures(db, action="login_password", email=normalized_login_id, request=request)
    tokens = issue_auth_tokens(db, user=user, request=request)
    record_auth_event(
        db,
        event_type="login_password",
        outcome="success",
        email=user.email,
        user=user,
        request=request,
    )
    db.commit()
    return build_login_response(
        user,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )


@router.get("/users", response_model=List[UserRolePowerResponse])
async def list_role_users(
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_user_management_access),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [serialize_role_user(item) for item in users]


@router.post("/users", response_model=UserRolePowerResponse)
async def create_role_user(
    payload: UserRolePowerCreate,
    _: User = Depends(require_user_management_access),
    db: Session = Depends(get_db),
):
    username = payload.username.strip().lower()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    role_value = validate_role_input(payload.role)
    user_type = validate_user_type_input(payload.user_type)
    permissions = normalize_permissions(payload.permissions)
    if not permissions:
        raise HTTPException(status_code=400, detail="At least one permission is required")

    email = (payload.email or f"{username}@local.app").strip().lower()
    if db.query(User).filter(User.email == email).first():
        email = f"{username}+{int(__import__('time').time())}@local.app"

    user = User(
        username=username,
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=UserRole(role_value),
        user_type=user_type,
        permissions=encode_permissions(permissions),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return serialize_role_user(user)


@router.put("/users/{user_id}", response_model=UserRolePowerResponse)
async def update_role_user(
    user_id: int,
    payload: UserRolePowerUpdate,
    actor_user: User = Depends(require_user_management_access),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.role is not None:
        next_role = UserRole(validate_role_input(payload.role))
        if user.role == UserRole.ADMIN and next_role != UserRole.ADMIN:
            active_admin_count = (
                db.query(User)
                .filter(User.role == UserRole.ADMIN, User.is_active.is_(True), User.id != user.id)
                .count()
            )
            if active_admin_count < 1:
                raise HTTPException(status_code=400, detail="At least one active admin user must remain")
            if str(actor_user.id) == str(user.id):
                raise HTTPException(status_code=400, detail="You cannot remove your own admin role")
        user.role = next_role
    if payload.user_type is not None:
        user.user_type = validate_user_type_input(payload.user_type)
    if payload.permissions is not None:
        user.permissions = encode_permissions(normalize_permissions(payload.permissions))
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        if (
            user.role == UserRole.ADMIN
            and payload.is_active is False
            and str(actor_user.id) == str(user.id)
        ):
            raise HTTPException(status_code=400, detail="You cannot deactivate your own admin account")
        if user.role == UserRole.ADMIN and payload.is_active is False:
            active_admin_count = (
                db.query(User)
                .filter(User.role == UserRole.ADMIN, User.is_active.is_(True), User.id != user.id)
                .count()
            )
            if active_admin_count < 1:
                raise HTTPException(status_code=400, detail="At least one active admin user must remain")
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    return serialize_role_user(user)


@router.delete("/users/{user_id}")
async def delete_role_user(
    user_id: int,
    _: User = Depends(require_user_management_access),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    admin_users = db.query(User).filter(User.role == UserRole.ADMIN, User.is_active.is_(True)).all()
    if user.role == UserRole.ADMIN and len(admin_users) <= 1:
        raise HTTPException(status_code=400, detail="At least one active admin user must remain")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.post("/refresh", response_model=LoginResponse)
async def refresh_session(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        token_payload, record, user = validate_refresh_token(db, refresh_token=payload.refresh_token)
    except HTTPException as exc:
        record_auth_event(
            db,
            event_type="refresh_token",
            outcome="failed",
            request=request,
            detail=str(exc.detail),
        )
        db.commit()
        raise
    tokens = issue_auth_tokens(db, user=user, request=request, previous_refresh_record=record)
    record_auth_event(
        db,
        event_type="refresh_token",
        outcome="success",
        email=user.email,
        user=user,
        request=request,
        detail=serialize_auth_detail({"family": token_payload.get("family")}),
    )
    db.commit()
    db.refresh(user)
    return build_login_response(
        user,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )


@router.post("/logout")
async def logout(
    request: Request,
    payload: Optional[LogoutRequest] = None,
    db: Session = Depends(get_db),
):
    """
    Logout user and invalidate the supplied refresh token when present.
    """
    refresh_token = payload.refresh_token if payload else None
    if refresh_token:
        token_record = revoke_refresh_token(db, refresh_token=refresh_token)
        if token_record:
            user = db.query(User).filter(User.id == token_record.user_id).first() if token_record.user_id else None
            record_auth_event(
                db,
                event_type="logout",
                outcome="success",
                email=token_record.email,
                user=user,
                request=request,
            )
            db.commit()
            return {"message": "Logged out successfully"}
    if db.new or db.dirty:
        db.commit()
    return {"message": "Logged out successfully"}
