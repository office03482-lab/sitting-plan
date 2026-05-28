"""
Invigilator Management Routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import List, Optional
from app.database import get_db
from app.services.supabase_context import build_legacy_sqlite_route_blocker, resolve_school_id_from_actor
from app.models import Invigilator, RoomInvigilator, Room
from app.schemas import (
    InvigilatorResponse, InvigilatorCreate, InvigilatorUpdate,
    RoomInvigilatorResponse, RoomInvigilatorCreate, RoomInvigilatorUpdate,
    InvigilatorWithRoomsResponse
)

router = APIRouter(
    prefix="/api/invigilators",
    tags=["invigilators"],
    dependencies=[
        Depends(
            build_legacy_sqlite_route_blocker(
                "Invigilator management",
                reason="This module still depends on legacy SQLite invigilator and room assignment tables.",
            )
        )
    ],
)


# ==================== Invigilator CRUD ====================

@router.post("", response_model=InvigilatorResponse)
def create_invigilator(
    invigilator: InvigilatorCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db)
):
    """
    Create a new invigilator
    """
    # Check if staff_id already exists
    existing = db.query(Invigilator).filter(
        Invigilator.staff_id == invigilator.staff_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Invigilator with staff ID '{invigilator.staff_id}' already exists"
        )
    
    try:
        new_invigilator = Invigilator(
            staff_id=invigilator.staff_id.strip(),
            name=invigilator.name.strip(),
            school_id=school_id,
            email=invigilator.email,
            phone=invigilator.phone,
            department=invigilator.department.strip() if invigilator.department else None,
            designation=invigilator.designation,
            is_active=True
        )
        db.add(new_invigilator)
        db.commit()
        db.refresh(new_invigilator)
        return new_invigilator
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Failed to create invigilator - duplicate staff ID or invalid data"
        )


@router.get("", response_model=List[InvigilatorResponse])
def list_invigilators(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_active: Optional[bool] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    List all invigilators for a school
    """
    query = db.query(Invigilator).filter(Invigilator.school_id == school_id)
    
    if is_active is not None:
        query = query.filter(Invigilator.is_active == is_active)
    
    invigilators = query.offset(skip).limit(limit).all()
    return invigilators


