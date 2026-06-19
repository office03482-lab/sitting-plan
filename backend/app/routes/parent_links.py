"""Admin routes for parent account creation and student-parent linking."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, EmailStr

from app.middleware.auth import get_authenticated_user, require_permissions
from app.models import User
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_parent_links import (
    create_or_link_parent,
    import_parent_links_from_excel,
    list_parent_directory,
    list_student_parents,
    unlink_parent,
)

router = APIRouter(prefix="/api/parent-links", tags=["Parent Links"])


class ParentLinkRequest(BaseModel):
    guardian_id: str | None = None
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    relation_type: str | None = "parent"
    address: str | None = None
    is_primary: bool = False
    can_receive_notifications: bool = True
    create_login: bool = True
    password: str | None = None


def require_parent_link_admin(
    _: User = Depends(require_permissions("admin_office.students", "admin_office.access_control")),
    user: User = Depends(get_authenticated_user),
) -> User:
    role_key = str(getattr(user, "role_key", "") or "").strip().lower()
    if getattr(user, "role", None) == "admin" or role_key in {"platform_admin", "school_admin"}:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to manage parent links")


@router.get("/guardians")
async def api_list_guardians(
    search: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_parent_link_admin),
):
    return list_parent_directory(school_id, search=search, limit=limit)


@router.get("/students/{student_id}")
async def api_list_student_parents(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_parent_link_admin),
):
    return list_student_parents(school_id, student_id)


@router.post("/students/{student_id}")
async def api_create_or_link_parent(
    student_id: str,
    payload: ParentLinkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_parent_link_admin),
):
    return create_or_link_parent(
        school_id,
        student_id,
        guardian_id=payload.guardian_id,
        full_name=payload.full_name,
        email=str(payload.email).strip() if payload.email else None,
        phone=payload.phone,
        relation_type=payload.relation_type,
        address=payload.address,
        is_primary=payload.is_primary,
        can_receive_notifications=payload.can_receive_notifications,
        create_login=payload.create_login,
        password=payload.password,
    )


@router.delete("/students/{student_id}/{guardian_id}")
async def api_unlink_parent(
    student_id: str,
    guardian_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_parent_link_admin),
):
    return unlink_parent(school_id, student_id, guardian_id)


@router.post("/import")
async def api_import_parent_links(
    file: UploadFile = File(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    _: User = Depends(require_parent_link_admin),
):
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported for parent import")
    content = await file.read()
    return import_parent_links_from_excel(school_id, content)
