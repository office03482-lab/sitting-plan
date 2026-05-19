"""
Batch Management Routes
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from app.database import get_db
from app.services.supabase_context import resolve_school_id_from_actor
from app.models import BatchTable, Student
from app.schemas import BatchCreate, BatchUpdate, BatchResponse, BatchWithStudentCount, BatchReorderRequest
from app.utils.academic_batches import looks_like_academic_batch_name
# from app.middleware.auth import get_current_user  # Temporarily disabled
from typing import List

router = APIRouter(prefix="/api/batches", tags=["batches"])


def _is_invalid_class_name(name: str | None, category: str | None) -> bool:
    return (category or "batch").strip().lower() == "class" and looks_like_academic_batch_name(name)


def _serialize_batch(batch: BatchTable, student_count: int) -> dict:
    return {
        **{
            col: getattr(batch, col)
            for col in ['id', 'name', 'category', 'syllabus', 'display_order', 'school_id', 'is_active', 'created_at', 'updated_at']
        },
        'student_count': student_count,
    }


def _next_display_order(db: Session, school_id: int) -> int:
    last_batch = (
        db.query(BatchTable)
        .filter(BatchTable.school_id == school_id)
        .order_by(BatchTable.display_order.desc(), BatchTable.id.desc())
        .first()
    )
    return (last_batch.display_order if last_batch and last_batch.display_order is not None else 0) + 1


@router.post("", response_model=BatchResponse)
def create_batch(
    batch: BatchCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    # current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new batch for a school.
    Prevents duplicate batch names per school.
    """
    # Check if batch already exists (case-insensitive)
    normalized_category = (batch.category or "batch").strip().lower() or "batch"
    if _is_invalid_class_name(batch.name, normalized_category):
        raise HTTPException(
            status_code=400,
            detail="Coaching batch names cannot be created as classes"
        )
    existing_batch = db.query(BatchTable).filter(
        BatchTable.school_id == school_id,
        BatchTable.category == normalized_category,
        BatchTable.name.ilike(batch.name.strip())
    ).first()
    
    if existing_batch:
        raise HTTPException(
            status_code=400,
            detail=f"Batch with name '{batch.name}' already exists in this school"
        )
    
    try:
        new_batch = BatchTable(
            name=batch.name.strip(),
            category=normalized_category,
            syllabus=batch.syllabus.strip() if batch.syllabus else None,
            display_order=batch.display_order if batch.display_order > 0 else _next_display_order(db, school_id),
            school_id=school_id,
            is_active=batch.is_active
        )
        db.add(new_batch)
        db.commit()
        db.refresh(new_batch)
        return new_batch
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Failed to create batch - duplicate name or invalid data"
        )


