"""Supabase-backed portal access, session management, and account security helpers."""

from __future__ import annotations

import io
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from openpyxl import Workbook

from app.services.supabase_admin import create_supabase_admin_client


ACTIVE_SESSIONS_SCHEMA = "public"
ACCOUNT_SECURITY_MODULE = "account_security"
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$")
SESSION_LIMITS = {
    "student": 1,
    "parent": 1,
    "teacher": 2,
    "school_admin": 5,
    "platform_admin": None,
}
DEFAULT_STUDENT_PERMISSIONS = [
    "lms.progress",
    "lms.assignments",
    "online_tests.attempt",
    "study_planner.view",
    "study_planner.goals",
    "ai_tutor.chat",
    "doubt_solver.solve",
]
DEFAULT_PARENT_PERMISSIONS = [
    "parent_intelligence",
    "parent_intelligence.view",
    "parent_intelligence.alerts",
    "parent_intelligence.communication",
    "parent_intelligence.reports",
    "edupay.parent_portal",
]
DEFAULT_TEACHER_PERMISSIONS = [
    "attendance",
    "timetable",
    "lms.view",
    "lms.manage",
    "lms.assignments",
    "online_tests.view",
    "online_tests.manage",
    "online_tests.grade",
    "teacher_ai.generate",
]


def _client():
    return create_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional(value: Any) -> str | None:
    text = _normalize(value)
    return text or None


def _normalize_role_key(value: Any) -> str:
    return _normalize(value).lower()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _merge_metadata(base: Any, updates: dict[str, Any]) -> dict[str, Any]:
    payload = _json_object(base)
    payload.update(updates)
    return payload


def validate_password_strength(password: str) -> None:
    if not PASSWORD_PATTERN.match(password or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters and include uppercase, lowercase, number, and special character",
        )


def generate_secure_password(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(max(length, 8)))
        if PASSWORD_PATTERN.match(value):
            return value


