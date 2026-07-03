from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from app.services.supabase_account_security import (
    _create_or_update_auth_user,
    _default_portal_login_email,
    _ensure_membership_role,
    _load_profile,
    _update_profile_for_portal_access,
    _upsert_membership,
    generate_secure_password,
)
from app.services.subscription_engine import SchoolSubscriptionService
from app.services.supabase_admin import get_supabase_admin_client

MODULE_KEY = "platform_control_plane"
DEFAULT_PLATFORM_DEPARTMENTS = [
    "Administration",
    "Academics",
    "Examination",
    "Accounts",
    "Transport",
    "Library",
]
DEFAULT_FIRST_LOGIN_STEPS = [
    "verify_email",
    "accept_terms",
    "change_password",
    "confirm_mobile",
    "mfa_setup",
    "review_school_information",
    "complete_school_profile",
    "finish_setup",
]
DEFAULT_SCHOOL_APP_SETTINGS = {
    "name": "",
    "address": "",
    "phone": "",
    "email": "",
    "website": "",
    "principal_name": "",
    "established_year": datetime.now(timezone.utc).year,
    "timezone": "Asia/Kolkata",
    "date_format": "DD/MM/YYYY",
    "default_batch_colors": {
        "11th": "#3B82F6",
        "12th": "#10B981",
        "Dropper 1": "#F59E0B",
        "Dropper 2": "#EF4444",
    },
    "export_format": "both",
    "auto_save": True,
    "conflict_detection": True,
    "email_notifications": True,
}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utc_now().isoformat()


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", _normalize(value).lower())
    return normalized.strip("-") or "school"


def _unique_slug(preferred: str) -> str:
    base = _slugify(preferred)
    slug = base
    suffix = 1
    while _public_table("schools").select("id").eq("slug", slug).limit(1).execute().data:
        suffix += 1
        slug = f"{base}-{suffix}"
    return slug


def _resolve_school_code(payload: dict[str, Any]) -> str:
    provided = _normalize(payload.get("school_code")).upper()
    if provided:
        return provided
    derived = re.sub(r"[^A-Z0-9]+", "", _normalize(payload.get("name")).upper())[:8]
    return derived or f"SCH{_utc_now().strftime('%m%d%H')}"


def _school_admin_username(school_code: str, school_name: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "", school_code.upper())[:10] or re.sub(r"[^A-Z0-9]+", "", school_name.upper())[:10] or "SCHOOL"
    return f"{base}ADMIN"


