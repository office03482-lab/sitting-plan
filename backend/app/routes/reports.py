"""
Report generation routes
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import SeatingPlan, Student, Room, Invigilator, RoomInvigilator
from app.services.supabase_admin import fetch_all, get_supabase_admin_client
from app.services.supabase_context import is_legacy_sqlite_mode, resolve_school_id_from_actor
from app.utils.excel import create_multi_room_seating_export_excel, create_seating_export_excel
from app.utils.pdf import create_seating_report_pdf
import json
router = APIRouter()


def parse_plan_batches(plan: SeatingPlan) -> list[str]:
    if not plan.batch_distribution:
        return []
    try:
        parsed = json.loads(plan.batch_distribution)
        if isinstance(parsed, dict):
            return [str(key) for key in parsed.keys()]
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        return []
    return []


def _parse_supabase_batch_names(batch_distribution: Any) -> list[str]:
    if isinstance(batch_distribution, dict):
        return [str(key) for key in batch_distribution.keys()]
    if isinstance(batch_distribution, list):
        names = []
        for item in batch_distribution:
            if isinstance(item, dict) and item.get("batch"):
                names.append(str(item["batch"]))
        return names
    return []


def _get_supabase_plan_assignment(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    assignment = metadata.get("assignment")
    return assignment if isinstance(assignment, dict) else {}


def _get_effective_supabase_plan_type(plan_row: dict[str, Any]) -> str:
    metadata = plan_row.get("plan_metadata")
    if isinstance(metadata, dict):
        return str(metadata.get("ui_plan_type") or plan_row.get("plan_type") or "").strip().lower()
    return str(plan_row.get("plan_type") or "").strip().lower()


def _build_supabase_room_plans(school_id: str, exam_id: str, plan_type: str | None = None) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    rows = fetch_all(
        supabase,
        "seating_plans",
        schema="exam",
        select="id, exam_id, room_id, plan_name, plan_type, plan_metadata, batch_distribution, created_at",
        filters={"school_id": school_id, "exam_id": exam_id, "is_active": True},
    )

    normalized_plan_type = (plan_type or "").strip().lower()
    if normalized_plan_type:
        rows = [row for row in rows if _get_effective_supabase_plan_type(row) == normalized_plan_type]

    if not rows:
        return []

    room_lookup = {
        str(item.get("id")): item
        for item in fetch_all(
            supabase,
            "rooms",
            select="id, name, capacity, length_feet, width_feet, num_benches",
            filters={"school_id": school_id},
        )
    }
    exam_lookup = {
        str(item.get("id")): item
        for item in fetch_all(
            supabase,
            "exams",
            schema="exam",
            select="id, name, metadata",
            filters={"school_id": school_id},
        )
    }

    room_plans: list[dict[str, Any]] = []
    for row in rows:
        metadata = row.get("plan_metadata") if isinstance(row.get("plan_metadata"), dict) else {}
        room = room_lookup.get(str(row.get("room_id"))) or {}
        exam = exam_lookup.get(str(row.get("exam_id"))) or {}
        room_plans.append(
            {
                "plan_data": {
                    "assignment": _get_supabase_plan_assignment(metadata),
                    "batches": _parse_supabase_batch_names(row.get("batch_distribution")),
                    "plan_type": metadata.get("ui_plan_type") or row.get("plan_type"),
                    "exam": {
                        "name": exam.get("name") or metadata.get("exam_name"),
                        "subject": (exam.get("metadata") or {}).get("subject_text") if isinstance(exam.get("metadata"), dict) else metadata.get("exam_subject"),
                    },
                },
                "room_data": {
                    "name": room.get("name") or metadata.get("room_name") or f"Room {row.get('room_id')}",
                    "capacity": room.get("capacity"),
                    "length_feet": room.get("length_feet"),
                    "width_feet": room.get("width_feet"),
                    "num_benches": room.get("num_benches"),
                    "plan_type": metadata.get("ui_plan_type") or row.get("plan_type"),
                    "exam_name": exam.get("name") or metadata.get("exam_name"),
                    "exam_subject": (exam.get("metadata") or {}).get("subject_text") if isinstance(exam.get("metadata"), dict) else metadata.get("exam_subject"),
                    "invigilator": None,
                },
            }
        )

    return room_plans


def load_plan_data(plan: SeatingPlan) -> dict:
    raw_plan_data = getattr(plan, "plan_data", None)
    if raw_plan_data:
        try:
            parsed = json.loads(raw_plan_data)
            if isinstance(parsed, dict):
                parsed.setdefault("assignment", {})
                parsed.setdefault("batches", parse_plan_batches(plan))
                return parsed
        except Exception:
            pass

    # Fallback for legacy plans that were saved without plan_data.
    return {
        "assignment": {},
        "batches": parse_plan_batches(plan),
        "plan_type": getattr(plan, "plan_type", None),
        "exam": {
            "name": getattr(getattr(plan, "exam", None), "name", None),
            "subject": getattr(getattr(plan, "exam", None), "subject", None),
        },
    }


def build_enriched_room_plan(db: Session, plan: SeatingPlan) -> dict:
    room = db.query(Room).filter(Room.id == plan.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    room_assignment = (
        db.query(RoomInvigilator)
        .filter(RoomInvigilator.room_id == room.id)
        .order_by(RoomInvigilator.id.desc())
        .first()
    )
    invigilator = None
    if room_assignment:
        invigilator = db.query(Invigilator).filter(Invigilator.id == room_assignment.invigilator_id).first()

    plan_data = load_plan_data(plan)
    student_ids = []
    for desk_students in plan_data.get('assignment', {}).values():
        for student in desk_students:
            if student.get('id'):
                student_ids.append(student['id'])

    students = db.query(Student).filter(Student.id.in_(student_ids)).all()
    student_dict = {s.id: s for s in students}

    enriched_assignment = {}
    for desk_id, desk_students in plan_data.get('assignment', {}).items():
        enriched_students = []
        for student in desk_students:
            student_id = student.get('id')
            if student_id and student_id in student_dict:
                db_student = student_dict[student_id]
                enriched_students.append({
                    'id': student_id,
                    'name': db_student.name,
                    'roll_number': db_student.roll_number,
                    'father_name': db_student.father_name,
                    'batch': db_student.batch.value if hasattr(db_student.batch, "value") else db_student.batch,
                    'email': db_student.email,
                    'phone': db_student.phone,
                })
            else:
                enriched_students.append(student)
        enriched_assignment[desk_id] = enriched_students

    enriched_plan_data = plan_data.copy()
    enriched_plan_data['assignment'] = enriched_assignment

    room_data = {
        'name': room.name,
        'capacity': room.capacity,
        'length_feet': room.length_feet,
        'width_feet': room.width_feet,
        'num_benches': room.num_benches,
        'plan_type': getattr(plan, 'plan_type', None),
        'exam_name': getattr(getattr(plan, 'exam', None), 'name', None),
        'exam_subject': getattr(getattr(plan, 'exam', None), 'subject', None),
        'invigilator': {
            'name': invigilator.name if invigilator else 'Not Assigned',
            'staff_id': invigilator.staff_id if invigilator else '',
            'phone': invigilator.phone if invigilator else '',
            'email': invigilator.email if invigilator else '',
        } if invigilator else None,
    }
    return {"plan_data": enriched_plan_data, "room_data": room_data}


@router.get("/pdf/{plan_id}")
async def export_pdf(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """
    Export seating plan as PDF
    """
    plan = db.query(SeatingPlan).filter(SeatingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Get room data
    room = db.query(Room).filter(Room.id == plan.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    room_assignment = (
        db.query(RoomInvigilator)
        .filter(RoomInvigilator.room_id == room.id)
        .order_by(RoomInvigilator.id.desc())
        .first()
    )
    invigilator = None
    if room_assignment:
        invigilator = db.query(Invigilator).filter(Invigilator.id == room_assignment.invigilator_id).first()

    plan_data = load_plan_data(plan)

    # Get student details for the plan
    student_ids = []
    for desk_students in plan_data.get('assignment', {}).values():
        for student in desk_students:
            if student.get('id'):
                student_ids.append(student['id'])

    students = db.query(Student).filter(Student.id.in_(student_ids)).all()
    student_dict = {s.id: s for s in students}

    # Enrich plan data with student details
    enriched_assignment = {}
    for desk_id, desk_students in plan_data.get('assignment', {}).items():
        enriched_students = []
        for student in desk_students:
            student_id = student.get('id')
            if student_id and student_id in student_dict:
                db_student = student_dict[student_id]
                enriched_students.append({
                    'id': student_id,
                    'name': db_student.name,
                    'roll_number': db_student.roll_number,
                    'father_name': db_student.father_name,
                    'batch': db_student.batch.value if hasattr(db_student.batch, "value") else db_student.batch,
                    'email': db_student.email,
                    'phone': db_student.phone,
                })
            else:
                enriched_students.append(student)
        enriched_assignment[desk_id] = enriched_students

    enriched_plan_data = plan_data.copy()
    enriched_plan_data['assignment'] = enriched_assignment

    # Prepare room data
    room_data = {
        'name': room.name,
        'capacity': room.capacity,
        'length_feet': room.length_feet,
        'width_feet': room.width_feet,
        'num_benches': room.num_benches,
        'plan_type': getattr(plan, 'plan_type', None),
        'exam_name': getattr(getattr(plan, 'exam', None), 'name', None),
        'exam_subject': getattr(getattr(plan, 'exam', None), 'subject', None),
        'invigilator': {
            'name': invigilator.name if invigilator else 'Not Assigned',
            'staff_id': invigilator.staff_id if invigilator else '',
            'phone': invigilator.phone if invigilator else '',
            'email': invigilator.email if invigilator else '',
        } if invigilator else None,
    }

    # Generate PDF
    pdf_buffer = create_seating_report_pdf(enriched_plan_data, room_data)

    return StreamingResponse(
        pdf_buffer,
        media_type='application/pdf',
        headers={"Content-Disposition": f'attachment; filename="seating-plan-{plan_id}.pdf"'}
    )


@router.get("/excel/{plan_id}")
async def export_excel(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """
    Export seating plan as Excel file
    """
    plan = db.query(SeatingPlan).filter(SeatingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    enriched_room_plan = build_enriched_room_plan(db, plan)

    # Generate Excel
    excel_buffer = create_seating_export_excel(enriched_room_plan["plan_data"], enriched_room_plan["room_data"])

    return StreamingResponse(
        excel_buffer,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={"Content-Disposition": f'attachment; filename="seating-plan-{plan_id}.xlsx"'}
    )


@router.get("/excel/all-rooms/{exam_id}")
async def export_all_rooms_excel(
    exam_id: str,
    plan_type: str | None = None,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Export all seating plans for an exam into one workbook, one sheet per room."""
    if not is_legacy_sqlite_mode():
        room_plans = _build_supabase_room_plans(school_id, exam_id, plan_type)
        if not room_plans:
            raise HTTPException(status_code=404, detail="No seating plans found for this exam")
    else:
        normalized_exam_id = int(exam_id) if str(exam_id).isdigit() else None
        if normalized_exam_id is None:
            raise HTTPException(status_code=404, detail="No seating plans found for this exam")

        query = db.query(SeatingPlan).filter(SeatingPlan.exam_id == normalized_exam_id)
        if plan_type:
            query = query.filter(SeatingPlan.plan_type == plan_type)
        plans = query.order_by(SeatingPlan.room_id.asc(), SeatingPlan.id.asc()).all()

        if not plans:
            raise HTTPException(status_code=404, detail="No seating plans found for this exam")

        room_plans = [build_enriched_room_plan(db, plan) for plan in plans]

    excel_buffer = create_multi_room_seating_export_excel(room_plans)
    suffix = f"-{plan_type}" if plan_type else ""
    return StreamingResponse(
        excel_buffer,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={"Content-Disposition": f'attachment; filename="seating-plan-all-rooms-exam-{exam_id}{suffix}.xlsx"'}
    )
