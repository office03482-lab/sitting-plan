"""
Room configuration routes
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.services.supabase_context import build_legacy_sqlite_route_blocker, resolve_school_id_from_actor
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import Room, Desk, Seat, School, User, UserRole
from app.schemas import RoomCreate, RoomResponse, RoomUpdate

logger = logging.getLogger(__name__)

router = APIRouter(
    dependencies=[
        Depends(
            build_legacy_sqlite_route_blocker(
                "Room management",
                reason="This module still depends on legacy SQLite room and school tables.",
            )
        )
    ]
)


def ensure_school_exists(db: Session, school_id: str) -> str:
    """Bootstrap a default school/admin so room creation works on a fresh database."""
    school_row = db.query(School.id).filter(School.id == school_id).first()
    if school_row:
        return school_id

    admin_user = db.query(User).filter(User.id == 1).first()
    if not admin_user:
        admin_user = User(
            email="admin@school.edu",
            full_name="School Admin",
            password_hash="default",
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)

    school = School(
        id=school_id,
        name="Default School",
        admin_id=admin_user.id,
        is_active=True,
    )
    db.add(school)
    db.commit()
    return school_id


def serialize_room(room: Room) -> RoomResponse:
    # Handle door_location enum conversion safely
    if hasattr(room.door_location, 'value'):
        door_loc = room.door_location.value
    else:
        # If it's already a string, use it directly
        door_loc = str(room.door_location)

    return RoomResponse(
        id=room.id,
        name=room.name,
        length_feet=room.length_feet,
        width_feet=room.width_feet,
        desk_length_feet=room.desk_length_feet,
        desk_width_feet=room.desk_width_feet,
        num_benches=room.num_benches,
        capacity=room.capacity,
        teaching_zone_clearance_feet=room.teaching_zone_clearance_feet,
        aisle_width_feet=room.aisle_width_feet,
        door_location=door_loc,
        window_location=room.window_location,
        glare_mitigation=room.glare_mitigation,
        is_accessible=room.is_accessible,
        is_active=room.is_active,
    )


@router.post("", response_model=RoomResponse)
async def create_room(
    room_data: RoomCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Create a new room configuration
    """
    ensure_school_exists(db, school_id)

    # Create room
    room = Room(
        name=room_data.name,
        school_id=school_id,
        length_feet=room_data.length_feet,
        width_feet=room_data.width_feet,
        desk_length_feet=room_data.desk_length_feet,
        desk_width_feet=room_data.desk_width_feet,
        num_benches=room_data.num_benches,
        capacity=room_data.num_benches * 2,  # 2 seats per bench
        teaching_zone_clearance_feet=room_data.teaching_zone_clearance_feet,
        aisle_width_feet=room_data.aisle_width_feet,
        door_location=room_data.door_location,
        window_location=room_data.window_location,
        glare_mitigation=room_data.glare_mitigation,
        is_accessible=room_data.is_accessible,
    )
    
    db.add(room)
    db.flush()  # Get room ID
    
    # Create desks
    for bench_idx in range(room_data.num_benches):
        row = bench_idx // 3
        col = bench_idx % 3
        
        desk = Desk(
            room_id=room.id,
            row=row,
            col=col,
        )
        db.add(desk)
        db.flush()
        
        # Create 2 seats per desk
        for seat_pos in [1, 2]:
            seat = Seat(
                desk_id=desk.id,
                position=seat_pos,
            )
            db.add(seat)
    
    db.commit()
    db.refresh(room)
    
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_room(room)


@router.get("", response_model=List[RoomResponse])
async def list_rooms(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    List all rooms for a school
    """
    ensure_school_exists(db, school_id)

    rooms = db.query(Room).filter(
        Room.school_id == school_id,
        Room.is_active == True
    ).all()
    
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(rooms)}")
    return [serialize_room(room) for room in rooms]


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: int,
    db: Session = Depends(get_db),
):
    """
    Get details of a specific room
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return serialize_room(room)


@router.put("/{room_id}", response_model=RoomResponse)
async def update_room(
    room_id: int,
    update_data: RoomUpdate,
    db: Session = Depends(get_db),
):
    """
    Update room configuration
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Update fields
    update_dict = update_data.dict(exclude_unset=True)

    for key, value in update_dict.items():
        setattr(room, key, value)
    
    db.commit()
    db.refresh(room)
    
    return serialize_room(room)


@router.delete("/{room_id}")
async def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
):
    """
    Delete a room
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room.is_active = False
    db.commit()
    
    return {"message": "Room deleted"}

@router.delete("")
async def delete_all_rooms(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_admin: bool = False,
    db: Session = Depends(get_db),
):
    """
    Delete all rooms for a school (Admin only).
    Requires is_admin=true query parameter for safety.
    """
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Only administrators can delete all rooms"
        )
    
    ensure_school_exists(db, school_id)
    
    # Delete all associated desks and seats first
    rooms = db.query(Room).filter(Room.school_id == school_id).all()
    deleted_desks = 0
    deleted_seats = 0
    
    for room in rooms:
        # Delete seats for each desk in this room
        desks = db.query(Desk).filter(Desk.room_id == room.id).all()
        for desk in desks:
            seats_count = db.query(Seat).filter(Seat.desk_id == desk.id).count()
            db.query(Seat).filter(Seat.desk_id == desk.id).delete()
            deleted_seats += seats_count
        
        # Delete desks
        desks_count = db.query(Desk).filter(Desk.room_id == room.id).count()
        db.query(Desk).filter(Desk.room_id == room.id).delete()
        deleted_desks += desks_count
    
    # Delete all rooms
    rooms_count = db.query(Room).filter(Room.school_id == school_id).count()
    db.query(Room).filter(Room.school_id == school_id).delete()
    db.commit()
    
    return {
        "message": f"All {rooms_count} rooms, {deleted_desks} desks, and {deleted_seats} seats deleted successfully",
        "deleted_rooms": rooms_count,
        "deleted_desks": deleted_desks,
        "deleted_seats": deleted_seats
    }

@router.delete("", summary="Delete all rooms")
async def delete_all_rooms(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_admin: bool = False,
    db: Session = Depends(get_db),
):
    """
    Delete all rooms for a school (Admin only).
    """
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Only administrators can delete all rooms"
        )
    
    rooms = db.query(Room).filter(Room.school_id == school_id).all()
    deleted_count = len(rooms)
    for room in rooms:
        db.delete(room)
    db.commit()
    
    return {
        "message": f"All {deleted_count} rooms deleted successfully",
        "deleted_count": deleted_count
    }
