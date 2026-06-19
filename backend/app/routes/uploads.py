"""Supabase storage-backed upload APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.middleware.auth import get_authenticated_user
from app.models import User, UserRole
from app.services.bulk_action_requests import is_platform_admin_user
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


@router.post("/video")
async def api_upload_video(
    file: UploadFile = File(...),
    purpose: str = Query(default="lms"),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_upload_manager),
):
    del user
    category = "live_class_recording" if purpose == "live_class_recording" else "video"
    return await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=purpose,
    )


@router.post("/document")
async def api_upload_document(
    file: UploadFile = File(...),
    purpose: str = Query(default="lms"),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_upload_manager),
):
    del user
    category = "notes" if purpose == "notes" else "document"
    return await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=purpose,
    )


@router.post("/image")
async def api_upload_image(
    file: UploadFile = File(...),
    purpose: str = Query(default="online_test"),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_upload_manager),
):
    del user
    return await upload_file_to_supabase_storage(
        school_id=school_id,
        category="image",
        file=file,
        folder=purpose,
    )


@router.post("/assignment")
async def api_upload_assignment(
    file: UploadFile = File(...),
    submission: bool = Query(default=False),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_assignment_upload_user),
):
    del user
    category = "assignment_submission" if submission else "assignment"
    folder = "submissions" if submission else "teacher-material"
    return await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=folder,
    )
