"""
Batch Management Routes (Supabase-native)
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from app.services.supabase_batches import (
    create_batch as create_batch_supabase,
    delete_all_batches as delete_all_batches_supabase,
    delete_batch as delete_batch_supabase,
    get_batch as get_batch_supabase,
    get_batch_by_name as get_batch_by_name_supabase,
    list_batches as list_batches_supabase,
    reorder_batches as reorder_batches_supabase,
    update_batch as update_batch_supabase,
)
from app.services.supabase_context import resolve_school_id_from_actor
from app.schemas import BatchCreate, BatchUpdate, BatchResponse, BatchWithStudentCount, BatchReorderRequest
from typing import List

router = APIRouter(
    prefix="/api/batches",
    tags=["batches"],
)


@router.post("", response_model=BatchResponse)
def create_batch(
    batch: BatchCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return create_batch_supabase(school_id, batch.model_dump())


@router.get("", response_model=List[BatchWithStudentCount])
def list_batches(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_active: bool = Query(None),
    category: str | None = Query(default=None),
):
    return list_batches_supabase(school_id, is_active=is_active, category=category)


@router.get("/{batch_id}", response_model=BatchWithStudentCount)
def get_batch(
    batch_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return get_batch_supabase(school_id, batch_id)


@router.put("/{batch_id}", response_model=BatchResponse)
def update_batch(
    batch_id: str,
    batch_update: BatchUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return update_batch_supabase(school_id, batch_id, batch_update.model_dump(exclude_unset=True))


@router.post("/reorder", response_model=List[BatchWithStudentCount])
def reorder_batches(
    payload: BatchReorderRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return reorder_batches_supabase(
        school_id,
        [item.model_dump() for item in payload.items],
    )


@router.delete("/{batch_id}")
def delete_batch(
    batch_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return delete_batch_supabase(school_id, batch_id)


@router.delete("")
def delete_all_batches(
    school_id: str = Depends(resolve_school_id_from_actor),
    category: str | None = Query(default=None),
):
    return delete_all_batches_supabase(school_id, category=category)


@router.get("/by-name/{batch_name}")
def get_batch_by_name(
    batch_name: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return get_batch_by_name_supabase(school_id, batch_name)