@router.get("", response_model=List[BatchWithStudentCount])
def list_batches(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_active: bool = Query(None),
    category: str | None = Query(default=None),
    # current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all batches for a school.
    Optionally filter by active status.
    Returns student count for each batch.
    """
    query = db.query(BatchTable).filter(BatchTable.school_id == school_id)
    
    if is_active is not None:
        query = query.filter(BatchTable.is_active == is_active)
    if category:
        query = query.filter(BatchTable.category == category.strip().lower())
    
    batches = query.order_by(BatchTable.display_order.asc(), BatchTable.created_at.asc(), BatchTable.id.asc()).all()
    regular_batch_names = {
        item.name.strip().lower()
        for item in db.query(BatchTable).filter(
            BatchTable.school_id == school_id,
            BatchTable.category != "class",
        ).all()
    }
    if category and category.strip().lower() == "class":
        batches = [
            batch for batch in batches
            if batch.name.strip().lower() not in regular_batch_names
            and not looks_like_academic_batch_name(batch.name)
        ]
    
    result = []
    for batch in batches:
        if batch.category == "class":
            student_count = db.query(Student).filter(
                Student.school_id == school_id,
                Student.class_name == batch.name,
            ).count()
        else:
            student_count = db.query(Student).filter(
                Student.batch_id == batch.id
            ).count()
        result.append(_serialize_batch(batch, student_count))
    
    return result


@router.get("/{batch_id}", response_model=BatchWithStudentCount)
def get_batch(
    batch_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    # current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific batch with student count"""
    batch = db.query(BatchTable).filter(
        BatchTable.id == batch_id,
        BatchTable.school_id == school_id
    ).first()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    if batch.category == "class":
        student_count = db.query(Student).filter(
            Student.school_id == school_id,
            Student.class_name == batch.name,
        ).count()
    else:
        student_count = db.query(Student).filter(
            Student.batch_id == batch.id
        ).count()
    
    return _serialize_batch(batch, student_count)


@router.put("/{batch_id}", response_model=BatchResponse)
def update_batch(
    batch_id: int,
    batch_update: BatchUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    # current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update a batch (name and/or status).
    Name change is allowed even if students are assigned.
    """
    batch = db.query(BatchTable).filter(
        BatchTable.id == batch_id,
        BatchTable.school_id == school_id
    ).first()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    try:
        old_name = batch.name
        previous_category = batch.category or "batch"
        next_category = (batch_update.category or batch.category or "batch").strip().lower() or "batch"
        next_name = batch_update.name.strip() if batch_update.name else batch.name

        if _is_invalid_class_name(next_name, next_category):
            raise HTTPException(
                status_code=400,
                detail="Coaching batch names cannot be saved as classes"
            )

        # Check if new name already exists (if name is being changed)
        if batch_update.name and batch_update.name.strip() != batch.name:
            normalized_name = batch_update.name.strip()
            existing = db.query(BatchTable).filter(
                BatchTable.school_id == school_id,
                BatchTable.id != batch_id,
                BatchTable.category == next_category,
                BatchTable.name.ilike(normalized_name)
            ).first()
            
            if existing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Batch with name '{batch_update.name}' already exists"
                )
            
            batch.name = normalized_name
            if previous_category == "class":
                db.query(Student).filter(
                    Student.school_id == school_id,
                    Student.class_name == old_name,
                ).update(
                    {Student.class_name: normalized_name},
                    synchronize_session=False,
                )
            else:
                db.query(Student).filter(
                    Student.school_id == school_id,
                    Student.batch_id == batch.id,
                ).update(
                    {Student.batch: normalized_name},
                    synchronize_session=False,
                )

                db.query(Student).filter(
                    Student.school_id == school_id,
                    Student.batch == old_name,
                ).update(
                    {
                        Student.batch: normalized_name,
                        Student.batch_id: batch.id,
                    },
                    synchronize_session=False,
                )

        if batch_update.category is not None:
            batch.category = next_category
        
        if batch_update.syllabus is not None:
            batch.syllabus = batch_update.syllabus.strip() if batch_update.syllabus else None

        if batch_update.display_order is not None:
            batch.display_order = max(0, batch_update.display_order)
        
        if batch_update.is_active is not None:
            batch.is_active = batch_update.is_active
        
        batch.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(batch)
        return batch
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Failed to update batch - duplicate name or invalid data"
        )


@router.post("/reorder", response_model=List[BatchWithStudentCount])
def reorder_batches(
    payload: BatchReorderRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db)
):
    """Persist manual batch ordering for a school."""
    if not payload.items:
        raise HTTPException(status_code=400, detail="At least one batch order item is required")

    batch_ids = [item.batch_id for item in payload.items]
    batches = db.query(BatchTable).filter(
        BatchTable.school_id == school_id,
        BatchTable.id.in_(batch_ids),
    ).all()

    if len(batches) != len(set(batch_ids)):
        raise HTTPException(status_code=404, detail="One or more batches were not found")

    batch_map = {batch.id: batch for batch in batches}
    for item in payload.items:
        batch_map[item.batch_id].display_order = max(0, item.display_order)
        batch_map[item.batch_id].updated_at = datetime.utcnow()

    db.commit()

    refreshed = (
        db.query(BatchTable)
        .filter(BatchTable.school_id == school_id)
        .order_by(BatchTable.display_order.asc(), BatchTable.created_at.asc(), BatchTable.id.asc())
        .all()
    )

    return [
        _serialize_batch(
            batch,
            db.query(Student).filter(
                Student.school_id == school_id,
                Student.class_name == batch.name,
            ).count()
            if batch.category == "class"
            else db.query(Student).filter(Student.batch_id == batch.id).count(),
        )
        for batch in refreshed
    ]


@router.delete("/{batch_id}")
def delete_batch(
    batch_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    # current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a batch.
    Prevents deletion if students are assigned.
    """
    batch = db.query(BatchTable).filter(
        BatchTable.id == batch_id,
        BatchTable.school_id == school_id
    ).first()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Check if batch has students
    if batch.category == "class":
        student_count = db.query(Student).filter(
            Student.school_id == school_id,
            Student.class_name == batch.name,
        ).count()
    else:
        student_count = db.query(Student).filter(
            Student.batch_id == batch_id
        ).count()
    
    if student_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete batch: {student_count} student(s) are assigned. Please reassign them first."
        )
    
    db.delete(batch)
    db.commit()
    
    return {"message": "Batch deleted successfully"}


@router.delete("")
def delete_all_batches(
    school_id: str = Depends(resolve_school_id_from_actor),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db)
):
    """
    Delete all batches for a school.
    Prevents deletion if any students are still assigned to any batch.
    """
    query = db.query(BatchTable).filter(BatchTable.school_id == school_id)
    if category:
        query = query.filter(BatchTable.category == category.strip().lower())
    batches = query.all()

    if not batches:
        return {"message": "No batches found", "deleted_count": 0}

    batch_ids = [batch.id for batch in batches]
    class_batch_names = [batch.name for batch in batches if batch.category == "class"]
    regular_batch_ids = [batch.id for batch in batches if batch.category != "class"]
    assigned_student_count = 0
    if regular_batch_ids:
        assigned_student_count += db.query(Student).filter(
            Student.batch_id.in_(regular_batch_ids)
        ).count()
    if class_batch_names:
        assigned_student_count += db.query(Student).filter(
            Student.school_id == school_id,
            Student.class_name.in_(class_batch_names),
        ).count()

    if assigned_student_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete all batches: {assigned_student_count} student(s) are still assigned. Please remove or reassign them first."
        )

    deleted_count = len(batches)
    for batch in batches:
        db.delete(batch)
    db.commit()

    return {"message": "All batches deleted successfully", "deleted_count": deleted_count}


@router.get("/by-name/{batch_name}")
def get_batch_by_name(
    batch_name: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db)
):
    """
    Get batch by name (for internal use, no auth required for migration).
    Used during Excel import to find or verify batches.
    """
    batch = db.query(BatchTable).filter(
        BatchTable.school_id == school_id,
        BatchTable.name.ilike(batch_name.strip())
    ).first()
    
    if not batch:
        return {"exists": False, "batch": None}
    
    return {"exists": True, "batch": {col: getattr(batch, col) for col in ['id', 'name', 'school_id', 'is_active']}}
