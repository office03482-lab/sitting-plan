"""Supabase-backed portal access, session management, and account security helpers."""

from __future__ import annotations

import io
import logging
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from openpyxl import Workbook

from app.services.supabase_admin import create_supabase_admin_client

logger = logging.getLogger(__name__)

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
PORTAL_PERMISSION_TEMPLATES = {
    "student": {
        "label": "Student Template",
        "selected_role": "student",
        "permissions": [
            "lms.view",
            "online_tests.attempt",
            "timetable.view",
            "ai_tutor.chat",
            "live_classes.join",
        ],
    },
    "parent": {
        "label": "Parent Template",
        "selected_role": "parent",
        "permissions": [
            "parent_intelligence.view",
            "attendance.student",
            "lms.assignments",
            "online_tests.view",
            "edupay.parent_portal",
        ],
    },
    "teacher": {
        "label": "Teacher",
        "selected_role": "teacher",
        "permissions": DEFAULT_TEACHER_PERMISSIONS,
    },
    "class_teacher": {
        "label": "Class Teacher",
        "selected_role": "teacher",
        "permissions": [
            "attendance",
            "attendance.student",
            "attendance.reports",
            "timetable",
            "lms.view",
            "lms.manage",
            "lms.progress",
            "lms.assignments",
            "online_tests.view",
            "online_tests.manage",
            "online_tests.grade",
            "study_planner.reports",
            "teacher_ai.generate",
            "teacher_ai.reports",
        ],
    },
    "academic_coordinator": {
        "label": "Academic Coordinator",
        "selected_role": "teacher",
        "permissions": [
            "admin_office.batches",
            "admin_office.students",
            "attendance",
            "attendance.reports",
            "timetable",
            "timetable.manage",
            "lms.view",
            "lms.manage",
            "online_tests.view",
            "online_tests.manage",
            "online_tests.reports",
            "teacher_ai.generate",
            "teacher_ai.reports",
            "study_planner.reports",
        ],
    },
    "exam_cell": {
        "label": "Exam Cell",
        "selected_role": "staff",
        "permissions": [
            "admin_office.seating_generation",
            "admin_office.seating_plans",
            "admin_office.rooms",
            "admin_office.invigilators",
            "admin_office.reports",
            "online_tests.view",
            "online_tests.manage",
            "online_tests.grade",
            "online_tests.reports",
        ],
    },
    "store_manager": {
        "label": "Store Manager",
        "selected_role": "store_manager",
        "permissions": [
            "inventory",
            "inventory.dashboard",
            "inventory.materials",
            "inventory.suppliers",
            "inventory.stock_in",
            "inventory.stock_out",
            "inventory.reports",
        ],
    },
    "accountant": {
        "label": "Accountant",
        "selected_role": "staff",
        "permissions": [
            "edupay",
            "edupay.dashboard",
            "edupay.students",
            "edupay.fees",
            "edupay.payments",
            "edupay.revenue",
        ],
    },
    "viewer": {
        "label": "Viewer",
        "selected_role": "viewer",
        "permissions": [
            "attendance.overview",
            "timetable.view",
            "lms.view",
            "online_tests.view",
            "live_classes.view",
        ],
    },
    "custom": {
        "label": "Custom Role",
        "selected_role": "staff",
        "permissions": [],
    },
}


def _client():
    return create_supabase_admin_client()


def _public_table(name: str, *, supabase: Any | None = None):
    client = supabase or _client()
    return client.table(name)


def _schema_table(schema: str, name: str, *, supabase: Any | None = None):
    client = supabase or _client()
    return client.schema(schema).table(name)


def _eq_boolean(query: Any, column: str, value: bool) -> Any:
    return query.filter(column, "eq", str(bool(value)).lower())


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional(value: Any) -> str | None:
    text = _normalize(value)
    return text or None


def _normalize_role_key(value: Any) -> str:
    return _normalize(value).lower()


def normalize_staff_type(value: Any) -> str | None:
    normalized = _normalize_role_key(value)
    if not normalized:
        return None
    if normalized in {"teacher", "teaching"}:
        return "teaching"
    if normalized in {"staff", "non_teaching", "non-teaching", "invigilator"}:
        return "invigilator"
    return normalized