@router.get("/room-assignments", response_model=List[RoomInvigilatorResponse])
def list_room_assignments_v2(
    school_id: str = Depends(resolve_school_id_from_actor),
    room_id: Optional[int] = Query(None),
    invigilator_id: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(True),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    List room-invigilator assignments with filters using a static-safe path.
    This route must stay above `/{invigilator_id}` to avoid 422 path capture.
    """
    query = db.query(RoomInvigilator).options(
        joinedload(RoomInvigilator.invigilator),
        joinedload(RoomInvigilator.room),
    ).filter(RoomInvigilator.school_id == school_id)
    
    if room_id:
        query = query.filter(RoomInvigilator.room_id == room_id)
    if invigilator_id:
        query = query.filter(RoomInvigilator.invigilator_id == invigilator_id)
    if is_active is not None:
        query = query.filter(RoomInvigilator.is_active == is_active)
    
    assignments = query.offset(skip).limit(limit).all()
    return assignments


@router.get("/assignments", response_model=List[RoomInvigilatorResponse])
def list_room_assignments(
    school_id: str = Depends(resolve_school_id_from_actor),
    room_id: Optional[int] = Query(None),
    invigilator_id: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(True),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    Backward-compatible assignment listing route.
    This route also stays above `/{invigilator_id}`.
    """
    query = db.query(RoomInvigilator).options(
        joinedload(RoomInvigilator.invigilator),
        joinedload(RoomInvigilator.room),
    ).filter(RoomInvigilator.school_id == school_id)
    
    if room_id:
        query = query.filter(RoomInvigilator.room_id == room_id)
    if invigilator_id:
        query = query.filter(RoomInvigilator.invigilator_id == invigilator_id)
    if is_active is not None:
        query = query.filter(RoomInvigilator.is_active == is_active)
    
    assignments = query.offset(skip).limit(limit).all()
    return assignments


@router.get("/{invigilator_id}", response_model=InvigilatorWithRoomsResponse)
def get_invigilator(
    invigilator_id: int,
    db: Session = Depends(get_db)
):
    """
    Get invigilator by ID with room assignments
    """
    invigilator = db.query(Invigilator).filter(Invigilator.id == invigilator_id).first()
    
    if not invigilator:
        raise HTTPException(status_code=404, detail="Invigilator not found")
    
    return invigilator


@router.put("/{invigilator_id}", response_model=InvigilatorResponse)
def update_invigilator(
    invigilator_id: int,
    update_data: InvigilatorUpdate,
    db: Session = Depends(get_db)
):
    """
    Update invigilator information
    """
    invigilator = db.query(Invigilator).filter(Invigilator.id == invigilator_id).first()
    
    if not invigilator:
        raise HTTPException(status_code=404, detail="Invigilator not found")

    if update_data.staff_id is not None:
        next_staff_id = update_data.staff_id.strip()
        if not next_staff_id:
            raise HTTPException(status_code=400, detail="Staff ID cannot be empty")

        existing = (
            db.query(Invigilator)
            .filter(Invigilator.staff_id == next_staff_id, Invigilator.id != invigilator_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail=f"Invigilator with staff ID '{next_staff_id}' already exists")

        invigilator.staff_id = next_staff_id
    
    # Update fields
    if update_data.name is not None:
        invigilator.name = update_data.name.strip()
    if update_data.email is not None:
        invigilator.email = update_data.email
    if update_data.phone is not None:
        invigilator.phone = update_data.phone
    if update_data.department is not None:
        invigilator.department = update_data.department.strip() or None
    if update_data.designation is not None:
        invigilator.designation = update_data.designation
    if update_data.is_active is not None:
        invigilator.is_active = update_data.is_active
    
    invigilator.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(invigilator)
    
    return invigilator


@router.delete("/{invigilator_id}")
def delete_invigilator(
    invigilator_id: int,
    db: Session = Depends(get_db)
):
    """
    Delete an invigilator (also removes all room assignments)
    """
    invigilator = db.query(Invigilator).filter(Invigilator.id == invigilator_id).first()
    
    if not invigilator:
        raise HTTPException(status_code=404, detail="Invigilator not found")
    
    db.delete(invigilator)
    db.commit()
    
    return {"message": "Invigilator deleted successfully"}


# ==================== Room Assignment CRUD ====================

@router.post("/room-assignment", response_model=RoomInvigilatorResponse)
def assign_invigilator_to_room(
    assignment: RoomInvigilatorCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db)
):
    """
    Assign an invigilator to a room
    """
    # Verify room exists
    room = db.query(Room).filter(
        Room.id == assignment.room_id,
        Room.school_id == school_id
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Verify invigilator exists
    invigilator = db.query(Invigilator).filter(
        Invigilator.id == assignment.invigilator_id,
        Invigilator.school_id == school_id
    ).first()
    if not invigilator:
        raise HTTPException(status_code=404, detail="Invigilator not found")
    
    # If a room already has an active assignment, reuse it instead of throwing 400.
    existing_room_assignment = db.query(RoomInvigilator).filter(
        RoomInvigilator.room_id == assignment.room_id,
        RoomInvigilator.school_id == school_id,
        RoomInvigilator.is_active == True
    ).first()
    
    if existing_room_assignment:
        existing_room_assignment.invigilator_id = assignment.invigilator_id
        existing_room_assignment.exam_id = assignment.exam_id
        existing_room_assignment.notes = assignment.notes
        existing_room_assignment.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing_room_assignment)
        return existing_room_assignment
    
    # Create assignment
    new_assignment = RoomInvigilator(
        room_id=assignment.room_id,
        invigilator_id=assignment.invigilator_id,
        school_id=school_id,
        exam_id=assignment.exam_id,
        notes=assignment.notes,
        is_active=True
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)
    
    return new_assignment


@router.get("/room/{room_id}/invigilators", response_model=List[InvigilatorResponse])
def get_room_invigilators(
    room_id: int,
    db: Session = Depends(get_db)
):
    """
    Get all invigilators assigned to a room
    """
    assignments = db.query(RoomInvigilator).options(
        joinedload(RoomInvigilator.invigilator),
        joinedload(RoomInvigilator.room),
    ).filter(
        RoomInvigilator.room_id == room_id,
        RoomInvigilator.is_active == True
    ).all()
    
    invigilators = [assignment.invigilator for assignment in assignments]
    return invigilators


@router.put("/assignments/{assignment_id}", response_model=RoomInvigilatorResponse)
def update_room_assignment(
    assignment_id: int,
    update_data: RoomInvigilatorUpdate,
    db: Session = Depends(get_db)
):
    """
    Update or swap invigilator in a room
    """
    assignment = db.query(RoomInvigilator).options(
        joinedload(RoomInvigilator.invigilator),
        joinedload(RoomInvigilator.room),
    ).filter(
        RoomInvigilator.id == assignment_id
    ).first()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    # If changing invigilator, verify new invigilator exists
    if update_data.invigilator_id is not None:
        new_invigilator = db.query(Invigilator).filter(
            Invigilator.id == update_data.invigilator_id
        ).first()
        if not new_invigilator:
            raise HTTPException(status_code=404, detail="New invigilator not found")
        
        # Check if new invigilator is already assigned to this room
        existing = db.query(RoomInvigilator).filter(
            RoomInvigilator.room_id == assignment.room_id,
            RoomInvigilator.invigilator_id == update_data.invigilator_id,
            RoomInvigilator.id != assignment_id,
            RoomInvigilator.is_active == True
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=400,
                detail="New invigilator is already assigned to this room"
            )
        
        assignment.invigilator_id = update_data.invigilator_id
    
    # Update other fields
    if update_data.exam_id is not None:
        assignment.exam_id = update_data.exam_id
    if update_data.notes is not None:
        assignment.notes = update_data.notes
    if update_data.is_active is not None:
        assignment.is_active = update_data.is_active
    
    assignment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assignment)
    
    return assignment


@router.delete("/assignments")
def delete_all_room_assignments(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db)
):
    """
    Remove all active invigilator assignments for a school (soft delete).
    """
    assignments = db.query(RoomInvigilator).filter(
        RoomInvigilator.school_id == school_id,
        RoomInvigilator.is_active == True
    ).all()

    if not assignments:
        return {"message": "No active invigilator assignments found", "deleted_count": 0}

    for assignment in assignments:
        assignment.is_active = False
        assignment.updated_at = datetime.utcnow()

    db.commit()

    return {
        "message": "All invigilator assignments removed successfully",
        "deleted_count": len(assignments),
    }


@router.delete("/assignments/{assignment_id}")
def delete_room_assignment(
    assignment_id: int,
    db: Session = Depends(get_db)
):
    """
    Remove invigilator assignment from a room (soft delete - marks as inactive)
    """
    assignment = db.query(RoomInvigilator).filter(
        RoomInvigilator.id == assignment_id
    ).first()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    # Soft delete: mark as inactive instead of hard delete
    assignment.is_active = False
    assignment.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Invigilator assignment removed from room"}
