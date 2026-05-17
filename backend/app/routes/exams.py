"""Exam management routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import Exam, School, SeatingPlan, Student, User, UserRole
from app.services.supabase_admin import fetch_all, get_supabase_admin_client

router = APIRouter()
logger = logging.getLogger(__name__)


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
    normalized_school_id = str(school_id or "").strip()
    return settings.database_url.startswith("sqlite:///") or not normalized_school_id.isdigit()


def get_school_id_from_context(
    school_id: str = Query(None),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
) -> str:
    user_id = actor.get("user_id") or actor.get("id")
    resolved_school_id = str(school_id) if school_id and str(school_id) != "1" else None
    if not resolved_school_id:
        try:
            from app.models import Profile, SchoolMembership

            profile = db.query(Profile).filter(Profile.user_id == user_id).first()
            if profile:
                membership = db.query(SchoolMembership).filter(SchoolMembership.profile_id == profile.id).first()
                if membership:
                    resolved_school_id = str(membership.school_id)
        except Exception:
            pass
        resolved_school_id = resolved_school_id or actor.get("school_id")
    if not resolved_school_id or resolved_school_id == "1":
        raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")
    return str(resolved_school_id)


def ensure_school_exists(db: Session, school_id: Any) -> School:
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


def normalize_supabase_exam_payload(exam_data: dict[str, Any]) -> dict[str, Any]:
    name = str(exam_data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Exam name is required")

    subject_text = str(exam_data.get("subject") or "").strip() or None
    duration_value = exam_data.get("duration_minutes")
    return {
      "name": name,
      "exam_type": str(exam_data.get("exam_type") or "written").strip() or "written",
      "exam_date": str(exam_data.get("exam_date") or "").strip() or None,
      "duration_minutes": int(duration_value) if duration_value not in (None, "", False) else None,
      "status": str(exam_data.get("status") or "draft").strip() or "draft",
      "metadata": {"subject_text": subject_text},
      "is_active": bool(exam_data.get("is_active", True)),
    }


def build_supabase_exam_code(name: str) -> str:
    from datetime import datetime

    now = datetime.utcnow()
    suffix = now.strftime("%Y%m%d-%H%M%S%f")[-12:]
    return f"EXM-{suffix}"


def list_exams_from_supabase(school_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    rows = (
        supabase.schema("exam")
        .table("exams")
        .select("*")
        .eq("school_id", school_id)
        .order("exam_date", desc=True)
        .execute()
    )
    return list(rows.data or [])


def create_exam_in_supabase(school_id: str, exam_data: dict[str, Any]) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    payload = normalize_supabase_exam_payload(exam_data)
    payload["school_id"] = school_id
    payload["exam_code"] = build_supabase_exam_code(payload["name"])
    payload["exam_date"] = payload["exam_date"] or __import__("datetime").date.today().isoformat()

    inserted = (
        supabase.schema("exam")
        .table("exams")
        .insert(payload)
        .execute()
    )
    rows = list(inserted.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Exam save returned no row")
    return rows[0]


def update_exam_in_supabase(school_id: str, exam_id: str, exam_data: dict[str, Any]) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    payload = normalize_supabase_exam_payload(exam_data)
    updated = (
        supabase.schema("exam")
        .table("exams")
        .update(payload)
        .eq("id", exam_id)
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(updated.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Exam not found")
    return rows[0]


def delete_exam_in_supabase(school_id: str, exam_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    deleted = (
        supabase.schema("exam")
        .table("exams")
        .delete()
        .eq("id", exam_id)
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(deleted.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Exam not found")
    return {"message": "Exam deleted successfully"}


def create_exam_in_legacy_store(db: Session, school_id: Any, exam_data: dict[str, Any]) -> Exam:
    legacy_school_id = normalize_legacy_school_id(school_id)
    ensure_school_exists(db, legacy_school_id)
    total_students = db.query(Student).filter(Student.school_id == legacy_school_id, Student.is_active == True).count()
    total_batches = (
        db.query(func.count(func.distinct(Student.batch)))
        .filter(Student.school_id == legacy_school_id, Student.is_active == True)
        .scalar()
        or 0
    )
    exam = Exam(
        name=str(exam_data.get("name") or "").strip(),
        school_id=legacy_school_id,
        subject=str(exam_data.get("subject") or "").strip() or None,
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
    school_id: str = Depends(get_school_id_from_context),
    db: Session = Depends(get_db),
):
    """Create a new exam."""
    if should_use_legacy_exam_store(school_id):
        return create_exam_in_legacy_store(db, school_id, exam_data)

    try:
        return create_exam_in_supabase(school_id, exam_data)
    except Exception as exc:
        logger.warning("Falling back to legacy exam create path: %s", exc)
        return create_exam_in_legacy_store(db, school_id, exam_data)


@router.get("")
async def list_exams(
    school_id: str = Depends(get_school_id_from_context),
    db: Session = Depends(get_db),
):
    """List all exams for a school."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        ensure_school_exists(db, legacy_school_id)
        return db.query(Exam).filter(Exam.school_id == legacy_school_id).all()

    try:
        return list_exams_from_supabase(school_id)
    except Exception as exc:
        logger.warning("Falling back to legacy exam list path: %s", exc)
        legacy_school_id = normalize_legacy_school_id(school_id)
        ensure_school_exists(db, legacy_school_id)
        return db.query(Exam).filter(Exam.school_id == legacy_school_id).all()


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    school_id: str = Depends(get_school_id_from_context),
    db: Session = Depends(get_db),
):
    """Get exam details."""
    if should_use_legacy_exam_store(school_id):
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        return exam

    try:
        rows = fetch_all(
            get_supabase_admin_client(),
            "exams",
            schema="exam",
            filters={"id": exam_id, "school_id": school_id},
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Exam not found")
        return rows[0]
    except Exception as exc:
        logger.warning("Falling back to legacy exam get path: %s", exc)
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found")
        return exam


@router.put("/{exam_id}")
async def update_exam(
    exam_id: str,
    exam_data: dict,
    school_id: str = Depends(get_school_id_from_context),
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
        if "subject" in exam_data:
            exam.subject = str(exam_data.get("subject") or "").strip() or None
        db.commit()
        db.refresh(exam)
        return exam

    try:
        return update_exam_in_supabase(school_id, exam_id, exam_data)
    except Exception as exc:
        logger.warning("Falling back to legacy exam update path: %s", exc)
        legacy_school_id = normalize_legacy_school_id(school_id)
        legacy_exam_id = normalize_legacy_exam_id(exam_id)
        ensure_school_exists(db, legacy_school_id)
        exam = db.query(Exam).filter(Exam.id == legacy_exam_id, Exam.school_id == legacy_school_id).first()
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
    exam_id: str,
    school_id: str = Depends(get_school_id_from_context),
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

    try:
        return delete_exam_in_supabase(school_id, exam_id)
    except Exception as exc:
        logger.warning("Falling back to legacy exam delete path: %s", exc)
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


@router.delete("", summary="Delete all exams")
async def delete_all_exams(
    school_id: str = Depends(get_school_id_from_context),
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

    try:
        supabase = get_supabase_admin_client()
        existing = list_exams_from_supabase(school_id)
        deleted_count = len(existing)
        if deleted_count:
            supabase.schema("exam").table("exams").delete().eq("school_id", school_id).execute()
        return {"message": f"All {deleted_count} exams deleted successfully", "deleted_count": deleted_count}
    except Exception as exc:
        logger.warning("Falling back to legacy delete-all exams path: %s", exc)
        legacy_school_id = normalize_legacy_school_id(school_id)
        ensure_school_exists(db, legacy_school_id)
        exams = db.query(Exam).filter(Exam.school_id == legacy_school_id).all()
        deleted_count = len(exams)
        for exam in exams:
            db.delete(exam)
        db.commit()
        return {"message": f"All {deleted_count} exams deleted successfully", "deleted_count": deleted_count}
