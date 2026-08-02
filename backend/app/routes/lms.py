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
    LmsRevisionTrackerResponse,
    LmsRevisionTrackerUpsert,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.scope_engine import PermissionScopeContext, build_scope_context
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_lms import (
    _get_assignment_row,
    _get_course_row,
    _get_lesson_row,
    _get_module_row,
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
    get_student_success_dashboard,
    grade_submission,
    list_assignments,
    list_revision_tracker,
    list_courses,
    list_lessons,
    list_modules,
    submit_assignment,
    upsert_revision_tracker,
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


def _is_admin_preview_user(user: User) -> bool:
    if _is_school_admin_user(user) or is_platform_admin_user(user):
        return True
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return "admin_office.students" in permissions


def require_lms_manage_user(
    _: User = Depends(require_permissions("lms.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can manage LMS content")


def require_lms_view_user(
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user) or _is_parent_portal_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to LMS resources")


def require_lms_progress_user(
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


def require_lms_view_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_view_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="lms.view",
        include_students=True,
        include_teacher_batches=True,
    )


def require_lms_manage_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_manage_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="lms.manage",
        include_students=True,
        include_teacher_batches=True,
    )


def require_lms_progress_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="lms.progress",
        include_students=True,
        include_teacher_batches=True,
    )


def require_lms_assignment_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="lms.assignments",
        include_students=True,
        include_teacher_batches=True,
    )


def _normalize_scope_value(value: object) -> str:
    return str(value or "").strip()


def _matches_assigned_batch(context: PermissionScopeContext, *, class_name: str | None, section: str | None, batch_id: str | None) -> bool:
    if context.is_school_wide:
        return True
    assigned = [(_normalize_scope_value(item[0]).casefold(), _normalize_scope_value(item[1]).casefold() if item[1] else None) for item in context.assigned_batches if _normalize_scope_value(item[0])]
    if not assigned:
        return False
    normalized_class_name = _normalize_scope_value(class_name).casefold()
    normalized_section = _normalize_scope_value(section).casefold() if section else None
    if normalized_class_name:
        for assigned_class, assigned_section in assigned:
            if assigned_class != normalized_class_name:
                continue
            if assigned_section and normalized_section and assigned_section != normalized_section:
                continue
            if assigned_section and not normalized_section:
                continue
            return True
    if batch_id:
        for assigned_class, _ in assigned:
            if assigned_class == _normalize_scope_value(batch_id).casefold():
                return True
    return False


def _course_is_in_scope(course: dict[str, object], context: PermissionScopeContext) -> bool:
    if context.is_school_wide:
        return True
    if context.scope == "own":
        return False
    if _normalize_scope_value(course.get("created_by_profile_id")) and _normalize_scope_value(course.get("created_by_profile_id")) == _normalize_scope_value(context.profile_id):
        return True
    return _matches_assigned_batch(
        context,
        class_name=_normalize_scope_value(course.get("target_class_name")) or None,
        section=_normalize_scope_value(course.get("target_section")) or None,
        batch_id=_normalize_scope_value(course.get("batch_id")) or None,
    )


def _student_is_in_scope(student: dict[str, object], context: PermissionScopeContext) -> bool:
    if context.is_school_wide:
        return True
    student_id = _normalize_scope_value(student.get("id"))
    if context.scope == "own":
        return student_id in {_normalize_scope_value(item) for item in context.student_ids}
    if context.scope == "assigned":
        return _matches_assigned_batch(
            context,
            class_name=_normalize_scope_value(student.get("class_name")) or None,
            section=_normalize_scope_value(student.get("section")) or None,
            batch_id=_normalize_scope_value(student.get("batch_id")) or None,
        )
    return False


def _enforce_course_scope(course: dict[str, object], context: PermissionScopeContext, detail: str) -> None:
    if not _course_is_in_scope(course, context):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _filter_courses(rows: list[dict[str, object]], context: PermissionScopeContext) -> list[dict[str, object]]:
    if context.is_school_wide:
        return rows
    return [row for row in rows if _course_is_in_scope(row, context)]