def _school_slug(school_id: str) -> str:
    rows = list(
        _public_table("schools")
        .select("slug,school_code")
        .eq("id", school_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    school = dict(rows[0]) if rows else {}
    return (_normalize(school.get("slug")) or _normalize(school.get("school_code")) or "school").lower()


def _default_student_login_email(school_id: str, roll_number: str) -> str:
    return f"{roll_number.lower()}@{_school_slug(school_id)}.student.local"


def _default_parent_login_email(school_id: str, guardian_id: str, email: str | None = None) -> str:
    normalized_email = _normalize_optional(email)
    if normalized_email:
        return normalized_email.lower()
    return f"parent.{guardian_id[:10].lower()}@{_school_slug(school_id)}.parent.local"


def _default_teacher_login_email(school_id: str, employee_code: str, email: str | None = None) -> str:
    normalized_email = _normalize_optional(email)
    if normalized_email:
        return normalized_email.lower()
    return f"{employee_code.lower()}@{_school_slug(school_id)}.staff.local"


def _load_profile(profile_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("profiles")
        .select("id,email,full_name,display_name,phone,metadata,is_active,created_at,updated_at")
        .eq("id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found")
    return dict(rows[0])


def _load_school_membership(school_id: str, profile_id: str) -> dict[str, Any] | None:
    rows = list(
        _public_table("school_memberships")
        .select("id,school_id,profile_id,role_id,status,is_primary,is_active,metadata,roles(role_key,role_name,metadata)")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    membership = dict(rows[0])
    roles = membership.get("roles")
    if isinstance(roles, list):
        membership["roles"] = roles[0] if roles else None
    return membership


def _load_students_for_batch(school_id: str, batch_id: str | None = None) -> list[dict[str, Any]]:
    query = (
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,roll_number,full_name,email,phone,created_at,metadata,is_active")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if batch_id:
        query = query.eq("batch_id", batch_id)
    rows = list(query.order("roll_number").execute().data or [])
    return [dict(row) for row in rows]


def _load_student(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,roll_number,full_name,email,phone,created_at,metadata,is_active")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


def _load_guardian(school_id: str, guardian_id: str) -> dict[str, Any]:
    rows = list(
        _schema_table("academic", "guardians")
        .select("id,school_id,profile_id,full_name,email,phone,relation_type,address,metadata,is_active,created_at")
        .eq("school_id", school_id)
        .eq("id", guardian_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Parent not found")
    return dict(rows[0])


def _load_staff_member(school_id: str, staff_member_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("staff_members")
        .select("id,school_id,profile_id,employee_code,full_name,email,phone,staff_type,metadata,is_active,created_at")
        .eq("school_id", school_id)
        .eq("id", staff_member_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return dict(rows[0])


def _role_user_type(selected_role: str) -> str:
    if selected_role == "teacher":
        return "teaching"
    if selected_role == "student":
        return "student"
    return "non_teaching"


def _default_permissions_for_role(selected_role: str) -> list[str]:
    if selected_role == "student":
        return DEFAULT_STUDENT_PERMISSIONS
    if selected_role == "parent":
        return DEFAULT_PARENT_PERMISSIONS
    if selected_role == "teacher":
        return DEFAULT_TEACHER_PERMISSIONS
    return []


def _ensure_membership_role(
    school_id: str,
    profile_id: str,
    *,
    full_name: str,
    selected_role: str,
    permissions: list[str] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import _ensure_managed_role, normalize_permissions

    role_permissions = normalize_permissions(permissions or _default_permissions_for_role(selected_role))
    return _ensure_managed_role(
        school_id,
        profile_id,
        full_name=full_name,
        selected_role=selected_role,
        user_type=_role_user_type(selected_role),
        permissions=role_permissions,
        supabase=_client(),
    )


def _upsert_membership(
    school_id: str,
    profile_id: str,
    role_id: str,
    *,
    is_active: bool = True,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = _load_school_membership(school_id, profile_id)
    payload = {
        "school_id": school_id,
        "profile_id": profile_id,
        "role_id": role_id,
        "status": "active" if is_active else "suspended",
        "is_primary": bool(current.get("is_primary")) if current else False,
        "is_active": is_active,
        "metadata": metadata or {"source": "portal_access"},
    }
    if current:
        _public_table("school_memberships").update(payload).eq("id", current["id"]).execute()
        return {**current, **payload, "id": current["id"]}
    created = _public_table("school_memberships").insert(payload).execute()
    rows = list(created.data or [])
    return dict(rows[0]) if rows else payload


def _record_audit(
    *,
    school_id: str | None,
    actor_profile_id: str | None,
    action: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    insert_payload: dict[str, Any] = {
        "school_id": school_id,
        "profile_id": actor_profile_id,
        "action": action,
        "module_key": ACCOUNT_SECURITY_MODULE,
        "entity_table": "profiles",
        "entity_id": entity_id if entity_id and len(entity_id) == 36 else None,
        "payload": payload or {},
        "user_agent": user_agent,
    }
    if ip_address and "." in ip_address:
        insert_payload["ip_address"] = ip_address
    try:
        _public_table("audit_logs").insert(insert_payload).execute()
    except Exception:
        pass


def _latest_session_for_profile(profile_id: str) -> dict[str, Any] | None:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("*")
        .eq("profile_id", profile_id)
        .order("last_activity", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else None


def _active_session_count(profile_id: str) -> int:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("id")
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return len(rows)


def _portal_metadata(profile: dict[str, Any]) -> dict[str, Any]:
    return _json_object(profile.get("metadata")).get("portal_access") if isinstance(_json_object(profile.get("metadata")).get("portal_access"), dict) else {}


def _serialize_portal_status(
    *,
    entity_type: str,
    entity: dict[str, Any],
    profile: dict[str, Any] | None,
    membership: dict[str, Any] | None,
) -> dict[str, Any]:
    latest_session = _latest_session_for_profile(_normalize(profile.get("id"))) if profile else None
    portal_metadata = _portal_metadata(profile or {})
    role_data = membership.get("roles") if isinstance(membership, dict) else None
    if isinstance(role_data, list):
        role_data = role_data[0] if role_data else None
    role_key = _normalize_role_key((role_data or {}).get("role_key") if isinstance(role_data, dict) else None)
    return {
        "entity_type": entity_type,
        "entity_id": _normalize(entity.get("id")),
        "portal_status": "active" if profile and membership and profile.get("is_active", True) and membership.get("is_active", True) else ("not_created" if not profile else "disabled"),
        "username": _normalize(profile.get("display_name")) if profile else "",
        "login_email": _normalize(profile.get("email")) if profile else "",
        "last_login": latest_session.get("login_time") if latest_session else portal_metadata.get("last_login"),
        "last_activity": latest_session.get("last_activity") if latest_session else None,
        "profile_linked": bool(profile),
        "profile_id": _normalize(profile.get("id")) if profile else None,
        "account_created_date": profile.get("created_at") if profile else None,
        "must_change_password": bool(portal_metadata.get("must_change_password")) if profile else False,
        "force_password_change": bool(portal_metadata.get("must_change_password")) if profile else False,
        "last_password_reset_at": portal_metadata.get("last_password_reset_at") if profile else None,
        "active_sessions": _active_session_count(_normalize(profile.get("id"))) if profile else 0,
        "role_key": role_key or entity_type,
        "entity_label": _normalize(entity.get("full_name")) or _normalize(entity.get("roll_number")) or _normalize(entity.get("employee_code")),
        "is_enabled": bool(profile.get("is_active", True) and membership.get("is_active", True)) if profile and membership else False,
    }


def get_student_portal_access(school_id: str, student_id: str) -> dict[str, Any]:
    student = _load_student(school_id, student_id)
    profile_id = _normalize_optional(student.get("profile_id"))
    profile = _load_profile(profile_id) if profile_id else None
    membership = _load_school_membership(school_id, profile_id) if profile_id else None
    return _serialize_portal_status(entity_type="student", entity=student, profile=profile, membership=membership)


def get_parent_portal_access(school_id: str, guardian_id: str) -> dict[str, Any]:
    guardian = _load_guardian(school_id, guardian_id)
    profile_id = _normalize_optional(guardian.get("profile_id"))
    profile = _load_profile(profile_id) if profile_id else None
    membership = _load_school_membership(school_id, profile_id) if profile_id else None
    status_payload = _serialize_portal_status(entity_type="parent", entity=guardian, profile=profile, membership=membership)
    status_payload["relation_type"] = _normalize(guardian.get("relation_type")) or "parent"
    return status_payload


def _create_or_update_auth_user(
    *,
    school_id: str,
    profile_id: str | None,
    login_email: str,
    username: str,
    full_name: str,
    phone: str | None,
    password: str,
    selected_role: str,
) -> str:
    validate_password_strength(password)
    client = _client()
    if profile_id:
        client.auth.admin.update_user_by_id(
            profile_id,
            {
                "email": login_email,
                "password": password,
                "user_metadata": {
                    "full_name": full_name,
                    "display_name": username,
                    "username": username,
                    "school_id": school_id,
                    "selected_role": selected_role,
                },
            },
        )
        return profile_id

    response = client.auth.admin.create_user(
        {
            "email": login_email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": full_name,
                "display_name": username,
                "username": username,
                "school_id": school_id,
                "selected_role": selected_role,
            },
        }
    )
    created_user = getattr(response, "user", None)
    new_profile_id = _normalize_optional(getattr(created_user, "id", None))
    if not new_profile_id:
        raise HTTPException(status_code=500, detail="Failed to create portal login")
    return new_profile_id


def _update_profile_for_portal_access(
    *,
    profile_id: str,
    full_name: str,
    username: str,
    login_email: str,
    phone: str | None,
    entity_type: str,
    entity_id: str,
    actor_profile_id: str | None,
    must_change_password: bool,
    is_active: bool,
) -> dict[str, Any]:
    current = _load_profile(profile_id)
    metadata = _merge_metadata(
        current.get("metadata"),
        {
            "username": username,
            "user_type": "student" if entity_type == "student" else "non_teaching",
            "portal_access": {
                **_portal_metadata(current),
                "entity_type": entity_type,
                "entity_id": entity_id,
                "username": username,
                "must_change_password": must_change_password,
                "account_created_at": current.get("created_at") or _now_iso(),
                "last_password_reset_at": _now_iso(),
                "managed_by": "account_security",
                "updated_by_profile_id": actor_profile_id,
            },
        },
    )
    _public_table("profiles").update(
        {
            "email": login_email,
            "full_name": full_name,
            "display_name": username,
            "phone": _normalize_optional(phone),
            "metadata": metadata,
            "is_active": is_active,
        }
    ).eq("id", profile_id).execute()
    return _load_profile(profile_id)


def create_or_reset_student_account(
    school_id: str,
    student_id: str,
    *,
    actor_profile_id: str | None,
    password: str | None = None,
    force_password_change: bool = True,
) -> dict[str, Any]:
    student = _load_student(school_id, student_id)
    username = _normalize(student.get("roll_number"))
    if not username:
        raise HTTPException(status_code=400, detail="Student roll number is required for portal access")
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(student.get("profile_id"))
    login_email = _default_student_login_email(school_id, username)
    new_profile_id = _create_or_update_auth_user(
        school_id=school_id,
        profile_id=profile_id,
        login_email=login_email,
        username=username,
        full_name=_normalize(student.get("full_name")) or username,
        phone=_normalize_optional(student.get("phone")),
        password=generated_password,
        selected_role="student",
    )
    role_row = _ensure_membership_role(
        school_id,
        new_profile_id,
        full_name=_normalize(student.get("full_name")) or username,
        selected_role="student",
        permissions=DEFAULT_STUDENT_PERMISSIONS,
    )
    _upsert_membership(school_id, new_profile_id, _normalize(role_row.get("id")), is_active=True)
    profile = _update_profile_for_portal_access(
        profile_id=new_profile_id,
        full_name=_normalize(student.get("full_name")) or username,
        username=username,
        login_email=login_email,
        phone=_normalize_optional(student.get("phone")),
        entity_type="student",
        entity_id=_normalize(student.get("id")),
        actor_profile_id=actor_profile_id,
        must_change_password=force_password_change,
        is_active=True,
    )
    if _normalize(student.get("profile_id")) != new_profile_id:
        _public_table("students").update({"profile_id": new_profile_id}).eq("id", student_id).execute()
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.created" if not profile_id else "password.reset",
        entity_id=new_profile_id,
        payload={"entity_type": "student", "student_id": student_id, "username": username},
    )
    result = get_student_portal_access(school_id, student_id)
    result["temporary_password"] = generated_password
    result["login_email"] = login_email
    return result


def create_or_reset_parent_account(
    school_id: str,
    guardian_id: str,
    *,
    actor_profile_id: str | None,
    password: str | None = None,
    force_password_change: bool = True,
) -> dict[str, Any]:
    guardian = _load_guardian(school_id, guardian_id)
    username = _normalize(guardian.get("email")).split("@")[0] if _normalize(guardian.get("email")) else f"parent-{guardian_id[:8]}"
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(guardian.get("profile_id"))
    login_email = _default_parent_login_email(school_id, guardian_id, _normalize_optional(guardian.get("email")))
    new_profile_id = _create_or_update_auth_user(
        school_id=school_id,
        profile_id=profile_id,
        login_email=login_email,
        username=username,
        full_name=_normalize(guardian.get("full_name")) or username,
        phone=_normalize_optional(guardian.get("phone")),
        password=generated_password,
        selected_role="parent",
    )
    role_row = _ensure_membership_role(
        school_id,
        new_profile_id,
        full_name=_normalize(guardian.get("full_name")) or username,
        selected_role="parent",
        permissions=DEFAULT_PARENT_PERMISSIONS,
    )
    _upsert_membership(school_id, new_profile_id, _normalize(role_row.get("id")), is_active=True)
    _update_profile_for_portal_access(
        profile_id=new_profile_id,
        full_name=_normalize(guardian.get("full_name")) or username,
        username=username,
        login_email=login_email,
        phone=_normalize_optional(guardian.get("phone")),
        entity_type="parent",
        entity_id=_normalize(guardian.get("id")),
        actor_profile_id=actor_profile_id,
        must_change_password=force_password_change,
        is_active=True,
    )
    if _normalize(guardian.get("profile_id")) != new_profile_id:
        _schema_table("academic", "guardians").update({"profile_id": new_profile_id}).eq("id", guardian_id).execute()
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.created" if not profile_id else "password.reset",
        entity_id=new_profile_id,
        payload={"entity_type": "parent", "guardian_id": guardian_id, "username": username},
    )
    result = get_parent_portal_access(school_id, guardian_id)
    result["temporary_password"] = generated_password
    result["login_email"] = login_email
    return result


def create_or_reset_staff_account(
    school_id: str,
    staff_member_id: str,
    *,
    actor_profile_id: str | None,
    password: str | None = None,
    selected_role: str = "teacher",
    force_password_change: bool = True,
) -> dict[str, Any]:
    staff_member = _load_staff_member(school_id, staff_member_id)
    username = _normalize(staff_member.get("employee_code")) or f"staff-{staff_member_id[:8]}"
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(staff_member.get("profile_id"))
    login_email = _default_teacher_login_email(school_id, username, _normalize_optional(staff_member.get("email")))
    new_profile_id = _create_or_update_auth_user(
        school_id=school_id,
        profile_id=profile_id,
        login_email=login_email,
        username=username,
        full_name=_normalize(staff_member.get("full_name")) or username,
        phone=_normalize_optional(staff_member.get("phone")),
        password=generated_password,
        selected_role=selected_role,
    )
    role_row = _ensure_membership_role(
        school_id,
        new_profile_id,
        full_name=_normalize(staff_member.get("full_name")) or username,
        selected_role=selected_role,
        permissions=_default_permissions_for_role(selected_role),
    )
    _upsert_membership(school_id, new_profile_id, _normalize(role_row.get("id")), is_active=True)
    _update_profile_for_portal_access(
        profile_id=new_profile_id,
        full_name=_normalize(staff_member.get("full_name")) or username,
        username=username,
        login_email=login_email,
        phone=_normalize_optional(staff_member.get("phone")),
        entity_type="staff_member",
        entity_id=_normalize(staff_member.get("id")),
        actor_profile_id=actor_profile_id,
        must_change_password=force_password_change,
        is_active=True,
    )
    if _normalize(staff_member.get("profile_id")) != new_profile_id:
        _public_table("staff_members").update({"profile_id": new_profile_id}).eq("id", staff_member_id).execute()
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.created" if not profile_id else "password.reset",
        entity_id=new_profile_id,
        payload={"entity_type": selected_role, "staff_member_id": staff_member_id, "username": username},
    )
    return {
        "profile_id": new_profile_id,
        "username": username,
        "login_email": login_email,
        "temporary_password": generated_password,
    }


def set_account_enabled(
    school_id: str,
    profile_id: str,
    *,
    actor_profile_id: str | None,
    is_enabled: bool,
) -> dict[str, Any]:
    membership = _load_school_membership(school_id, profile_id)
    if not membership:
        raise HTTPException(status_code=404, detail="School membership not found for account")
    _public_table("profiles").update({"is_active": is_enabled}).eq("id", profile_id).execute()
    _public_table("school_memberships").update(
        {"is_active": is_enabled, "status": "active" if is_enabled else "suspended"}
    ).eq("id", membership["id"]).execute()
    if not is_enabled:
        force_logout_profile_sessions(school_id, profile_id, actor_profile_id=actor_profile_id, reason="account_disabled")
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.enabled" if is_enabled else "account.disabled",
        entity_id=profile_id,
        payload={"profile_id": profile_id},
    )
    profile = _load_profile(profile_id)
    return {"profile_id": profile_id, "is_enabled": is_enabled, "display_name": profile.get("display_name")}


def force_logout_profile_sessions(
    school_id: str,
    profile_id: str,
    *,
    actor_profile_id: str | None,
    reason: str = "force_logout",
) -> dict[str, Any]:
    active_rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("id")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    for row in active_rows:
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
            {"is_active": False, "ended_at": _now_iso(), "ended_reason": reason}
        ).eq("id", row["id"]).execute()
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.force_logout",
        entity_id=profile_id,
        payload={"profile_id": profile_id, "count": len(active_rows), "reason": reason},
    )
    return {"profile_id": profile_id, "terminated_sessions": len(active_rows)}


def bulk_generate_student_accounts(
    school_id: str,
    *,
    actor_profile_id: str | None,
    student_ids: list[str] | None = None,
    batch_id: str | None = None,
) -> dict[str, Any]:
    students = _load_students_for_batch(school_id, batch_id)
    if student_ids:
        wanted = {_normalize(item) for item in student_ids if _normalize(item)}
        students = [row for row in students if _normalize(row.get("id")) in wanted]
    credentials: list[dict[str, Any]] = []
    for student in students:
        result = create_or_reset_student_account(
            school_id,
            _normalize(student.get("id")),
            actor_profile_id=actor_profile_id,
        )
        credentials.append(
            {
                "student_name": _normalize(student.get("full_name")),
                "roll_number": _normalize(student.get("roll_number")),
                "username": result.get("username") or _normalize(student.get("roll_number")),
                "login_email": result.get("login_email"),
                "temporary_password": result.get("temporary_password"),
            }
        )
    return {"count": len(credentials), "credentials": credentials}


def create_credentials_workbook(rows: list[dict[str, Any]]) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Portal Credentials"
    worksheet.append(["Student Name", "Roll Number", "Username", "Login Email", "Temporary Password"])
    for row in rows:
        worksheet.append(
            [
                _normalize(row.get("student_name")),
                _normalize(row.get("roll_number")),
                _normalize(row.get("username")),
                _normalize(row.get("login_email")),
                _normalize(row.get("temporary_password")),
            ]
        )
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def list_active_sessions(school_id: str) -> list[dict[str, Any]]:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("*")
        .eq("school_id", school_id)
        .order("last_activity", desc=True)
        .limit(500)
        .execute()
        .data
        or []
    )
    profile_ids = sorted({_normalize(row.get("profile_id")) for row in rows if _normalize(row.get("profile_id"))})
    profiles = {}
    if profile_ids:
        profile_rows = list(
            _public_table("profiles")
            .select("id,email,full_name,display_name,is_active")
            .in_("id", profile_ids)
            .execute()
            .data
            or []
        )
        profiles = {_normalize(row.get("id")): dict(row) for row in profile_rows}
    sessions: list[dict[str, Any]] = []
    for row in rows:
        profile = profiles.get(_normalize(row.get("profile_id")), {})
        sessions.append(
            {
                "id": _normalize(row.get("id")),
                "profile_id": _normalize(row.get("profile_id")),
                "username": _normalize(profile.get("display_name")) or _normalize(profile.get("email")).split("@")[0],
                "full_name": _normalize(profile.get("full_name")),
                "email": _normalize_optional(profile.get("email")),
                "role_key": _normalize_role_key(row.get("role_key")),
                "device_id": _normalize(row.get("device_id")),
                "device_name": _normalize_optional(row.get("device_name")),
                "browser": _normalize_optional(row.get("browser")),
                "ip_address": _normalize_optional(row.get("ip_address")),
                "login_time": row.get("login_time"),
                "last_activity": row.get("last_activity"),
                "status": "active" if row.get("is_active", True) else "terminated",
                "session_key": _normalize(row.get("session_key")),
                "is_active": bool(row.get("is_active", True)),
            }
        )
    return sessions


def _resolve_session_limit(role_key: str) -> int | None:
    normalized = _normalize_role_key(role_key)
    if normalized in SESSION_LIMITS:
        return SESSION_LIMITS[normalized]
    return 2


def register_active_session(
    *,
    school_id: str,
    profile_id: str,
    membership_id: str | None,
    role_key: str,
    session_key: str,
    device_id: str,
    device_name: str | None,
    browser: str | None,
    ip_address: str | None,
    user_agent: str | None,
    force_takeover: bool = False,
) -> dict[str, Any]:
    limit = _resolve_session_limit(role_key)
    current_rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("*")
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .order("last_activity", desc=True)
        .execute()
        .data
        or []
    )
    same_session = next((dict(row) for row in current_rows if _normalize(row.get("session_key")) == session_key), None)
    if same_session:
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
            {
                "device_id": device_id,
                "device_name": device_name,
                "browser": browser,
                "ip_address": ip_address,
                "last_activity": _now_iso(),
                "metadata": _merge_metadata(same_session.get("metadata"), {"user_agent": user_agent}),
            }
        ).eq("id", same_session["id"]).execute()
        return {"status": "ok", "session_id": same_session["id"], "limit": limit}

    if limit is not None and len(current_rows) >= limit:
        if not force_takeover:
            latest = dict(current_rows[0])
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "session_limit_exceeded",
                    "message": "Existing session detected",
                    "limit": limit,
                    "current_session": {
                        "device_name": latest.get("device_name"),
                        "browser": latest.get("browser"),
                        "last_activity": latest.get("last_activity"),
                    },
                },
            )
        for row in current_rows:
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
                {"is_active": False, "ended_at": _now_iso(), "ended_reason": "takeover"}
            ).eq("id", row["id"]).execute()

    response = _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").insert(
        {
            "user_id": profile_id,
            "profile_id": profile_id,
            "school_id": school_id,
            "membership_id": membership_id,
            "role_key": _normalize_role_key(role_key),
            "device_id": device_id,
            "device_name": device_name,
            "browser": browser,
            "ip_address": ip_address,
            "session_key": session_key,
            "session_scope": "portal",
            "login_time": _now_iso(),
            "last_activity": _now_iso(),
            "is_active": True,
            "metadata": {"user_agent": user_agent},
        }
    ).execute()
    rows = list(response.data or [])
    created = dict(rows[0]) if rows else {}
    _public_table("profiles").update(
        {
            "metadata": _merge_metadata(
                _load_profile(profile_id).get("metadata"),
                {"portal_access": {**_portal_metadata(_load_profile(profile_id)), "last_login": created.get("login_time")}},
            )
        }
    ).eq("id", profile_id).execute()
    return {"status": "ok", "session_id": _normalize(created.get("id")), "limit": limit}


