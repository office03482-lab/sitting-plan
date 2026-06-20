"""Portal access, account security, and session management routes."""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User
from app.services.supabase_account_security import (
    bulk_generate_student_accounts,
    bulk_generate_parent_accounts,
    bulk_generate_staff_accounts,
    complete_password_change,
    create_credentials_workbook,
    create_or_reset_parent_account,
    create_or_reset_staff_account,
    create_or_reset_student_account,
    force_logout_profile_sessions,
    get_generated_credential_details,
    get_permission_templates,
    get_parent_portal_access,
    get_portal_access_overview,
    get_recent_generated_credentials,
    get_student_portal_access,
    heartbeat_active_session,
    list_account_history,
    list_active_sessions,
    logout_session_by_id,
    logout_session,
    register_active_session,
    resolve_login_email,
    set_account_enabled,
)
from app.services.supabase_context import resolve_school_id_from_actor


router = APIRouter(prefix="/api/account-security", tags=["Account Security"])


def require_access_control_user(
    _: User = Depends(require_permissions("admin_office.access_control")),
    user: User = Depends(get_authenticated_user),
) -> User:
    role_key = str(getattr(user, "role_key", "") or "").strip().lower()
    if getattr(user, "role", None) == "admin" or role_key in {"platform_admin", "school_admin"}:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access control permission required")


@router.get("/resolve-login")
async def api_resolve_login(identifier: str = Query(..., min_length=1)):
    return resolve_login_email(identifier)


@router.get("/templates")
async def api_get_portal_templates(_: User = Depends(require_access_control_user)):
    t0 = time.time()
    result = get_permission_templates()
    logging.getLogger("app.performance").info("portal_templates duration=%.3fs", time.time() - t0)
    return result


