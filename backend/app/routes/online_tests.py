"""Online Test backend routes using Supabase-native storage."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas import (
    OnlineTestAnalyticsResponse,
    OnlineTestAiGenerateRequest,
    OnlineTestAiGenerateResponse,
    OnlineTestAttemptCreate,
    OnlineTestAttemptResponse,
    OnlineTestAttemptResponseUpsert,
    OnlineTestCreate,
    OnlineTestQuestionBankCreate,
    OnlineTestQuestionBankResponse,
    OnlineTestQuestionCreate,
    OnlineTestQuestionResponse,
    OnlineTestQuestionUpdate,
    OnlineTestResponse,
    OnlineTestResultResponse,
    OnlineTestUpdate,
)
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.route_retrofit import commit_route_retrofit, prepare_route_retrofit
from app.services.scope_engine import PermissionScopeContext, build_scope_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_lms import _list_parent_linked_students
from app.services.supabase_online_tests import (
    AIProviderError,
    _get_attempt_row,
    _get_result_row,
    _get_student_by_profile_id,
    _get_test_row,
    close_test,
    create_question_bank_item,
    create_question,
    create_test,
    delete_question,
    delete_test,
    duplicate_test,
    generate_ai_test,
    get_result,
    get_attempt,
    get_results_analytics,
    get_test,
    get_test_for_student,
    import_question_bank_workbook,
    list_attempts,
    list_question_bank,
    list_questions,
    list_questions_for_student,
    list_results,
    list_tests,
    publish_test,
    save_attempt,
    start_attempt,
    submit_attempt,
    unpublish_test,
    update_question,
    update_test,
)
from app.utils.academic_batches import split_batch_to_class_section

router = APIRouter(prefix="/api/online-tests", tags=["Online Tests"])


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


def require_manage_user(
    _: User = Depends(require_permissions("online_tests.manage")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can manage online tests")


def require_view_user(
    _: User = Depends(
        require_permissions(
            "online_tests.view",
            "online_tests.attempt",
            "online_tests.manage",
            "online_tests.grade",
            "online_tests.reports",
        )
    ),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_student_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to online test resources")


def require_attempt_user(
    _: User = Depends(require_permissions("online_tests.attempt")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_student_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can attempt online tests")


def require_grade_user(
    _: User = Depends(require_permissions("online_tests.grade")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can grade online tests")


def require_reports_user(
    _: User = Depends(require_permissions("online_tests.reports")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_teacher_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only teachers or administrators can view online test analytics")


def require_results_analytics_user(
    _: User = Depends(
        require_permissions(
            "online_tests.reports",
            "online_tests.view",
            "online_tests.attempt",
            "edupay.parent_portal",
        )
    ),
    user: User = Depends(get_authenticated_user),
) -> User:
    if (
        _is_teacher_user(user)
        or _is_student_user(user)
        or _is_school_admin_user(user)
        or is_platform_admin_user(user)
        or _is_parent_portal_user(user)
    ):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to online test analytics")


def require_online_tests_view_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_view_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key="online_tests.view",
        include_students=True,
        include_teacher_batches=True,
    )


def require_online_tests_manage_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key="online_tests.manage",
        include_students=True,
        include_teacher_batches=True,
    )


def require_online_tests_reports_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_results_analytics_user),
) -> PermissionScopeContext:
    permission_key = "online_tests.reports"
    if _is_parent_portal_user(user):
        permission_key = "edupay.parent_portal"
    elif _is_student_user(user):
        permission_key = "online_tests.attempt"
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
        permission_key=permission_key,
        include_students=True,
        include_teacher_batches=True,
    )


def _normalize_scope_value(value: object) -> str:
    return str(value or "").strip()


def _assigned_scope_pairs(context: PermissionScopeContext) -> list[tuple[str, str | None]]:
    return [
        (
            _normalize_scope_value(class_name).casefold(),
            _normalize_scope_value(section).casefold() if section else None,
        )
        for class_name, section in context.assigned_batches
        if _normalize_scope_value(class_name)
    ]


def _resolve_batch_name(school_id: str, batch_id: str | None) -> str | None:
    normalized_batch_id = _normalize_scope_value(batch_id)
    if not normalized_batch_id:
        return None
    rows = list(
        get_supabase_admin_client()
        .table("batches")
        .select("id,name")
        .eq("school_id", school_id)
        .eq("id", normalized_batch_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    return _normalize_scope_value(rows[0].get("name")) or None


def _batch_matches_scope(school_id: str, batch_id: str | None, context: PermissionScopeContext) -> bool:
    if context.is_school_wide:
        return True
    batch_name = _resolve_batch_name(school_id, batch_id)
    if not batch_name:
        return False
    assigned_pairs = _assigned_scope_pairs(context)
    class_name, section = split_batch_to_class_section(batch_name)
    normalized_batch_name = _normalize_scope_value(batch_name).casefold()
    normalized_class_name = _normalize_scope_value(class_name).casefold()
    normalized_section = _normalize_scope_value(section).casefold() if section else None
    for assigned_class, assigned_section in assigned_pairs:
        if normalized_batch_name and assigned_class == normalized_batch_name:
            return True
        if normalized_class_name and assigned_class != normalized_class_name:
            continue
        if normalized_class_name:
            if assigned_section and normalized_section and assigned_section != normalized_section:
                continue
            if assigned_section and not normalized_section:
                continue
            return True
    return False


def _get_question_row(school_id: str, question_id: str) -> dict[str, object]:
    rows = list(
        get_supabase_admin_client()
        .table("online_test_test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return dict(rows[0])


def _serialize_question_bank_row(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": _normalize_scope_value(row.get("id")),
        "school_id": _normalize_scope_value(row.get("school_id")),
        "subject": row.get("subject"),
        "chapter": row.get("chapter"),
        "topic": row.get("topic"),
        "question_type": _normalize_scope_value(row.get("question_type")) or "single_choice",
        "difficulty_level": _normalize_scope_value(row.get("difficulty_level")) or "medium",
        "prompt_text": _normalize_scope_value(row.get("prompt_text")),
        "option_items": list(row.get("option_items") or []),
        "answer_key": dict(row.get("answer_key")) if isinstance(row.get("answer_key"), dict) else {},
        "explanation": row.get("explanation"),
        "marks": float(row.get("marks") or 0),
        "negative_marks": float(row.get("negative_marks") or 0),
        "metadata": dict(row.get("metadata")) if isinstance(row.get("metadata"), dict) else {},
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _list_question_bank_rows(
    school_id: str,
    *,
    subject: str | None = None,
    chapter: str | None = None,
    topic: str | None = None,
    difficulty_level: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, object]]:
    query = (
        get_supabase_admin_client()
        .table("online_test_question_bank")
        .select("*")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if subject:
        query = query.eq("subject", subject)
    if chapter:
        query = query.eq("chapter", chapter)
    if topic:
        query = query.eq("topic", topic)
    if difficulty_level:
        query = query.eq("difficulty_level", difficulty_level)
    return [dict(row) for row in list(query.order("created_at", desc=True).range(max(skip, 0), max(skip, 0) + max(limit, 1) - 1).execute().data or [])]


def _enforce_assigned_test_target(
    school_id: str,
    context: PermissionScopeContext,
    batch_id: str | None,
    detail: str,
) -> None:
    if context.is_school_wide:
        return
    if context.scope == "own":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    if not _batch_matches_scope(school_id, batch_id, context):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _test_in_scope(test: dict[str, object], context: PermissionScopeContext) -> bool:
    if context.is_school_wide:
        return True
    if context.scope == "own":
        return False
    if _normalize_scope_value(test.get("created_by_profile_id")) == _normalize_scope_value(context.profile_id):
        return True
    return _batch_matches_scope(context.school_id, _normalize_scope_value(test.get("batch_id")) or None, context)


def _enforce_test_scope(test: dict[str, object], context: PermissionScopeContext, detail: str) -> None:
    if not _test_in_scope(test, context):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _load_student_lookup(school_id: str, student_ids: list[str]) -> dict[str, dict[str, object]]:
    cleaned_ids = sorted({_normalize_scope_value(student_id) for student_id in student_ids if _normalize_scope_value(student_id)})
    if not cleaned_ids:
        return {}
    rows = list(
        get_supabase_admin_client()
        .table("students")
        .select("id,full_name,batch_id")
        .eq("school_id", school_id)
        .in_("id", cleaned_ids)
        .execute()
        .data
        or []
    )
    return {_normalize_scope_value(row.get("id")): dict(row) for row in rows}


def _build_results_analytics_payload(
    school_id: str,
    *,
    test_rows: list[dict[str, object]],
    attempt_rows: list[dict[str, object]],
    result_rows: list[dict[str, object]],
    test_id: str | None,
    scope_label: str,
    visible_student_ids: list[str] | None = None,
) -> dict[str, object]:
    percentages = [float(row.get("percentage") or 0) for row in result_rows]
    scores = [float(row.get("score_obtained") or 0) for row in result_rows]
    visible_ids = sorted({_normalize_scope_value(student_id) for student_id in (visible_student_ids or []) if _normalize_scope_value(student_id)})
    student_lookup = _load_student_lookup(school_id, [_normalize_scope_value(row.get("student_id")) for row in result_rows] + visible_ids)
    question_wise_analysis: list[dict[str, object]] = []
    difficulty_wise_analysis: list[dict[str, object]] = []
    student_ranking: list[dict[str, object]] = []

    if test_id:
        question_rows = list_questions(school_id, test_id=test_id, skip=0, limit=500)
        question_map = {_normalize_scope_value(row.get("id")): row for row in question_rows}
        responses_query = (
            get_supabase_admin_client()
            .table("online_test_test_responses")
            .select("question_id,is_correct,marks_awarded,student_id")
            .eq("school_id", school_id)
            .eq("test_id", test_id)
            .is_("deleted_at", "null")
        )
        if visible_ids:
            responses_query = responses_query.in_("student_id", visible_ids)
        response_rows = [dict(row) for row in list(responses_query.execute().data or [])]
        question_stats: dict[str, dict[str, object]] = {}
        difficulty_stats: dict[str, dict[str, object]] = {}
        for response in response_rows:
            question_id = _normalize_scope_value(response.get("question_id"))
            question = question_map.get(question_id)
            if not question:
                continue
            stats = question_stats.setdefault(
                question_id,
                {
                    "question_id": question_id,
                    "prompt_text": _normalize_scope_value(question.get("prompt_text")),
                    "difficulty_level": _normalize_scope_value(question.get("difficulty_level")) or "medium",
                    "attempts": 0,
                    "correct": 0,
                    "incorrect": 0,
                    "average_marks": 0.0,
                },
            )
            stats["attempts"] = int(stats["attempts"]) + 1
            if response.get("is_correct") is True:
                stats["correct"] = int(stats["correct"]) + 1
            elif response.get("is_correct") is False:
                stats["incorrect"] = int(stats["incorrect"]) + 1
            stats["average_marks"] = float(stats["average_marks"]) + float(response.get("marks_awarded") or 0)
        for stats in question_stats.values():
            attempts = max(int(stats["attempts"]), 1)
            stats["average_marks"] = round(float(stats["average_marks"]) / attempts, 2)
            stats["correct_rate"] = round((int(stats["correct"]) / attempts) * 100, 2)
            question_wise_analysis.append(stats)
            difficulty_bucket = difficulty_stats.setdefault(
                str(stats["difficulty_level"]),
                {"difficulty_level": str(stats["difficulty_level"]), "questions": 0, "attempts": 0, "correct": 0},
            )
            difficulty_bucket["questions"] = int(difficulty_bucket["questions"]) + 1
            difficulty_bucket["attempts"] = int(difficulty_bucket["attempts"]) + attempts
            difficulty_bucket["correct"] = int(difficulty_bucket["correct"]) + int(stats["correct"])
        for stats in difficulty_stats.values():
            attempts = max(int(stats["attempts"]), 1)
            stats["correct_rate"] = round((int(stats["correct"]) / attempts) * 100, 2)
            difficulty_wise_analysis.append(stats)

    ranked_results = sorted(
        result_rows,
        key=lambda row: (float(row.get("percentage") or 0), float(row.get("score_obtained") or 0)),
        reverse=True,
    )
    for index, row in enumerate(ranked_results[:20], start=1):
        student = student_lookup.get(_normalize_scope_value(row.get("student_id")), {})
        student_ranking.append(
            {
                "rank": index,
                "student_id": _normalize_scope_value(row.get("student_id")),
                "student_name": _normalize_scope_value(student.get("full_name")) or f"Student {_normalize_scope_value(row.get('student_id'))[:8]}",
                "batch_id": _normalize_scope_value(student.get("batch_id")) or None,
                "percentage": round(float(row.get("percentage") or 0), 2),
                "score_obtained": round(float(row.get("score_obtained") or 0), 2),
                "max_score": round(float(row.get("max_score") or 0), 2),
            }
        )

    return {
        "scope": scope_label,
        "school_id": school_id,
        "test_id": test_id,
        "total_tests": len(test_rows),
        "total_attempts": len(attempt_rows),
        "completed_attempts": len([row for row in attempt_rows if _normalize_scope_value(row.get("status")) in {"submitted", "evaluated"}]),
        "evaluated_results": len(result_rows),
        "average_score": round(sum(scores) / len(scores), 2) if scores else 0.0,
        "average_percentage": round(sum(percentages) / len(percentages), 2) if percentages else 0.0,
        "highest_score": round(max(scores), 2) if scores else 0.0,
        "lowest_score": round(min(scores), 2) if scores else 0.0,
        "published_results": len([row for row in result_rows if row.get("published_at")]),
        "question_wise_analysis": question_wise_analysis,
        "difficulty_wise_analysis": difficulty_wise_analysis,
        "student_ranking": student_ranking,
    }


@router.get("/tests", response_model=list[OnlineTestResponse])
async def api_list_tests(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        student = _get_student_by_profile_id(school_id, profile_id)
        return list_tests(
            school_id,
            include_inactive=False,
            student_batch_id=str(student.get("batch_id") or "").strip() or None,
            skip=skip,
            limit=limit,
        )
    tests = list_tests(
        school_id,
        include_inactive=True,
        skip=skip,
        limit=limit,
    )
    if scope_context.is_school_wide:
        return tests
    return [test for test in tests if _test_in_scope(_get_test_row(school_id, _normalize_scope_value(test.get("id"))), scope_context)]


@router.post("/tests", response_model=OnlineTestResponse)
async def api_create_test(
    payload: OnlineTestCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_assigned_test_target(
        school_id,
        scope_context,
        payload.batch_id,
        "You can only create online tests for your assigned batches or classes",
    )
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        reason="online_tests.create_test",
    )
    result = create_test(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.get("/tests/{test_id}", response_model=OnlineTestResponse)
async def api_get_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        return get_test_for_student(school_id, test_id, profile_id)
    test_row = _get_test_row(school_id, test_id)
    _enforce_test_scope(test_row, scope_context, "You can only view online tests in your assigned scope")
    return get_test(school_id, test_id)


@router.put("/tests/{test_id}", response_model=OnlineTestResponse)
async def api_update_test(
    test_id: str,
    payload: OnlineTestUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only edit online tests in your assigned scope")
    return update_test(school_id, test_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/tests/{test_id}")
async def api_delete_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only delete online tests in your assigned scope")
    return delete_test(school_id, test_id, actor.get("profile_id"))


@router.get("/tests/{test_id}/questions", response_model=list[OnlineTestQuestionResponse])
async def api_list_test_questions(
    test_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
    section_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        return list_questions_for_student(
            school_id,
            test_id=test_id,
            profile_id=profile_id,
            section_id=section_id,
            skip=skip,
            limit=limit,
        )
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only view questions for online tests in your assigned scope")
    return list_questions(school_id, test_id=test_id, section_id=section_id, skip=skip, limit=limit)


@router.post("/tests/{test_id}/questions", response_model=OnlineTestQuestionResponse)
async def api_create_test_question(
    test_id: str,
    payload: OnlineTestQuestionCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only edit questions for online tests in your assigned scope")
    data = payload.model_dump(exclude_none=True)
    data["test_id"] = test_id
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        reason="online_tests.create_question",
    )
    result = create_question(school_id, data, actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result


@router.get("/question-bank", response_model=list[OnlineTestQuestionBankResponse])
async def api_list_question_bank(
    subject: str | None = Query(default=None),
    chapter: str | None = Query(default=None),
    topic: str | None = Query(default=None),
    difficulty_level: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_manage_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    if not scope_context.is_school_wide and scope_context.scope == "own":
        raise HTTPException(status_code=403, detail="Own-scope access cannot browse the shared question bank")
    rows = _list_question_bank_rows(
        school_id,
        subject=subject,
        chapter=chapter,
        topic=topic,
        difficulty_level=difficulty_level,
        skip=skip,
        limit=limit,
    )
    if scope_context.is_school_wide:
        return [_serialize_question_bank_row(row) for row in rows]
    actor_profile_id = _normalize_scope_value(scope_context.profile_id)
    return [
        _serialize_question_bank_row(row)
        for row in rows
        if _normalize_scope_value(row.get("created_by_profile_id")) == actor_profile_id
    ]


@router.post("/question-bank", response_model=OnlineTestQuestionBankResponse)
async def api_create_question_bank(
    payload: OnlineTestQuestionBankCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    if not scope_context.is_school_wide and not _normalize_scope_value(scope_context.profile_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Assigned-scope question bank creation requires a staff profile")
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        reason="online_tests.question_bank",
    )
    result = create_question_bank_item(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    commit_route_retrofit(reservation)
    return result


@router.post("/question-bank/import")
async def api_import_question_bank(
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    if not scope_context.is_school_wide and scope_context.scope == "own":
        raise HTTPException(status_code=403, detail="Own-scope access cannot import question bank workbooks")
    if not scope_context.is_school_wide and not _normalize_scope_value(scope_context.profile_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Assigned-scope question bank import requires a staff profile")
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported for question bank import")
    file_bytes = await file.read()
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        reason="online_tests.import_question_bank",
    )
    result = import_question_bank_workbook(school_id, actor.get("profile_id"), file_bytes)
    commit_route_retrofit(reservation)
    return result


@router.post("/ai-generate", response_model=OnlineTestAiGenerateResponse)
async def api_generate_ai_test(
    payload: OnlineTestAiGenerateRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_assigned_test_target(
        school_id,
        scope_context,
        payload.batch_id,
        "You can only generate AI tests for your assigned batches or classes",
    )
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        credit_feature="ai_test_generation",
        credit_amount=5,
        reason="online_tests.ai_generate",
    )
    try:
        result = generate_ai_test(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    except AIProviderError:
        return JSONResponse(
            status_code=200,
            content={"success": False, "message": "AI service temporarily unavailable", "questions": []},
        )
    commit_route_retrofit(reservation)
    return result


@router.put("/questions/{question_id}", response_model=OnlineTestQuestionResponse)
async def api_update_question(
    question_id: str,
    payload: OnlineTestQuestionUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    question_row = _get_question_row(school_id, question_id)
    test_row = _get_test_row(school_id, _normalize_scope_value(question_row.get("test_id")))
    _enforce_test_scope(test_row, scope_context, "You can only update questions for online tests in your assigned scope")
    return update_question(school_id, question_id, payload.model_dump(exclude_unset=True), actor.get("profile_id"))


@router.delete("/questions/{question_id}")
async def api_delete_question(
    question_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    question_row = _get_question_row(school_id, question_id)
    test_row = _get_test_row(school_id, _normalize_scope_value(question_row.get("test_id")))
    _enforce_test_scope(test_row, scope_context, "You can only delete questions for online tests in your assigned scope")
    return delete_question(school_id, question_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/publish", response_model=OnlineTestResponse)
async def api_publish_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only publish online tests in your assigned scope")
    return publish_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/close", response_model=OnlineTestResponse)
async def api_close_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only close online tests in your assigned scope")
    return close_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/duplicate", response_model=OnlineTestResponse)
async def api_duplicate_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only duplicate online tests in your assigned scope")
    reservation = prepare_route_retrofit(
        flag_name="tests",
        user=scope_context.user,
        actor=actor,
        permission_key="online_tests.manage",
        school_id=school_id,
        resource_key="tests_used",
        delta=1,
        reason="online_tests.duplicate",
    )
    result = duplicate_test(school_id, test_id, actor.get("profile_id"))
    commit_route_retrofit(reservation)
    return result


@router.post("/tests/{test_id}/unpublish", response_model=OnlineTestResponse)
async def api_unpublish_test(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    scope_context: PermissionScopeContext = Depends(require_online_tests_manage_scope),
):
    school_id = tenant.school_id
    _enforce_test_scope(_get_test_row(school_id, test_id), scope_context, "You can only unpublish online tests in your assigned scope")
    return unpublish_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/start", response_model=OnlineTestAttemptResponse)
async def api_start_attempt(
    test_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
):
    del user
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    return start_attempt(school_id, test_id, profile_id)


@router.post("/attempts", response_model=OnlineTestAttemptResponse)
async def api_create_attempt(
    payload: OnlineTestAttemptCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
):
    del user
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    return start_attempt(
        school_id,
        payload.test_id,
        profile_id,
        {"test_id": payload.test_id, "session_key": x_active_session, "device_id": x_device_id},
    )


@router.get("/attempts", response_model=list[OnlineTestAttemptResponse])
async def api_list_attempts(
    test_id: str | None = Query(default=None),
    student_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        resolved_student_id = str(_get_student_by_profile_id(school_id, profile_id).get("id") or "").strip()
        return list_attempts(school_id, student_id=resolved_student_id, test_id=test_id, skip=skip, limit=limit)
    attempts = list_attempts(school_id, student_id=student_id, test_id=test_id, skip=skip, limit=limit)
    if scope_context.is_school_wide:
        return attempts
    filtered: list[dict] = []
    for attempt in attempts:
        attempt_row = _get_attempt_row(school_id, _normalize_scope_value(attempt.get("id")))
        test_row = _get_test_row(school_id, _normalize_scope_value(attempt_row.get("test_id")))
        if _test_in_scope(test_row, scope_context):
            filtered.append(attempt)
    return filtered


@router.get("/attempts/{attempt_id}", response_model=OnlineTestAttemptResponse)
async def api_get_attempt(
    attempt_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    attempt = get_attempt(school_id, attempt_id)
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        student = _get_student_by_profile_id(school_id, profile_id)
        if str(attempt.get("student_id") or "").strip() != str(student.get("id") or "").strip():
            raise HTTPException(status_code=403, detail="Students can view only their own attempts")
    else:
        attempt_row = _get_attempt_row(school_id, attempt_id)
        _enforce_test_scope(_get_test_row(school_id, _normalize_scope_value(attempt_row.get("test_id"))), scope_context, "You can only view attempts for online tests in your assigned scope")
    return attempt


@router.post("/attempts/{attempt_id}/save", response_model=OnlineTestAttemptResponse)
async def api_save_attempt(
    attempt_id: str,
    payload: OnlineTestAttemptResponseUpsert,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
):
    del user
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    data = payload.model_dump()
    data["session_key"] = x_active_session
    return save_attempt(school_id, attempt_id, profile_id, data)


@router.post("/attempts/{attempt_id}/submit", response_model=OnlineTestResultResponse)
async def api_submit_attempt(
    attempt_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
):
    del user
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    return submit_attempt(school_id, attempt_id, profile_id, x_active_session)


@router.get("/results/analytics", response_model=OnlineTestAnalyticsResponse)
async def api_results_analytics(
    test_id: str | None = Query(default=None),
    target_school_id_override: str | None = Query(default=None, alias="target_school_id"),
    global_view: bool = Query(default=False),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_results_analytics_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_reports_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    permission_key = "online_tests.reports"
    if _is_parent_portal_user(user):
        permission_key = "edupay.parent_portal"
    elif _is_student_user(user):
        permission_key = "online_tests.attempt"
    reservation = prepare_route_retrofit(
        flag_name="analytics",
        user=user,
        actor=actor,
        permission_key=permission_key,
        school_id=school_id,
        credit_feature="ai_analytics",
        credit_amount=4,
        reason="online_tests.results_analytics",
    )
    target_school_id = school_id
    global_scope = False
    if is_platform_admin_user(user) and target_school_id_override:
        target_school_id = target_school_id_override
    if is_platform_admin_user(user) and global_view:
        target_school_id = None
        global_scope = True
    if global_scope:
        result = get_results_analytics(target_school_id, test_id=test_id, global_scope=True)
        commit_route_retrofit(reservation)
        return result
    if _is_school_admin_user(user):
        result = get_results_analytics(target_school_id, test_id=test_id, global_scope=False)
        commit_route_retrofit(reservation)
        return result
    if _is_student_user(user):
        profile_id = _normalize_scope_value(actor.get("profile_id"))
        if not profile_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student profile context is missing")
        student = _get_student_by_profile_id(school_id, profile_id)
        student_id = _normalize_scope_value(student.get("id"))
        if test_id:
            get_test_for_student(school_id, test_id, profile_id)
        test_rows = [get_test_for_student(school_id, test_id, profile_id)] if test_id else []
        attempt_rows = list_attempts(school_id, student_id=student_id, test_id=test_id, skip=0, limit=500)
        result_rows = list_results(school_id, test_id=test_id, student_id=student_id, skip=0, limit=500)
        if not test_rows:
            visible_test_ids = sorted(
                {
                    _normalize_scope_value(item.get("test_id"))
                    for item in [*attempt_rows, *result_rows]
                    if _normalize_scope_value(item.get("test_id"))
                }
            )
            test_rows = [get_test_for_student(school_id, visible_test_id, profile_id) for visible_test_id in visible_test_ids]
        result = _build_results_analytics_payload(
            school_id,
            test_rows=test_rows,
            attempt_rows=attempt_rows,
            result_rows=result_rows,
            test_id=test_id,
            scope_label="student",
            visible_student_ids=[student_id],
        )
        commit_route_retrofit(reservation)
        return result
    if _is_parent_portal_user(user):
        linked_students = _list_parent_linked_students(
            school_id,
            _normalize_scope_value(actor.get("profile_id")) or None,
            getattr(user, "email", None),
        )
        visible_student_ids = sorted({_normalize_scope_value(item.get("id")) for item in linked_students if _normalize_scope_value(item.get("id"))})
        attempt_rows: list[dict] = []
        result_rows: list[dict] = []
        for student_id in visible_student_ids:
            attempt_rows.extend(list_attempts(school_id, student_id=student_id, test_id=test_id, skip=0, limit=500))
            result_rows.extend(list_results(school_id, test_id=test_id, student_id=student_id, skip=0, limit=500))
        test_rows = []
        if test_id:
            test_rows = [get_test(school_id, test_id)]
        else:
            visible_test_ids = sorted(
                {
                    _normalize_scope_value(item.get("test_id"))
                    for item in [*attempt_rows, *result_rows]
                    if _normalize_scope_value(item.get("test_id"))
                }
            )
            test_rows = [get_test(school_id, visible_test_id) for visible_test_id in visible_test_ids]
        result = _build_results_analytics_payload(
            school_id,
            test_rows=test_rows,
            attempt_rows=attempt_rows,
            result_rows=result_rows,
            test_id=test_id,
            scope_label="parent",
            visible_student_ids=visible_student_ids,
        )
        commit_route_retrofit(reservation)
        return result
    if test_id and not global_scope and target_school_id:
        _enforce_test_scope(_get_test_row(target_school_id, test_id), scope_context, "You can only view analytics for online tests in your assigned scope")
        result = get_results_analytics(target_school_id, test_id=test_id, global_scope=False)
        commit_route_retrofit(reservation)
        return result
    scoped_tests = [
        test
        for test in list_tests(target_school_id, include_inactive=True, skip=0, limit=500)
        if _test_in_scope(_get_test_row(target_school_id, _normalize_scope_value(test.get("id"))), scope_context)
    ]
    scoped_test_ids = sorted({_normalize_scope_value(test.get("id")) for test in scoped_tests if _normalize_scope_value(test.get("id"))})
    attempt_rows: list[dict] = []
    result_rows: list[dict] = []
    for scoped_test_id in scoped_test_ids:
        attempt_rows.extend(list_attempts(target_school_id, test_id=scoped_test_id, skip=0, limit=500))
        result_rows.extend(list_results(target_school_id, test_id=scoped_test_id, skip=0, limit=500))
    result = _build_results_analytics_payload(
        target_school_id,
        test_rows=scoped_tests,
        attempt_rows=attempt_rows,
        result_rows=result_rows,
        test_id=None,
        scope_label="assigned",
    )
    commit_route_retrofit(reservation)
    return result


@router.get("/results/{result_id}", response_model=OnlineTestResultResponse)
async def api_get_result(
    result_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    result = get_result(school_id, result_id)
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        student = _get_student_by_profile_id(school_id, profile_id)
        if str(result.get("student_id") or "").strip() != str(student.get("id") or "").strip():
            raise HTTPException(status_code=403, detail="Students can view only their own results")
    else:
        result_row = _get_result_row(school_id, result_id)
        _enforce_test_scope(_get_test_row(school_id, _normalize_scope_value(result_row.get("test_id"))), scope_context, "You can only view results for online tests in your assigned scope")
    return result


@router.get("/results", response_model=list[OnlineTestResultResponse], include_in_schema=False)
async def api_list_results(
    test_id: str | None = Query(default=None),
    student_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    tenant: TenantContext = Depends(get_tenant_context),
    user: User = Depends(require_view_user),
    scope_context: PermissionScopeContext = Depends(require_online_tests_view_scope),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        resolved_student_id = str(_get_student_by_profile_id(school_id, profile_id).get("id") or "").strip()
        return list_results(school_id, test_id=test_id, student_id=resolved_student_id, skip=skip, limit=limit)
    results = list_results(school_id, test_id=test_id, student_id=student_id, skip=skip, limit=limit)
    if scope_context.is_school_wide:
        return results
    filtered: list[dict] = []
    for result in results:
        result_row = _get_result_row(school_id, _normalize_scope_value(result.get("id")))
        test_row = _get_test_row(school_id, _normalize_scope_value(result_row.get("test_id")))
        if _test_in_scope(test_row, scope_context):
            filtered.append(result)
    return filtered
