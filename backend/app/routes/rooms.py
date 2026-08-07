"""Room configuration routes (Supabase-native)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends

from app.middleware.auth import get_authenticated_actor_context
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.schemas import RoomCreate, RoomResponse, RoomUpdate
from app.services.supabase_rooms import (
    create_room as create_room_supabase,
    delete_all_rooms as delete_all_rooms_supabase,
    delete_room as delete_room_supabase,
    get_room as get_room_supabase,
    get_rooms_summary as get_rooms_summary_supabase,
    list_rooms as list_rooms_supabase,
    update_room as update_room_supabase,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=RoomResponse)
async def create_room(
    room_data: RoomCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    result = create_room_supabase(school_id, room_data.model_dump())
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}")
    return RoomResponse(**result)


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    skip: int = 0,
    limit: int = 100,
):
    school_id = tenant.school_id
    rows = list_rooms_supabase(school_id, skip=skip, limit=limit)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(rows)}")
    return [RoomResponse(**row) for row in rows]


@router.get("/summary")
async def get_rooms_summary(
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return get_rooms_summary_supabase(school_id)


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    row = get_room_supabase(school_id, room_id)
    return RoomResponse(**row)


@router.put("/{room_id}", response_model=RoomResponse)
async def update_room(
    room_id: str,
    update_data: RoomUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    result = update_room_supabase(school_id, room_id, update_data.model_dump(exclude_unset=True))
    return RoomResponse(**result)


@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return delete_room_supabase(school_id, room_id)


@router.delete("")
async def delete_all_rooms(
    tenant: TenantContext = Depends(get_tenant_context),
    is_admin: bool = False,
):
    school_id = tenant.school_id
    return delete_all_rooms_supabase(school_id, is_admin=is_admin)
