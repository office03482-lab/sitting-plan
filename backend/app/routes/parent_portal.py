"""Parent Portal routes — simplified parent-friendly endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, require_permissions
from app.models import User
from app.services.scope_engine import PermissionScopeContext, build_scope_context
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_admin import get_supabase_admin_client
import app.services.parent_portal_service as parent_portal_service
import app.services.supabase_parent_intelligence as parent_intelligence_service
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_parent_intelligence import acknowledge_parent_alert, contact_teacher, request_parent_meeting

router = APIRouter(prefix="/api/parent", tags=["Parent Portal"])


class AiAskRequest(BaseModel):
    question: str
    student_id: str | None = None
    history: list[dict[str, str]] | None = None


class ParentCommunicationRequest(BaseModel):
    student_id: str
    message: str | None = None
    preferred_date: str | None = None
    note: str | None = None


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def _is_parent_user(user: User) -> bool:
    permissions = [str(item or "").strip().lower() for item in (getattr(user, "permissions", None) or [])]
    return _role_key(user) == "parent" or "edupay.parent_portal" in permissions


def _is_school_admin_user(user: User) -> bool:
    return _role_key(user) == "school_admin" or getattr(user, "role", None) == "admin"


def require_parent_view_user(
    _: User = Depends(require_permissions("parent_intelligence.view", "parent_intelligence.reports", "edupay.parent_portal")),
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the parent portal")


def require_parent_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="edupay.parent_portal",
        include_students=True,
    )


def _normalize_scope_value(value: object) -> str:
    return str(value or "").strip()


def _load_visible_students(
    school_id: str,
    context: PermissionScopeContext,
    actor: dict,
    user: User,
    *,
    student_id: str | None = None,
) -> list[dict]:
    if context.is_school_wide and (_is_school_admin_user(user) or is_platform_admin_user(user)):
        query = (
            get_supabase_admin_client()
            .table("students")
            .select("id,school_id,profile_id,batch_id,full_name,class_name,section,guardian_name,guardian_phone,roll_number,metadata")
            .eq("school_id", school_id)
            .eq("is_active", True)
        )
        if student_id:
            query = query.eq("id", student_id)
        return [dict(row) for row in list(query.limit(500).execute().data or [])]
    linked = parent_portal_service._resolve_parent_students(  # type: ignore[attr-defined]
        school_id,
        str(actor.get("profile_id") or "").strip() or None,
        getattr(user, "email", None),
    )
    if student_id:
        linked = [item for item in linked if _normalize_scope_value(item.get("id")) == _normalize_scope_value(student_id)]
    return linked


def _build_parent_ai_response(
    school_id: str,
    visible_students: list[dict[str, Any]],
    *,
    question: str,
    history: list[dict[str, str]] | None,
) -> dict[str, Any]:
    if not visible_students:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No linked students found for this request")

    context_parts: list[str] = []
    for student in visible_students:
        sid = _normalize_scope_value(student.get("id"))
        sname = _normalize_scope_value(student.get("full_name")) or "Student"
        dash = parent_portal_service._build_child_dashboard(school_id, student)  # type: ignore[attr-defined]
        attendance = parent_portal_service._build_attendance(school_id, student)  # type: ignore[attr-defined]
        assignments = parent_portal_service._build_assignments(school_id, student)  # type: ignore[attr-defined]
        tests = parent_portal_service._build_test_results(school_id, student)  # type: ignore[attr-defined]
        academic = parent_portal_service._build_academic_progress(school_id, student)  # type: ignore[attr-defined]
        attendance_overall = attendance.get("overall", {})
        assignment_summary = assignments.get("summary", {})
        weak_topics = list(academic.get("weak_topics") or [])[:3]
        strong_topics = list(academic.get("strong_topics") or [])[:3]

        context_parts.append(
            f"--- {sname} (ID: {sid}) ---\n"
            f"Class: {dash.get('class_name')} {dash.get('section')}\n"
            f"Attendance: {attendance_overall.get('attendance_percentage', dash.get('attendance_percentage'))}% "
            f"({attendance_overall.get('present_days', dash.get('present_days'))} present, "
            f"{attendance_overall.get('absent_days', dash.get('absent_days'))} absent)\n"
            f"Learning Score: {dash.get('learning_score')}%\n"
            f"Pending Assignments: {dash.get('pending_assignments')}\n"
            f"Fee Status: {dash.get('fee_status', {}).get('status')} (Due: Rs {dash.get('fee_status', {}).get('due_amount', 0):.0f})\n"
            f"Latest Test: {dash.get('latest_test_result', {}).get('title', 'N/A')} - {dash.get('latest_test_result', {}).get('percentage', 0)}%\n"
            f"Upcoming Tests: {len(dash.get('upcoming_tests', []))}\n"
            f"Assignment Summary: pending={assignment_summary.get('pending', 0)}, submitted={assignment_summary.get('submitted', 0)}, graded={assignment_summary.get('graded', 0)}, late={assignment_summary.get('late', 0)}\n"
            f"Test Average: {tests.get('average_percentage')}% over {tests.get('total_tests')} tests\n"
            f"Weak Topics: {weak_topics}\n"
            f"Strong Topics: {strong_topics}"
        )

    student_context = "\n\n".join(context_parts)
    system_prompt = (
        "You are the Aspire Academy Parent AI Assistant. "
        "Answer only from the grounded student data provided below. "
        "Use attendance, assignments, test scores, course progress, and topic analysis whenever relevant. "
        "Do not invent facts or use any data outside this prompt. "
        "If something is missing, say that clearly. "
        "Use simple, supportive language and keep the answer concise in 3-6 sentences.\n\n"
        f"STUDENT DATA:\n{student_context}"
    )
    messages: list[dict[str, str]] = [{"role": "assistant", "content": system_prompt}]
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": question})

    try:
        answer = parent_portal_service.chat(messages)  # type: ignore[attr-defined]
    except parent_portal_service.AIProviderError:  # type: ignore[attr-defined]
        answer = "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."

    return {
        "answer": answer,
        "context_students": [
            {
                "student_id": _normalize_scope_value(student.get("id")),
                "student_name": _normalize_scope_value(student.get("full_name")) or "Student",
            }
            for student in visible_students
        ],
    }


# ─── Multi-Child Support (Phase 7) ─────────────────────────────────────

@router.get("/children")
async def api_list_children(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    return [
        {
            "student_id": _normalize_scope_value(student.get("id")),
            "student_name": _normalize_scope_value(student.get("full_name")) or "Student",
            "class_name": _normalize_scope_value(student.get("class_name")),
            "section": _normalize_scope_value(student.get("section")),
            "roll_number": _normalize_scope_value(student.get("roll_number")),
        }
        for student in visible_students
    ]


# ─── Dashboard (Phase 1) ───────────────────────────────────────────────

@router.get("/dashboard")
async def api_get_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    return {
        "children": [parent_portal_service._build_child_dashboard(school_id, student) for student in visible_students],  # type: ignore[attr-defined]
        "children_count": len(visible_students),
    }


# ─── Academic Progress (Phase 2) ───────────────────────────────────────

@router.get("/academic-progress")
async def api_get_academic_progress(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return {"children": [parent_portal_service._build_academic_progress(school_id, student) for student in visible_students]}  # type: ignore[attr-defined]


# ─── Attendance Center (Phase 3) ───────────────────────────────────────

@router.get("/attendance")
async def api_get_attendance(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return {"children": [parent_portal_service._build_attendance(school_id, student) for student in visible_students]}  # type: ignore[attr-defined]


# ─── Online Test Results (Phase 4) ─────────────────────────────────────

@router.get("/test-results")
async def api_get_test_results(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return {"children": [parent_portal_service._build_test_results(school_id, student) for student in visible_students]}  # type: ignore[attr-defined]


# ─── Assignments (Phase 5) ─────────────────────────────────────────────

@router.get("/assignments")
async def api_get_assignments(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return {"children": [parent_portal_service._build_assignments(school_id, student) for student in visible_students]}  # type: ignore[attr-defined]


# ─── Alerts (Phase 6) ──────────────────────────────────────────────────

@router.get("/alerts")
async def api_get_alerts(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return {"children": [parent_portal_service._build_alerts(school_id, student) for student in visible_students]}  # type: ignore[attr-defined]


# ─── AI Assistant (Phase 8) ────────────────────────────────────────────

@router.post("/ai/ask")
async def api_ai_ask(
    payload: AiAskRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=payload.student_id)
    return _build_parent_ai_response(
        school_id,
        visible_students,
        question=payload.question,
        history=payload.history,
    )


@router.get("/ai/recommendations")
async def api_get_recommendations(
    student_id: str | None = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return [parent_portal_service._build_recommendations(school_id, student) for student in visible_students]  # type: ignore[attr-defined]


# ─── Legacy Intelligence Endpoints (keep for backward compat) ──────────

@router.get("/insights")
async def api_get_parent_insights(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    return {
        "role": "parent" if _is_parent_user(user) else "admin",
        "children": [parent_intelligence_service._student_parent_payload(school_id, student, parent_profile_id=str(actor.get("profile_id") or "").strip() or None) for student in visible_students],  # type: ignore[attr-defined]
    }


@router.get("/risk-score")
async def api_get_parent_risk_scores(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    return {
        "role": "parent" if _is_parent_user(user) else "admin",
        "children": [parent_intelligence_service._student_parent_payload(school_id, student, parent_profile_id=str(actor.get("profile_id") or "").strip() or None) for student in visible_students],  # type: ignore[attr-defined]
    }


@router.post("/alerts/{alert_id}/acknowledge")
async def api_acknowledge_parent_alert(
    alert_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    rows = list(
        get_supabase_admin_client()
        .table("analytics_parent_alerts")
        .select("id,student_id,parent_profile_id")
        .eq("school_id", school_id)
        .eq("id", alert_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent alert not found")
    alert_row = dict(rows[0])
    if _is_parent_user(user):
        visible_students = _load_visible_students(
            school_id,
            scope_context,
            actor,
            user,
            student_id=_normalize_scope_value(alert_row.get("student_id")) or None,
        )
        if not visible_students:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can acknowledge alerts only for linked children")
        actor_profile_id = _normalize_scope_value(actor.get("profile_id"))
        alert_parent_profile_id = _normalize_scope_value(alert_row.get("parent_profile_id"))
        if alert_parent_profile_id and actor_profile_id and alert_parent_profile_id != actor_profile_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can acknowledge only your own linked-child alerts")
    return acknowledge_parent_alert(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        user_email=None,
        alert_id=alert_id,
    )


@router.post("/communication/contact-teacher")
async def api_contact_teacher(
    payload: ParentCommunicationRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    _load_visible_students(school_id, scope_context, actor, user, student_id=payload.student_id)
    return contact_teacher(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/communication/request-meeting")
async def api_request_parent_meeting(
    payload: ParentCommunicationRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    _load_visible_students(school_id, scope_context, actor, user, student_id=payload.student_id)
    return request_parent_meeting(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )
