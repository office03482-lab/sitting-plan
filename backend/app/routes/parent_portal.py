"""Parent Portal routes — simplified parent-friendly endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.services.scope_engine import PermissionScopeContext, build_scope_context
from app.services.bulk_action_requests import is_platform_admin_user
from app.services.supabase_admin import get_supabase_admin_client
import app.services.parent_portal_service as parent_portal_service
import app.services.parent_portal_ai as parent_portal_ai
import app.services.supabase_parent_intelligence as parent_intelligence_service
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
    if _role_key(user) == "parent":
        return True
    role_metadata = getattr(user, "role_metadata", None)
    if isinstance(role_metadata, dict) and str(role_metadata.get("role_key") or "").strip().lower() == "parent":
        return True
    permissions_raw = str(getattr(user, "permissions", "") or "").lower()
    return "edupay.parent_portal" in [p.strip() for p in permissions_raw.split(",")]


def _is_school_admin_user(user: User) -> bool:
    return _role_key(user) == "school_admin" or getattr(user, "role", None) == "admin"


def require_parent_view_user(
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user) or _is_school_admin_user(user) or is_platform_admin_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the parent portal")


def require_parent_ai_user(
    user: User = Depends(get_authenticated_user),
) -> User:
    if _is_parent_user(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only linked parents can use the parent AI assistant")


def require_parent_scope(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=tenant.school_id,
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
    scope_context: PermissionScopeContext | None = None,
    actor: dict[str, Any] | None = None,
    user: User | None = None,
    student_id: str | None = None,
) -> dict[str, Any]:
    return parent_portal_ai.run_ai_ask(
        school_id,
        question=question,
        history=history,
        scope_context=scope_context,
        actor=actor,
        user=user,
        student_id=student_id,
    )


# ─── Multi-Child Support (Phase 7) ─────────────────────────────────────

@router.get("/children")
def api_list_children(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
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
def api_get_dashboard(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    profile_id = str(actor.get("profile_id") or "").strip() or None
    user_email = str(getattr(user, "email", "") or actor.get("email") or "").strip() or None
    return parent_portal_service.get_dashboard(school_id, profile_id=profile_id, user_email=user_email)


# ─── Academic Progress (Phase 2) ───────────────────────────────────────

@router.get("/academic-progress")
def api_get_academic_progress(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    student_ids = [_normalize_scope_value(s.get("id")) for s in visible_students if _normalize_scope_value(s.get("id"))]
    try:
        assignments = parent_portal_service._batch_load_assignments(school_id)  # type: ignore[attr-defined]
        progress_by_student = parent_portal_service._batch_load_progress(school_id, student_ids)  # type: ignore[attr-defined]
        test_results = parent_portal_service._batch_load_test_results(school_id, student_ids, limit=50)  # type: ignore[attr-defined]
        analytics_by_student = parent_portal_service._get_students_analytics_data(school_id, student_ids)  # type: ignore[attr-defined]
    except Exception:
        assignments = []
        progress_by_student = {}
        test_results = {}
        analytics_by_student = {}
    return {
        "children": [
            parent_portal_service._build_academic_progress_from_batch(  # type: ignore[attr-defined]
                school_id,
                student,
                assignments,
                progress_by_student.get(_normalize_scope_value(student.get("id")), []),
                test_results.get(_normalize_scope_value(student.get("id")), []),
                analytics=analytics_by_student.get(_normalize_scope_value(student.get("id"))),
            )
            for student in visible_students
        ]
    }


# ─── Attendance Center (Phase 3) ───────────────────────────────────────

@router.get("/attendance")
def api_get_attendance(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    student_ids = [_normalize_scope_value(s.get("id")) for s in visible_students if _normalize_scope_value(s.get("id"))]
    try:
        rows_by_student = parent_portal_service._batch_load_attendance(school_id, student_ids, days=365)  # type: ignore[attr-defined]
    except Exception:
        rows_by_student = {}
    return {
        "children": [
            parent_portal_service._build_attendance_from_batch(  # type: ignore[attr-defined]
                student,
                rows_by_student.get(_normalize_scope_value(student.get("id")), []),
            )
            for student in visible_students
        ]
    }


# ─── Online Test Results (Phase 4) ─────────────────────────────────────

@router.get("/test-results")
def api_get_test_results(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    student_ids = [_normalize_scope_value(s.get("id")) for s in visible_students if _normalize_scope_value(s.get("id"))]
    try:
        test_results = parent_portal_service._batch_load_test_results(school_id, student_ids, limit=50)  # type: ignore[attr-defined]
    except Exception:
        test_results = {}
    return {
        "children": [
            parent_portal_service._build_test_results_from_batch(  # type: ignore[attr-defined]
                student,
                test_results.get(_normalize_scope_value(student.get("id")), []),
            )
            for student in visible_students
        ]
    }


# ─── Assignments (Phase 5) ─────────────────────────────────────────────

@router.get("/assignments")
def api_get_assignments(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    try:
        assignments = parent_portal_service._batch_load_assignments(school_id)  # type: ignore[attr-defined]
    except Exception:
        assignments = []
    return {
        "children": [
            parent_portal_service._build_assignments_from_batch(  # type: ignore[attr-defined]
                student,
                assignments,
            )
            for student in visible_students
        ]
    }


# ─── Fees (Parent view) ────────────────────────────────────────────────

@router.get("/fees")
def api_get_fees(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    student_ids = [_normalize_scope_value(s.get("id")) for s in visible_students if _normalize_scope_value(s.get("id"))]
    try:
        fee_by_student = parent_portal_service._batch_load_fees(school_id, student_ids)  # type: ignore[attr-defined]
    except Exception:
        fee_by_student = {}
    children = []
    for student in visible_students:
        sid = _normalize_scope_value(student.get("id"))
        fee_status = fee_by_student.get(sid) or {"total_fee": 0, "paid_amount": 0, "due_amount": 0, "status": "unavailable", "due_date": None, "payment_percentage": 0}
        children.append({
            "student_id": sid,
            "student_name": _normalize_scope_value(student.get("full_name")) or "Student",
            "class_name": _normalize_scope_value(student.get("class_name")),
            "section": _normalize_scope_value(student.get("section")),
            "fee_status": fee_status,
        })
    return {"children": children}


# ─── Alerts (Phase 6) ──────────────────────────────────────────────────

@router.get("/alerts")
def api_get_alerts(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    student_ids = [_normalize_scope_value(s.get("id")) for s in visible_students if _normalize_scope_value(s.get("id"))]
    try:
        attendance_by_student = parent_portal_service._batch_load_attendance(school_id, student_ids, days=90)  # type: ignore[attr-defined]
        test_results = parent_portal_service._batch_load_test_results(school_id, student_ids, limit=10)  # type: ignore[attr-defined]
        assignments = parent_portal_service._batch_load_assignments(school_id)  # type: ignore[attr-defined]
        shared_tests = parent_portal_service._load_shared_tests(school_id)  # type: ignore[attr-defined]
        fee_by_student = parent_portal_service._batch_load_fees(school_id, student_ids)  # type: ignore[attr-defined]
    except Exception:
        attendance_by_student = {}
        test_results = {}
        assignments = []
        shared_tests = []
        fee_by_student = {}
    return {
        "children": [
            parent_portal_service._build_alerts_from_batch(  # type: ignore[attr-defined]
                school_id,
                student,
                attendance_rows=attendance_by_student.get(_normalize_scope_value(student.get("id")), []),
                test_results_list=test_results.get(_normalize_scope_value(student.get("id")), []),
                assignments=assignments,
                shared_tests=shared_tests,
                fee_data=fee_by_student.get(_normalize_scope_value(student.get("id"))),
            )
            for student in visible_students
        ]
    }


# ─── AI Assistant (Phase 8) ────────────────────────────────────────────

@router.post("/ai/ask")
def api_ai_ask(
    payload: AiAskRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_ai_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    if payload.student_id:
        visible_students = _load_visible_students(
            school_id,
            scope_context,
            actor,
            user,
            student_id=payload.student_id,
        )
        if not visible_students:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can ask only about your linked child")
    return _build_parent_ai_response(
        school_id,
        [],
        question=payload.question,
        history=payload.history,
        scope_context=scope_context,
        actor=actor,
        user=user,
        student_id=payload.student_id,
    )


@router.get("/ai/recommendations")
def api_get_recommendations(
    student_id: str | None = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_ai_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user, student_id=student_id)
    return parent_portal_ai.build_recommendations_batch(school_id, visible_students)


# ─── Legacy Intelligence Endpoints (keep for backward compat) ──────────

@router.get("/insights")
def api_get_parent_insights(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    profile_id = str(actor.get("profile_id") or "").strip() or None
    return {
        "role": "parent" if _is_parent_user(user) else "admin",
        "children": parent_intelligence_service._batch_student_parent_payloads(school_id, visible_students, parent_profile_id=profile_id),  # type: ignore[attr-defined]
    }


@router.get("/risk-score")
def api_get_parent_risk_scores(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    visible_students = _load_visible_students(school_id, scope_context, actor, user)
    profile_id = str(actor.get("profile_id") or "").strip() or None
    return {
        "role": "parent" if _is_parent_user(user) else "admin",
        "children": parent_intelligence_service._batch_student_parent_payloads(school_id, visible_students, parent_profile_id=profile_id),  # type: ignore[attr-defined]
    }


@router.post("/alerts/{alert_id}/acknowledge")
def api_acknowledge_parent_alert(
    alert_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
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
def api_contact_teacher(
    payload: ParentCommunicationRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    _load_visible_students(school_id, scope_context, actor, user, student_id=payload.student_id)
    return contact_teacher(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/communication/request-meeting")
def api_request_parent_meeting(
    payload: ParentCommunicationRequest,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_parent_view_user),
    scope_context: PermissionScopeContext = Depends(require_parent_scope),
):
    school_id = tenant.school_id
    _load_visible_students(school_id, scope_context, actor, user, student_id=payload.student_id)
    return request_parent_meeting(
        school_id,
        profile_id=str(actor.get("profile_id") or "").strip() or None,
        student_id=payload.student_id,
        payload=payload.model_dump(exclude_none=True),
    )
