"""Supabase storage-backed upload APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.models import User, UserRole
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit, storage_delta_gb
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_storage import upload_file_to_supabase_storage

router = APIRouter(prefix="/api/uploads", tags=["Uploads"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def require_upload_manager(user: User = Depends(get_authenticated_user)) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can upload this file")


def require_assignment_upload_user(user: User = Depends(get_authenticated_user)) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to assignment uploads")


def _file_size_bytes(file: UploadFile) -> int:
    current = file.file.tell()
    file.file.seek(0, 2)
    size = int(file.file.tell() or 0)
    file.file.seek(current)
    return size


@router.post("/video")
async def api_upload_video(
    file: UploadFile = File(...),
    purpose: str = Query(default="lms"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_upload_manager),
):
    reservation = prepare_route_retrofit(
        flag_name="storage",
        user=user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="storage_used",
        delta=storage_delta_gb(_file_size_bytes(file)),
        reason="uploads.video",
    )
    category = "live_class_recording" if purpose == "live_class_recording" else "video"
    result = await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=purpose,
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/document")
async def api_upload_document(
    file: UploadFile = File(...),
    purpose: str = Query(default="lms"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_upload_manager),
):
    reservation = prepare_route_retrofit(
        flag_name="storage",
        user=user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="storage_used",
        delta=storage_delta_gb(_file_size_bytes(file)),
        reason="uploads.document",
    )
    category = "notes" if purpose == "notes" else "document"
    result = await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=purpose,
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/image")
async def api_upload_image(
    file: UploadFile = File(...),
    purpose: str = Query(default="online_test"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_upload_manager),
):
    reservation = prepare_route_retrofit(
        flag_name="storage",
        user=user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="storage_used",
        delta=storage_delta_gb(_file_size_bytes(file)),
        reason="uploads.image",
    )
    result = await upload_file_to_supabase_storage(
        school_id=school_id,
        category="image",
        file=file,
        folder=purpose,
    )
    commit_route_retrofit(reservation)
    return result


@router.post("/assignment")
async def api_upload_assignment(
    file: UploadFile = File(...),
    submission: bool = Query(default=False),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_assignment_upload_user),
):
    permission_key = "lms.assignments" if _is_student_user(user) else "lms.manage"
    reservation = prepare_route_retrofit(
        flag_name="storage",
        user=user,
        actor=actor,
        permission_key=permission_key,
        school_id=school_id,
        resource_key="storage_used",
        delta=storage_delta_gb(_file_size_bytes(file)),
        reason="uploads.assignment",
    )
    category = "assignment_submission" if submission else "assignment"
    folder = "submissions" if submission else "teacher-material"
    result = await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=folder,
    )
    commit_route_retrofit(reservation)
    return result