def _slug_token(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", _normalize(value)).upper()


def _digits_only(value: Any) -> str:
    return "".join(ch for ch in _normalize(value) if ch.isdigit())


def _escape_ilike(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace(",", "\\,")


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
        value = "".join(secrets.choice(alphabet) for _ in range(max(length, 10)))
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


def _student_username(roll_number: str) -> str:
    token = _slug_token(roll_number)
    if not token:
        raise HTTPException(status_code=400, detail="Student roll number is required for portal access")
    return f"STU{token}"


def _parent_username(guardian_code: str | None, guardian_id: str) -> str:
    token = _slug_token(guardian_code) or _digits_only(guardian_id) or _slug_token(guardian_id)[:10]
    if not token:
        raise HTTPException(status_code=400, detail="Guardian identifier is required for portal access")
    return f"PAR{token}"


def _staff_username(employee_code: str, *, selected_role: str) -> str:
    token = _slug_token(employee_code)
    if not token:
        raise HTTPException(status_code=400, detail="Employee code is required for portal access")
    return f"{'TCH' if _normalize_role_key(selected_role) == 'teacher' else 'STF'}{token}"


def _default_portal_login_email(school_id: str, username: str, entity_type: str) -> str:
    return f"{username.lower()}@{_school_slug(school_id)}.{entity_type}.local"


def _load_profile(profile_id: str, *, supabase: Any | None = None) -> dict[str, Any]:
    rows = list(
        _public_table("profiles", supabase=supabase)
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


def _load_school_membership(school_id: str, profile_id: str, *, supabase: Any | None = None) -> dict[str, Any] | None:
    rows = list(
        _public_table("school_memberships", supabase=supabase)
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
    query = _eq_boolean(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,roll_number,full_name,email,phone,created_at,metadata,is_active")
        .eq("school_id", school_id),
        "is_active",
        True,
    )
    if batch_id:
        query = query.eq("batch_id", batch_id)
    rows = list(query.order("roll_number").execute().data or [])
    return [dict(row) for row in rows]


def _load_students_for_scope(
    school_id: str,
    *,
    batch_id: str | None = None,
    class_name: str | None = None,
    supabase: Any | None = None,
) -> list[dict[str, Any]]:
    query = _eq_boolean(
        _public_table("students", supabase=supabase)
        .select("id,school_id,profile_id,batch_id,roll_number,full_name,email,phone,class_name,section,created_at,metadata,is_active")
        .eq("school_id", school_id),
        "is_active",
        True,
    )
    if batch_id:
        query = query.eq("batch_id", batch_id)
    if class_name:
        query = query.eq("class_name", class_name)
    rows = list(query.order("roll_number").execute().data or [])
    records = [dict(row) for row in rows]
    batch_names = _load_batch_names_for_students(school_id, records, supabase=supabase)
    for record in records:
        record["batch_name"] = batch_names.get(_normalize(record.get("batch_id"))) or "Unassigned"
    return records


def _load_batch_names_for_students(
    school_id: str,
    student_rows: list[dict[str, Any]],
    *,
    supabase: Any | None = None,
) -> dict[str, str]:
    batch_ids = sorted({_normalize(row.get("batch_id")) for row in student_rows if _normalize(row.get("batch_id"))})
    if not batch_ids:
        return {}
    rows = list(
        _public_table("batches", supabase=supabase)
        .select("id,name,batch_code")
        .eq("school_id", school_id)
        .in_("id", batch_ids)
        .execute()
        .data
        or []
    )
    batch_names: dict[str, str] = {}
    for row in rows:
        batch_id = _normalize(row.get("id"))
        if batch_id:
            batch_names[batch_id] = _normalize(row.get("name")) or _normalize(row.get("batch_code")) or "Unassigned"
    return batch_names


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
        .select("id,school_id,profile_id,guardian_code,full_name,email,phone,relation_type,address,metadata,is_active,created_at")
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
        .select("id,school_id,profile_id,employee_code,full_name,email,phone,staff_type,department,designation,metadata,is_active,created_at")
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


def _load_staff_members_for_scope(
    school_id: str,
    *,
    staff_type: str | None = None,
    supabase: Any | None = None,
) -> list[dict[str, Any]]:
    rows = list(
        _eq_boolean(
            _public_table("staff_members", supabase=supabase)
            .select("id,school_id,profile_id,employee_code,full_name,email,phone,staff_type,department,designation,metadata,is_active,created_at")
            .eq("school_id", school_id),
            "is_active",
            True,
        )
        .order("full_name")
        .execute()
        .data
        or []
    )
    records = [dict(row) for row in rows]
    requested_staff_type = _normalize_optional(staff_type)
    normalized_type = normalize_staff_type(staff_type)
    if normalized_type in {"teaching", "invigilator"}:
        records = [row for row in records if _normalize_role_key(row.get("staff_type")) == normalized_type]
    logger.info(
        "portal_access_manager.staff_scope",
        extra={
            "school_id": school_id,
            "requested_staff_type": requested_staff_type,
            "normalized_staff_type": normalized_type,
            "returned_record_count": len(records),
        },
    )
    return records


def _load_guardian_ids_for_students(school_id: str, student_ids: list[str], *, supabase: Any | None = None) -> list[str]:
    if not student_ids:
        return []
    rows = list(
        _schema_table("academic", "student_guardians", supabase=supabase)
        .select("guardian_id")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .execute()
        .data
        or []
    )
    guardian_ids = []
    seen: set[str] = set()
    for row in rows:
        guardian_id = _normalize(row.get("guardian_id"))
        if guardian_id and guardian_id not in seen:
            seen.add(guardian_id)
            guardian_ids.append(guardian_id)
    return guardian_ids


def _load_guardians_for_scope(
    school_id: str,
    *,
    guardian_ids: list[str] | None = None,
    student_ids: list[str] | None = None,
    batch_id: str | None = None,
    class_name: str | None = None,
    supabase: Any | None = None,
) -> list[dict[str, Any]]:
    resolved_guardian_ids = [_normalize(item) for item in (guardian_ids or []) if _normalize(item)]
    if student_ids:
        resolved_guardian_ids.extend(
            _load_guardian_ids_for_students(
                school_id,
                [_normalize(item) for item in student_ids if _normalize(item)],
                supabase=supabase,
            )
        )
    if batch_id or class_name:
        students = _load_students_for_scope(
            school_id,
            batch_id=batch_id,
            class_name=class_name,
            supabase=supabase,
        )
        resolved_guardian_ids.extend(
            _load_guardian_ids_for_students(
                school_id,
                [_normalize(row.get("id")) for row in students],
                supabase=supabase,
            )
        )
    normalized_guardian_ids: list[str] = []
    seen: set[str] = set()
    for guardian_id in resolved_guardian_ids:
        if guardian_id and guardian_id not in seen:
            seen.add(guardian_id)
            normalized_guardian_ids.append(guardian_id)
    query = (
        _eq_boolean(
            _schema_table("academic", "guardians", supabase=supabase)
            .select("id,school_id,profile_id,guardian_code,full_name,email,phone,relation_type,address,metadata,is_active,created_at")
            .eq("school_id", school_id),
            "is_active",
            True,
        )
    )
    if normalized_guardian_ids:
        query = query.in_("id", normalized_guardian_ids)
    rows = list(query.order("full_name").execute().data or [])
    return [dict(row) for row in rows]


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


def _module_label(key: str) -> str:
    return " ".join(word.capitalize() for word in _normalize(key).split("_") if word)


def _permission_leaf_label(key: str) -> str:
    value = _normalize(key)
    if "." in value:
        value = value.split(".", 1)[1]
    return _module_label(value)


def _selected_role_from_membership(membership: dict[str, Any] | None) -> str:
    role_data = membership.get("roles") if isinstance(membership, dict) else None
    if isinstance(role_data, list):
        role_data = role_data[0] if role_data else None
    metadata = _json_object((role_data or {}).get("metadata")) if isinstance(role_data, dict) else {}
    selected_role = _normalize_role_key(metadata.get("role_key"))
    if selected_role:
        return selected_role
    role_key = _normalize_role_key((role_data or {}).get("role_key")) if isinstance(role_data, dict) else ""
    return role_key or "viewer"


def _normalize_scope_value(value: Any) -> str:
    normalized = _normalize_role_key(value)
    return normalized if normalized in {"own", "assigned", "school", "platform"} else "school"


def _default_scope_for_permission(permission_key: str, selected_role: str) -> str:
    normalized_role = _normalize_role_key(selected_role)
    if normalized_role == "platform_admin":
        return "platform"
    if normalized_role in {"student", "parent"}:
        return "own"
    if normalized_role in {"teacher", "staff", "viewer", "store_manager"}:
        return "assigned"
    return "school"


def _normalize_scope_assignments(
    assignments: dict[str, Any] | None,
    *,
    permissions: list[str],
    selected_role: str,
) -> dict[str, str]:
    normalized_permissions = [_normalize_role_key(item) for item in permissions if _normalize_role_key(item)]
    raw_assignments = assignments if isinstance(assignments, dict) else {}
    result: dict[str, str] = {}
    for permission_key in normalized_permissions:
        result[permission_key] = _normalize_scope_value(raw_assignments.get(permission_key) or _default_scope_for_permission(permission_key, selected_role))
    return result


def _resolve_template_key_for_role(selected_role: str, permissions: list[str]) -> str:
    from app.routes.auth import normalize_permissions

    normalized_role = _normalize_role_key(selected_role)
    normalized_permissions = normalize_permissions(permissions)
    for key, template in PORTAL_PERMISSION_TEMPLATES.items():
        if key == "custom":
            continue
        if _normalize_role_key(template.get("selected_role")) != normalized_role:
            continue
        if normalize_permissions(template.get("permissions")) == normalized_permissions:
            return key
    return "custom"


def _group_permissions(
    *,
    granted_permissions: list[str],
    template_permissions: list[str],
) -> list[dict[str, Any]]:
    from app.routes.auth import ALLOWED_PERMISSIONS, PERMISSION_CHILDREN, normalize_permissions

    granted_set = set(normalize_permissions(granted_permissions))
    template_set = set(normalize_permissions(template_permissions))
    changed_keys = granted_set.symmetric_difference(template_set)
    module_keys = list(PERMISSION_CHILDREN.keys())
    grouped: list[dict[str, Any]] = []

    for module_key in module_keys:
        child_keys = list(PERMISSION_CHILDREN.get(module_key) or [])
        granted_count = sum(1 for key in child_keys if key in granted_set)
        entries: list[dict[str, Any]] = []
        for permission_key in child_keys:
            if permission_key not in granted_set and permission_key not in template_set and permission_key not in changed_keys:
                continue
            entries.append(
                {
                    "key": permission_key,
                    "label": _permission_leaf_label(permission_key),
                    "granted": permission_key in granted_set,
                    "from_template": permission_key in template_set,
                    "manually_added": permission_key in granted_set and permission_key not in template_set,
                    "manually_removed": permission_key not in granted_set and permission_key in template_set,
                }
            )
        if entries:
            grouped.append(
                {
                    "key": module_key,
                    "label": _module_label(module_key),
                    "count": granted_count,
                    "permissions": entries,
                }
            )

    standalone_keys = sorted(
        key
        for key in ALLOWED_PERMISSIONS
        if "." not in key and key not in PERMISSION_CHILDREN
    )
    for permission_key in standalone_keys:
        if permission_key not in granted_set and permission_key not in template_set and permission_key not in changed_keys:
            continue
        grouped.append(
            {
                "key": permission_key,
                "label": _module_label(permission_key),
                "count": 1 if permission_key in granted_set else 0,
                "permissions": [
                    {
                        "key": permission_key,
                        "label": _module_label(permission_key),
                        "granted": permission_key in granted_set,
                        "from_template": permission_key in template_set,
                        "manually_added": permission_key in granted_set and permission_key not in template_set,
                        "manually_removed": permission_key not in granted_set and permission_key in template_set,
                    }
                ],
            }
        )
    return grouped


def _load_role_permissions_batch(role_ids: list[str], *, supabase: Any | None = None) -> dict[str, list[str]]:
    from app.routes.auth import normalize_permissions

    ids = [_normalize(item) for item in role_ids if _normalize(item)]
    if not ids:
        return {}
    rows = list(
        _public_table("role_permissions", supabase=supabase)
        .select("role_id,permissions(permission_key)")
        .in_("role_id", ids)
        .execute()
        .data
        or []
    )
    result: dict[str, list[str]] = {}
    for row in rows:
        role_id = _normalize(row.get("role_id"))
        permission_data = row.get("permissions")
        permission_key = _normalize_role_key(permission_data.get("permission_key")) if isinstance(permission_data, dict) else ""
        if role_id and permission_key:
            result.setdefault(role_id, [])
            result[role_id].append(permission_key)
    return {key: normalize_permissions(value) for key, value in result.items()}


def get_permission_templates() -> list[dict[str, Any]]:
    from app.routes.auth import normalize_permissions

    templates: list[dict[str, Any]] = []
    for key, value in PORTAL_PERMISSION_TEMPLATES.items():
        templates.append(
            {
                "key": key,
                "label": value["label"],
                "selected_role": value["selected_role"],
                "permissions": normalize_permissions(value["permissions"]),
            }
        )
    return templates


def get_role_template_permissions(role: str) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions

    template_key = _normalize_role_key(role)
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key)
    if not template:
        raise HTTPException(status_code=404, detail="Permission template not found")
    template_permissions = normalize_permissions(template.get("permissions"))
    return {
        "template_key": template_key,
        "template_label": _normalize(template.get("label")) or _module_label(template_key),
        "selected_role": _normalize_role_key(template.get("selected_role")),
        "permission_count": len(template_permissions),
        "groups": _group_permissions(granted_permissions=template_permissions, template_permissions=template_permissions),
    }


def get_user_permission_summary(school_id: str, profile_id: str) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions

    profile = _load_profile(profile_id)
    membership = _load_school_membership(school_id, profile_id)
    if not membership:
        raise HTTPException(status_code=404, detail="School membership not found for account")
    role_id = _normalize(membership.get("role_id"))
    current_permissions = _load_role_permissions_batch([role_id]).get(role_id, [])
    selected_role = _selected_role_from_membership(membership)
    template_key = _resolve_template_key_for_role(selected_role, current_permissions)
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key) or {"label": "Custom Role", "permissions": [], "selected_role": selected_role}
    template_permissions = normalize_permissions(template.get("permissions"))
    role_data = membership.get("roles") if isinstance(membership, dict) else None
    if isinstance(role_data, list):
        role_data = role_data[0] if role_data else None
    role_metadata = _json_object((role_data or {}).get("metadata")) if isinstance(role_data, dict) else {}
    scope_assignments = _normalize_scope_assignments(
        role_metadata.get("scope_assignments"),
        permissions=current_permissions,
        selected_role=selected_role,
    )
    latest_session = _latest_session_for_profile(profile_id)
    active_sessions = _active_session_count(profile_id)
    grouped = _group_permissions(granted_permissions=current_permissions, template_permissions=template_permissions)
    manually_added = [key for key in current_permissions if key not in template_permissions]
    manually_removed = [key for key in template_permissions if key not in current_permissions]
    return {
        "profile_id": profile_id,
        "user_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")) or "User",
        "username": _normalize(profile.get("display_name")),
        "login_email": _normalize_optional(profile.get("email")),
        "role": selected_role,
        "role_label": _module_label(selected_role),
        "status": "active" if bool(profile.get("is_active", True) and membership.get("is_active", True)) else "disabled",
        "is_enabled": bool(profile.get("is_active", True) and membership.get("is_active", True)),
        "last_login": latest_session.get("login_time") if latest_session else _portal_metadata(profile).get("last_login"),
        "last_activity": latest_session.get("last_activity") if latest_session else None,
        "active_sessions": active_sessions,
        "created_at": profile.get("created_at"),
        "permission_count": len(current_permissions),
        "template_key": template_key,
        "template_label": _normalize(template.get("label")) or "Custom Role",
        "selected_role": selected_role,
        "template_permission_count": len(template_permissions),
        "manual_add_count": len(manually_added),
        "manual_remove_count": len(manually_removed),
        "permissions": current_permissions,
        "scope_assignments": scope_assignments,
        "template_permissions": template_permissions,
        "manually_added": manually_added,
        "manually_removed": manually_removed,
        "groups": grouped,
    }


