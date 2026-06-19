"""Online Test backend routes using Supabase-native storage."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
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
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_online_tests import (
    AIProviderError,
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

router = APIRouter(prefix="/api/online-tests", tags=["Online Tests"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_teacher_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.TEACHER or _role_key(user) == "teacher"


def _is_student_user(user: User) -> bool:
    return str(getattr(user, "user_type", "") or "").strip().lower() == "student" or _role_key(user) == "student"


def _is_school_admin_user(user: User) -> bool:
    return getattr(user, "role", None) == UserRole.ADMIN and not is_platform_admin_user(user)


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


@router.get("/tests", response_model=list[OnlineTestResponse])
async def api_list_tests(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
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
    return list_tests(
        school_id,
        include_inactive=True,
        skip=skip,
        limit=limit,
    )


@router.post("/tests", response_model=OnlineTestResponse)
async def api_create_test(
    payload: OnlineTestCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return create_test(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.get("/tests/{test_id}", response_model=OnlineTestResponse)
async def api_get_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        return get_test_for_student(school_id, test_id, profile_id)
    return get_test(school_id, test_id)


@router.put("/tests/{test_id}", response_model=OnlineTestResponse)
async def api_update_test(
    test_id: str,
    payload: OnlineTestUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return update_test(school_id, test_id, actor.get("profile_id"), payload.model_dump(exclude_unset=True))


@router.delete("/tests/{test_id}")
async def api_delete_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return delete_test(school_id, test_id, actor.get("profile_id"))


@router.get("/tests/{test_id}/questions", response_model=list[OnlineTestQuestionResponse])
async def api_list_test_questions(
    test_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
    section_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
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
    return list_questions(school_id, test_id=test_id, section_id=section_id, skip=skip, limit=limit)


@router.post("/tests/{test_id}/questions", response_model=OnlineTestQuestionResponse)
async def api_create_test_question(
    test_id: str,
    payload: OnlineTestQuestionCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    data = payload.model_dump(exclude_none=True)
    data["test_id"] = test_id
    return create_question(school_id, data, actor.get("profile_id"))


@router.get("/question-bank", response_model=list[OnlineTestQuestionBankResponse])
async def api_list_question_bank(
    subject: str | None = Query(default=None),
    chapter: str | None = Query(default=None),
    topic: str | None = Query(default=None),
    difficulty_level: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_manage_user),
):
    del user
    return list_question_bank(
        school_id,
        subject=subject,
        chapter=chapter,
        topic=topic,
        difficulty_level=difficulty_level,
        skip=skip,
        limit=limit,
    )


@router.post("/question-bank", response_model=OnlineTestQuestionBankResponse)
async def api_create_question_bank(
    payload: OnlineTestQuestionBankCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return create_question_bank_item(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))


@router.post("/question-bank/import")
async def api_import_question_bank(
    file: UploadFile = File(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported for question bank import")
    file_bytes = await file.read()
    return import_question_bank_workbook(school_id, actor.get("profile_id"), file_bytes)


@router.post("/ai-generate", response_model=OnlineTestAiGenerateResponse)
async def api_generate_ai_test(
    payload: OnlineTestAiGenerateRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    try:
        return generate_ai_test(school_id, actor.get("profile_id"), payload.model_dump(exclude_none=True))
    except AIProviderError:
        return JSONResponse(
            status_code=200,
            content={"success": False, "message": "AI service temporarily unavailable", "questions": []},
        )


@router.put("/questions/{question_id}", response_model=OnlineTestQuestionResponse)
async def api_update_question(
    question_id: str,
    payload: OnlineTestQuestionUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return update_question(school_id, question_id, payload.model_dump(exclude_unset=True), actor.get("profile_id"))


@router.delete("/questions/{question_id}")
async def api_delete_question(
    question_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return delete_question(school_id, question_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/publish", response_model=OnlineTestResponse)
async def api_publish_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return publish_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/close", response_model=OnlineTestResponse)
async def api_close_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return close_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/duplicate", response_model=OnlineTestResponse)
async def api_duplicate_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return duplicate_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/unpublish", response_model=OnlineTestResponse)
async def api_unpublish_test(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_manage_user),
):
    del user
    return unpublish_test(school_id, test_id, actor.get("profile_id"))


@router.post("/tests/{test_id}/start", response_model=OnlineTestAttemptResponse)
async def api_start_attempt(
    test_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
):
    del user
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    return start_attempt(school_id, test_id, profile_id)


@router.post("/attempts", response_model=OnlineTestAttemptResponse)
async def api_create_attempt(
    payload: OnlineTestAttemptCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
):
    del user
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
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        resolved_student_id = str(_get_student_by_profile_id(school_id, profile_id).get("id") or "").strip()
        return list_attempts(school_id, student_id=resolved_student_id, test_id=test_id, skip=skip, limit=limit)
    return list_attempts(school_id, student_id=student_id, test_id=test_id, skip=skip, limit=limit)


@router.get("/attempts/{attempt_id}", response_model=OnlineTestAttemptResponse)
async def api_get_attempt(
    attempt_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    attempt = get_attempt(school_id, attempt_id)
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        student = _get_student_by_profile_id(school_id, profile_id)
        if str(attempt.get("student_id") or "").strip() != str(student.get("id") or "").strip():
            raise HTTPException(status_code=403, detail="Students can view only their own attempts")
    return attempt


@router.post("/attempts/{attempt_id}/save", response_model=OnlineTestAttemptResponse)
async def api_save_attempt(
    attempt_id: str,
    payload: OnlineTestAttemptResponseUpsert,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
):
    del user
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    data = payload.model_dump()
    data["session_key"] = x_active_session
    return save_attempt(school_id, attempt_id, profile_id, data)


@router.post("/attempts/{attempt_id}/submit", response_model=OnlineTestResultResponse)
async def api_submit_attempt(
    attempt_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_attempt_user),
    x_active_session: str | None = Header(default=None, alias="X-Active-Session"),
):
    del user
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=403, detail="Student profile context is missing")
    return submit_attempt(school_id, attempt_id, profile_id, x_active_session)


@router.get("/results/analytics", response_model=OnlineTestAnalyticsResponse)
async def api_results_analytics(
    test_id: str | None = Query(default=None),
    target_school_id_override: str | None = Query(default=None, alias="target_school_id"),
    global_view: bool = Query(default=False),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_reports_user),
):
    target_school_id = school_id
    global_scope = False
    if is_platform_admin_user(user) and target_school_id_override:
        target_school_id = target_school_id_override
    if is_platform_admin_user(user) and global_view:
        target_school_id = None
        global_scope = True
    return get_results_analytics(target_school_id, test_id=test_id, global_scope=global_scope)


@router.get("/results/{result_id}", response_model=OnlineTestResultResponse)
async def api_get_result(
    result_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    result = get_result(school_id, result_id)
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        student = _get_student_by_profile_id(school_id, profile_id)
        if str(result.get("student_id") or "").strip() != str(student.get("id") or "").strip():
            raise HTTPException(status_code=403, detail="Students can view only their own results")
    return result


@router.get("/results", response_model=list[OnlineTestResultResponse], include_in_schema=False)
async def api_list_results(
    test_id: str | None = Query(default=None),
    student_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    school_id: str = Depends(resolve_school_id_from_actor),
    user: User = Depends(require_view_user),
    actor: dict = Depends(get_authenticated_actor_context),
):
    if _is_student_user(user):
        profile_id = str(actor.get("profile_id") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        from app.services.supabase_online_tests import _get_student_by_profile_id

        resolved_student_id = str(_get_student_by_profile_id(school_id, profile_id).get("id") or "").strip()
        return list_results(school_id, test_id=test_id, student_id=resolved_student_id, skip=skip, limit=limit)
    return list_results(school_id, test_id=test_id, student_id=student_id, skip=skip, limit=limit)
