"""
Teacher management routes (Supabase-native)
"""
import logging
from fastapi import APIRouter, Depends
from app.services.supabase_context import resolve_school_id_from_actor
from typing import List
from app.middleware.auth import get_authenticated_actor_context
from app.schemas import TeacherCreate, TeacherResponse, TeacherUpdate
from app.services import supabase_teachers

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=TeacherResponse)
async def create_teacher(
    teacher: TeacherCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    row = supabase_teachers.create_teacher(school_id, teacher.model_dump())
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return TeacherResponse(**row)


@router.get("", response_model=List[TeacherResponse])
async def list_teachers(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    skip: int = 0,
    limit: int = 100,
):
    rows = supabase_teachers.list_teachers(school_id, skip=skip, limit=limit)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(rows)}")
    return [TeacherResponse(**row) for row in rows]


@router.get("/count")
async def get_teachers_count(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return supabase_teachers.count_teachers(school_id)


@router.get("/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(
    teacher_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    row = supabase_teachers.get_teacher(school_id, teacher_id)
    return TeacherResponse(**row)


@router.put("/{teacher_id}", response_model=TeacherResponse)
async def update_teacher(
    teacher_id: str,
    teacher_update: TeacherUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    row = supabase_teachers.update_teacher(school_id, teacher_id, teacher_update.model_dump(exclude_unset=True))
    return TeacherResponse(**row)


@router.delete("/{teacher_id}")
async def delete_teacher(
    teacher_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return supabase_teachers.delete_teacher(school_id, teacher_id)