def update_user_permissions(
    school_id: str,
    profile_id: str,
    *,
    actor_profile_id: str | None,
    selected_role: str | None = None,
    permission_template: str | None = None,
    permissions: list[str] | None = None,
    scope_assignments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions, validate_role_input

    profile = _load_profile(profile_id)
    membership = _load_school_membership(school_id, profile_id)
    if not membership:
        raise HTTPException(status_code=404, detail="School membership not found for account")
    previous_summary = get_user_permission_summary(school_id, profile_id)
    next_role = validate_role_input(selected_role or previous_summary.get("selected_role") or previous_summary.get("role") or "viewer")
    template_key = _normalize_role_key(permission_template) or _resolve_template_key_for_role(next_role, previous_summary.get("permissions") or [])
    if template_key != "custom" and template_key not in PORTAL_PERMISSION_TEMPLATES:
        raise HTTPException(status_code=404, detail="Permission template not found")
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key, PORTAL_PERMISSION_TEMPLATES["custom"])
    resolved_permissions = normalize_permissions(permissions if template_key == "custom" else template.get("permissions"))
    resolved_scope_assignments = _normalize_scope_assignments(
        scope_assignments if scope_assignments is not None else previous_summary.get("scope_assignments"),
        permissions=resolved_permissions,
        selected_role=next_role,
    )
    role_row = _ensure_membership_role(
        school_id,
        profile_id,
        full_name=_normalize(profile.get("full_name")) or _normalize(profile.get("display_name")) or "User",
        selected_role=next_role,
        permissions=resolved_permissions,
        scope_assignments=resolved_scope_assignments,
    )
    _public_table("school_memberships").update({"role_id": _normalize(role_row.get("id"))}).eq("id", membership["id"]).execute()

    previous_role = _normalize_role_key(previous_summary.get("selected_role"))
    if previous_role != next_role:
        _record_audit(
            school_id=school_id,
            actor_profile_id=actor_profile_id,
            action="role.changed",
            entity_id=profile_id,
            payload={
                "profile_id": profile_id,
                "username": _normalize(profile.get("display_name")),
                "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
                "previous_role": previous_role,
                "next_role": next_role,
                "action_label": "Role Changed",
            },
        )

    previous_permissions = set(previous_summary.get("permissions") or [])
    next_permissions = set(resolved_permissions)
    for permission_key in sorted(next_permissions - previous_permissions):
        _record_audit(
            school_id=school_id,
            actor_profile_id=actor_profile_id,
            action="permission.added",
            entity_id=profile_id,
            payload={
                "profile_id": profile_id,
                "username": _normalize(profile.get("display_name")),
                "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
                "permission_key": permission_key,
                "action_label": "Permission Added",
            },
        )
    for permission_key in sorted(previous_permissions - next_permissions):
        _record_audit(
            school_id=school_id,
            actor_profile_id=actor_profile_id,
            action="permission.removed",
            entity_id=profile_id,
            payload={
                "profile_id": profile_id,
                "username": _normalize(profile.get("display_name")),
                "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
                "permission_key": permission_key,
                "action_label": "Permission Removed",
            },
        )
    previous_scopes = {
        _normalize_role_key(key): _normalize_scope_value(value)
        for key, value in dict(previous_summary.get("scope_assignments") or {}).items()
        if _normalize_role_key(key)
    }
    for permission_key in sorted(next_permissions):
        previous_scope = previous_scopes.get(permission_key)
        next_scope = resolved_scope_assignments.get(permission_key)
        if not next_scope or previous_scope == next_scope:
            continue
        _record_audit(
            school_id=school_id,
            actor_profile_id=actor_profile_id,
            action="permission.scope_changed",
            entity_id=profile_id,
            payload={
                "profile_id": profile_id,
                "username": _normalize(profile.get("display_name")),
                "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
                "permission_key": permission_key,
                "previous_scope": previous_scope,
                "next_scope": next_scope,
                "action_label": "Permission Scope Changed",
            },
        )
    return get_user_permission_summary(school_id, profile_id)


