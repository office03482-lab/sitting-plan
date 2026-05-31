"""Exam management routes (Supabase-native)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.services.supabase_context import resolve_school_id_from_actor
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
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return create_exam_supabase(school_id, exam_data)


@router.get("")
async def list_exams(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return list_exams_supabase(school_id)


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return get_exam_supabase(school_id, exam_id)


@router.put("/{exam_id}")
async def update_exam(
    exam_id: str,
    exam_data: dict,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return update_exam_supabase(school_id, exam_id, exam_data)


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return delete_exam_supabase(school_id, exam_id)


@router.delete("", summary="Delete all exams")
async def delete_all_exams(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_admin: bool = False,
):
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can delete all exams")
    return delete_all_exams_supabase(school_id)