def heartbeat_active_session(profile_id: str, session_key: str) -> dict[str, Any]:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("*")
        .eq("profile_id", profile_id)
        .eq("session_key", session_key)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Active session not found")
    row = dict(rows[0])
    if not row.get("is_active", True):
        raise HTTPException(status_code=401, detail="Session has been terminated")
    _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update({"last_activity": _now_iso()}).eq("id", row["id"]).execute()
    return {"status": "ok", "session_id": row["id"]}


def validate_active_session(profile_id: str, session_key: str | None) -> None:
    normalized_profile_id = _normalize(profile_id)
    normalized_session_key = _normalize(session_key)
    if not normalized_profile_id or not normalized_session_key:
        return
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("id,is_active")
        .eq("profile_id", normalized_profile_id)
        .eq("session_key", normalized_session_key)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=401, detail="Session is not registered")
    if not rows[0].get("is_active", True):
        raise HTTPException(status_code=401, detail="Session has been terminated")


def logout_session(profile_id: str, session_key: str) -> None:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("id")
        .eq("profile_id", profile_id)
        .eq("session_key", session_key)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return
    _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
        {"is_active": False, "ended_at": _now_iso(), "ended_reason": "logout"}
    ).eq("id", rows[0]["id"]).execute()


def complete_password_change(profile_id: str) -> dict[str, Any]:
    profile = _load_profile(profile_id)
    metadata = _merge_metadata(
        profile.get("metadata"),
        {"portal_access": {**_portal_metadata(profile), "must_change_password": False, "password_changed_at": _now_iso()}},
    )
    _public_table("profiles").update({"metadata": metadata}).eq("id", profile_id).execute()
    return {"status": "ok"}


