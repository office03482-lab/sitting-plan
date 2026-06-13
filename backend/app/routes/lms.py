"""Learning Management System routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User, UserRole
from app.schemas import (
    LmsAssignmentCreate,
    LmsAssignmentResponse,
    LmsAssignmentSubmissionCreate,
    LmsAssignmentSubmissionGrade,
    LmsAssignmentSubmissionResponse,
    LmsAssignmentUpdate,
    LmsCourseCreate,
    LmsCourseModuleCreate,
    LmsCourseModuleResponse,
    LmsCourseModuleUpdate,
    LmsCourseResponse,
    LmsCourseUpdate,
    LmsLessonCreate,
    LmsLessonResponse,
    LmsLessonUpdate,
    LmsProgressDashboardResponse,
    LmsProgressResponse,
    LmsProgressUpdate,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_lms import (
    _get_student,
    _get_student_by_profile_id,
    _list_parent_linked_students,
    create_assignment,
    create_course,
    create_lesson,
    create_module,
    delete_assignment,
    delete_course,
    delete_lesson,
    delete_module,
    get_assignment,
    get_course,
    get_lesson,
    get_progress_dashboard,
    grade_submission,
    list_assignments,
    list_courses,
    list_lessons,
    list_modules,
    submit_assignment,
    update_assignment,
    update_course,
    update_lesson,
    update_module,
    update_progress,
)

router = APIRouter(prefix="/api/lms", tags=["LMS"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def _is_parent_portal_user(user: User) -> bool:
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return _role_key(user) == "parent" or "edupay.parent_portal" in permissions


def require_lms_manage_user(
    _: User = Depends(require_permissions("lms.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can manage LMS content")


def require_lms_view_user(
    _: User = Depends(require_permissions("lms.view", "lms.progress", "lms.assignments", "lms.manage", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_portal_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to LMS resources")


def require_lms_progress_user(
    _: User = Depends(require_permissions("lms.progress", "lms.view", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_portal_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students, parents, or administrators can view LMS progress")


def require_lms_assignment_user(
    _: User = Depends(require_permissions("lms.assignments", "lms.progress", "lms.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to LMS assignments")


@router.get("/courses", response_model=list[LmsCourseResponse])
async def api_list_courses(
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return list_courses(school_id, student=student)
    return list_courses(school_id, include_inactive=True)


@router.post("/courses", response_model=LmsCourseResponse)
async def api_create_course(
    payload: LmsCourseCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return create_course(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.get("/courses/{course_id}", response_model=LmsCourseResponse)
async def api_get_course(
    course_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_course(school_id, course_id, student=student)
    return get_course(school_id, course_id)


@router.put("/courses/{course_id}", response_model=LmsCourseResponse)
async def api_update_course(
    course_id: str,
    payload: LmsCourseUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return update_course(school_id, course_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/courses/{course_id}")
async def api_delete_course(
    course_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return delete_course(school_id, course_id, actor.get("profile_id"))


@router.get("/modules", response_model=list[LmsCourseModuleResponse])
async def api_list_modules(
    course_id: str = Query(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
):
    del user
    return list_modules(school_id, course_id)


@router.post("/modules", response_model=LmsCourseModuleResponse)
async def api_create_module(
    payload: LmsCourseModuleCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return create_module(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.put("/modules/{module_id}", response_model=LmsCourseModuleResponse)
async def api_update_module(
    module_id: str,
    payload: LmsCourseModuleUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return update_module(school_id, module_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/modules/{module_id}")
async def api_delete_module(
    module_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return delete_module(school_id, module_id, actor.get("profile_id"))


@router.get("/lessons", response_model=list[LmsLessonResponse])
async def api_list_lessons(
    course_id: str | None = Query(default=None),
    module_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
):
    del user
    return list_lessons(school_id, course_id=course_id, module_id=module_id)


@router.post("/lessons", response_model=LmsLessonResponse)
async def api_create_lesson(
    payload: LmsLessonCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return create_lesson(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.get("/lessons/{lesson_id}", response_model=LmsLessonResponse)
async def api_get_lesson(
    lesson_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_lesson(school_id, lesson_id, student=student)
    return get_lesson(school_id, lesson_id)


@router.put("/lessons/{lesson_id}", response_model=LmsLessonResponse)
async def api_update_lesson(
    lesson_id: str,
    payload: LmsLessonUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return update_lesson(school_id, lesson_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/lessons/{lesson_id}")
async def api_delete_lesson(
    lesson_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return delete_lesson(school_id, lesson_id, actor.get("profile_id"))


@router.get("/progress", response_model=LmsProgressDashboardResponse)
async def api_get_progress(
    child_student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_progress_dashboard(school_id, student=student)
    if _is_parent_portal_user(user):
        linked_students = _list_parent_linked_students(school_id, str(actor.get("profile_id") or "").strip(), getattr(user, "email", None))
        if child_student_id:
            linked_students = [item for item in linked_students if str(item.get("id") or "").strip() == child_student_id]
        return get_progress_dashboard(school_id, parent_students=linked_students)
    if child_student_id:
        student = _get_student(school_id, child_student_id)
        return get_progress_dashboard(school_id, student=student)
    return get_progress_dashboard(school_id, parent_students=[])


@router.post("/progress", response_model=LmsProgressResponse)
async def api_update_progress(
    payload: LmsProgressUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
):
    if not _is_student_user(user):
        raise HTTPException(status_code=403, detail="Only students can update lesson progress")
    student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
    return update_progress(school_id, student, payload.model_dump(exclude_none=True))


@router.get("/assignments", response_model=list[LmsAssignmentResponse])
async def api_list_assignments(
    course_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return list_assignments(school_id, student=student, course_id=course_id)
    return list_assignments(school_id, course_id=course_id, include_inactive=True)


@router.post("/assignments", response_model=LmsAssignmentResponse)
async def api_create_assignment(
    payload: LmsAssignmentCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return create_assignment(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.get("/assignments/{assignment_id}", response_model=LmsAssignmentResponse)
async def api_get_assignment(
    assignment_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_assignment(school_id, assignment_id, student=student)
    return get_assignment(school_id, assignment_id)


@router.put("/assignments/{assignment_id}", response_model=LmsAssignmentResponse)
async def api_update_assignment(
    assignment_id: str,
    payload: LmsAssignmentUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return update_assignment(school_id, assignment_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/assignments/{assignment_id}")
async def api_delete_assignment(
    assignment_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return delete_assignment(school_id, assignment_id, actor.get("profile_id"))


@router.post("/assignments/{assignment_id}/submit", response_model=LmsAssignmentSubmissionResponse)
async def api_submit_assignment(
    assignment_id: str,
    payload: LmsAssignmentSubmissionCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
):
    if not _is_student_user(user):
        raise HTTPException(status_code=403, detail="Only students can submit assignments")
    student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
    return submit_assignment(school_id, assignment_id, student, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.post("/assignments/{assignment_id}/grade/{student_id}", response_model=LmsAssignmentSubmissionResponse, include_in_schema=False)
async def api_grade_assignment_submission(
    assignment_id: str,
    student_id: str,
    payload: LmsAssignmentSubmissionGrade,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
):
    del user
    return grade_submission(school_id, assignment_id, student_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
