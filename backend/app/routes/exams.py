"""
Exam management routes
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Exam, School, SeatingPlan, User, UserRole, Student

router = APIRouter()


def ensure_school_exists(db: Session, school_id: int) -> School:
    school = db.query(School).filter(School.id == school_id).first()
    if school:
        return school

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

    school = School(id=school_id, name="Default School", admin_id=admin_user.id, is_active=True)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.post("")
async def create_exam(
    exam_data: dict,
    school_id: int = 1,
    db: Session = Depends(get_db),
):
    """
    Create a new exam event
    """
    ensure_school_exists(db, school_id)
    total_students = db.query(Student).filter(Student.school_id == school_id, Student.is_active == True).count()
    total_batches = len({
        str(student.batch.value if hasattr(student.batch, "value") else student.batch)
        for student in db.query(Student).filter(Student.school_id == school_id, Student.is_active == True).all()
    })

    exam = Exam(
        name=exam_data.get('name'),
        school_id=school_id,
        subject=exam_data.get('subject'),
        total_students=total_students,
        total_batches=total_batches,
    )
    
    db.add(exam)
    db.commit()
    db.refresh(exam)
    
    return exam


@router.get("")
async def list_exams(
    school_id: int = 1,
    db: Session = Depends(get_db),
):
    """
    List all exams for a school
    """
    ensure_school_exists(db, school_id)
    exams = db.query(Exam).filter(Exam.school_id == school_id).all()
    
    return exams


@router.get("/{exam_id}")
async def get_exam(
    exam_id: int,
    db: Session = Depends(get_db),
):
    """
    Get exam details
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    
    return exam


@router.put("/{exam_id}")
async def update_exam(
    exam_id: int,
    exam_data: dict,
    school_id: int = 1,
    db: Session = Depends(get_db),
):
    """Update exam details"""
    ensure_school_exists(db, school_id)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.school_id == school_id).first()

    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    if "name" in exam_data and str(exam_data.get("name") or "").strip():
        exam.name = str(exam_data.get("name")).strip()
    if "subject" in exam_data:
        exam.subject = str(exam_data.get("subject") or "").strip() or None

    db.commit()
    db.refresh(exam)
    return exam


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: int,
    school_id: int = 1,
    db: Session = Depends(get_db),
):
    """Delete a single exam and its seating plans"""
    ensure_school_exists(db, school_id)
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.school_id == school_id).first()

    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    db.query(SeatingPlan).filter(SeatingPlan.exam_id == exam.id).delete(synchronize_session=False)
    db.delete(exam)
    db.commit()

    return {"message": "Exam deleted successfully"}


@router.delete("", summary="Delete all exams")
async def delete_all_exams(
    school_id: int = 1,
    is_admin: bool = False,
    db: Session = Depends(get_db),
):
    """
    Delete all exams for a school (Admin only).
    """
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Only administrators can delete all exams"
        )
    
    ensure_school_exists(db, school_id)
    
    exams = db.query(Exam).filter(Exam.school_id == school_id).all()
    deleted_count = len(exams)
    for exam in exams:
        db.delete(exam)
    db.commit()
    
    return {
        "message": f"All {deleted_count} exams deleted successfully",
        "deleted_count": deleted_count
    }
