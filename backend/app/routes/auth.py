"""Authentication and role-power management routes."""
import logging
from email.message import EmailMessage
import smtplib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from app.services.supabase_context import resolve_school_id_from_actor
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, UserRole
from app.middleware.auth import get_authenticated_user, user_has_permission
from app.services.supabase_admin import create_supabase_admin_client
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
    ModulePermissionInfo,
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
    request: Request,
    user: User = Depends(get_authenticated_user),
) -> User:
    if user.role == UserRole.ADMIN or user_has_permission(user, "admin_office.access_control"):
        return user
    logger.warning(
        "auth.user_management_access_denied",
        extra={
            "path": str(request.url.path),
            "method": request.method,
            "user_id": str(getattr(user, "id", "")),
            "role": str(getattr(getattr(user, "role", ""), "value", getattr(user, "role", ""))),
            "granted_permissions": getattr(user, "permissions", "") or "",
            "failure_reason": "missing_access_control_permission",
        },
    )
    raise HTTPException(status_code=403, detail="Only admin or access-control users can manage users")

ALLOWED_USER_TYPES = {"teaching", "non_teaching", "student"}
ROLE_ALIASES = {
    "admin": "school_admin",
}
ALLOWED_ROLE_VALUES = {
    "platform_admin",
    "school_admin",
    "teacher",
    "staff",
    "student",
    "parent",
    "store_manager",
    "viewer",
}
ADMIN_ROLE_VALUES = {"platform_admin", "school_admin"}
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
    "online_tests",
    "online_tests.view",
    "online_tests.manage",
    "online_tests.attempt",
    "online_tests.grade",
    "online_tests.reports",
    "live_classes",
    "live_classes.view",
    "live_classes.manage",
    "live_classes.join",
    "live_classes.attendance",
    "live_classes.reports",
    "study_planner",
    "study_planner.view",
    "study_planner.goals",
    "study_planner.reports",
    "ai_tutor",
    "ai_tutor.chat",
    "ai_tutor.review",
    "ai_tutor.manage",
    "doubt_solver",
    "doubt_solver.solve",
    "doubt_solver.review",
    "doubt_solver.manage",
    "doubt_solver.escalate",
    "teacher_ai",
    "teacher_ai.generate",
    "teacher_ai.evaluate",
    "teacher_ai.reports",
    "parent_intelligence",
    "parent_intelligence.view",
    "parent_intelligence.alerts",
    "parent_intelligence.communication",
    "parent_intelligence.reports",
    "lms",
    "lms.view",
    "lms.manage",
    "lms.progress",
    "lms.assignments",
    "edupay",
    "edupay.dashboard",
    "edupay.students",
    "edupay.fees",
    "edupay.payments",
    "edupay.parent_portal",
    "edupay.commerce",
    "edupay.subscriptions",
    "edupay.revenue",
    "bi",
    "bi.academic",
    "bi.finance",
    "bi.operations",
    "bi.platform",
    "bi.reports",
    "predictions",
    "predictions.student",
    "predictions.campus",
    "predictions.finance",
    "predictions.manage",
    "ai_agents",
    "ai_agents.view",
    "ai_agents.run",
    "ai_agents.approve",
    "ai_agents.reports",
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
    "online_tests": [
        "online_tests.view",
        "online_tests.manage",
        "online_tests.attempt",
        "online_tests.grade",
        "online_tests.reports",
    ],
    "live_classes": [
        "live_classes.view",
        "live_classes.manage",
        "live_classes.join",
        "live_classes.attendance",
        "live_classes.reports",
    ],
    "study_planner": [
        "study_planner.view",
        "study_planner.goals",
        "study_planner.reports",
    ],
    "ai_tutor": [
        "ai_tutor.chat",
        "ai_tutor.review",
        "ai_tutor.manage",
    ],
    "doubt_solver": [
        "doubt_solver.solve",
        "doubt_solver.review",
        "doubt_solver.manage",
        "doubt_solver.escalate",
    ],
    "teacher_ai": [
        "teacher_ai.generate",
        "teacher_ai.evaluate",
        "teacher_ai.reports",
    ],
    "parent_intelligence": [
        "parent_intelligence.view",
        "parent_intelligence.alerts",
        "parent_intelligence.communication",
        "parent_intelligence.reports",
    ],
    "lms": [
        "lms.view",
        "lms.manage",
        "lms.progress",
        "lms.assignments",
    ],
    "edupay": [
        "edupay.dashboard",
        "edupay.students",
        "edupay.fees",
        "edupay.payments",
        "edupay.parent_portal",
        "edupay.commerce",
        "edupay.subscriptions",
        "edupay.revenue",
    ],
    "bi": [
        "bi.academic",
        "bi.finance",
        "bi.operations",
        "bi.platform",
        "bi.reports",
    ],
    "predictions": [
        "predictions.student",
        "predictions.campus",
        "predictions.finance",
        "predictions.manage",
    ],
    "ai_agents": [
        "ai_agents.view",
        "ai_agents.run",
        "ai_agents.approve",
        "ai_agents.reports",
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


def _make_permission_label(key: str) -> str:
    return " ".join(word.capitalize() for word in key.split("_"))


def validate_role_input(role: str) -> str:
    normalized = ROLE_ALIASES.get((role or "").strip().lower(), (role or "").strip().lower())
    if normalized not in ALLOWED_ROLE_VALUES:
        raise HTTPException(status_code=400, detail="Unsupported role")
    return normalized


def validate_user_type_input(user_type: str) -> str:
    normalized = (user_type or "").strip().lower()
    if normalized not in ALLOWED_USER_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported user_type")
    return normalized


def coerce_user_type_for_role(role: str, user_type: str) -> str:
    normalized_user_type = validate_user_type_input(user_type)
    if role == "teacher":
        return "teaching"
    if role == "student":
        return "student"
    return normalized_user_type if normalized_user_type != "student" else "non_teaching"


def _normalize_supabase_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_supabase_role_key(value: str) -> str:
    return (value or "").strip().lower()


def _legacy_role_for_selected_role(role_key: str) -> str:
    if role_key in ADMIN_ROLE_VALUES:
        return "admin"
    if role_key == "teacher":
        return "teacher"
    if role_key == "store_manager":
        return "store_manager"
    return "viewer"


def _selected_role_from_supabase_role(role_row: dict[str, Any] | None) -> str:
    if not isinstance(role_row, dict):
        return "viewer"
    metadata = role_row.get("metadata")
    if isinstance(metadata, dict):
        selected_role = _normalize_supabase_text(metadata.get("role_key")).lower()
        if selected_role in ALLOWED_ROLE_VALUES:
            return selected_role
        legacy_role = _normalize_supabase_text(metadata.get("legacy_role")).lower()
        if legacy_role == "admin":
            return "school_admin"
        if legacy_role in {"teacher", "store_manager", "viewer"}:
            return legacy_role
    role_key = _normalize_supabase_role_key(role_row.get("role_key") or "")
    if role_key in ALLOWED_ROLE_VALUES:
        return role_key
    return "viewer"


def _managed_role_key_for_profile(profile_id: str) -> str:
    sanitized = "".join(ch for ch in _normalize_supabase_text(profile_id).lower() if ch.isalnum())
    return f"managed_{sanitized[:24] or 'user'}"


def _load_permission_id_map(supabase=None) -> dict[str, str]:
    supabase = supabase or create_supabase_admin_client()
    response = supabase.table("permissions").select("id,permission_key").execute()
    result: dict[str, str] = {}
    for row in list(response.data or []):
        key = _normalize_supabase_text(row.get("permission_key")).lower()
        value = _normalize_supabase_text(row.get("id"))
        if key and value:
            result[key] = value
    return result


def _load_role_permissions_map(role_ids: list[str], supabase=None) -> dict[str, list[str]]:
    ids = [item for item in role_ids if item]
    if not ids:
        return {}
    supabase = supabase or create_supabase_admin_client()
    response = (
        supabase
        .table("role_permissions")
        .select("role_id,permissions(permission_key)")
        .in_("role_id", ids)
        .execute()
    )
    result: dict[str, list[str]] = {}
    for row in list(response.data or []):
        role_id = _normalize_supabase_text(row.get("role_id"))
        permission_data = row.get("permissions")
        permission_key = (
            _normalize_supabase_text(permission_data.get("permission_key")).lower()
            if isinstance(permission_data, dict)
            else ""
        )
        if role_id and permission_key:
            result.setdefault(role_id, [])
            if permission_key not in result[role_id]:
                result[role_id].append(permission_key)
    return result


def _load_school_role_user_rows(school_id: str, supabase=None) -> list[dict[str, Any]]:
    supabase = supabase or create_supabase_admin_client()
    response = (
        supabase
        .table("school_memberships")
        .select(
            """
            id,
            school_id,
            profile_id,
            role_id,
            status,
            is_primary,
            is_active,
            created_at,
            updated_at,
            profiles!school_memberships_profile_id_fkey (
              id,
              email,
              full_name,
              display_name,
              metadata,
              is_active
            ),
            roles (
              id,
              role_key,
              role_name,
              metadata,
              is_active
            )
            """
        )
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [dict(row) for row in list(response.data or [])]


def _serialize_supabase_role_user(
    membership_row: dict[str, Any],
    permissions_by_role: dict[str, list[str]],
    *,
    plain_password: str = "",
) -> UserRolePowerResponse:
    profile = membership_row.get("profiles")
    if isinstance(profile, list):
        profile = profile[0] if profile else {}
    if not isinstance(profile, dict):
        profile = {}
    role = membership_row.get("roles")
    if isinstance(role, list):
        role = role[0] if role else {}
    if not isinstance(role, dict):
        role = {}

    profile_metadata = profile.get("metadata")
    if not isinstance(profile_metadata, dict):
        profile_metadata = {}

    username = (
        _normalize_supabase_text(profile_metadata.get("username"))
        or _normalize_supabase_text(profile.get("display_name"))
        or _normalize_supabase_text(profile.get("email")).split("@")[0]
        or f"user_{_normalize_supabase_text(profile.get('id'))[:8]}"
    )
    role_id = _normalize_supabase_text(membership_row.get("role_id"))
    normalized_user_type = _normalize_supabase_text(profile_metadata.get("user_type")).lower()
    if normalized_user_type not in ALLOWED_USER_TYPES:
        normalized_user_type = "non_teaching"

    return UserRolePowerResponse(
        id=_normalize_supabase_text(profile.get("id")),
        username=username,
        full_name=_normalize_supabase_text(profile.get("full_name")) or username,
        email=_normalize_supabase_text(profile.get("email")) or None,
        password=plain_password,
        role=_selected_role_from_supabase_role(role),
        user_type=normalized_user_type,
        permissions=normalize_permissions(permissions_by_role.get(role_id, [])),
        is_active=bool(membership_row.get("is_active", True) and profile.get("is_active", True)),
        created_at=membership_row.get("created_at"),
    )


def _find_membership_or_404(school_id: str, profile_id: str, supabase=None) -> dict[str, Any]:
    rows = [
        row
        for row in _load_school_role_user_rows(school_id, supabase)
        if _normalize_supabase_text(row.get("profile_id")) == profile_id
    ]
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    return rows[0]


def _count_active_admins(rows: list[dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        role = row.get("roles")
        if isinstance(role, list):
            role = role[0] if role else {}
        if not isinstance(role, dict):
            role = {}
        if _selected_role_from_supabase_role(role) in ADMIN_ROLE_VALUES and bool(row.get("is_active", True)):
            count += 1
    return count


def _ensure_managed_role(
    school_id: str,
    profile_id: str,
    *,
    full_name: str,
    selected_role: str,
    user_type: str,
    permissions: list[str],
    metadata_updates: dict[str, Any] | None = None,
    supabase=None,
) -> dict[str, Any]:
    supabase = supabase or create_supabase_admin_client()
    role_key = _managed_role_key_for_profile(profile_id)
    legacy_role = _legacy_role_for_selected_role(selected_role)
    role_name = f"{selected_role.replace('_', ' ').title()} - {full_name or profile_id[:8]}"
    role_response = (
        supabase.table("roles")
        .select("*")
        .eq("school_id", school_id)
        .eq("role_key", role_key)
        .limit(1)
        .execute()
    )
    rows = list(role_response.data or [])
    role_payload = {
        "school_id": school_id,
        "role_key": role_key,
        "role_name": role_name[:120],
        "description": f"Managed Access Control role for {full_name or profile_id}",
        "scope": "school",
        "is_system": False,
        "is_active": True,
        "metadata": {
            "role_key": selected_role,
            "legacy_role": legacy_role,
            "user_type": user_type,
            "managed_by": "access_control",
            "profile_id": profile_id,
            **(metadata_updates or {}),
        },
    }
    if rows:
        role_row = dict(rows[0])
        supabase.table("roles").update(role_payload).eq("id", role_row["id"]).execute()
        role_id = _normalize_supabase_text(role_row.get("id"))
    else:
        created = supabase.table("roles").insert(role_payload).execute()
        created_rows = list(created.data or [])
        if not created_rows:
            raise HTTPException(status_code=500, detail="Failed to create managed role")
        role_id = _normalize_supabase_text(created_rows[0].get("id"))

    supabase.table("role_permissions").delete().eq("role_id", role_id).execute()
    permission_map = _load_permission_id_map(supabase)
    permission_rows = [
        {"role_id": role_id, "permission_id": permission_map[permission_key]}
        for permission_key in normalize_permissions(permissions)
        if permission_key in permission_map
    ]
    if permission_rows:
        supabase.table("role_permissions").insert(permission_rows).execute()

    refreshed = (
        supabase.table("roles")
        .select("*")
        .eq("id", role_id)
        .limit(1)
        .execute()
    )
    refreshed_rows = list(refreshed.data or [])
    if not refreshed_rows:
        raise HTTPException(status_code=500, detail="Failed to reload managed role")
    return dict(refreshed_rows[0])


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
        logger.warning(
            "auth.user_inactive",
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "user_id": str(user.id),
                "role": str(user.role.value if hasattr(user.role, "value") else user.role),
                "failure_reason": "inactive_user",
            },
        )
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
):
    supabase = create_supabase_admin_client()
    membership_rows = _load_school_role_user_rows(school_id, supabase)
    role_ids = [_normalize_supabase_text(row.get("role_id")) for row in membership_rows]
    permissions_by_role = _load_role_permissions_map(role_ids, supabase)
    return [
        _serialize_supabase_role_user(row, permissions_by_role)
        for row in membership_rows
    ]


@router.post("/users", response_model=UserRolePowerResponse)
async def create_role_user(
    payload: UserRolePowerCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_user_management_access),
):
    username = payload.username.strip().lower()
    supabase = create_supabase_admin_client()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    role_value = validate_role_input(payload.role)
    user_type = coerce_user_type_for_role(role_value, payload.user_type)
    permissions = normalize_permissions(payload.permissions)
    if not permissions:
        raise HTTPException(status_code=400, detail="At least one permission is required")

    email = (payload.email or f"{username}@local.app").strip().lower()
    try:
        user_response = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": payload.full_name.strip(),
                    "display_name": username,
                    "username": username,
                },
            }
        )
    except Exception as exc:
        message = str(exc).strip() or "Failed to create user account"
        normalized_message = message.lower()
        if "already" in normalized_message or "duplicate" in normalized_message:
            raise HTTPException(status_code=400, detail="Username or email already exists") from exc
        raise HTTPException(status_code=500, detail=message) from exc
    created_user = getattr(user_response, "user", None)
    profile_id = _normalize_supabase_text(getattr(created_user, "id", None))
    if not profile_id:
        raise HTTPException(status_code=500, detail="Failed to create user account")

    role_row = _ensure_managed_role(
        school_id,
        profile_id,
        full_name=payload.full_name.strip(),
        selected_role=role_value,
        user_type=user_type,
        permissions=permissions,
        supabase=supabase,
    )
    supabase.table("profiles").update(
        {
            "full_name": payload.full_name.strip(),
            "display_name": username,
            "is_active": True,
            "metadata": {
                "username": username,
                "user_type": user_type,
            },
        }
    ).eq("id", profile_id).execute()
    membership_insert = supabase.table("school_memberships").insert(
        {
            "school_id": school_id,
            "profile_id": profile_id,
            "role_id": role_row["id"],
            "status": "active",
            "is_primary": False,
            "is_active": True,
            "metadata": {"source": "access_control"},
        }
    ).execute()
    membership_rows = list(membership_insert.data or [])
    membership_row = dict(membership_rows[0]) if membership_rows else {
        "school_id": school_id,
        "profile_id": profile_id,
        "role_id": role_row["id"],
        "status": "active",
        "is_primary": False,
        "is_active": True,
    }
    membership_row["profiles"] = {
        "id": profile_id,
        "email": email,
        "full_name": payload.full_name.strip(),
        "display_name": username,
        "metadata": {"username": username, "user_type": user_type},
        "is_active": True,
    }
    membership_row["roles"] = role_row
    permissions_by_role = {role_row["id"]: permissions}
    return _serialize_supabase_role_user(membership_row, permissions_by_role, plain_password=payload.password)


