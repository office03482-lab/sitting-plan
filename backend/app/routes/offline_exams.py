"""Offline Exam backend routes using Supabase-native storage."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import (
    OfflineExamAttendanceCreate,
    OfflineExamCreate,
    OfflineExamEvaluationCreate,
    OfflineExamQuestionCreate,
    OfflineExamQuestionUpdate,
    OfflineExamUpdate,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.scope_engine import PermissionScopeContext, build_scope_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_offline_exams import (
    create_exam,
    create_question,
    delete_exam,
    delete_question,
    duplicate_exam,
    generate_hall_tickets,
    generate_seating,
    get_analytics,
    get_exam,
    import_evaluations_from_excel,
    list_attendance,
    list_evaluations,
    list_exams,
    list_hall_tickets,
    list_questions,
    list_results,
    list_seating,
    mark_attendance,
    publish_exam,
    publish_results,
    save_evaluation,
    unpublish_exam,
    update_exam,
    update_question,
)

router = APIRouter(prefix="/api/offline-exams", tags=["Offline Exams"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


def require_manage_user(
    _: User = Depends(require_permissions("offline_exams.manage", "online_tests.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can manage offline exams")


def require_view_user(
    _: User = Depends(
        require_permissions(
            "offline_exams.view",
            "offline_exams.manage",
            "online_tests.view",
            "online_tests.manage",
        )
    ),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to offline exam resources")


def require_reports_user(
    _: User = Depends(require_permissions("offline_exams.reports", "offline_exams.manage", "online_tests.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can view offline exam analytics")


def require_offline_exams_manage_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key="offline_exams.manage",
        include_students=True,
        include_teacher_batches=True,
    )


def require_offline_exams_view_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_view_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key="offline_exams.view",
        include_students=True,
        include_teacher_batches=True,
    )


def require_offline_exams_reports_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_reports_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key="offline_exams.reports",
        include_students=True,
        include_teacher_batches=True,
    )


# ─── Subjects ──────────────────────────────────────────────────────────

@router.get("/subjects")
async def list_offline_exam_subjects(
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    rows = list(
        get_supabase_admin_client()
        .table("subjects")
        .select("id, school_id, name, class_name, is_active")
        .eq("school_id", context.school_id)
        .eq("is_active", True)
        .order("name", desc=False)
        .execute()
        .data
        or []
    )
    return JSONResponse(content=rows)


# ─── Exam CRUD ──────────────────────────────────────────────────────────

@router.get("")
async def list_offline_exams(context: PermissionScopeContext = Depends(require_offline_exams_view_scope)):
    exams = list_exams(context.school_id)
    return JSONResponse(content=exams)


@router.get("/{exam_id}")
async def get_offline_exam(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=get_exam(context.school_id, exam_id))


@router.post("")
async def create_offline_exam(
    payload: OfflineExamCreate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = create_exam(context.school_id, context.profile_id, payload.model_dump())
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


@router.put("/{exam_id}")
async def update_offline_exam(
    exam_id: str,
    payload: OfflineExamUpdate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = update_exam(context.school_id, exam_id, context.profile_id, payload.model_dump(exclude_unset=True))
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


@router.delete("/{exam_id}")
async def delete_offline_exam(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    delete_exam(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content={"success": True})


@router.post("/{exam_id}/publish")
async def publish_offline_exam(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = publish_exam(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


@router.post("/{exam_id}/unpublish")
async def unpublish_offline_exam(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = unpublish_exam(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


@router.post("/{exam_id}/duplicate")
async def duplicate_offline_exam(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = duplicate_exam(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


# ─── Questions ──────────────────────────────────────────────────────────

@router.get("/{exam_id}/questions")
async def list_offline_exam_questions(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_questions(context.school_id, exam_id))


@router.post("/{exam_id}/questions")
async def create_offline_exam_question(
    exam_id: str,
    payload: OfflineExamQuestionCreate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    data = payload.model_dump()
    data["exam_id"] = exam_id
    result = create_question(context.school_id, exam_id, context.profile_id, data)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


@router.put("/questions/{question_id}")
async def update_offline_exam_question(
    question_id: str,
    payload: OfflineExamQuestionUpdate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = update_question(context.school_id, question_id, context.profile_id, payload.model_dump(exclude_unset=True))
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


@router.delete("/questions/{question_id}")
async def delete_offline_exam_question(
    question_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    delete_question(context.school_id, question_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content={"success": True})


# ─── Hall Tickets ───────────────────────────────────────────────────────

@router.get("/{exam_id}/hall-tickets")
async def list_offline_exam_hall_tickets(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_hall_tickets(context.school_id, exam_id))


@router.post("/{exam_id}/hall-tickets/generate")
async def generate_offline_exam_hall_tickets(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = generate_hall_tickets(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


# ─── Attendance ─────────────────────────────────────────────────────────

@router.get("/{exam_id}/attendance")
async def list_offline_exam_attendance(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_attendance(context.school_id, exam_id))


@router.post("/{exam_id}/attendance")
async def mark_offline_exam_attendance(
    exam_id: str,
    payload: OfflineExamAttendanceCreate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = mark_attendance(context.school_id, exam_id, context.profile_id, payload.model_dump())
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


# ─── Evaluations ────────────────────────────────────────────────────────

@router.get("/{exam_id}/evaluations")
async def list_offline_exam_evaluations(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_evaluations(context.school_id, exam_id))


@router.post("/{exam_id}/evaluations")
async def save_offline_exam_evaluation(
    exam_id: str,
    payload: OfflineExamEvaluationCreate,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = save_evaluation(context.school_id, exam_id, context.profile_id, payload.model_dump())
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)


@router.post("/{exam_id}/evaluations/import")
async def import_offline_exam_scores(
    exam_id: str,
    file: UploadFile = File(...),
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    import openpyxl
    content = await file.read()
    workbook = openpyxl.load_workbook(content, read_only=True)
    sheet = workbook.active
    if not sheet:
        raise HTTPException(status_code=400, detail="Uploaded file has no data")
    headers = [str(cell.value or "").strip().lower() for cell in sheet[1]]
    rows_data = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        row_dict = dict(zip(headers, row))
        rows_data.append(row_dict)
    result = import_evaluations_from_excel(context.school_id, exam_id, context.profile_id, rows_data)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


# ─── Results ────────────────────────────────────────────────────────────

@router.get("/{exam_id}/results")
async def list_offline_exam_results(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_results(context.school_id, exam_id))


@router.post("/{exam_id}/results/publish")
async def publish_offline_exam_results(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = publish_results(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result)


# ─── Analytics ──────────────────────────────────────────────────────────

@router.get("/{exam_id}/analytics")
async def get_offline_exam_analytics(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_reports_scope),
):
    return JSONResponse(content=get_analytics(context.school_id, exam_id))


# ─── Seating ────────────────────────────────────────────────────────────

@router.get("/{exam_id}/seating")
async def list_offline_exam_seating(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_view_scope),
):
    return JSONResponse(content=list_seating(context.school_id, exam_id))


@router.post("/{exam_id}/seating/generate")
async def generate_offline_exam_seating(
    exam_id: str,
    context: PermissionScopeContext = Depends(require_offline_exams_manage_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    reservation = prepare_route_retrofit(
        flag_name="offline_exams",
        user=context.user,
        actor=actor,
        permission_key="offline_exams.manage",
        school_id=context.school_id,
    )
    result = generate_seating(context.school_id, exam_id, context.profile_id)
    commit_route_retrofit(reservation)
    return JSONResponse(content=result, status_code=status.HTTP_201_CREATED)
