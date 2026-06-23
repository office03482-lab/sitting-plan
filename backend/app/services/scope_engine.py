from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException, status

from app.models import User
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_lms import _get_student_by_profile_id, _list_parent_linked_students


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _role_key(user: User) -> str:
    return _normalize(getattr(user, "role_key", "")).lower()


def _user_type(user: User) -> str:
    return _normalize(getattr(user, "user_type", "")).lower()


def _default_scope_for_permission(user: User, permission_key: str) -> str:
    del permission_key
    role_key = _role_key(user)
    if role_key == "platform_admin" or is_platform_admin_user(user):
        return "platform"
    if role_key in {"student", "parent"} or _user_type(user) == "student":
        return "own"
    if role_key in {"teacher", "staff", "viewer", "store_manager"}:
        return "assigned"
    return "school"


def _normalize_scope_value(value: Any, fallback: str) -> str:
    normalized = _normalize(value).lower()
    return normalized if normalized in {"own", "assigned", "school", "platform"} else fallback


def decode_scope_assignments(user: User) -> dict[str, str]:
    raw = getattr(user, "scope_assignments", None)
    if not isinstance(raw, dict):
        role_metadata = getattr(user, "role_metadata", None)
        if isinstance(role_metadata, dict):
            raw = role_metadata.get("scope_assignments")
    if not isinstance(raw, dict):
        return {}
    assignments: dict[str, str] = {}
    for key, value in raw.items():
        permission_key = _normalize(key).lower()
        if not permission_key:
            continue
        assignments[permission_key] = _normalize_scope_value(value, "school")
    return assignments


def resolve_permission_scope(user: User, permission_key: str) -> str:
    normalized_permission = _normalize(permission_key).lower()
    fallback = _default_scope_for_permission(user, normalized_permission)
    assignments = decode_scope_assignments(user)
    if normalized_permission in assignments:
        return assignments[normalized_permission]
    for key in sorted(assignments.keys(), key=len, reverse=True):
        if normalized_permission.startswith(f"{key}.") or key.startswith(f"{normalized_permission}."):
            return assignments[key]
    return fallback


def _split_batch_label(value: Any) -> tuple[str, str | None]:
    normalized = _normalize(value)
    if not normalized:
        return "", None
    if "|" in normalized:
        left, right = normalized.split("|", 1)
        return left.strip(), right.strip() or None
    if "-" in normalized:
        left, right = normalized.split("-", 1)
        return left.strip(), right.strip() or None
    parts = normalized.rsplit(" ", 1)
    if len(parts) == 2 and len(parts[1]) <= 3 and parts[1].isalnum():
        return parts[0].strip(), parts[1].strip() or None
    return normalized, None


def _expand_batch_labels(value: Any) -> list[tuple[str, str | None]]:
    seen: set[tuple[str, str | None]] = set()
    expanded: list[tuple[str, str | None]] = []
    for part in [_normalize(item) for item in _normalize(value).split(",")]:
        if not part:
            continue
        class_name, section = _split_batch_label(part)
        if not class_name:
            continue
        entry = (class_name, section)
        if entry in seen:
            continue
        seen.add(entry)
        expanded.append(entry)
    return expanded


def _resolve_staff_member(school_id: str, actor: dict[str, Any]) -> dict[str, Any] | None:
    profile_id = _normalize(actor.get("profile_id"))
    email = _normalize(actor.get("email")).lower()
    name = _normalize(actor.get("name"))
    query = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id, profile_id, full_name, email, department, staff_type, is_active")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if profile_id:
        rows = list(query.eq("profile_id", profile_id).limit(1).execute().data or [])
        if rows:
            return dict(rows[0])
    if email:
        rows = list(query.ilike("email", email).limit(1).execute().data or [])
        if rows:
            return dict(rows[0])
    if name:
        rows = list(query.ilike("full_name", name).limit(5).execute().data or [])
        if rows:
            return dict(rows[0])
    return None


def _resolve_student_ids(school_id: str, actor: dict[str, Any], user: User) -> list[str]:
    profile_id = _normalize(actor.get("profile_id"))
    email = _normalize(getattr(user, "email", None) or actor.get("email")).lower()
    role_key = _role_key(user)
    student_ids: list[str] = []

    if role_key == "student" or _user_type(user) == "student":
        if profile_id:
            try:
                student = _get_student_by_profile_id(school_id, profile_id)
                student_id = _normalize(student.get("id"))
                if student_id:
                    student_ids.append(student_id)
            except HTTPException:
                pass

    if role_key == "parent" or "edupay.parent_portal" in _normalize(getattr(user, "permissions", "")).lower():
        linked_students = _list_parent_linked_students(school_id, profile_id or None, email or None)
        for row in linked_students:
            student_id = _normalize(row.get("id"))
            if student_id and student_id not in student_ids:
                student_ids.append(student_id)

    return student_ids


def _resolve_teacher_batches(school_id: str, staff_member_id: str) -> list[tuple[str, str | None]]:
    rows = list(
        get_supabase_admin_client()
        .schema("scheduling")
        .table("timetable_entries")
        .select("class_name")
        .eq("school_id", school_id)
        .eq("staff_member_id", staff_member_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    seen: set[tuple[str, str | None]] = set()
    batches: list[tuple[str, str | None]] = []
    for row in rows:
        for batch_entry in _expand_batch_labels(row.get("class_name")):
            if batch_entry in seen:
                continue
            seen.add(batch_entry)
            batches.append(batch_entry)
    return batches


@dataclass
class PermissionScopeContext:
    user: User
    permission_key: str
    scope: str
    role_key: str
    school_id: str
    profile_id: str | None = None
    email: str | None = None
    name: str | None = None
    staff_member_id: str | None = None
    staff_department: str | None = None
    student_ids: list[str] = field(default_factory=list)
    assigned_batches: list[tuple[str, str | None]] = field(default_factory=list)

    @property
    def is_school_wide(self) -> bool:
        return self.scope in {"school", "platform"}


def build_scope_context(
    *,
    user: User,
    actor: dict[str, Any],
    school_id: str,
    permission_key: str,
    include_students: bool = False,
    include_staff: bool = False,
    include_teacher_batches: bool = False,
) -> PermissionScopeContext:
    context = PermissionScopeContext(
        user=user,
        permission_key=_normalize(permission_key).lower(),
        scope=resolve_permission_scope(user, permission_key),
        role_key=_role_key(user),
        school_id=school_id,
        profile_id=_normalize(actor.get("profile_id")) or None,
        email=_normalize(actor.get("email")) or None,
        name=_normalize(actor.get("name")) or None,
    )
    if context.is_school_wide:
        return context

    if include_students:
        context.student_ids = _resolve_student_ids(school_id, actor, user)

    if include_staff or include_teacher_batches or context.scope in {"own", "assigned"}:
        staff_member = _resolve_staff_member(school_id, actor)
        if staff_member:
            context.staff_member_id = _normalize(staff_member.get("id")) or None
            context.staff_department = _normalize(staff_member.get("department")) or None

    if include_teacher_batches and context.staff_member_id:
        context.assigned_batches = _resolve_teacher_batches(school_id, context.staff_member_id)

    return context


def ensure_school_wide_scope(context: PermissionScopeContext, detail: str) -> None:
    if context.is_school_wide:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