@router.get("/courses", response_model=list[LmsCourseResponse])
async def api_list_courses(
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    scope_context: PermissionScopeContext = Depends(require_lms_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return list_courses(school_id, student=student)
    return _filter_courses(list_courses(school_id, include_inactive=True), scope_context)


@router.post("/courses", response_model=LmsCourseResponse)
async def api_create_course(
    payload: LmsCourseCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    if not scope_context.is_school_wide and not _matches_assigned_batch(
        scope_context,
        class_name=payload.target_class_name,
        section=payload.target_section,
        batch_id=payload.batch_id,
    ):
        raise HTTPException(status_code=403, detail="You can only create LMS courses for your assigned batches")
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=scope_context.user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.create_course",
    )
    result = create_course(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/courses/{course_id}", response_model=LmsCourseResponse)
async def api_get_course(
    course_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    scope_context: PermissionScopeContext = Depends(require_lms_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_course(school_id, course_id, student=student)
    course_row = _get_course_row(school_id, course_id)
    _enforce_course_scope(course_row, scope_context, "You can only view LMS courses in your assigned scope")
    return get_course(school_id, course_id)


@router.put("/courses/{course_id}", response_model=LmsCourseResponse)
async def api_update_course(
    course_id: str,
    payload: LmsCourseUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    course_row = _get_course_row(school_id, course_id)
    _enforce_course_scope(course_row, scope_context, "You can only edit LMS courses in your assigned scope")
    return update_course(school_id, course_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/courses/{course_id}")
async def api_delete_course(
    course_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    course_row = _get_course_row(school_id, course_id)
    _enforce_course_scope(course_row, scope_context, "You can only delete LMS courses in your assigned scope")
    return delete_course(school_id, course_id, actor.get("profile_id"))


@router.get("/modules", response_model=list[LmsCourseModuleResponse])
async def api_list_modules(
    course_id: str = Query(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_lms_view_scope),
):
    course_row = _get_course_row(school_id, course_id)
    _enforce_course_scope(course_row, scope_context, "You can only view LMS modules in your assigned scope")
    return list_modules(school_id, course_id)


@router.post("/modules", response_model=LmsCourseModuleResponse)
async def api_create_module(
    payload: LmsCourseModuleCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    course_row = _get_course_row(school_id, payload.course_id)
    _enforce_course_scope(course_row, scope_context, "You can only create LMS modules in your assigned scope")
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=scope_context.user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.create_module",
    )
    result = create_module(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.put("/modules/{module_id}", response_model=LmsCourseModuleResponse)
async def api_update_module(
    module_id: str,
    payload: LmsCourseModuleUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    module_row = _get_module_row(school_id, module_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(module_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only edit LMS modules in your assigned scope")
    return update_module(school_id, module_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/modules/{module_id}")
async def api_delete_module(
    module_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    module_row = _get_module_row(school_id, module_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(module_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only delete LMS modules in your assigned scope")
    return delete_module(school_id, module_id, actor.get("profile_id"))


@router.get("/lessons", response_model=list[LmsLessonResponse])
async def api_list_lessons(
    course_id: str | None = Query(default=None),
    module_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_lms_view_scope),
):
    if course_id:
        course_row = _get_course_row(school_id, course_id)
        _enforce_course_scope(course_row, scope_context, "You can only view LMS lessons in your assigned scope")
    if module_id:
        module_row = _get_module_row(school_id, module_id)
        course_row = _get_course_row(school_id, _normalize_scope_value(module_row.get("course_id")))
        _enforce_course_scope(course_row, scope_context, "You can only view LMS lessons in your assigned scope")
    return list_lessons(school_id, course_id=course_id, module_id=module_id)


@router.post("/lessons", response_model=LmsLessonResponse)
async def api_create_lesson(
    payload: LmsLessonCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    course_row = _get_course_row(school_id, payload.course_id)
    _enforce_course_scope(course_row, scope_context, "You can only create LMS lessons in your assigned scope")
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=scope_context.user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.create_lesson",
    )
    result = create_lesson(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/lessons/{lesson_id}", response_model=LmsLessonResponse)
async def api_get_lesson(
    lesson_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_lms_view_user),
    scope_context: PermissionScopeContext = Depends(require_lms_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_lesson(school_id, lesson_id, student=student)
    lesson_row = _get_lesson_row(school_id, lesson_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(lesson_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only view LMS lessons in your assigned scope")
    return get_lesson(school_id, lesson_id)


@router.put("/lessons/{lesson_id}", response_model=LmsLessonResponse)
async def api_update_lesson(
    lesson_id: str,
    payload: LmsLessonUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    lesson_row = _get_lesson_row(school_id, lesson_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(lesson_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only edit LMS lessons in your assigned scope")
    return update_lesson(school_id, lesson_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/lessons/{lesson_id}")
async def api_delete_lesson(
    lesson_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    lesson_row = _get_lesson_row(school_id, lesson_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(lesson_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only delete LMS lessons in your assigned scope")
    return delete_lesson(school_id, lesson_id, actor.get("profile_id"))


@router.get("/progress", response_model=LmsProgressDashboardResponse)
async def api_get_progress(
    child_student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
    scope_context: PermissionScopeContext = Depends(require_lms_progress_scope),
):
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=user,
        actor=actor,
        permission_key="lms.progress",
        school_id=school_id,
        resource_key="lms_usage",
        delta=0,
        reason="lms.get_progress",
    )
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        result = get_student_success_dashboard(school_id, student=student)
        commit_route_retrofit(reservation)
        return result
    if _is_admin_preview_user(user):
        if child_student_id:
            student = _get_student(school_id, child_student_id)
            if not _student_is_in_scope(student, scope_context):
                raise HTTPException(status_code=403, detail="You can only view LMS progress for students in your assigned scope")
            result = get_student_success_dashboard(school_id, student=student, viewer_mode_override="admin")
            commit_route_retrofit(reservation)
            return result
        result = get_student_success_dashboard(school_id, parent_students=[])
        commit_route_retrofit(reservation)
        return result
    if _is_parent_portal_user(user):
        linked_students = _list_parent_linked_students(school_id, str(actor.get("profile_id") or "").strip(), getattr(user, "email", None))
        if child_student_id:
            linked_students = [item for item in linked_students if str(item.get("id") or "").strip() == child_student_id]
        result = get_student_success_dashboard(school_id, parent_students=linked_students)
        commit_route_retrofit(reservation)
        return result
    result = get_student_success_dashboard(school_id, parent_students=[])
    commit_route_retrofit(reservation)
    return result


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
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=user,
        actor=actor,
        permission_key="lms.progress",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.update_progress",
    )
    result = update_progress(school_id, student, payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/revision-tracker", response_model=list[LmsRevisionTrackerResponse])
async def api_list_revision_tracker(
    child_student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
    scope_context: PermissionScopeContext = Depends(require_lms_progress_scope),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return list_revision_tracker(school_id, str(student.get("id") or "").strip())
    if _is_admin_preview_user(user):
        if child_student_id:
            student = _get_student(school_id, child_student_id)
            if not _student_is_in_scope(student, scope_context):
                raise HTTPException(status_code=403, detail="You can only view LMS revision data for students in your assigned scope")
            return list_revision_tracker(school_id, str(student.get("id") or "").strip())
        return []
    if _is_parent_portal_user(user):
        linked_students = _list_parent_linked_students(school_id, str(actor.get("profile_id") or "").strip(), getattr(user, "email", None))
        if child_student_id:
            linked_students = [item for item in linked_students if str(item.get("id") or "").strip() == child_student_id]
        if not linked_students:
            return []
        return list_revision_tracker(school_id, str(linked_students[0].get("id") or "").strip())
    return []


@router.post("/revision-tracker", response_model=LmsRevisionTrackerResponse)
async def api_upsert_revision_tracker(
    payload: LmsRevisionTrackerUpsert,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_progress_user),
):
    if not _is_student_user(user):
        raise HTTPException(status_code=403, detail="Only students can update revision tracker status")
    student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=user,
        actor=actor,
        permission_key="lms.progress",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.revision_tracker",
    )
    result = upsert_revision_tracker(school_id, student, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/assignments", response_model=list[LmsAssignmentResponse])
async def api_list_assignments(
    course_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
    scope_context: PermissionScopeContext = Depends(require_lms_assignment_scope),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return list_assignments(school_id, student=student, course_id=course_id)
    assignments = list_assignments(school_id, course_id=course_id, include_inactive=True)
    if scope_context.is_school_wide:
        return assignments
    filtered: list[dict] = []
    for assignment in assignments:
        course_row = _get_course_row(school_id, _normalize_scope_value(assignment.get("course_id")))
        if _course_is_in_scope(course_row, scope_context):
            filtered.append(assignment)
    return filtered


@router.post("/assignments", response_model=LmsAssignmentResponse)
async def api_create_assignment(
    payload: LmsAssignmentCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    course_row = _get_course_row(school_id, payload.course_id)
    _enforce_course_scope(course_row, scope_context, "You can only create LMS assignments in your assigned scope")
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=scope_context.user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.create_assignment",
    )
    result = create_assignment(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/assignments/{assignment_id}", response_model=LmsAssignmentResponse)
async def api_get_assignment(
    assignment_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_lms_assignment_user),
    scope_context: PermissionScopeContext = Depends(require_lms_assignment_scope),
):
    if _is_student_user(user):
        student = _get_student_by_profile_id(school_id, str(actor.get("profile_id") or "").strip())
        return get_assignment(school_id, assignment_id, student=student)
    assignment_row = _get_assignment_row(school_id, assignment_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(assignment_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only view LMS assignments in your assigned scope")
    return get_assignment(school_id, assignment_id)


@router.put("/assignments/{assignment_id}", response_model=LmsAssignmentResponse)
async def api_update_assignment(
    assignment_id: str,
    payload: LmsAssignmentUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    assignment_row = _get_assignment_row(school_id, assignment_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(assignment_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only edit LMS assignments in your assigned scope")
    return update_assignment(school_id, assignment_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/assignments/{assignment_id}")
async def api_delete_assignment(
    assignment_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    assignment_row = _get_assignment_row(school_id, assignment_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(assignment_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only delete LMS assignments in your assigned scope")
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
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=user,
        actor=actor,
        permission_key="lms.assignments",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.submit_assignment",
    )
    result = submit_assignment(school_id, assignment_id, student, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.post("/assignments/{assignment_id}/grade/{student_id}", response_model=LmsAssignmentSubmissionResponse, include_in_schema=False)
async def api_grade_assignment_submission(
    assignment_id: str,
    student_id: str,
    payload: LmsAssignmentSubmissionGrade,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_lms_manage_scope),
):
    assignment_row = _get_assignment_row(school_id, assignment_id)
    course_row = _get_course_row(school_id, _normalize_scope_value(assignment_row.get("course_id")))
    _enforce_course_scope(course_row, scope_context, "You can only grade LMS assignments in your assigned scope")
    if not _student_is_in_scope(_get_student(school_id, student_id), scope_context):
        raise HTTPException(status_code=403, detail="You can only grade LMS assignments for students in your assigned scope")
    reservation = prepare_route_retrofit(
        flag_name="lms",
        user=scope_context.user,
        actor=actor,
        permission_key="lms.manage",
        school_id=school_id,
        resource_key="lms_usage",
        delta=1,
        reason="lms.grade_assignment",
    )
    result = grade_submission(school_id, assignment_id, student_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result
