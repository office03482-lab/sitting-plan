"""Authentication and role-power management routes."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import timedelta
import smtplib
from email.message import EmailMessage
from typing import Dict, List, Optional

from app.database import get_db
from app.models import Token, User, UserRole
from app.middleware.auth import require_admin_actor
from app.schemas import (
    LoginResponse,
    PasswordLoginRequest,
    SendOTPRequest,
    UserRolePowerCreate,
    UserRolePowerResponse,
    UserRolePowerUpdate,
    VerifyOTPRequest,
)
from app.utils.auth import create_access_token, generate_otp, hash_password, verify_password
from app.config import settings

router = APIRouter()

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


def ensure_admin_user(db: Session) -> User:
    admin = (
        db.query(User)
        .filter((User.username == "admin") | (User.email == "admin@school.edu"))
        .first()
    )
    if admin:
        if not admin.username:
            admin.username = "admin"
        if not admin.permissions:
            admin.permissions = "timetable,attendance"
        if not admin.user_type:
            admin.user_type = "non_teaching"
        if not admin.is_verified:
            admin.is_verified = True
        # Repair legacy admin credentials so password login always works.
        needs_password_reset = False
        try:
            if not verify_password("admin123", admin.password_hash):
                needs_password_reset = True
        except Exception:
            needs_password_reset = True
        if needs_password_reset:
            admin.password_hash = hash_password("admin123")
        db.commit()
        db.refresh(admin)
        return admin

    admin = User(
        username="admin",
        email="admin@school.edu",
        full_name="System Administrator",
        password_hash=hash_password("admin123"),
        role=UserRole.ADMIN,
        user_type="non_teaching",
        permissions="timetable,attendance",
        is_active=True,
        is_verified=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@router.post("/send-otp")
async def send_otp(request: SendOTPRequest, db: Session = Depends(get_db)):
    """
    Send OTP to email for login/registration
    """
    # TODO: Implement email sending
    
    # Check if user exists
    user = db.query(User).filter(User.email == request.email).first()
    
    # Generate OTP
    otp_code = generate_otp()
    
    # Store OTP in database
    token = Token(
        email=request.email,
        token=otp_code,
        token_type="otp",
        otp_code=otp_code,
        expires_at=__import__('datetime').datetime.utcnow() + timedelta(minutes=10)
    )
    db.add(token)
    db.commit()

    if not settings.smtp_email or not settings.smtp_password or settings.smtp_password in ["", "your-app-password"]:
        if settings.debug:
            print(f"DEBUG OTP for {request.email}: {otp_code}")
            return {
                "message": "OTP generated in debug mode. Update SMTP settings to send real email.",
                "email": request.email,
                "expires_in_minutes": 10,
                "debug_otp": otp_code,
            }

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SMTP is not configured. Set SMTP_EMAIL and SMTP_PASSWORD in .env."
        )

    # Send email with OTP
    try:
        msg = EmailMessage()
        msg["Subject"] = "Dr. Girish App - Your OTP for Verification"
        msg["From"] = settings.smtp_email
        msg["To"] = request.email
        msg.set_content(
            f"Your one-time login code is {otp_code}.\n\nThis code expires in 10 minutes."
        )

        with smtplib.SMTP(settings.smtp_server, settings.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_email, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Unable to send OTP email. Check SMTP settings and network access. "
                f"Error: {exc}"
            )
        )

    return {
        "message": "OTP sent to email",
        "email": request.email,
        "expires_in_minutes": 10,
    }


@router.post("/verify-otp", response_model=LoginResponse)
async def verify_otp(request: VerifyOTPRequest, db: Session = Depends(get_db)):
    """
    Verify OTP and create login session
    """
    # Check if OTP exists and is valid
    token = db.query(Token).filter(
        Token.email == request.email,
        Token.otp_code == request.otp_code,
        Token.token_type == "otp",
        Token.is_used == False,
        Token.expires_at > __import__('datetime').datetime.utcnow(),
    ).first()
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP"
        )
    
    # Mark OTP as used
    token.is_used = True
    token.used_at = __import__('datetime').datetime.utcnow()
    db.commit()
    
    # Find or create user
    user = db.query(User).filter(User.email == request.email).first()
    
    if not user:
        # Create new user from email
        user = User(
            email=request.email,
            full_name=request.email.split('@')[0],  # TODO: Get from form
            password_hash=hash_password(""),  # No password for OTP auth
            is_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    # Create access token
    access_token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "username": user.username,
        "full_name": user.full_name,
        "user_type": user.user_type or "non_teaching",
    })
    
    return LoginResponse(
        access_token=access_token,
        user_id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        role=user.role.value,
        user_type=user.user_type or "non_teaching",
        permissions=decode_permissions(user.permissions),
    )


@router.post("/login-password", response_model=LoginResponse)
async def login_password(payload: PasswordLoginRequest, db: Session = Depends(get_db)):
    ensure_admin_user(db)
    login_id = payload.username.strip()
    normalized_login_id = login_id.lower()
    if not normalized_login_id:
        raise HTTPException(status_code=400, detail="Username is required")

    user = (
        db.query(User)
        .filter(
            (func.lower(User.username) == normalized_login_id)
            | (func.lower(User.email) == normalized_login_id)
        )
        .first()
    )

    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    try:
        password_valid = verify_password(payload.password, user.password_hash)
    except Exception:
        password_valid = False

    if not password_valid:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")

    access_token = create_access_token(
        {
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
            "username": user.username,
            "full_name": user.full_name,
            "user_type": user.user_type or "non_teaching",
        }
    )
    return LoginResponse(
        access_token=access_token,
        user_id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        user_type=user.user_type or "non_teaching",
        permissions=decode_permissions(user.permissions),
    )


@router.get("/users", response_model=List[UserRolePowerResponse])
async def list_role_users(
    school_id: int = Query(default=1),
    _: Dict[str, str] = Depends(require_admin_actor),
    db: Session = Depends(get_db),
):
    ensure_admin_user(db)
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [serialize_role_user(item) for item in users]


@router.post("/users", response_model=UserRolePowerResponse)
async def create_role_user(
    payload: UserRolePowerCreate,
    _: Dict[str, str] = Depends(require_admin_actor),
    db: Session = Depends(get_db),
):
    ensure_admin_user(db)
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
    _: Dict[str, str] = Depends(require_admin_actor),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.role is not None:
        user.role = UserRole(validate_role_input(payload.role))
    if payload.user_type is not None:
        user.user_type = validate_user_type_input(payload.user_type)
    if payload.permissions is not None:
        user.permissions = encode_permissions(normalize_permissions(payload.permissions))
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    return serialize_role_user(user)


@router.delete("/users/{user_id}")
async def delete_role_user(
    user_id: int,
    _: Dict[str, str] = Depends(require_admin_actor),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.username or "").lower() == "admin":
        raise HTTPException(status_code=400, detail="Default admin cannot be deleted")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.post("/logout")
async def logout():
    """
    Logout user (client-side token management)
    """
    return {"message": "Logged out successfully"}