def reset_user_permissions_to_template(
    school_id: str,
    profile_id: str,
    *,
    actor_profile_id: str | None,
    permission_template: str | None = None,
    selected_role: str | None = None,
) -> dict[str, Any]:
    summary = get_user_permission_summary(school_id, profile_id)
    next_role = selected_role or summary.get("selected_role") or summary.get("role")
    template_key = _normalize_role_key(permission_template)
    if not template_key:
        template_key = _resolve_template_key_for_role(_normalize_role_key(next_role), summary.get("template_permissions") or summary.get("permissions") or [])
        if template_key == "custom":
            role_matches = [
                key for key, value in PORTAL_PERMISSION_TEMPLATES.items()
                if key != "custom" and _normalize_role_key(value.get("selected_role")) == _normalize_role_key(next_role)
            ]
            template_key = role_matches[0] if role_matches else "custom"
    return update_user_permissions(
        school_id,
        profile_id,
        actor_profile_id=actor_profile_id,
        selected_role=next_role,
        permission_template=template_key,
        permissions=None,
        scope_assignments=None,
    )


def _ensure_membership_role(
    school_id: str,
    profile_id: str,
    *,
    full_name: str,
    selected_role: str,
    permissions: list[str] | None = None,
    scope_assignments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import _ensure_managed_role, normalize_permissions

    role_permissions = normalize_permissions(permissions or _default_permissions_for_role(selected_role))
    normalized_scope_assignments = _normalize_scope_assignments(
        scope_assignments,
        permissions=role_permissions,
        selected_role=selected_role,
    )
    return _ensure_managed_role(
        school_id,
        profile_id,
        full_name=full_name,
        selected_role=selected_role,
        user_type=_role_user_type(selected_role),
        permissions=role_permissions,
        metadata_updates={"scope_assignments": normalized_scope_assignments},
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


def _purge_expired_generated_credentials(*, supabase: Any | None = None) -> None:
    try:
        _public_table("generated_credentials", supabase=supabase).delete().lt("expires_at", _now_iso()).execute()
    except Exception:
        logger.exception("Failed to purge expired generated credentials")


def _store_generated_credential(
    *,
    school_id: str,
    profile_id: str,
    entity_type: str,
    entity_id: str,
    role_key: str,
    username: str,
    login_email: str,
    temporary_password: str,
    created_by: str | None,
    entity_name: str | None = None,
) -> None:
    _purge_expired_generated_credentials()
    payload = {
        "school_id": school_id,
        "profile_id": profile_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "role_key": role_key,
        "entity_name": entity_name,
        "username": username,
        "login_email": login_email,
        "temporary_password": temporary_password,
        "created_by": created_by,
        "viewed": False,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }
    _public_table("generated_credentials").insert(payload).execute()


def get_recent_generated_credentials(
    school_id: str,
    *,
    created_by: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    _purge_expired_generated_credentials()
    query = (
        _public_table("generated_credentials")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .limit(max(1, min(limit, 250)))
    )
    if created_by:
        query = query.eq("created_by", created_by)
    rows = list(query.execute().data or [])
    return [dict(row) for row in rows]


def get_generated_credential_details(school_id: str, profile_id: str) -> dict[str, Any]:
    _purge_expired_generated_credentials()
    rows = list(
        _public_table("generated_credentials")
        .select("*")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No temporary credential found for this account")
    row = dict(rows[0])
    _public_table("generated_credentials").update({"viewed": True}).eq("id", row["id"]).execute()
    return row


def list_account_history(
    school_id: str,
    *,
    search: str | None = None,
    profile_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    query = (
        _public_table("audit_logs")
        .select("id,profile_id,action,payload,created_at", count="exact")
        .eq("school_id", school_id)
        .eq("module_key", ACCOUNT_SECURITY_MODULE)
        .order("created_at", desc=True)
        .range(offset, max(offset + limit - 1, offset))
    )
    if profile_id:
        query = query.eq("entity_id", profile_id)
    response = query.execute()
    rows = list(response.data or [])
    total_count = int(getattr(response, "count", None) or 0)
    filtered_rows = [dict(row) for row in rows]
    if search:
        needle = _normalize(search).lower()
        filtered_rows = [
            row for row in filtered_rows
            if needle in _normalize(_json_object(row.get("payload")).get("entity_name")).lower()
            or needle in _normalize(_json_object(row.get("payload")).get("username")).lower()
            or needle in _normalize(row.get("action")).lower()
        ]
    actor_ids = sorted({_normalize(row.get("profile_id")) for row in filtered_rows if _normalize(row.get("profile_id"))})
    actor_profiles = _load_profiles_batch(actor_ids) if actor_ids else {}
    items: list[dict[str, Any]] = []
    for row in filtered_rows:
        payload = _json_object(row.get("payload"))
        actor_profile = actor_profiles.get(_normalize(row.get("profile_id")), {})
        items.append(
            {
                "id": _normalize(row.get("id")),
                "name": _normalize(payload.get("entity_name")) or _normalize(payload.get("username")) or "Account",
                "action": _normalize(payload.get("action_label")) or _normalize(row.get("action")),
                "created_by": _normalize(actor_profile.get("full_name")) or _normalize(actor_profile.get("display_name")) or "System",
                "timestamp": row.get("created_at"),
                "username": _normalize_optional(payload.get("username")),
                "entity_type": _normalize_optional(payload.get("entity_type")),
                "target_user": _normalize(payload.get("entity_name")) or _normalize(payload.get("username")) or "Account",
                "permission_key": _normalize_optional(payload.get("permission_key")),
            }
        )
    return {"items": items, "limit": limit, "offset": offset, "total_count": total_count}


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
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
            .select("id")
            .eq("profile_id", profile_id),
            "is_active",
            True,
        )
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
    permissions_by_role: dict[str, list[str]] | None = None,
    _latest_session: dict[str, Any] | None = None,
    _active_count: int | None = None,
) -> dict[str, Any]:
    if profile and _latest_session is None:
        _latest_session = _latest_session_for_profile(_normalize(profile.get("id")))
    if profile and _active_count is None:
        _active_count = _active_session_count(_normalize(profile.get("id")))
    elif _active_count is None:
        _active_count = 0
    portal_metadata = _portal_metadata(profile or {})
    role_data = membership.get("roles") if isinstance(membership, dict) else None
    if isinstance(role_data, list):
        role_data = role_data[0] if role_data else None
    role_key = _normalize_role_key((role_data or {}).get("role_key") if isinstance(role_data, dict) else None)
    role_id = _normalize(membership.get("role_id")) if isinstance(membership, dict) else ""
    permission_count = len((permissions_by_role or {}).get(role_id, [])) if role_id else 0
    return {
        "entity_type": entity_type,
        "entity_id": _normalize(entity.get("id")),
        "portal_status": "active" if profile and membership and profile.get("is_active", True) and membership.get("is_active", True) else ("not_created" if not profile else "disabled"),
        "username": _normalize(profile.get("display_name")) if profile else "",
        "login_email": _normalize(profile.get("email")) if profile else "",
        "last_login": _latest_session.get("login_time") if _latest_session else portal_metadata.get("last_login"),
        "last_activity": _latest_session.get("last_activity") if _latest_session else None,
        "profile_linked": bool(profile),
        "profile_id": _normalize(profile.get("id")) if profile else None,
        "account_created_date": profile.get("created_at") if profile else None,
        "must_change_password": bool(portal_metadata.get("must_change_password")) if profile else False,
        "first_login_completed": bool(portal_metadata.get("first_login_completed")) if profile else False,
        "force_password_change": bool(portal_metadata.get("must_change_password")) if profile else False,
        "last_password_reset_at": portal_metadata.get("last_password_reset_at") if profile else None,
        "active_sessions": _active_count if profile else 0,
        "role_key": role_key or entity_type,
        "permission_count": permission_count,
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
                "first_login_completed": False if must_change_password else bool(_portal_metadata(current).get("first_login_completed")),
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
    permissions: list[str] | None = None,
    create_missing_only: bool = False,
) -> dict[str, Any]:
    student = _load_student(school_id, student_id)
    username = _student_username(_normalize(student.get("roll_number")))
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(student.get("profile_id"))
    if create_missing_only and profile_id:
        result = get_student_portal_access(school_id, student_id)
        result["skipped"] = True
        result["skip_reason"] = "account_exists"
        return result
    login_email = _default_portal_login_email(school_id, username, "student")
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
        permissions=permissions or DEFAULT_STUDENT_PERMISSIONS,
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
        payload={
            "entity_type": "student",
            "student_id": student_id,
            "username": username,
            "entity_name": _normalize(student.get("full_name")) or username,
            "action_label": "Account Created" if not profile_id else "Password Reset",
        },
    )
    _store_generated_credential(
        school_id=school_id,
        profile_id=new_profile_id,
        entity_type="student",
        entity_id=_normalize(student.get("id")),
        role_key="student",
        username=username,
        login_email=login_email,
        temporary_password=generated_password,
        created_by=actor_profile_id,
        entity_name=_normalize(student.get("full_name")) or username,
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
    permissions: list[str] | None = None,
    create_missing_only: bool = False,
) -> dict[str, Any]:
    guardian = _load_guardian(school_id, guardian_id)
    username = _parent_username(_normalize_optional(guardian.get("guardian_code")), guardian_id)
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(guardian.get("profile_id"))
    if create_missing_only and profile_id:
        result = get_parent_portal_access(school_id, guardian_id)
        result["skipped"] = True
        result["skip_reason"] = "account_exists"
        return result
    login_email = _default_portal_login_email(school_id, username, "parent")
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
        permissions=permissions or DEFAULT_PARENT_PERMISSIONS,
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
        payload={
            "entity_type": "parent",
            "guardian_id": guardian_id,
            "username": username,
            "entity_name": _normalize(guardian.get("full_name")) or username,
            "action_label": "Account Created" if not profile_id else "Password Reset",
        },
    )
    _store_generated_credential(
        school_id=school_id,
        profile_id=new_profile_id,
        entity_type="parent",
        entity_id=_normalize(guardian.get("id")),
        role_key="parent",
        username=username,
        login_email=login_email,
        temporary_password=generated_password,
        created_by=actor_profile_id,
        entity_name=_normalize(guardian.get("full_name")) or username,
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
    permissions: list[str] | None = None,
    create_missing_only: bool = False,
) -> dict[str, Any]:
    staff_member = _load_staff_member(school_id, staff_member_id)
    username = _staff_username(_normalize(staff_member.get("employee_code")), selected_role=selected_role)
    generated_password = password or generate_secure_password()
    profile_id = _normalize_optional(staff_member.get("profile_id"))
    if create_missing_only and profile_id:
        membership = _load_school_membership(school_id, profile_id)
        role_data = membership.get("roles") if isinstance(membership, dict) else None
        if isinstance(role_data, list):
            role_data = role_data[0] if role_data else None
        return {
            "profile_id": profile_id,
            "username": username,
            "login_email": _normalize_optional(_load_profile(profile_id).get("email")),
            "role_key": _normalize_role_key((role_data or {}).get("role_key")) if isinstance(role_data, dict) else selected_role,
            "skipped": True,
            "skip_reason": "account_exists",
        }
    login_email = _default_portal_login_email(school_id, username, "staff")
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
        permissions=permissions or _default_permissions_for_role(selected_role),
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
        payload={
            "entity_type": selected_role,
            "staff_member_id": staff_member_id,
            "username": username,
            "entity_name": _normalize(staff_member.get("full_name")) or username,
            "action_label": "Account Created" if not profile_id else "Password Reset",
        },
    )
    _store_generated_credential(
        school_id=school_id,
        profile_id=new_profile_id,
        entity_type="staff_member",
        entity_id=_normalize(staff_member.get("id")),
        role_key=selected_role,
        username=username,
        login_email=login_email,
        temporary_password=generated_password,
        created_by=actor_profile_id,
        entity_name=_normalize(staff_member.get("full_name")) or username,
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
    profile = _load_profile(profile_id)
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.enabled" if is_enabled else "account.disabled",
        entity_id=profile_id,
        payload={
            "profile_id": profile_id,
            "username": _normalize(profile.get("display_name")),
            "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
            "action_label": "Account Enabled" if is_enabled else "Account Disabled",
        },
    )
    return {"profile_id": profile_id, "is_enabled": is_enabled, "display_name": profile.get("display_name")}


