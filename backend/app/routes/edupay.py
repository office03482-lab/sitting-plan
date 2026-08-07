"""
EduPay fee management routes
"""
import asyncio
import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.middleware.auth import get_authenticated_actor_context
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.schemas import (
    EduPayDashboardResponse,
    EduPayFeeAssignmentResponse,
    EduPayFeeStructureCreate,
    EduPayFeeStructureResponse,
    EduPayParentPortalResponse,
    EduPayPaymentCreate,
    EduPayPaymentResponse,
    EduPayStudentCreate,
    EduPayStudentResponse,
)
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import (
    ensure_supabase_school_exists,
)
from app.services.supabase_edupay import (
    create_fee_structure as create_supabase_edupay_fee_structure,
    create_payment as create_supabase_edupay_payment,
    create_student as create_supabase_edupay_student,
    get_dashboard as get_supabase_edupay_dashboard,
    get_parent_portal as get_supabase_edupay_parent_portal,
    list_assignments as list_supabase_edupay_assignments,
    list_fee_structures as list_supabase_edupay_fee_structures,
    list_payments as list_supabase_edupay_payments,
    list_students as list_supabase_edupay_students,
)
from app.utils.dashboard_tracing import begin_dashboard_request, finish_dashboard_request

router = APIRouter(prefix="/api/edupay", tags=["EduPay"])
logger = logging.getLogger(__name__)

WRITE_ROLES = {"admin", "store_manager", "accountant", "staff"}


def require_write_access(actor: Dict[str, str] = Depends(get_authenticated_actor_context)) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, Accountant, or Staff can modify EduPay records",
        )
    return actor


@router.get("/dashboard", response_model=EduPayDashboardResponse)
async def get_dashboard(
    response: Response,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    trace = begin_dashboard_request("edupay_dashboard", school_id)
    response.headers["X-Dashboard-Request-Id"] = str(trace["request_id"])
    ensure_supabase_school_exists(school_id)
    try:
        payload = await asyncio.to_thread(get_supabase_edupay_dashboard, school_id, trace=trace)
        logger.info(
            "EduPay dashboard loaded - User ID: %s, School ID: %s, Execution mode: supabase_native",
            actor.get("user_id") or actor.get("id"),
            school_id,
        )
        finish_dashboard_request(trace, cache_status="service_logged", execution_path="rpc_or_fallback")
        return EduPayDashboardResponse(**payload)
    except Exception as exc:
        finish_dashboard_request(trace, cache_status="service_logged", execution_path="error", error=str(exc)[:200])
        raise


@router.get("/students", response_model=List[EduPayStudentResponse])
def list_students(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    payload = list_supabase_edupay_students(school_id)
    logger.info(
        "EduPay students listed - User ID: %s, School ID: %s, Row count: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/students", response_model=EduPayStudentResponse)
def create_student(
    payload: EduPayStudentCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    result = create_supabase_edupay_student(school_id, payload.model_dump())
    logger.info(
        "EduPay student created - User ID: %s, School ID: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return result


@router.get("/fee-structures", response_model=List[EduPayFeeStructureResponse])
def list_fee_structures(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    payload = list_supabase_edupay_fee_structures(school_id)
    logger.info(
        "EduPay fee structures listed - User ID: %s, School ID: %s, Row count: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/fee-structures", response_model=EduPayFeeStructureResponse)
def create_fee_structure(
    payload: EduPayFeeStructureCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    result = create_supabase_edupay_fee_structure(school_id, payload.model_dump())
    logger.info(
        "EduPay fee structure created - User ID: %s, School ID: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return result


@router.get("/assignments", response_model=List[EduPayFeeAssignmentResponse])
def list_assignments(
    tenant: TenantContext = Depends(get_tenant_context),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    student_id: Optional[str] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    payload = list_supabase_edupay_assignments(
        school_id,
        status_filter=status_filter,
        student_id=student_id,
    )
    logger.info(
        "EduPay assignments listed - User ID: %s, School ID: %s, Row count: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.get("/payments", response_model=List[EduPayPaymentResponse])
def list_payments(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    payload = list_supabase_edupay_payments(school_id)
    logger.info(
        "EduPay payments listed - User ID: %s, School ID: %s, Row count: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/payments", response_model=EduPayPaymentResponse)
def create_payment(
    payload: EduPayPaymentCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    payment = create_supabase_edupay_payment(
        school_id,
        payload.model_dump(),
        {"user_id": actor.get("user_id") or actor.get("id")},
    )
    logger.info(
        "EduPay payment created - User ID: %s, School ID: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return EduPayPaymentResponse(**payment)


@router.get("/parent-portal", response_model=EduPayParentPortalResponse)
def get_parent_portal(
    tenant: TenantContext = Depends(get_tenant_context),
    parent_id: Optional[str] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    ensure_supabase_school_exists(school_id)
    pid = parent_id
    if not pid:
        first = (
            get_supabase_admin_client()
            .table("students")
            .select("id, guardian_phone")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if not first.data:
            raise HTTPException(status_code=404, detail="No students found")
        pid = str(first.data[0].get("id"))
    result = get_supabase_edupay_parent_portal(school_id, pid)
    logger.info(
        "EduPay parent portal loaded - User ID: %s, School ID: %s, Execution mode: supabase_native",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return result