@router.get("/overview")
async def api_get_portal_overview(
    entity_type: str = Query(...),
    batch_id: str | None = Query(default=None),
    class_name: str | None = Query(default=None),
    staff_type: str | None = Query(default=None),
    department: str | None = Query(default=None),
    role_key: str | None = Query(default=None),
    student_ids: str | None = Query(default=None),
    guardian_ids: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    t0 = time.time()
    result = get_portal_access_overview(
        school_id,
        entity_type=entity_type,
        batch_id=batch_id,
        class_name=class_name,
        staff_type=staff_type,
        department=department,
        role_key=role_key,
        student_ids=[item.strip() for item in (student_ids or "").split(",") if item.strip()],
        guardian_ids=[item.strip() for item in (guardian_ids or "").split(",") if item.strip()],
        search=search,
        limit=limit,
        offset=offset,
    )
    logging.getLogger("app.performance").info("portal_overview entity=%s duration=%.3fs records=%d", entity_type, time.time() - t0, len(result.get("records") or []))
    return result


@router.get("/students/{student_id}")
async def api_get_student_portal_access(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    return get_student_portal_access(school_id, student_id)


@router.post("/students/{student_id}/create-login")
async def api_create_student_login(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return create_or_reset_student_account(school_id, student_id, actor_profile_id=actor.get("profile_id"))


@router.post("/students/{student_id}/reset-password")
async def api_reset_student_password(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return create_or_reset_student_account(school_id, student_id, actor_profile_id=actor.get("profile_id"))


@router.post("/students/{student_id}/disable")
async def api_disable_student_login(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_student_portal_access(school_id, student_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Student portal account not found")
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=False)


@router.post("/students/{student_id}/enable")
async def api_enable_student_login(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_student_portal_access(school_id, student_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Student portal account not found")
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=True)


@router.post("/students/{student_id}/force-logout")
async def api_force_logout_student(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_student_portal_access(school_id, student_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Student portal account not found")
    return force_logout_profile_sessions(school_id, profile_id, actor_profile_id=actor.get("profile_id"))


@router.post("/students/bulk-generate")
async def api_bulk_generate_student_accounts(
    payload: dict[str, Any] = Body(default_factory=dict),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return bulk_generate_student_accounts(
        school_id,
        actor_profile_id=actor.get("profile_id"),
        student_ids=[str(item) for item in list(payload.get("student_ids") or [])],
        batch_id=str(payload.get("batch_id") or "").strip() or None,
        class_name=str(payload.get("class_name") or "").strip() or None,
        permission_template=str(payload.get("permission_template") or "").strip() or None,
        permissions=[str(item) for item in list(payload.get("permissions") or [])],
    )


@router.post("/credentials/export")
async def api_export_credentials(payload: dict[str, Any] = Body(default_factory=dict), _: User = Depends(require_access_control_user)):
    rows = list(payload.get("rows") or [])
    content = create_credentials_workbook(rows)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="portal-credentials.xlsx"'},
    )


@router.get("/credentials/recent")
async def api_recent_generated_credentials(
    limit: int = Query(default=100, ge=1, le=250),
    created_by_me: bool = Query(default=False),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return get_recent_generated_credentials(
        school_id,
        created_by=actor.get("profile_id") if created_by_me else None,
        limit=limit,
    )


@router.get("/credentials/profile/{profile_id}")
async def api_generated_credential_details(
    profile_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    return get_generated_credential_details(school_id, profile_id)


@router.get("/history")
async def api_account_history(
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    return list_account_history(school_id, search=search, limit=limit, offset=offset)


@router.get("/parents/{guardian_id}")
async def api_get_parent_portal_access(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    return get_parent_portal_access(school_id, guardian_id)


@router.post("/parents/{guardian_id}/create-login")
async def api_create_parent_login(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return create_or_reset_parent_account(school_id, guardian_id, actor_profile_id=actor.get("profile_id"))


@router.post("/parents/{guardian_id}/reset-password")
async def api_reset_parent_password(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return create_or_reset_parent_account(school_id, guardian_id, actor_profile_id=actor.get("profile_id"))


@router.post("/parents/{guardian_id}/disable")
async def api_disable_parent_login(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_parent_portal_access(school_id, guardian_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Parent portal account not found")
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=False)


@router.post("/parents/{guardian_id}/enable")
async def api_enable_parent_login(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_parent_portal_access(school_id, guardian_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Parent portal account not found")
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=True)


@router.post("/parents/{guardian_id}/force-logout")
async def api_force_logout_parent(
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    portal = get_parent_portal_access(school_id, guardian_id)
    profile_id = str(portal.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=404, detail="Parent portal account not found")
    return force_logout_profile_sessions(school_id, profile_id, actor_profile_id=actor.get("profile_id"))


@router.post("/parents/bulk-generate")
async def api_bulk_generate_parent_accounts(
    payload: dict[str, Any] = Body(default_factory=dict),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return bulk_generate_parent_accounts(
        school_id,
        actor_profile_id=actor.get("profile_id"),
        guardian_ids=[str(item) for item in list(payload.get("guardian_ids") or [])],
        student_ids=[str(item) for item in list(payload.get("student_ids") or [])],
        batch_id=str(payload.get("batch_id") or "").strip() or None,
        class_name=str(payload.get("class_name") or "").strip() or None,
        permission_template=str(payload.get("permission_template") or "").strip() or None,
        permissions=[str(item) for item in list(payload.get("permissions") or [])],
    )


@router.post("/staff/{staff_member_id}/reset-password")
async def api_reset_staff_password(
    staff_member_id: str,
    role_key: str = Query(default="teacher"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return create_or_reset_staff_account(
        school_id,
        staff_member_id,
        actor_profile_id=actor.get("profile_id"),
        selected_role=role_key,
    )


@router.post("/staff/bulk-generate")
async def api_bulk_generate_staff_accounts(
    payload: dict[str, Any] = Body(default_factory=dict),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return bulk_generate_staff_accounts(
        school_id,
        actor_profile_id=actor.get("profile_id"),
        staff_member_ids=[str(item) for item in list(payload.get("staff_member_ids") or [])],
        staff_type=str(payload.get("staff_type") or "").strip() or None,
        permission_template=str(payload.get("permission_template") or "").strip() or None,
        selected_role=str(payload.get("selected_role") or "").strip() or None,
        permissions=[str(item) for item in list(payload.get("permissions") or [])],
    )


@router.get("/sessions")
async def api_list_sessions(
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_access_control_user),
):
    return list_active_sessions(school_id)


@router.post("/sessions/register")
async def api_register_session(
    payload: dict[str, Any] = Body(default_factory=dict),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_forwarded_for: str | None = Header(default=None, alias="X-Forwarded-For"),
):
    session_key = str(payload.get("session_key") or "").strip()
    if not session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    profile_id = str(actor.get("profile_id") or getattr(user, "id", "")).strip()
    membership_id = str(actor.get("membership_id") or "").strip() or None
    return register_active_session(
        school_id=school_id,
        profile_id=profile_id,
        membership_id=membership_id,
        role_key=str(getattr(user, "role_key", "") or actor.get("role") or "").strip(),
        session_key=session_key,
        device_id=str(payload.get("device_id") or "").strip() or "browser",
        device_name=str(payload.get("device_name") or "").strip() or None,
        browser=str(payload.get("browser") or "").strip() or None,
        ip_address=(x_forwarded_for or "").split(",")[0].strip() or None,
        user_agent=user_agent,
        force_takeover=bool(payload.get("force_takeover")),
    )


@router.post("/sessions/heartbeat")
async def api_session_heartbeat(
    payload: dict[str, Any] = Body(default_factory=dict),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(get_authenticated_user),
):
    return heartbeat_active_session(str(actor.get("profile_id") or "").strip(), str(payload.get("session_key") or "").strip())


@router.post("/sessions/logout-current")
async def api_logout_current_session(
    payload: dict[str, Any] = Body(default_factory=dict),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(get_authenticated_user),
):
    logout_session(str(actor.get("profile_id") or "").strip(), str(payload.get("session_key") or "").strip())
    return {"status": "ok"}


@router.post("/sessions/{profile_id}/logout-all")
async def api_logout_all_profile_sessions(
    profile_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return force_logout_profile_sessions(school_id, profile_id, actor_profile_id=actor.get("profile_id"), reason="logout_all_devices")


@router.post("/sessions/{session_id}/logout-device")
async def api_logout_device_session(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return logout_session_by_id(school_id, session_id, actor_profile_id=actor.get("profile_id"))


@router.post("/profiles/{profile_id}/disable")
async def api_disable_profile_account(
    profile_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=False)


@router.post("/profiles/{profile_id}/enable")
async def api_enable_profile_account(
    profile_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_access_control_user),
):
    return set_account_enabled(school_id, profile_id, actor_profile_id=actor.get("profile_id"), is_enabled=True)


@router.post("/password/change-complete")
async def api_complete_password_change(
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(get_authenticated_user),
):
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="Profile context missing")
    return complete_password_change(profile_id)