def _school_admin_permissions() -> list[str]:
    rows = list(
        _public_table("permissions")
        .select("permission_key,module_key")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    permissions: list[str] = []
    for row in rows:
        permission_key = _normalize(row.get("permission_key"))
        module_key = _normalize(row.get("module_key"))
        if not permission_key:
            continue
        if module_key == "platform" or permission_key.startswith("platform."):
            continue
        permissions.append(permission_key)
    return sorted(set(permissions))


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _execute_count(query) -> int:
    try:
        result = query.execute()
        return int(result.count or 0)
    except Exception:
        return 0


def _safe_count(table_name: str, *, school_id: str | None = None, schema: str | None = None, active_only: bool = False) -> int:
    table = _schema_table(schema, table_name) if schema else _public_table(table_name)
    query = table.select("id", count="exact", head=True)
    if school_id:
        query = query.eq("school_id", school_id)
    if active_only:
        query = query.eq("is_active", True)
    return _execute_count(query)


def _safe_list(table_name: str, *, school_id: str | None = None, schema: str | None = None, select: str = "*") -> list[dict[str, Any]]:
    table = _schema_table(schema, table_name) if schema else _public_table(table_name)
    query = table.select(select)
    if school_id:
        query = query.eq("school_id", school_id)
    try:
        return [dict(row) for row in list(query.execute().data or [])]
    except Exception:
        return []


def _safe_latest(table_name: str, *, school_id: str | None = None, schema: str | None = None, column: str = "created_at") -> dict[str, Any] | None:
    table = _schema_table(schema, table_name) if schema else _public_table(table_name)
    query = table.select("*").order(column, desc=True).limit(1)
    if school_id:
        query = query.eq("school_id", school_id)
    try:
        rows = list(query.execute().data or [])
    except Exception:
        return None
    return dict(rows[0]) if rows else None


def _merge_school_metadata(existing: dict[str, Any] | None, updates: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(existing or {})
    for key, value in dict(updates or {}).items():
        if value is not None:
            merged[key] = value
    return merged


def _provision_school_defaults(school: dict[str, Any], payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, bool]:
    school_id = _normalize(school.get("id"))
    school_metadata = school.get("metadata") if isinstance(school.get("metadata"), dict) else {}
    app_settings = {
        **DEFAULT_SCHOOL_APP_SETTINGS,
        "name": _normalize(school.get("name")),
        "phone": _normalize(school.get("contact_phone")),
        "email": _normalize(school.get("contact_email")),
        "timezone": _normalize(school.get("timezone")) or DEFAULT_SCHOOL_APP_SETTINGS["timezone"],
        "address": _normalize(payload.get("address")),
        "website": _normalize(payload.get("website")),
    }
    provisioning_metadata = {
        "board": payload.get("board"),
        "language": payload.get("language") or "English",
        "address": payload.get("address"),
        "city": payload.get("city"),
        "state": payload.get("state"),
        "country": payload.get("country"),
        "default_departments": DEFAULT_PLATFORM_DEPARTMENTS,
        "attendance_settings": {"minimum_attendance_threshold": 75, "working_hours_start": "09:00", "working_hours_end": "17:00"},
        "timetable_settings": {"days_per_week": 6, "periods_per_day": 8},
        "examination_settings": {"grading_mode": "percentage", "marks_entry_locked": False},
        "ai_settings": {"enabled": True, "monthly_guardrails_enabled": True},
        "notification_settings": {"email_notifications": True, "platform_broadcasts": True, "welcome_sms_enabled": False},
    }
    merged_metadata = _merge_school_metadata(
        school_metadata,
        {
            "app_settings": app_settings,
            "school_domain": payload.get("school_domain"),
            "academic_session": payload.get("academic_session"),
            "branding": {"logo_url": payload.get("logo_url")} if payload.get("logo_url") else school_metadata.get("branding") or {},
            "onboarding": {
                "status": "provisioned",
                "completed_at": _iso_now(),
                "provisioned_by": actor_profile_id,
                **provisioning_metadata,
            },
        },
    )
    _public_table("schools").update({"metadata": merged_metadata}).eq("id", school_id).execute()
    _schema_table("attendance", "settings").upsert(
        {
            "school_id": school_id,
            "minimum_attendance_threshold": 75,
            "working_hours_start": "09:00",
            "working_hours_end": "17:00",
            "metadata": {"source": "platform_onboarding"},
            "is_active": True,
        },
        on_conflict="school_id",
    ).execute()
    return {
        "school_settings": True,
        "academic_session": True,
        "departments": True,
        "attendance_settings": True,
        "timetable_settings": True,
        "examination_settings": True,
        "ai_settings": True,
        "notification_settings": True,
    }


def _provision_school_admin(school: dict[str, Any], payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    school_id = _normalize(school.get("id"))
    school_code = _normalize(school.get("school_code")).upper()
    school_name = _normalize(school.get("name"))
    admin_full_name = _normalize(payload.get("admin_full_name"))
    admin_email = _normalize(payload.get("admin_email")).lower()
    admin_mobile = _normalize(payload.get("admin_mobile")) or None
    username = _school_admin_username(school_code, school_name)
    temporary_password = generate_secure_password(length=16)
    login_email = admin_email or _default_portal_login_email(school_id, username, "school_admin")
    profile_id = _normalize(payload.get("admin_profile_id")) or None
    new_profile_id = _create_or_update_auth_user(
        school_id=school_id,
        profile_id=profile_id,
        login_email=login_email,
        username=username,
        full_name=admin_full_name or username,
        phone=admin_mobile,
        password=temporary_password,
        selected_role="school_admin",
    )
    role_row = _ensure_membership_role(
        school_id,
        new_profile_id,
        full_name=admin_full_name or username,
        selected_role="school_admin",
        permissions=_school_admin_permissions(),
    )
    membership = _upsert_membership(
        school_id,
        new_profile_id,
        _normalize(role_row.get("id")),
        is_active=True,
        metadata={"source": "platform_onboarding", "first_login_completed": False},
    )
    profile = _update_profile_for_portal_access(
        profile_id=new_profile_id,
        full_name=admin_full_name or username,
        username=username,
        login_email=login_email,
        phone=admin_mobile,
        entity_type="staff_member",
        entity_id=new_profile_id,
        actor_profile_id=actor_profile_id,
        must_change_password=True,
        is_active=True,
    )
    portal_access = dict(((profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {}).get("portal_access") or {}))
    portal_access.update(
        {
            "entity_type": "school_admin",
            "must_change_password": True,
            "first_login_completed": False,
            "first_login_steps": DEFAULT_FIRST_LOGIN_STEPS,
            "temporary_password_expires_at": (_utc_now() + timedelta(days=7)).isoformat(),
            "school_onboarding_required": True,
            "onboarding_status": "pending",
            "managed_by": "platform_onboarding",
        }
    )
    metadata = _merge_school_metadata(
        profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {},
        {"portal_access": portal_access},
    )
    _public_table("profiles").update(
        {
            "metadata": metadata,
            "default_school_id": school_id,
            "email": login_email,
            "phone": admin_mobile,
            "full_name": admin_full_name or username,
            "display_name": username,
        }
    ).eq("id", new_profile_id).execute()
    _public_table("ai_credit_wallets").upsert(
        {
            "profile_id": new_profile_id,
            "school_id": school_id,
            "wallet_type": "personal",
            "balance": 0,
            "created_by": actor_profile_id,
            "updated_by": actor_profile_id,
            "metadata": {"source": "platform_onboarding"},
        },
        on_conflict="profile_id,school_id,wallet_type",
    ).execute()
    return {
        "profile_id": new_profile_id,
        "username": username,
        "temporary_password": temporary_password,
        "login_email": login_email,
        "full_name": admin_full_name or username,
        "mobile": admin_mobile,
        "employee_code": _normalize(payload.get("admin_employee_code")) or None,
        "role_key": "school_admin",
        "must_change_password": True,
        "first_login_completed": False,
        "membership_created": bool(membership),
        "account_created": True,
    }


def _school_status(row: dict[str, Any]) -> str:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if metadata.get("deleted_at"):
        return "deleted"
    if metadata.get("platform_status"):
        return str(metadata.get("platform_status"))
    return "active" if row.get("is_active", True) else "inactive"


def _school_summary(row: dict[str, Any], counters: dict[str, dict[str, int]] | None = None) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    counts = counters.get(str(row.get("id")), {}) if counters else {}
    branding = metadata.get("branding") if isinstance(metadata.get("branding"), dict) else {}
    return {
        "id": str(row.get("id") or ""),
        "school_code": row.get("school_code") or "",
        "slug": row.get("slug") or "",
        "name": row.get("name") or "",
        "legal_name": row.get("legal_name"),
        "timezone": row.get("timezone") or "Asia/Kolkata",
        "contact_email": row.get("contact_email"),
        "contact_phone": row.get("contact_phone"),
        "school_domain": metadata.get("school_domain"),
        "academic_session": metadata.get("academic_session"),
        "logo_url": branding.get("logo_url") or metadata.get("logo_url"),
        "status": _school_status(row),
        "is_active": bool(row.get("is_active", True)),
        "student_count": counts.get("students", 0),
        "teacher_count": counts.get("teachers", 0),
        "staff_count": counts.get("staff", 0),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "metadata": metadata,
    }


def _audit(*, school_id: str | None, profile_id: str | None, action: str, severity: str = "info", payload: dict[str, Any] | None = None) -> None:
    try:
        _public_table("audit_logs").insert(
            {
                "school_id": school_id,
                "profile_id": profile_id,
                "action": action,
                "module_key": MODULE_KEY,
                "entity_table": "schools" if school_id else "platform",
                "payload": {"severity": severity, **(payload or {})},
            }
        ).execute()
    except Exception:
        pass


def _load_school_row(school_id: str) -> dict[str, Any]:
    rows = _public_table("schools").select("*").eq("id", school_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="School not found")
    return dict(rows[0])


def _resolve_counts(school_ids: list[str]) -> dict[str, dict[str, int]]:
    counters: dict[str, dict[str, int]] = {school_id: {"students": 0, "teachers": 0, "staff": 0} for school_id in school_ids}
    student_rows = (
        _public_table("students")
        .select("school_id")
        .in_("school_id", school_ids)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    for row in student_rows:
        school_id = _normalize(row.get("school_id"))
        if school_id in counters:
            counters[school_id]["students"] += 1

    staff_rows = (
        _public_table("staff_members")
        .select("school_id,staff_type")
        .in_("school_id", school_ids)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    for row in staff_rows:
        school_id = _normalize(row.get("school_id"))
        if school_id not in counters:
            continue
        staff_type = _normalize(row.get("staff_type"))
        if staff_type == "teaching":
            counters[school_id]["teachers"] += 1
        elif staff_type == "non_teaching":
            counters[school_id]["staff"] += 1
    return counters


def list_schools(*, status: str | None = None, q: str | None = None) -> dict[str, Any]:
    rows = [dict(row) for row in list(_public_table("schools").select("*").order("created_at", desc=False).execute().data or [])]
    normalized_q = _normalize(q).casefold()
    if normalized_q:
        rows = [
            row for row in rows
            if normalized_q in " ".join(
                [
                    _normalize(row.get("school_code")),
                    _normalize(row.get("slug")),
                    _normalize(row.get("name")),
                    _normalize(row.get("legal_name")),
                    _normalize(row.get("contact_email")),
                ]
            ).casefold()
        ]
    if status:
        rows = [row for row in rows if _school_status(row) == status]
    school_ids = [str(row.get("id")) for row in rows]
    counters = _resolve_counts(school_ids) if school_ids else {}
    return {"items": [_school_summary(row, counters) for row in rows], "total_count": len(rows)}


def create_school(payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    resolved_school_code = _resolve_school_code(payload)
    resolved_slug = _unique_slug(payload.get("slug") or resolved_school_code or payload.get("name") or "school")
    metadata = _merge_school_metadata(
        payload.get("metadata"),
        {
            "school_domain": payload.get("school_domain"),
            "academic_session": payload.get("academic_session"),
            "branding": {"logo_url": payload.get("logo_url")} if payload.get("logo_url") else {},
            "platform_status": "active",
        },
    )
    insert_payload = {
        "school_code": resolved_school_code,
        "slug": resolved_slug,
        "name": _normalize(payload.get("name")),
        "legal_name": payload.get("legal_name"),
        "timezone": payload.get("timezone") or "Asia/Kolkata",
        "contact_email": payload.get("contact_email"),
        "contact_phone": payload.get("contact_phone"),
        "metadata": metadata,
        "is_active": True,
    }
    rows = _public_table("schools").insert(insert_payload).execute().data or []
    if not rows:
        raise HTTPException(status_code=400, detail="Unable to create school")
    created = dict(rows[0])
    _audit(
        school_id=str(created.get("id") or ""),
        profile_id=actor_profile_id,
        action="platform.school.created",
        payload={"school_code": created.get("school_code"), "slug": created.get("slug")},
    )
    return _school_summary(created)


def update_school(school_id: str, payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    existing = _load_school_row(school_id)
    existing_metadata = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
    update_payload = {key: value for key, value in payload.items() if key in {"school_code", "slug", "name", "legal_name", "timezone", "contact_email", "contact_phone"} and value is not None}
    if "slug" in update_payload:
        update_payload["slug"] = _normalize(update_payload["slug"]).lower()
    update_payload["metadata"] = _merge_school_metadata(
        existing_metadata,
        {
            **(payload.get("metadata") or {}),
            "school_domain": payload.get("school_domain") if payload.get("school_domain") is not None else existing_metadata.get("school_domain"),
            "academic_session": payload.get("academic_session") if payload.get("academic_session") is not None else existing_metadata.get("academic_session"),
            "branding": {
                **(existing_metadata.get("branding") if isinstance(existing_metadata.get("branding"), dict) else {}),
                **({"logo_url": payload.get("logo_url")} if payload.get("logo_url") is not None else {}),
            },
        },
    )
    rows = _public_table("schools").update(update_payload).eq("id", school_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=400, detail="Unable to update school")
    updated = dict(rows[0])
    _audit(school_id=school_id, profile_id=actor_profile_id, action="platform.school.updated", payload={"fields": sorted(update_payload.keys())})
    return _school_summary(updated)


def set_school_status(school_id: str, status: str, *, actor_profile_id: str | None, reason: str | None = None) -> dict[str, Any]:
    existing = _load_school_row(school_id)
    metadata = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
    metadata["platform_status"] = status
    metadata[f"{status}_at"] = _iso_now()
    if reason:
        metadata[f"{status}_reason"] = reason
    update_payload = {"metadata": metadata}
    if status == "active":
        update_payload["is_active"] = True
        metadata.pop("deleted_at", None)
    elif status in {"suspended", "archived", "deleted"}:
        update_payload["is_active"] = False
        if status == "deleted":
            metadata["deleted_at"] = _iso_now()
            metadata["soft_deleted"] = True
    rows = _public_table("schools").update(update_payload).eq("id", school_id).execute().data or []
    updated = dict(rows[0]) if rows else existing
    _audit(school_id=school_id, profile_id=actor_profile_id, action=f"platform.school.{status}", severity="warning" if status != "active" else "info", payload={"reason": reason})
    return _school_summary(updated)


def clone_school_settings(source_school_id: str, target_school_id: str, *, actor_profile_id: str | None) -> dict[str, Any]:
    source = _load_school_row(source_school_id)
    target = _load_school_row(target_school_id)
    source_metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
    target_metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
    cloned_metadata = _merge_school_metadata(
        target_metadata,
        {
            "school_domain": source_metadata.get("school_domain"),
            "academic_session": source_metadata.get("academic_session"),
            "branding": source_metadata.get("branding") if isinstance(source_metadata.get("branding"), dict) else {},
            "cloned_settings_from_school_id": source_school_id,
        },
    )
    rows = (
        _public_table("schools")
        .update(
            {
                "timezone": source.get("timezone"),
                "contact_email": source.get("contact_email"),
                "contact_phone": source.get("contact_phone"),
                "metadata": cloned_metadata,
            }
        )
        .eq("id", target_school_id)
        .execute()
        .data
        or []
    )
    _audit(school_id=target_school_id, profile_id=actor_profile_id, action="platform.school.settings_cloned", payload={"source_school_id": source_school_id})
    return _school_summary(dict(rows[0]) if rows else _load_school_row(target_school_id))


def copy_academic_structure(source_school_id: str, target_school_id: str, *, actor_profile_id: str | None) -> dict[str, Any]:
    batches = _safe_list("batches", school_id=source_school_id)
    subjects = _safe_list("subjects", school_id=source_school_id)
    created_batches = 0
    created_subjects = 0
    target_batches_by_code = {
        _normalize(row.get("batch_code")).lower(): str(row.get("id") or "")
        for row in _safe_list("batches", school_id=target_school_id)
    }
    for batch in batches:
        batch_code = _normalize(batch.get("batch_code")).lower()
        if batch_code in target_batches_by_code:
            continue
        insert_payload = {
            "school_id": target_school_id,
            "batch_code": batch.get("batch_code"),
            "name": batch.get("name"),
            "category": batch.get("category"),
            "class_name": batch.get("class_name"),
            "section": batch.get("section"),
            "academic_session": batch.get("academic_session"),
            "stream": batch.get("stream"),
            "syllabus": batch.get("syllabus"),
            "display_order": batch.get("display_order") or 0,
            "metadata": dict(batch.get("metadata") or {}),
            "is_active": batch.get("is_active", True),
        }
        created = _public_table("batches").insert(insert_payload).execute().data or []
        if created:
            created_batches += 1
            target_batches_by_code[batch_code] = str(created[0].get("id") or "")
    for subject in subjects:
        batch_code = ""
        for source_batch in batches:
            if str(source_batch.get("id") or "") == str(subject.get("batch_id") or ""):
                batch_code = _normalize(source_batch.get("batch_code")).lower()
                break
        insert_payload = {
            "school_id": target_school_id,
            "subject_code": subject.get("subject_code"),
            "name": subject.get("name"),
            "short_name": subject.get("short_name"),
            "subject_type": subject.get("subject_type"),
            "department": subject.get("department"),
            "class_name": subject.get("class_name"),
            "batch_id": target_batches_by_code.get(batch_code) or None,
            "metadata": dict(subject.get("metadata") or {}),
            "is_active": subject.get("is_active", True),
        }
        existing = (
            _public_table("subjects")
            .select("id")
            .eq("school_id", target_school_id)
            .eq("subject_code", subject.get("subject_code"))
            .limit(1)
            .execute()
            .data
            or []
        )
        if existing:
            continue
        created = _public_table("subjects").insert(insert_payload).execute().data or []
        if created:
            created_subjects += 1
    _audit(
        school_id=target_school_id,
        profile_id=actor_profile_id,
        action="platform.school.academic_structure_copied",
        payload={"source_school_id": source_school_id, "batches_created": created_batches, "subjects_created": created_subjects},
    )
    return {"source_school_id": source_school_id, "target_school_id": target_school_id, "batches_created": created_batches, "subjects_created": created_subjects}


def get_school_detail(school_id: str) -> dict[str, Any]:
    row = _load_school_row(school_id)
    counters = _resolve_counts([school_id])
    summary = _school_summary(row, counters)
    summary["subscription"] = get_subscription_summary(school_id)
    summary["usage"] = get_usage_dashboard(school_id=school_id)["items"][0]
    summary["health"] = get_health_dashboard(school_id=school_id)["items"][0]
    return summary


def get_subscription_summary(school_id: str) -> dict[str, Any]:
    service = SchoolSubscriptionService()
    plan = service.get_school_plan(school_id)
    latest_subscription = _safe_latest("subscriptions", school_id=school_id, schema="finance")
    usage = get_usage_dashboard(school_id=school_id)["items"][0]
    metadata = dict((latest_subscription or {}).get("metadata") or {})
    return {
        "school_id": school_id,
        "current_plan": plan.get("plan_tier") or "starter",
        "status": plan.get("subscription_status") or metadata.get("subscription_status") or "active",
        "expiry": (latest_subscription or {}).get("expiry_date"),
        "renewal": (latest_subscription or {}).get("renewal_date") or (latest_subscription or {}).get("expiry_date"),
        "usage": usage,
        "grace_period_days": _safe_int(metadata.get("grace_period_days"), 0),
        "payment_status": metadata.get("payment_status") or ((latest_subscription or {}).get("subscription_status") or "active"),
        "subscription_id": _normalize((latest_subscription or {}).get("id")) or None,
        "billing_cycle": metadata.get("billing_cycle") or (latest_subscription or {}).get("billing_cycle"),
        "amount": _safe_float((latest_subscription or {}).get("amount") or metadata.get("amount")) if latest_subscription else None,
        "currency": (latest_subscription or {}).get("currency") or metadata.get("currency"),
        "metadata": metadata,
    }


def _usage_item_for_school(school: dict[str, Any]) -> dict[str, Any]:
    school_id = str(school.get("id") or "")
    school_name = str(school.get("name") or "")
    students = _safe_count("students", school_id=school_id, active_only=True)
    staff_rows = _safe_list("staff_members", school_id=school_id)
    teachers = sum(1 for row in staff_rows if _normalize(row.get("staff_type")) == "teaching" and row.get("is_active", True))
    staff = sum(1 for row in staff_rows if _normalize(row.get("staff_type")) == "non_teaching" and row.get("is_active", True))
    parents = _execute_count(_public_table("school_memberships").select("id", count="exact", head=True).eq("school_id", school_id).eq("status", "active"))
    rooms = _safe_count("rooms", school_id=school_id, active_only=True)
    attendance_records = _safe_count("student_attendance", school_id=school_id, schema="attendance") + _safe_count("staff_attendance", school_id=school_id, schema="attendance")
    latest_usage_rows = (
        _public_table("usage_snapshots").select("*").eq("school_id", school_id).order("snapshot_date", desc=True).limit(1).execute().data or []
    )
    latest_usage = dict(latest_usage_rows[0]) if latest_usage_rows else {}
    ai_requests = _execute_count(
        _public_table("audit_logs")
        .select("id", count="exact", head=True)
        .eq("school_id", school_id)
        .like("action", "ai_%")
    )
    online_tests = _safe_count("tests", school_id=school_id, schema="online_tests")
    monthly_active_users = _execute_count(
        _public_table("audit_logs")
        .select("profile_id", count="exact", head=True)
        .eq("school_id", school_id)
    )
    return {
        "school_id": school_id,
        "school_name": school_name,
        "students": students,
        "teachers": teachers,
        "parents": parents,
        "staff": staff,
        "rooms": rooms,
        "attendance_records": attendance_records,
        "ai_credits_used": _safe_int(latest_usage.get("ai_credits_used"), 0),
        "ai_requests": ai_requests,
        "online_tests": online_tests,
        "storage_used_gb": _safe_float(latest_usage.get("storage_used"), 0.0),
        "database_size_mb": round(_safe_float(latest_usage.get("storage_used"), 0.0) * 64, 2),
        "monthly_active_users": monthly_active_users,
        "generated_at": _iso_now(),
    }


def get_usage_dashboard(*, school_id: str | None = None) -> dict[str, Any]:
    schools = [_load_school_row(school_id)] if school_id else [dict(row) for row in list(_public_table("schools").select("*").order("name").execute().data or [])]
    items = [_usage_item_for_school(school) for school in schools]
    return {
        "items": items,
        "total_students": sum(item["students"] for item in items),
        "total_teachers": sum(item["teachers"] for item in items),
        "total_ai_requests": sum(item["ai_requests"] for item in items),
        "total_storage_used_gb": round(sum(item["storage_used_gb"] for item in items), 2),
        "generated_at": _iso_now(),
    }


def get_health_dashboard(*, school_id: str | None = None) -> dict[str, Any]:
    schools = [_load_school_row(school_id)] if school_id else [dict(row) for row in list(_public_table("schools").select("*").order("name").execute().data or [])]
    items: list[dict[str, Any]] = []
    for school in schools:
        school_id = str(school.get("id") or "")
        school_name = str(school.get("name") or "")
        metadata = school.get("metadata") if isinstance(school.get("metadata"), dict) else {}
        latest_audit = _safe_latest("audit_logs", school_id=school_id)
        latest_session = _safe_latest("auth_sessions", school_id=school_id)
        latest_subscription = _safe_latest("subscriptions", school_id=school_id, schema="finance")
        latest_usage = _usage_item_for_school(school)
        items.append(
            {
                "school_id": school_id,
                "school_name": school_name,
                "api_status": "healthy" if school.get("is_active", True) else "degraded",
                "background_jobs": "stable",
                "queue_status": "idle",
                "storage_health": "warning" if latest_usage["storage_used_gb"] >= 80 else "healthy",
                "last_backup": metadata.get("last_backup_at"),
                "last_login": (latest_session or {}).get("last_activity") or (latest_session or {}).get("login_time"),
                "last_activity": (latest_audit or {}).get("created_at"),
                "last_billing_event": (latest_subscription or {}).get("updated_at") or (latest_subscription or {}).get("created_at"),
            }
        )
    return {"items": items, "generated_at": _iso_now()}


def global_search(query: str, *, limit: int = 25) -> dict[str, Any]:
    normalized = _normalize(query).casefold()
    if not normalized:
        return {"items": [], "total_count": 0}
    schools_map = {str(row.get("id")): str(row.get("name") or "") for row in list(_public_table("schools").select("id,name").execute().data or [])}
    items: list[dict[str, Any]] = []

    def add_item(entity_type: str, school_id: str | None, entity_id: str | None, title: str, subtitle: str | None = None, metadata: dict[str, Any] | None = None):
        if len(items) >= limit:
            return
        items.append(
            {
                "entity_type": entity_type,
                "school_id": school_id,
                "school_name": schools_map.get(school_id or "", None),
                "entity_id": entity_id,
                "title": title,
                "subtitle": subtitle,
                "metadata": metadata or {},
            }
        )

    for school in _safe_list("schools"):
        haystack = " ".join([_normalize(school.get("school_code")), _normalize(school.get("slug")), _normalize(school.get("name")), _normalize(school.get("contact_email"))]).casefold()
        if normalized in haystack:
            add_item("school", str(school.get("id") or ""), str(school.get("id") or ""), str(school.get("name") or ""), _normalize(school.get("school_code")))
    for student in _safe_list("students"):
        haystack = " ".join([_normalize(student.get("full_name")), _normalize(student.get("admission_no")), _normalize(student.get("roll_number")), _normalize(student.get("email")), _normalize(student.get("phone"))]).casefold()
        if normalized in haystack:
            add_item("student", _normalize(student.get("school_id")), _normalize(student.get("id")), _normalize(student.get("full_name")), _normalize(student.get("admission_no") or student.get("roll_number")))
    for staff in _safe_list("staff_members"):
        haystack = " ".join([_normalize(staff.get("full_name")), _normalize(staff.get("employee_code")), _normalize(staff.get("email")), _normalize(staff.get("phone"))]).casefold()
        if normalized in haystack:
            entity_type = "teacher" if _normalize(staff.get("staff_type")) == "teaching" else "staff"
            add_item(entity_type, _normalize(staff.get("school_id")), _normalize(staff.get("id")), _normalize(staff.get("full_name")), _normalize(staff.get("employee_code")))
    for profile in _safe_list("profiles"):
        haystack = " ".join([_normalize(profile.get("full_name")), _normalize(profile.get("display_name")), _normalize(profile.get("email")), _normalize(profile.get("phone"))]).casefold()
        if normalized in haystack:
            add_item("profile", _normalize(profile.get("default_school_id")) or None, _normalize(profile.get("id")), _normalize(profile.get("full_name") or profile.get("display_name") or profile.get("email")), _normalize(profile.get("email")))
    return {"items": items[:limit], "total_count": len(items[:limit])}


def get_platform_analytics_overview() -> dict[str, Any]:
    schools = list_schools()["items"]
    active_schools = [item for item in schools if item["status"] == "active"]
    subscriptions = _safe_list("subscriptions", schema="finance")
    latest_month = _utc_now().month
    revenue = sum(_safe_float(row.get("amount") or row.get("sale_price") or 0) for row in subscriptions if _normalize(row.get("subscription_status")) in {"active", "trial", "paused"})
    monthly_growth = sum(1 for item in schools if item.get("created_at") and str(item["created_at"])[5:7].isdigit() and int(str(item["created_at"])[5:7]) == latest_month)
    usage = get_usage_dashboard()
    ai_ledger = _safe_list("ai_credit_ledger")
    credit_sales = sum(_safe_float(item.get("amount")) for item in ai_ledger if _normalize(item.get("transaction_type")) == "purchase")
    trial_schools = sum(1 for row in subscriptions if _normalize(row.get("subscription_status")) == "trial")
    return {
        "total_schools": len(schools),
        "active_schools": len(active_schools),
        "trial_schools": trial_schools,
        "revenue": round(revenue, 2),
        "monthly_growth": monthly_growth,
        "student_count": usage["total_students"],
        "teacher_count": usage["total_teachers"],
        "subscriptions": len(subscriptions),
        "ai_usage": sum(_safe_int(item.get("amount")) for item in ai_ledger if _normalize(item.get("transaction_type")) == "consumption"),
        "credit_sales": round(credit_sales, 2),
        "generated_at": _iso_now(),
    }


def run_support_action(school_id: str, action: str, *, actor_profile_id: str | None, notes: str | None = None) -> dict[str, Any]:
    details: dict[str, Any] = {"notes": notes}
    if action == "recalculate_usage":
        usage = _usage_item_for_school(_load_school_row(school_id))
        upsert_payload = {
            "school_id": school_id,
            "snapshot_date": date.today().isoformat(),
            "students_used": usage["students"],
            "teachers_used": usage["teachers"],
            "parents_used": usage["parents"],
            "storage_used": usage["storage_used_gb"],
            "ai_credits_used": usage["ai_credits_used"],
            "tests_used": usage["online_tests"],
            "lms_usage": usage["monthly_active_users"],
            "updated_by": actor_profile_id,
            "created_by": actor_profile_id,
        }
        _public_table("usage_snapshots").upsert(upsert_payload, on_conflict="school_id,snapshot_date").execute()
        details["usage"] = usage
    elif action == "repair_ai_wallet":
        details["wallets_checked"] = _safe_count("ai_credit_wallets", school_id=school_id)
    elif action == "repair_subscription":
        details["subscription"] = get_subscription_summary(school_id)
    elif action == "rebuild_permissions":
        details["memberships"] = _safe_count("school_memberships", school_id=school_id)
    elif action == "impersonate_school_admin":
        memberships = (
            _public_table("school_memberships")
            .select("profile_id,roles(role_key,role_name)")
            .eq("school_id", school_id)
            .eq("status", "active")
            .execute()
            .data
            or []
        )
        admin_membership = next(
            (
                item for item in memberships
                if _normalize((item.get("roles")[0].get("role_key") if isinstance(item.get("roles"), list) and item.get("roles") else (item.get("roles") or {}).get("role_key"))) == "school_admin"
            ),
            None,
        )
        details["impersonation_target_profile_id"] = _normalize((admin_membership or {}).get("profile_id")) or None
    _audit(school_id=school_id, profile_id=actor_profile_id, action=f"platform.support.{action}", severity="warning", payload=details)
    return {"school_id": school_id, "action": action, "status": "completed", "audited": True, "details": details}


def list_audit_center(*, school_id: str | None = None, user_id: str | None = None, action: str | None = None, module_key: str | None = None, severity: str | None = None, limit: int = 100) -> dict[str, Any]:
    query = _public_table("audit_logs").select("*").order("created_at", desc=True).limit(limit)
    if school_id:
        query = query.eq("school_id", school_id)
    if user_id:
        query = query.eq("profile_id", user_id)
    if action:
        query = query.eq("action", action)
    if module_key:
        query = query.eq("module_key", module_key)
    rows = [dict(row) for row in list(query.execute().data or [])]
    if severity:
        rows = [row for row in rows if _normalize((row.get("payload") or {}).get("severity")) == _normalize(severity)]
    return {"items": rows, "total_count": len(rows)}


def list_notifications() -> dict[str, Any]:
    rows = [dict(row) for row in list(_public_table("platform_notifications").select("*").order("created_at", desc=True).execute().data or [])]
    items = []
    for row in rows:
        items.append(
            {
                "id": _normalize(row.get("id")),
                "title": _normalize(row.get("title")),
                "message": _normalize(row.get("message")),
                "notification_type": _normalize(row.get("notification_type")),
                "severity": _normalize(row.get("severity")) or "info",
                "audience_scope": _normalize(row.get("audience_scope")) or "school",
                "school_ids": list(row.get("school_ids") or []),
                "created_by_profile_id": _normalize(row.get("created_by_profile_id")) or None,
                "created_at": row.get("created_at"),
                "metadata": dict(row.get("metadata") or {}),
            }
        )
    return {"items": items, "total_count": len(items)}


def create_notification(payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    insert_payload = {
        "title": payload.get("title"),
        "message": payload.get("message"),
        "notification_type": payload.get("notification_type"),
        "severity": payload.get("severity") or "info",
        "audience_scope": payload.get("audience_scope") or "school",
        "school_ids": payload.get("school_ids") or [],
        "metadata": payload.get("metadata") or {},
        "created_by_profile_id": actor_profile_id,
    }
    rows = _public_table("platform_notifications").insert(insert_payload).execute().data or []
    if not rows:
        raise HTTPException(status_code=400, detail="Unable to create platform notification")
    created = dict(rows[0])
    _audit(school_id=None, profile_id=actor_profile_id, action="platform.notification.created", payload={"notification_id": created.get("id"), "audience_scope": created.get("audience_scope")})
    return {
        "id": _normalize(created.get("id")),
        "title": _normalize(created.get("title")),
        "message": _normalize(created.get("message")),
        "notification_type": _normalize(created.get("notification_type")),
        "severity": _normalize(created.get("severity")),
        "audience_scope": _normalize(created.get("audience_scope")),
        "school_ids": list(created.get("school_ids") or []),
        "created_by_profile_id": _normalize(created.get("created_by_profile_id")) or None,
        "created_at": created.get("created_at"),
        "metadata": dict(created.get("metadata") or {}),
    }


def run_onboarding(payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    audit_events = ["platform.school.created", "platform.onboarding.started"]
    _audit(school_id=None, profile_id=actor_profile_id, action="platform.onboarding.started", payload={"school_name": payload.get("name"), "admin_email": payload.get("admin_email")})
    school = create_school(payload, actor_profile_id=actor_profile_id)
    school_id = school["id"]
    roles_created = 0
    permissions_seeded = False
    provisioning = {
        "school_settings": False,
        "academic_session": False,
        "role_templates": False,
        "permission_templates": False,
        "departments": False,
        "attendance_settings": False,
        "timetable_settings": False,
        "examination_settings": False,
        "ai_settings": False,
        "notification_settings": False,
        "usage_counters": False,
        "subscription": False,
        "ai_wallet": False,
        "platform_notification": False,
        "audit_entry": True,
    }
    seeded_permissions = _school_admin_permissions()
    for role_key, role_name in (("school_admin", "School Admin"), ("teacher", "Teacher"), ("student", "Student"), ("parent", "Parent"), ("viewer", "Viewer")):
        existing = _public_table("roles").select("id").eq("school_id", school_id).eq("role_key", role_key).limit(1).execute().data or []
        if existing:
            continue
        created_role_rows = _public_table("roles").insert(
            {
                "school_id": school_id,
                "role_key": role_key,
                "role_name": role_name,
                "scope": "school",
                "is_system": False,
                "is_active": True,
                "metadata": {"created_by": "platform_onboarding"},
            }
        ).execute().data or []
        if role_key == "school_admin" and created_role_rows and seeded_permissions:
            permission_rows = _public_table("permissions").select("id,permission_key").in_("permission_key", seeded_permissions).execute().data or []
            permission_map = {_normalize(row.get("permission_key")): _normalize(row.get("id")) for row in permission_rows}
            role_permission_rows = [
                {"role_id": _normalize(created_role_rows[0].get("id")), "permission_id": permission_map[key]}
                for key in seeded_permissions
                if key in permission_map
            ]
            if role_permission_rows:
                _public_table("role_permissions").insert(role_permission_rows).execute()
        roles_created += 1
    permissions_seeded = True
    provisioning["role_templates"] = True
    provisioning["permission_templates"] = True
    batches_created = 0
    if payload.get("create_default_batches", True):
        for batch in (
            {"batch_code": "CLASS-1", "name": "Class 1", "class_name": "1", "section": "A"},
            {"batch_code": "CLASS-2", "name": "Class 2", "class_name": "2", "section": "A"},
        ):
            _public_table("batches").insert(
                {
                    "school_id": school_id,
                    "batch_code": batch["batch_code"],
                    "name": batch["name"],
                    "class_name": batch["class_name"],
                    "section": batch["section"],
                    "academic_session": payload.get("academic_session"),
                    "metadata": {"created_by": "platform_onboarding"},
                }
            ).execute()
            batches_created += 1
    provisioning.update(_provision_school_defaults(_load_school_row(school_id), payload, actor_profile_id=actor_profile_id))
    admin_account = _provision_school_admin(_load_school_row(school_id), payload, actor_profile_id=actor_profile_id)
    audit_events.append("platform.onboarding.credentials_generated")
    school_plan_rows = _public_table("school_plans").upsert(
        {
            "school_id": school_id,
            "plan_tier": payload.get("plan_tier") or "starter",
            "subscription_status": "trial",
            "effective_from": date.today().isoformat(),
            "created_by": actor_profile_id,
            "updated_by": actor_profile_id,
            "student_limit": payload.get("max_students") if payload.get("max_students") is not None else 100,
            "teacher_limit": payload.get("max_teachers") if payload.get("max_teachers") is not None else 10,
            "parent_limit": payload.get("max_parents") if payload.get("max_parents") is not None else 50,
            "storage_limit_gb": payload.get("max_storage_gb") if payload.get("max_storage_gb") is not None else 5,
            "metadata": {
                "billing_cycle": payload.get("billing_cycle") or "monthly",
                "max_staff": payload.get("max_staff"),
            },
        },
        on_conflict="school_id",
    ).execute().data or []
    subscription_initialized = bool(school_plan_rows or True)
    provisioning["subscription"] = subscription_initialized
    _public_table("usage_snapshots").upsert(
        {
            "school_id": school_id,
            "snapshot_date": date.today().isoformat(),
            "created_by": actor_profile_id,
            "updated_by": actor_profile_id,
        },
        on_conflict="school_id,snapshot_date",
    ).execute()
    usage_initialized = True
    provisioning["usage_counters"] = True
    ai_wallet_initialized = False
    if payload.get("initialize_ai_wallet", True):
        _public_table("ai_credit_wallets").upsert(
            {
                "profile_id": admin_account["profile_id"],
                "school_id": school_id,
                "wallet_type": "school",
                "balance": 0,
                "created_by": actor_profile_id,
                "updated_by": actor_profile_id,
            },
            on_conflict="profile_id,school_id,wallet_type",
        ).execute()
        ai_wallet_initialized = True
    provisioning["ai_wallet"] = ai_wallet_initialized
    admin_membership_created = bool(admin_account.get("membership_created"))
    _public_table("platform_notifications").insert(
        {
            "title": f"Welcome {school['name']}",
            "message": f"{school['name']} is provisioned and ready for first login.",
            "notification_type": "system_alert",
            "severity": "info",
            "audience_scope": "school",
            "school_ids": [school_id],
            "metadata": {"source": "platform_onboarding", "admin_profile_id": admin_account["profile_id"]},
            "created_by_profile_id": actor_profile_id,
        }
    ).execute()
    provisioning["platform_notification"] = True
    _audit(school_id=school_id, profile_id=actor_profile_id, action="platform.onboarding.credentials_generated", payload={"username": admin_account["username"], "login_email": admin_account["login_email"]})
    _audit(school_id=school_id, profile_id=actor_profile_id, action="platform.onboarding.completed", payload={"roles_created": roles_created, "batches_created": batches_created, "admin_profile_id": admin_account["profile_id"]})
    audit_events.extend(["platform.onboarding.completed", "platform.school.activated"])
    return {
        "school": school,
        "admin": {
            "profile_id": admin_account["profile_id"],
            "full_name": admin_account["full_name"],
            "email": admin_account["login_email"],
            "mobile": admin_account["mobile"],
            "employee_code": admin_account["employee_code"],
            "role_key": "school_admin",
            "first_login_completed": False,
            "must_change_password": True,
        },
        "credentials": {
            "username": admin_account["username"],
            "temporary_password": admin_account["temporary_password"],
            "login_email": admin_account["login_email"],
            "login_url": "/login",
            "expires_at": (_utc_now() + timedelta(days=7)).isoformat(),
            "visible_once": True,
        },
        "provisioning": provisioning,
        "roles_created": roles_created,
        "permissions_seeded": permissions_seeded,
        "batches_created": batches_created,
        "subscription_initialized": subscription_initialized,
        "usage_initialized": usage_initialized,
        "ai_wallet_initialized": ai_wallet_initialized,
        "admin_membership_created": admin_membership_created,
        "admin_account_created": bool(admin_account.get("account_created")),
        "notification_created": True,
        "activation_status": "provisioned",
        "audit_events": audit_events,
    }


def regenerate_school_admin_credentials(school_id: str, *, actor_profile_id: str | None) -> dict[str, Any]:
    school = _load_school_row(school_id)
    memberships = (
        _public_table("school_memberships")
        .select("profile_id,role_id,roles(*)")
        .eq("school_id", school_id)
        .eq("status", "active")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    admin_membership = next(
        (
            item for item in memberships
            if _normalize(((item.get("roles")[0] if isinstance(item.get("roles"), list) and item.get("roles") else item.get("roles") or {}).get("metadata") or {}).get("role_key")) == "school_admin"
            or _normalize((item.get("roles")[0] if isinstance(item.get("roles"), list) and item.get("roles") else item.get("roles") or {}).get("role_key")) == "school_admin"
        ),
        None,
    )
    if not admin_membership:
        raise HTTPException(status_code=404, detail="School admin account not found")
    profile_id = _normalize(admin_membership.get("profile_id"))
    profile = _load_profile(profile_id)
    username = _normalize(profile.get("display_name")) or _school_admin_username(_normalize(school.get("school_code")), _normalize(school.get("name")))
    login_email = _normalize(profile.get("email"))
    temporary_password = generate_secure_password(length=16)
    _create_or_update_auth_user(
        school_id=school_id,
        profile_id=profile_id,
        login_email=login_email,
        username=username,
        full_name=_normalize(profile.get("full_name")) or username,
        phone=_normalize(profile.get("phone")) or None,
        password=temporary_password,
        selected_role="school_admin",
    )
    portal_access = dict((((profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {}).get("portal_access")) or {}))
    portal_access.update(
        {
            "must_change_password": True,
            "first_login_completed": False,
            "school_onboarding_required": True,
            "onboarding_status": "pending",
            "temporary_password_expires_at": (_utc_now() + timedelta(days=7)).isoformat(),
            "last_password_reset_at": _iso_now(),
        }
    )
    metadata = _merge_school_metadata(profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {}, {"portal_access": portal_access})
    _public_table("profiles").update({"metadata": metadata}).eq("id", profile_id).execute()
    _audit(school_id=school_id, profile_id=actor_profile_id, action="platform.onboarding.credentials_regenerated", payload={"profile_id": profile_id, "username": username})
    return {
        "username": username,
        "temporary_password": temporary_password,
        "login_email": login_email,
        "login_url": "/login",
        "expires_at": (_utc_now() + timedelta(days=7)).isoformat(),
        "visible_once": True,
    }