@router.put("/users/{user_id}", response_model=UserRolePowerResponse)
async def update_role_user(
    user_id: str,
    payload: UserRolePowerUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor_user: User = Depends(require_user_management_access),
):
    supabase = create_supabase_admin_client()
    membership_rows = _load_school_role_user_rows(school_id, supabase)
    membership = next((row for row in membership_rows if _normalize_supabase_text(row.get("profile_id")) == user_id), None)
    if not membership:
        raise HTTPException(status_code=404, detail="User not found")

    role = membership.get("roles")
    if isinstance(role, list):
        role = role[0] if role else {}
    if not isinstance(role, dict):
        role = {}
    current_role = _selected_role_from_supabase_role(role)
    next_role = validate_role_input(payload.role) if payload.role is not None else current_role

    if current_role in ADMIN_ROLE_VALUES and next_role not in ADMIN_ROLE_VALUES:
        if _count_active_admins(membership_rows) < 2:
            raise HTTPException(status_code=400, detail="At least one active admin user must remain")
        if _normalize_supabase_text(getattr(actor_user, "profile_id", None) or actor_user.id) == user_id:
            raise HTTPException(status_code=400, detail="You cannot remove your own admin role")

    if payload.is_active is False and current_role in ADMIN_ROLE_VALUES:
        if _count_active_admins(membership_rows) < 2:
            raise HTTPException(status_code=400, detail="At least one active admin user must remain")
        if _normalize_supabase_text(getattr(actor_user, "profile_id", None) or actor_user.id) == user_id:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own admin account")

    profile = membership.get("profiles")
    if isinstance(profile, list):
        profile = profile[0] if profile else {}
    if not isinstance(profile, dict):
        profile = {}
    metadata = profile.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    metadata = dict(metadata)

    if payload.user_type is not None:
        metadata["user_type"] = validate_user_type_input(payload.user_type)

    username = _normalize_supabase_text(metadata.get("username")) or _normalize_supabase_text(profile.get("display_name"))
    if payload.full_name is not None or payload.user_type is not None:
        supabase.table("profiles").update(
            {
                "full_name": payload.full_name.strip() if payload.full_name is not None else profile.get("full_name"),
                "metadata": metadata,
                "is_active": bool(payload.is_active) if payload.is_active is not None else bool(profile.get("is_active", True)),
            }
        ).eq("id", user_id).execute()

    if payload.password is not None and payload.password.strip():
        supabase.auth.admin.update_user_by_id(
            user_id,
            {"password": payload.password.strip()},
        )

    permissions = (
        normalize_permissions(payload.permissions)
        if payload.permissions is not None
        else _load_role_permissions_map([_normalize_supabase_text(membership.get("role_id"))], supabase).get(_normalize_supabase_text(membership.get("role_id")), [])
    )
    metadata["user_type"] = coerce_user_type_for_role(next_role, str(metadata.get("user_type") or "non_teaching"))
    role_row = _ensure_managed_role(
        school_id,
        user_id,
        full_name=(payload.full_name or profile.get("full_name") or username or "User").strip(),
        selected_role=next_role,
        user_type=metadata["user_type"],
        permissions=permissions,
        supabase=supabase,
    )
    membership_update: dict[str, Any] = {"role_id": role_row["id"]}
    if payload.is_active is not None:
        membership_update["is_active"] = bool(payload.is_active)
        membership_update["status"] = "active" if payload.is_active else "suspended"
    supabase.table("school_memberships").update(membership_update).eq("id", membership["id"]).execute()

    updated_membership = dict(membership)
    updated_membership.update(membership_update)
    updated_membership["profiles"] = {
        **profile,
        "id": user_id,
        "full_name": payload.full_name.strip() if payload.full_name is not None else profile.get("full_name"),
        "metadata": metadata,
        "is_active": bool(payload.is_active) if payload.is_active is not None else bool(profile.get("is_active", True)),
    }
    updated_membership["roles"] = role_row
    permissions_by_role = {role_row["id"]: permissions}
    return _serialize_supabase_role_user(
        updated_membership,
        permissions_by_role,
        plain_password=payload.password.strip() if payload.password else "",
    )