def resolve_login_email(identifier: str) -> dict[str, Any]:
    normalized = _normalize(identifier)
    if not normalized:
        raise HTTPException(status_code=400, detail="Identifier is required")
    if "@" in normalized:
        return {"email": normalized.lower()}
    profile_rows = list(
        _public_table("profiles")
        .select("id,email,display_name")
        .ilike("display_name", normalized)
        .limit(5)
        .execute()
        .data
        or []
    )
    matches = [dict(row) for row in profile_rows if _normalize(row.get("email"))]
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="Multiple accounts found for this username. Please use your login email.")
    if matches:
        return {"email": _normalize(matches[0].get("email")).lower()}
    raise HTTPException(status_code=404, detail="Login account not found")


def start_test_session(
    *,
    school_id: str,
    test_id: str,
    attempt_id: str | None,
    student_id: str,
    profile_id: str,
    session_key: str | None,
    device_id: str | None,
    mode: str = "terminate_previous",
) -> None:
    active_rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions")
        .select("*")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", student_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    current_key = _normalize(session_key)
    for row in active_rows:
        if current_key and _normalize(row.get("session_key")) == current_key:
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").update(
                {"attempt_id": attempt_id, "last_activity": _now_iso()}
            ).eq("id", row["id"]).execute()
            return
    if active_rows:
        if mode == "block_new":
            raise HTTPException(status_code=409, detail="This test is already active on another device")
        for row in active_rows:
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").update(
                {"is_active": False, "terminated_at": _now_iso(), "terminated_reason": "new_device"}
            ).eq("id", row["id"]).execute()
    _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").insert(
        {
            "school_id": school_id,
            "test_id": test_id,
            "attempt_id": attempt_id,
            "student_id": student_id,
            "profile_id": profile_id,
            "device_id": _normalize_optional(device_id),
            "session_key": current_key or None,
            "is_active": True,
            "started_at": _now_iso(),
            "last_activity": _now_iso(),
            "metadata": {"mode": mode},
        }
    ).execute()


def touch_test_session(school_id: str, test_id: str, student_id: str, session_key: str | None) -> None:
    current_key = _normalize(session_key)
    if not current_key:
        return
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions")
        .select("id,is_active")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", student_id)
        .eq("session_key", current_key)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return
    if not rows[0].get("is_active", True):
        raise HTTPException(status_code=409, detail="This test session has been terminated")
    _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").update({"last_activity": _now_iso()}).eq("id", rows[0]["id"]).execute()


def end_test_session(school_id: str, test_id: str, student_id: str, session_key: str | None, *, reason: str = "completed") -> None:
    query = (
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", student_id)
        .eq("is_active", True)
    )
    current_key = _normalize(session_key)
    if current_key:
        query = query.eq("session_key", current_key)
    rows = list(query.execute().data or [])
    for row in rows:
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").update(
            {"is_active": False, "terminated_at": _now_iso(), "terminated_reason": reason}
        ).eq("id", row["id"]).execute()
