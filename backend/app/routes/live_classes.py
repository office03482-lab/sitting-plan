"""Live classes routes built on top of timetable, attendance, and LMS."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import (
    LiveClassAttendanceResponse,
    LiveClassJoinLeaveResponse,
    LiveClassRecordingCreate,
    LiveClassRecordingResponse,
    LiveClassSessionActionResponse,
    LiveClassSessionCreate,
    LiveClassSessionResponse,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_live_classes import (
    create_live_class,
    end_live_class,
    get_live_class,
    get_live_class_attendance,
    join_live_class,
    leave_live_class,
    list_live_classes,
    start_live_class,
    upload_live_class_recording,
)

router = APIRouter(prefix="/api/live-classes", tags=["Live Classes"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def _is_parent_user(user: User) -> bool:
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return _role_key(user) == "parent" or "edupay.parent_portal" in permissions


def require_live_class_manage_user(
    _: User = Depends(require_permissions("live_classes.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can manage live classes")


def require_live_class_view_user(
    _: User = Depends(require_permissions("live_classes.view", "live_classes.manage", "live_classes.reports", "live_classes.join", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to live classes")


def require_live_class_join_user(
    _: User = Depends(require_permissions("live_classes.join")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can join live classes from this route")


def require_live_class_attendance_user(
    _: User = Depends(require_permissions("live_classes.attendance", "live_classes.manage", "live_classes.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to live class attendance")


def _sanitize_session_for_user(session: dict, user: User) -> dict:
    payload = dict(session)
    role_key = _role_key(user)
    is_manager = _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user)
    if is_manager:
        return payload
    if role_key == "parent":
        payload["meeting_link"] = None
        payload["meeting_password"] = None
        payload["meeting_id"] = None
        return payload
    payload["meeting_password"] = None
    return payload


@router.get("", response_model=list[LiveClassSessionResponse])
async def api_list_live_classes(
    status_filter: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_live_class_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    rows = list_live_classes(
        school_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
        status_filter=status_filter,
        offset=skip,
        limit=limit,
    )
    return [_sanitize_session_for_user(item, user) for item in rows]


@router.post("", response_model=LiveClassSessionResponse)
async def api_create_live_class(
    payload: LiveClassSessionCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_manage_user),
):
    del user
    return create_live_class(school_id, str(actor.get("profile_id") or "").strip() or None, payload.model_dump(exclude_none=True))


@router.get("/{session_id}", response_model=LiveClassSessionResponse)
async def api_get_live_class(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_live_class_view_user),
):
    return _sanitize_session_for_user(get_live_class(school_id, session_id), user)


@router.post("/{session_id}/start", response_model=LiveClassSessionActionResponse)
async def api_start_live_class(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_manage_user),
):
    del user
    session = start_live_class(school_id, session_id, str(actor.get("profile_id") or "").strip() or None)
    return {"session": session, "message": "Live class started successfully"}


@router.post("/{session_id}/end", response_model=LiveClassSessionActionResponse)
async def api_end_live_class(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_manage_user),
):
    del user
    session = end_live_class(school_id, session_id, str(actor.get("profile_id") or "").strip() or None)
    return {"session": session, "message": "Live class ended successfully"}


@router.post("/{session_id}/join", response_model=LiveClassJoinLeaveResponse)
async def api_join_live_class(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_join_user),
):
    return join_live_class(
        school_id,
        session_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        role_key=_role_key(user),
    )


@router.post("/{session_id}/leave", response_model=LiveClassJoinLeaveResponse)
async def api_leave_live_class(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_join_user),
):
    del user
    return leave_live_class(
        school_id,
        session_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.get("/{session_id}/attendance", response_model=list[LiveClassAttendanceResponse])
async def api_get_live_class_attendance(
    session_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_live_class_attendance_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    return get_live_class_attendance(
        school_id,
        session_id,
        role_key=_role_key(user),
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=getattr(user, "email", None),
    )


@router.post("/{session_id}/recording", response_model=LiveClassRecordingResponse)
async def api_upload_live_class_recording(
    session_id: str,
    payload: LiveClassRecordingCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_live_class_manage_user),
):
    del user
    return upload_live_class_recording(
        school_id,
        session_id,
        str(actor.get("profile_id") or "").strip() or None,
        payload.model_dump(exclude_none=True),
    )