@router.delete("/users/{user_id}")
async def delete_role_user(
    user_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_user_management_access),
):
    supabase = create_supabase_admin_client()
    membership_rows = _load_school_role_user_rows(school_id, supabase)
    membership = next((row for row in membership_rows if _normalize_supabase_text(row.get("profile_id")) == user_id), None)
    if not membership:
        raise HTTPException(status_code=404, detail="User not found")
    role = membership.get("roles")
    if isinstance(role, list):
        role = role[0] if role else {}
    if not isinstance(role, dict):
        role = {}
    if _selected_role_from_supabase_role(role) in ADMIN_ROLE_VALUES and _count_active_admins(membership_rows) < 2:
        raise HTTPException(status_code=400, detail="At least one active admin user must remain")

    supabase.table("school_memberships").delete().eq("id", membership["id"]).execute()
    return {"message": "User deleted"}


@router.get("/permissions", response_model=List[ModulePermissionInfo])
async def list_permissions(
    _: User = Depends(require_user_management_access),
):
    modules = []
    for parent_key, children_keys in PERMISSION_CHILDREN.items():
        sections = [
            {"key": child_key, "label": _make_permission_label(child_key.split(".", 1)[1] if "." in child_key else child_key)}
            for child_key in children_keys
        ]
        modules.append(ModulePermissionInfo(
            key=parent_key,
            label=_make_permission_label(parent_key),
            sections=sections,
        ))
    standalone = sorted(
        key for key in ALLOWED_PERMISSIONS
        if "." not in key and key not in PERMISSION_CHILDREN
    )
    for key in standalone:
        modules.append(ModulePermissionInfo(
            key=key,
            label=_make_permission_label(key),
            sections=[],
        ))
    return modules


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