def force_logout_profile_sessions(
    school_id: str,
    profile_id: str,
    *,
    actor_profile_id: str | None,
    reason: str = "force_logout",
) -> dict[str, Any]:
    active_rows = list(
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
            .select("id")
            .eq("school_id", school_id)
            .eq("profile_id", profile_id),
            "is_active",
            True,
        )
        .execute()
        .data
        or []
    )
    for row in active_rows:
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
            {"is_active": False, "ended_at": _now_iso(), "ended_reason": reason}
        ).eq("id", row["id"]).execute()
    profile = _load_profile(profile_id)
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.force_logout",
        entity_id=profile_id,
        payload={
            "profile_id": profile_id,
            "count": len(active_rows),
            "reason": reason,
            "username": _normalize(profile.get("display_name")),
            "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
            "action_label": "Force Logout",
        },
    )
    return {"profile_id": profile_id, "terminated_sessions": len(active_rows)}


def bulk_generate_student_accounts(
    school_id: str,
    *,
    actor_profile_id: str | None,
    student_ids: list[str] | None = None,
    batch_id: str | None = None,
    class_name: str | None = None,
    permission_template: str | None = None,
    permissions: list[str] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions

    students = _load_students_for_scope(school_id, batch_id=batch_id, class_name=class_name)
    if student_ids:
        wanted = {_normalize(item) for item in student_ids if _normalize(item)}
        students = [row for row in students if _normalize(row.get("id")) in wanted]
    template_key = _normalize_role_key(permission_template) or "student"
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key, PORTAL_PERMISSION_TEMPLATES["student"])
    resolved_permissions = normalize_permissions(permissions if template_key == "custom" else template["permissions"])
    credentials: list[dict[str, Any]] = []
    skipped_count = 0
    for student in students:
        result = create_or_reset_student_account(
            school_id,
            _normalize(student.get("id")),
            actor_profile_id=actor_profile_id,
            permissions=resolved_permissions,
            create_missing_only=True,
        )
        if result.get("skipped"):
            skipped_count += 1
            continue
        credentials.append(
            {
                "name": _normalize(student.get("full_name")),
                "role": "Student",
                "identifier": _normalize(student.get("roll_number")),
                "student_name": _normalize(student.get("full_name")),
                "roll_number": _normalize(student.get("roll_number")),
                "username": result.get("username") or _normalize(student.get("roll_number")),
                "login_email": result.get("login_email"),
                "temporary_password": result.get("temporary_password"),
                "created_at": _now_iso(),
            }
        )
    return {"count": len(credentials), "skipped_count": skipped_count, "credentials": credentials, "permissions": resolved_permissions, "template_key": template_key}


