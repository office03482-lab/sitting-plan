"""Exam management routes (Supabase-native)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.services.supabase_exams import (
    create_exam as create_exam_supabase,
    delete_all_exams as delete_all_exams_supabase,
    delete_exam as delete_exam_supabase,
    get_exam as get_exam_supabase,
    list_exams as list_exams_supabase,
    update_exam as update_exam_supabase,
)

router = APIRouter()


@router.post("")
async def create_exam(
    exam_data: dict,
    tenant: TenantContext = Depends(get_tenant_context),
):
    return create_exam_supabase(tenant.school_id, exam_data)


@router.get("")
async def list_exams(
    tenant: TenantContext = Depends(get_tenant_context),
):
    return list_exams_supabase(tenant.school_id)


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    return get_exam_supabase(tenant.school_id, exam_id)


@router.put("/{exam_id}")
async def update_exam(
    exam_id: str,
    exam_data: dict,
    tenant: TenantContext = Depends(get_tenant_context),
):
    return update_exam_supabase(tenant.school_id, exam_id, exam_data)


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    return delete_exam_supabase(tenant.school_id, exam_id)


@router.delete("", summary="Delete all exams")
async def delete_all_exams(
    tenant: TenantContext = Depends(get_tenant_context),
    is_admin: bool = False,
):
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can delete all exams")
    return delete_all_exams_supabase(tenant.school_id)
