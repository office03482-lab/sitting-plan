"""Exam management routes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import Exam, School, SeatingPlan, Student, User, UserRole
from app.services.supabase_context import is_legacy_sqlite_mode, resolve_school_id_from_actor
from app.services.supabase_exams import (
    create_exam as create_exam_supabase,
    delete_all_exams as delete_all_exams_supabase,
    delete_exam as delete_exam_supabase,
    get_exam as get_exam_supabase,
    list_exams as list_exams_supabase,
    update_exam as update_exam_supabase,
)

router = APIRouter()


def normalize_legacy_school_id(school_id: Any) -> int:
    try:
        return int(str(school_id).strip())
    except (TypeError, ValueError):
        return 1


def normalize_legacy_exam_id(exam_id: Any) -> int:
    try:
        return int(str(exam_id).strip())
    except (TypeError, ValueError):
        return 0


def should_use_legacy_exam_store(school_id: Any) -> bool:
    return is_legacy_sqlite_mode()


def serialize_legacy_exam_response(exam: Any) -> dict[str, Any]:
    return {
        "id": getattr(exam, "id", None),
        "name": getattr(exam, "name", "") or "",
        "school_id": getattr(exam, "school_id", None),
        "subject": getattr(exam, "subject", None),
        "exam_date": getattr(exam, "exam_date", None).isoformat() if getattr(exam, "exam_date", None) else None,
        "duration_minutes": getattr(exam, "duration_minutes", None),
        "total_students": int(getattr(exam, "total_students", 0) or 0),
        "total_batches": int(getattr(exam, "total_batches", 0) or 0),
        "is_active": bool(getattr(exam, "is_active", True)),
        "created_at": getattr(exam, "created_at", None).isoformat() if getattr(exam, "created_at", None) else None,
        "updated_at": getattr(exam, "updated_at", None).isoformat() if getattr(exam, "updated_at", None) else None,
    }





def ensure_school_exists(db: Session, school_id: Any) -> Any:
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

    school = School(id=school_id, name="Default School", admin_id=admin_user.id, is_active=True)
    db.add(school)
    db.commit()
    return school_id


def parse_legacy_exam_date(value: Any):
    if value in (None, "", False):
        return None
    if isinstance(value, datetime):
        return value

    text_value = str(value).strip()
    if not text_value:
        return None

    for parser in (datetime.fromisoformat,):
        try:
            return parser(text_value.replace("Z", "+00:00"))
        except ValueError:
            continue

    try:
        return datetime.strptime(text_value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Exam date must be a valid date")


def create_exam_in_legacy_store(db: Session, school_id: Any, exam_data: dict[str, Any]) -> Exam:
    legacy_school_id = normalize_legacy_school_id(school_id)
    ensure_school_exists(db, legacy_school_id)
    name = str(exam_data.get("name") or exam_data.get("exam_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Exam name is required")

    exam_date = parse_legacy_exam_date(exam_data.get("exam_date"))
    if not exam_date:
        raise HTTPException(status_code=400, detail="Exam date is required")

    total_students = db.query(Student).filter(Student.school_id == legacy_school_id, Student.is_active == True).count()
    total_batches = (
        db.query(func.count(func.distinct(Student.batch)))
        .filter(Student.school_id == legacy_school_id, Student.is_active == True)
        .scalar()
        or 0
    )
    exam = Exam(
        name=name,
        school_id=legacy_school_id,
        subject=str(exam_data.get("subject") or "").strip() or None,
        exam_date=exam_date,
        duration_minutes=int(exam_data.get("duration_minutes")) if exam_data.get("duration_minutes") not in (None, "", False) else None,
        total_students=total_students,
        total_batches=int(total_batches),
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.post("")
async def create_exam(
    exam_data: dict,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Create a new exam."""
    if should_use_legacy_exam_store(school_id):
        return serialize_legacy_exam_response(create_exam_in_legacy_store(db, school_id, exam_data))

    return create_exam_supabase(school_id, exam_data)


@router.get("")
async def list_exams(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """List all exams for a school."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        ensure_school_exists(db, legacy_school_id)
        exams = db.query(Exam).filter(Exam.school_id == legacy_school_id).all()
        return [serialize_legacy_exam_response(exam) for exam in exams]

    return list_exams_supabase(school_id)


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Get exam details."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        return serialize_legacy_exam_response(exam)

    return get_exam_supabase(school_id, exam_id)


@router.put("/{exam_id}")
async def update_exam(
    exam_id: str,
    exam_data: dict,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Update exam details."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        ensure_school_exists(db, legacy_school_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        if "name" in exam_data and str(exam_data.get("name") or "").strip():
            exam.name = str(exam_data.get("name")).strip()
        elif "exam_name" in exam_data and str(exam_data.get("exam_name") or "").strip():
            exam.name = str(exam_data.get("exam_name")).strip()
        if "subject" in exam_data:
            exam.subject = str(exam_data.get("subject") or "").strip() or None
        if "exam_date" in exam_data:
            exam.exam_date = parse_legacy_exam_date(exam_data.get("exam_date"))
        if "duration_minutes" in exam_data:
            duration_value = exam_data.get("duration_minutes")
            exam.duration_minutes = int(duration_value) if duration_value not in (None, "", False) else None
        db.commit()
        db.refresh(exam)
        return serialize_legacy_exam_response(exam)

    return update_exam_supabase(school_id, exam_id, exam_data)


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Delete a single exam and its seating plans."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        ensure_school_exists(db, legacy_school_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        db.query(SeatingPlan).filter(SeatingPlan.exam_id == exam.id).delete(synchronize_session=False)
        db.delete(exam)
        db.commit()
        return {"message": "Exam deleted successfully"}

    return delete_exam_supabase(school_id, exam_id)


@router.delete("", summary="Delete all exams")
async def delete_all_exams(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_admin: bool = False,
    db: Session = Depends(get_db),
):
    """Delete all exams for a school (admin only)."""
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can delete all exams")

    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        ensure_school_exists(db, legacy_school_id)
        exams = db.query(Exam).filter(Exam.school_id == legacy_school_id).all()
        deleted_count = len(exams)
        for exam in exams:
            db.delete(exam)
        db.commit()
        return {"message": f"All {deleted_count} exams deleted successfully", "deleted_count": deleted_count}

    return delete_all_exams_supabase(school_id)