def bulk_generate_parent_accounts(
    school_id: str,
    *,
    actor_profile_id: str | None,
    guardian_ids: list[str] | None = None,
    student_ids: list[str] | None = None,
    batch_id: str | None = None,
    class_name: str | None = None,
    permission_template: str | None = None,
    permissions: list[str] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions

    guardians = _load_guardians_for_scope(
        school_id,
        guardian_ids=guardian_ids,
        student_ids=student_ids,
        batch_id=batch_id,
        class_name=class_name,
    )
    template_key = _normalize_role_key(permission_template) or "parent"
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key, PORTAL_PERMISSION_TEMPLATES["parent"])
    resolved_permissions = normalize_permissions(permissions if template_key == "custom" else template["permissions"])
    credentials: list[dict[str, Any]] = []
    skipped_count = 0
    for guardian in guardians:
        result = create_or_reset_parent_account(
            school_id,
            _normalize(guardian.get("id")),
            actor_profile_id=actor_profile_id,
            permissions=resolved_permissions,
            create_missing_only=True,
        )
        if result.get("skipped"):
            skipped_count += 1
            continue
        credentials.append(
            {
                "name": _normalize(guardian.get("full_name")),
                "role": "Parent",
                "identifier": _normalize(guardian.get("guardian_code")) or _normalize(guardian.get("relation_type")) or "Parent",
                "student_name": _normalize(guardian.get("full_name")),
                "roll_number": _normalize(guardian.get("guardian_code")) or _normalize(guardian.get("relation_type")) or "Parent",
                "username": result.get("username") or _parent_username(_normalize_optional(guardian.get("guardian_code")), _normalize(guardian.get("id"))),
                "login_email": result.get("login_email"),
                "temporary_password": result.get("temporary_password"),
                "created_at": _now_iso(),
            }
        )
    return {"count": len(credentials), "skipped_count": skipped_count, "credentials": credentials, "permissions": resolved_permissions, "template_key": template_key}


def bulk_generate_staff_accounts(
    school_id: str,
    *,
    actor_profile_id: str | None,
    staff_member_ids: list[str] | None = None,
    staff_type: str | None = None,
    permission_template: str | None = None,
    selected_role: str | None = None,
    permissions: list[str] | None = None,
) -> dict[str, Any]:
    from app.routes.auth import normalize_permissions, validate_role_input

    records = _load_staff_members_for_scope(school_id, staff_type=staff_type)
    if staff_member_ids:
        wanted = {_normalize(item) for item in staff_member_ids if _normalize(item)}
        records = [row for row in records if _normalize(row.get("id")) in wanted]
    template_key = _normalize_role_key(permission_template) or "teacher"
    template = PORTAL_PERMISSION_TEMPLATES.get(template_key, PORTAL_PERMISSION_TEMPLATES["teacher"])
    resolved_role = validate_role_input(selected_role or str(template["selected_role"]))
    resolved_permissions = normalize_permissions(permissions if template_key == "custom" else template["permissions"])
    credentials: list[dict[str, Any]] = []
    skipped_count = 0
    for staff_member in records:
        result = create_or_reset_staff_account(
            school_id,
            _normalize(staff_member.get("id")),
            actor_profile_id=actor_profile_id,
            selected_role=resolved_role,
            permissions=resolved_permissions,
            create_missing_only=True,
        )
        if result.get("skipped"):
            skipped_count += 1
            continue
        credentials.append(
            {
                "name": _normalize(staff_member.get("full_name")),
                "role": "Teacher" if resolved_role == "teacher" else "Staff",
                "identifier": _normalize(staff_member.get("employee_code")) or "Staff",
                "student_name": _normalize(staff_member.get("full_name")),
                "roll_number": _normalize(staff_member.get("employee_code")) or "Staff",
                "username": result.get("username") or _normalize(staff_member.get("employee_code")),
                "login_email": result.get("login_email"),
                "temporary_password": result.get("temporary_password"),
                "created_at": _now_iso(),
            }
        )
    return {
        "count": len(credentials),
        "skipped_count": skipped_count,
        "credentials": credentials,
        "selected_role": resolved_role,
        "permissions": resolved_permissions,
        "template_key": template_key,
    }


def create_credentials_workbook(rows: list[dict[str, Any]]) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Portal Credentials"
    worksheet.append(["Name", "Role", "Username", "Temporary Password", "Created Date"])
    for row in rows:
        worksheet.append(
            [
                _normalize(row.get("name") or row.get("student_name")),
                _normalize(row.get("role")),
                _normalize(row.get("username")),
                _normalize(row.get("temporary_password")),
                _normalize(row.get("created_at")),
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


def _load_profiles_batch(profile_ids: list[str], *, supabase: Any | None = None) -> dict[str, dict[str, Any]]:
    if not profile_ids:
        return {}
    rows = list(
        _public_table("profiles", supabase=supabase)
        .select("id,email,full_name,display_name,phone,metadata,is_active,created_at,updated_at")
        .in_("id", profile_ids)
        .execute()
        .data
        or []
    )
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_memberships_batch(
    school_id: str,
    profile_ids: list[str],
    *,
    supabase: Any | None = None,
) -> dict[str, dict[str, Any] | None]:
    if not profile_ids:
        return {}
    rows = list(
        _public_table("school_memberships", supabase=supabase)
        .select("id,school_id,profile_id,role_id,status,is_primary,is_active,metadata,roles(role_key,role_name,metadata)")
        .eq("school_id", school_id)
        .in_("profile_id", profile_ids)
        .execute()
        .data
        or []
    )
    result: dict[str, dict[str, Any] | None] = {}
    for row in rows:
        pid = _normalize(row.get("profile_id"))
        if pid:
            membership = dict(row)
            roles = membership.get("roles")
            if isinstance(roles, list):
                membership["roles"] = roles[0] if roles else None
            result[pid] = membership
    return result


def _load_latest_sessions_batch(profile_ids: list[str], *, supabase: Any | None = None) -> dict[str, dict[str, Any]]:
    if not profile_ids:
        return {}
    rows = list(
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions", supabase=supabase)
            .select("profile_id,login_time,last_activity")
            .in_("profile_id", profile_ids),
            "is_active",
            True,
        )
        .order("last_activity", desc=True)
        .execute()
        .data
        or []
    )
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = _normalize(row.get("profile_id"))
        if pid and pid not in result:
            result[pid] = dict(row)
    return result


def _load_active_session_counts_batch(profile_ids: list[str], *, supabase: Any | None = None) -> dict[str, int]:
    if not profile_ids:
        return {}
    rows = list(
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions", supabase=supabase)
            .select("profile_id")
            .in_("profile_id", profile_ids),
            "is_active",
            True,
        )
        .execute()
        .data
        or []
    )
    result: dict[str, int] = {}
    for row in rows:
        pid = _normalize(row.get("profile_id"))
        if pid:
            result[pid] = result.get(pid, 0) + 1
    return result


