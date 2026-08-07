"""Invigilator Management Routes (Supabase-native)."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.services.supabase_invigilators import (
    list_invigilators,
    get_invigilator,
    create_invigilator,
    update_invigilator,
    delete_invigilator,
    get_room_assignments,
    create_room_assignment,
    get_room_invigilators,
    update_room_assignment,
    delete_room_assignment,
    delete_all_room_assignments,
    get_invigilator_with_rooms,
)
from app.schemas import (
    InvigilatorResponse, InvigilatorCreate, InvigilatorUpdate,
    RoomInvigilatorResponse, RoomInvigilatorCreate, RoomInvigilatorUpdate,
    InvigilatorWithRoomsResponse,
)

router = APIRouter(
    prefix="/api/invigilators",
    tags=["invigilators"],
)


# ==================== Invigilator CRUD ====================


@router.post("", response_model=InvigilatorResponse)
def create_invigilator_endpoint(
    invigilator: InvigilatorCreate,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return create_invigilator(school_id, invigilator.model_dump())


@router.get("", response_model=List[InvigilatorResponse])
def list_invigilators_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    is_active: Optional[bool] = Query(None),
    skip: int = 0,
    limit: int = 100,
):
    school_id = tenant.school_id
    return list_invigilators(school_id, is_active=is_active, skip=skip, limit=limit)


@router.get("/room-assignments", response_model=List[RoomInvigilatorResponse])
def list_room_assignments_v2(
    tenant: TenantContext = Depends(get_tenant_context),
    room_id: Optional[str] = Query(None),
    invigilator_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    skip: int = 0,
    limit: int = 100,
):
    school_id = tenant.school_id
    return get_room_assignments(
        school_id,
        room_id=room_id,
        invigilator_id=invigilator_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )


@router.get("/assignments", response_model=List[RoomInvigilatorResponse])
def list_room_assignments(
    tenant: TenantContext = Depends(get_tenant_context),
    room_id: Optional[str] = Query(None),
    invigilator_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    skip: int = 0,
    limit: int = 100,
):
    school_id = tenant.school_id
    return get_room_assignments(
        school_id,
        room_id=room_id,
        invigilator_id=invigilator_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )


@router.get("/{invigilator_id}", response_model=InvigilatorWithRoomsResponse)
def get_invigilator_endpoint(
    invigilator_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return get_invigilator_with_rooms(school_id, invigilator_id)


@router.put("/{invigilator_id}", response_model=InvigilatorResponse)
def update_invigilator_endpoint(
    invigilator_id: str,
    update_data: InvigilatorUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return update_invigilator(school_id, invigilator_id, update_data.model_dump(exclude_unset=True))


@router.delete("/{invigilator_id}")
def delete_invigilator_endpoint(
    invigilator_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return delete_invigilator(school_id, invigilator_id)


# ==================== Room Assignment CRUD ====================


@router.post("/room-assignment", response_model=RoomInvigilatorResponse)
def assign_invigilator_to_room(
    assignment: RoomInvigilatorCreate,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return create_room_assignment(school_id, assignment.model_dump())


@router.get("/room/{room_id}/invigilators", response_model=List[InvigilatorResponse])
def get_room_invigilators_endpoint(
    room_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return get_room_invigilators(school_id, room_id)


@router.put("/assignments/{assignment_id}", response_model=RoomInvigilatorResponse)
def update_room_assignment_endpoint(
    assignment_id: str,
    update_data: RoomInvigilatorUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return update_room_assignment(school_id, assignment_id, update_data.model_dump(exclude_unset=True))


@router.delete("/assignments")
def delete_all_room_assignments_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return delete_all_room_assignments(school_id)


@router.delete("/assignments/{assignment_id}")
def delete_room_assignment_endpoint(
    assignment_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return delete_room_assignment(school_id, assignment_id)
