"""Hostel management routes using Supabase-native backend."""
from __future__ import annotations
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_hostels import (
    list_hostels as supabase_list_hostels,
    create_hostel as supabase_create_hostel,
    update_hostel as supabase_update_hostel,
    delete_hostel as supabase_delete_hostel,
    add_room as supabase_add_room,
)
from app.schemas import HostelCreate, HostelResponse, HostelUpdate, HostelRoomCreate, HostelRoomResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/hostels", tags=["Hostels"])


@router.get("", response_model=list[HostelResponse])
async def list_hostels(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostels = supabase_list_hostels(school_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: {len(hostels)}"
        )
        return hostels
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load hostels: {exc}") from exc


@router.post("", response_model=HostelResponse)
async def create_hostel(
    payload: HostelCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostel = supabase_create_hostel(school_id, payload.model_dump())
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return hostel
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create hostel: {exc}") from exc


@router.put("/{hostel_id}", response_model=HostelResponse)
async def update_hostel(
    hostel_id: str,
    payload: HostelUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostel = supabase_update_hostel(school_id, hostel_id, payload.model_dump(exclude_unset=True))
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return hostel
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update hostel: {exc}") from exc


@router.delete("/{hostel_id}")
async def delete_hostel(
    hostel_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        result = supabase_delete_hostel(school_id, hostel_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete hostel: {exc}") from exc


@router.post("/{hostel_id}/rooms", response_model=HostelRoomResponse)
async def add_hostel_room(
    hostel_id: str,
    payload: HostelRoomCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        room = supabase_add_room(school_id, hostel_id, payload.model_dump())
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return room
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add room: {exc}") from exc