def get_portal_access_overview(
    school_id: str,
    *,
    entity_type: str,
    batch_id: str | None = None,
    class_name: str | None = None,
    staff_type: str | None = None,
    department: str | None = None,
    role_key: str | None = None,
    student_ids: list[str] | None = None,
    guardian_ids: list[str] | None = None,
    search: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict[str, Any]:
    import time
    t0 = time.time()
    supabase = _client()
    normalized_entity = _normalize_role_key(entity_type)
    records: list[dict[str, Any]] = []

    if normalized_entity == "student":
        student_rows = _load_students_for_scope(
            school_id,
            batch_id=batch_id,
            class_name=class_name,
            supabase=supabase,
        )
        if student_ids:
            wanted = {_normalize(item) for item in student_ids if _normalize(item)}
            student_rows = [row for row in student_rows if _normalize(row.get("id")) in wanted]
        profile_ids = list(dict.fromkeys(_normalize(s.get("profile_id")) for s in student_rows if _normalize_optional(s.get("profile_id"))))  # unique, ordered
        t1 = time.time()
        profiles_dict = _load_profiles_batch(profile_ids, supabase=supabase)
        memberships_dict = _load_memberships_batch(school_id, profile_ids, supabase=supabase)
        permissions_by_role = _load_role_permissions_batch([
            _normalize((memberships_dict.get(pid) or {}).get("role_id")) for pid in profile_ids
        ], supabase=supabase)
        latest_sessions = _load_latest_sessions_batch(profile_ids, supabase=supabase)
        active_counts = _load_active_session_counts_batch(profile_ids, supabase=supabase)
        t2 = time.time()
        for student in student_rows:
            pid = _normalize(student.get("profile_id"))
            profile = profiles_dict.get(pid)
            membership = memberships_dict.get(pid)
            portal = _serialize_portal_status(
                entity_type="student",
                entity=student,
                profile=profile,
                membership=membership,
                permissions_by_role=permissions_by_role,
                _latest_session=latest_sessions.get(pid),
                _active_count=active_counts.get(pid, 0),
            )
            portal["entity_name"] = _normalize(student.get("full_name"))
            portal["roll_number"] = _normalize(student.get("roll_number"))
            portal["batch_name"] = _normalize_optional(student.get("batch_name"))
            portal["class_name"] = _normalize_optional(student.get("class_name"))
            portal["section"] = _normalize_optional(student.get("section"))
            portal["batch_id"] = _normalize_optional(student.get("batch_id"))
            records.append(portal)
        t3 = time.time()
    elif normalized_entity == "parent":
        guardians = _load_guardians_for_scope(
            school_id,
            guardian_ids=guardian_ids,
            student_ids=student_ids,
            batch_id=batch_id,
            class_name=class_name,
            supabase=supabase,
        )
        profile_ids = list(dict.fromkeys(_normalize(g.get("profile_id")) for g in guardians if _normalize_optional(g.get("profile_id"))))
        t1 = time.time()
        profiles_dict = _load_profiles_batch(profile_ids, supabase=supabase)
        memberships_dict = _load_memberships_batch(school_id, profile_ids, supabase=supabase)
        permissions_by_role = _load_role_permissions_batch([
            _normalize((memberships_dict.get(pid) or {}).get("role_id")) for pid in profile_ids
        ], supabase=supabase)
        latest_sessions = _load_latest_sessions_batch(profile_ids, supabase=supabase)
        active_counts = _load_active_session_counts_batch(profile_ids, supabase=supabase)
        t2 = time.time()
        for guardian in guardians:
            pid = _normalize(guardian.get("profile_id"))
            profile = profiles_dict.get(pid)
            membership = memberships_dict.get(pid)
            portal = _serialize_portal_status(
                entity_type="parent",
                entity=guardian,
                profile=profile,
                membership=membership,
                permissions_by_role=permissions_by_role,
                _latest_session=latest_sessions.get(pid),
                _active_count=active_counts.get(pid, 0),
            )
            portal["entity_name"] = _normalize(guardian.get("full_name"))
            portal["phone"] = _normalize_optional(guardian.get("phone"))
            portal["email"] = _normalize_optional(guardian.get("email"))
            records.append(portal)
        t3 = time.time()
    elif normalized_entity == "staff":
        normalized_staff_type = normalize_staff_type(staff_type)
        staff_rows = _load_staff_members_for_scope(school_id, staff_type=normalized_staff_type, supabase=supabase)
        if department:
            wanted_department = _normalize_role_key(department)
            staff_rows = [row for row in staff_rows if _normalize_role_key(row.get("department")) == wanted_department]
        profile_ids = list(dict.fromkeys(_normalize(s.get("profile_id")) for s in staff_rows if _normalize_optional(s.get("profile_id"))))
        t1 = time.time()
        profiles_dict = _load_profiles_batch(profile_ids, supabase=supabase)
        memberships_dict = _load_memberships_batch(school_id, profile_ids, supabase=supabase)
        permissions_by_role = _load_role_permissions_batch([
            _normalize((memberships_dict.get(pid) or {}).get("role_id")) for pid in profile_ids
        ], supabase=supabase)
        latest_sessions = _load_latest_sessions_batch(profile_ids, supabase=supabase)
        active_counts = _load_active_session_counts_batch(profile_ids, supabase=supabase)
        t2 = time.time()
        for staff_member in staff_rows:
            pid = _normalize(staff_member.get("profile_id"))
            profile = profiles_dict.get(pid)
            membership = memberships_dict.get(pid)
            portal = _serialize_portal_status(
                entity_type="staff_member",
                entity=staff_member,
                profile=profile,
                membership=membership,
                permissions_by_role=permissions_by_role,
                _latest_session=latest_sessions.get(pid),
                _active_count=active_counts.get(pid, 0),
            )
            portal["entity_name"] = _normalize(staff_member.get("full_name"))
            portal["employee_code"] = _normalize_optional(staff_member.get("employee_code"))
            portal["staff_type"] = _normalize_optional(staff_member.get("staff_type"))
            portal["department"] = _normalize_optional(staff_member.get("department"))
            portal["designation"] = _normalize_optional(staff_member.get("designation"))
            portal["email"] = _normalize_optional(staff_member.get("email"))
            records.append(portal)
        t3 = time.time()
        logger.info(
            "portal_access_manager.staff_overview",
            extra={
                "school_id": school_id,
                "requested_staff_type": _normalize_optional(staff_type),
                "normalized_staff_type": normalized_staff_type,
                "returned_record_count": len(records),
            },
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported entity_type")

    if role_key:
        wanted_role = _normalize_role_key(role_key)
        records = [item for item in records if _normalize_role_key(item.get("role_key")) == wanted_role]
    if search:
        needle = _normalize(search).lower()
        records = [
            item for item in records
            if needle in _normalize(item.get("entity_name")).lower()
            or needle in _normalize(item.get("username")).lower()
            or needle in _normalize(item.get("login_email")).lower()
            or needle in _normalize(item.get("roll_number")).lower()
            or needle in _normalize(item.get("employee_code")).lower()
            or needle in _normalize(item.get("phone")).lower()
            or needle in _normalize(item.get("department")).lower()
        ]
    total_records = len(records)
    paged_records = records[offset: offset + max(1, limit)]
    portal_active_count = sum(1 for item in records if item.get("portal_status") == "active")
    portal_disabled_count = sum(1 for item in records if item.get("portal_status") == "disabled")
    portal_not_created_count = sum(1 for item in records if item.get("portal_status") == "not_created")
    summary = {
        "total_records": total_records,
        "accounts_created": portal_active_count,
        "accounts_pending": portal_not_created_count,
        "accounts_disabled": portal_disabled_count,
        "last_login_count": sum(1 for item in records if item.get("last_login")),
        "portal_active": portal_active_count,
        "portal_disabled": portal_disabled_count,
        "portal_not_created": portal_not_created_count,
    }
    t4 = time.time()
    if normalized_entity == "student":
        summary["total_students"] = len(records)
        batch_names = {
            _normalize(item.get("batch_name"))
            for item in records
            if _normalize(item.get("batch_name"))
        }
        logger.info(
            "portal_access_manager.student_overview",
            extra={
                "school_id": school_id,
                "student_count": len(records),
                "batch_count": len(batch_names),
                "portal_active_count": portal_active_count,
                "portal_disabled_count": portal_disabled_count,
                "portal_not_created_count": portal_not_created_count,
                "batch_id": batch_id,
                "class_name": class_name,
                "selected_student_count": len(student_ids or []),
                "load_ms": int((t4 - t0) * 1000),
            },
        )
    return {
        "summary": summary,
        "records": paged_records,
        "meta": {
            "limit": limit,
            "offset": offset,
            "returned": len(paged_records),
            "total_count": total_records,
        },
    }


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
    _t0 = time.monotonic()
    limit = _resolve_session_limit(role_key)
    current_rows = list(
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
            .select("*")
            .eq("profile_id", profile_id),
            "is_active",
            True,
        )
        .order("last_activity", desc=True)
        .execute()
        .data
        or []
    )
    _t1 = time.monotonic()
    same_session = next((dict(row) for row in current_rows if _normalize(row.get("session_key")) == session_key), None)
    if same_session:
        logger.info("register_active_session.timing", extra={"step": "session_lookup_ms", "value": round((time.monotonic() - _t0) * 1000)})
        
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
    _t2 = time.monotonic()
    profile = _load_profile(profile_id)
    _t3 = time.monotonic()
    portal_metadata = _portal_metadata(profile)
    _public_table("profiles").update(
        {
            "metadata": _merge_metadata(
                profile.get("metadata"),
                {"portal_access": {**portal_metadata, "last_login": created.get("login_time")}},
            )
        }
    ).eq("id", profile_id).execute()
    _t4 = time.monotonic()
    logger.info("register_active_session.timing", extra={
        "step": "all_ms", "value": round((_t4 - _t0) * 1000),
        "session_lookup_ms": round((_t1 - _t0) * 1000),
        "insert_ms": round((_t2 - _t1) * 1000),
        "load_profile_ms": round((_t3 - _t2) * 1000),
        "profile_update_ms": round((_t4 - _t3) * 1000),
    })
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


def logout_session_by_id(
    school_id: str,
    session_id: str,
    *,
    actor_profile_id: str | None,
    reason: str = "admin_logout_device",
) -> dict[str, Any]:
    rows = list(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions")
        .select("id,profile_id")
        .eq("school_id", school_id)
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    row = dict(rows[0])
    _schema_table(ACTIVE_SESSIONS_SCHEMA, "active_sessions").update(
        {"is_active": False, "ended_at": _now_iso(), "ended_reason": reason}
    ).eq("id", row["id"]).execute()
    profile = _load_profile(_normalize(row.get("profile_id")))
    _record_audit(
        school_id=school_id,
        actor_profile_id=actor_profile_id,
        action="account.force_logout",
        entity_id=_normalize(row.get("profile_id")),
        payload={
            "profile_id": _normalize(row.get("profile_id")),
            "session_id": _normalize(row.get("id")),
            "reason": reason,
            "username": _normalize(profile.get("display_name")),
            "entity_name": _normalize(profile.get("full_name")) or _normalize(profile.get("display_name")),
            "action_label": "Logout Device",
        },
    )
    return {"session_id": _normalize(row.get("id")), "profile_id": _normalize(row.get("profile_id")), "status": "terminated"}


def complete_password_change(profile_id: str) -> dict[str, Any]:
    profile = _load_profile(profile_id)
    metadata = _merge_metadata(
        profile.get("metadata"),
        {
            "portal_access": {
                **_portal_metadata(profile),
                "must_change_password": False,
                "first_login_completed": True,
                "school_onboarding_required": False,
                "onboarding_status": "completed",
                "password_changed_at": _now_iso(),
                "completed_at": _now_iso(),
            }
        },
    )
    _public_table("profiles").update({"metadata": metadata}).eq("id", profile_id).execute()
    return {"status": "ok"}


def _profile_login_usernames(profile: dict[str, Any]) -> set[str]:
    metadata = _json_object(profile.get("metadata"))
    portal_access = _json_object(metadata.get("portal_access"))
    candidates = {
        _normalize(profile.get("display_name")),
        _normalize(metadata.get("username")),
        _normalize(portal_access.get("username")),
    }
    return {candidate.lower() for candidate in candidates if candidate}


def resolve_login_email(identifier: str, *, school_id: str | None = None, portal_intent: str | None = None) -> dict[str, Any]:
    normalized = _normalize(identifier)
    if not normalized:
        raise HTTPException(status_code=400, detail="Identifier is required")
    if "@" in normalized:
        return {"email": normalized.lower()}
    is_global_lookup = portal_intent in ("platform_admin", "student_portal", "parent_portal")
    if is_global_lookup:
        profile_rows = list(
            _public_table("profiles")
            .select("id,email,display_name,metadata")
            .limit(500)
            .execute()
            .data
            or []
        )
    else:
        normalized_school_id = _normalize(school_id)
        if not normalized_school_id:
            raise HTTPException(
                status_code=400,
                detail="School context is required for username login. Please use your login email.",
            )
        membership_rows = list(
            _public_table("school_memberships")
            .select("profile_id")
            .eq("school_id", normalized_school_id)
            .eq("is_active", True)
            .eq("status", "active")
            .limit(500)
            .execute()
            .data
            or []
        )
        scoped_profile_ids = sorted(
            {
                _normalize(row.get("profile_id"))
                for row in membership_rows
                if _normalize(row.get("profile_id"))
            }
        )
        if not scoped_profile_ids:
            raise HTTPException(status_code=404, detail="Login account not found")
        profile_rows = list(
            _public_table("profiles")
            .select("id,email,display_name,metadata")
            .in_("id", scoped_profile_ids)
            .limit(200)
            .execute()
            .data
            or []
        )
    normalized_lookup = normalized.lower()
    matches = [
        dict(row)
        for row in profile_rows
        if _normalize(row.get("email"))
        and (
            normalized_lookup in _profile_login_usernames(dict(row))
            or _normalize(row.get("email")).lower() == normalized_lookup
        )
    ]
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
        _eq_boolean(
            _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions")
            .select("*")
            .eq("school_id", school_id)
            .eq("test_id", test_id)
            .eq("student_id", student_id),
            "is_active",
            True,
        )
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
    query = _eq_boolean(
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", student_id),
        "is_active",
        True,
    )
    current_key = _normalize(session_key)
    if current_key:
        query = query.eq("session_key", current_key)
    rows = list(query.execute().data or [])
    for row in rows:
        _schema_table(ACTIVE_SESSIONS_SCHEMA, "test_sessions").update(
            {"is_active": False, "terminated_at": _now_iso(), "terminated_reason": reason}
        ).eq("id", row["id"]).execute()
