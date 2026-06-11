"""
Student management routes
"""
from datetime import datetime, timezone
import logging
from uuid import UUID
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from app.services.supabase_context import ensure_legacy_sqlite_route_available, is_legacy_sqlite_mode, resolve_school_id_from_actor
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload
from typing import Any, List
from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.models import BatchTable, Hostel, HostelRoom, Seat, SeatingPlan, StockOutEntry, Student, StudentHostelRequest, User
from app.schemas import (
    StudentBatchTransferRequest,
    StudentBatchTransferResponse,
    StudentBulkDeleteRequest,
    StudentCreate,
    StudentHostelRequestCreate,
    StudentHostelRequestDecision,
    StudentHostelRequestResponse,
    StudentImportResponse,
    StudentResponse,
    StudentUpdate,
)
from app.utils.academic_batches import (
    is_class_only_upload_name,
    looks_like_academic_batch_name,
    split_batch_to_class_section,
)
from app.utils.excel import parse_student_excel, create_student_excel_template
from app.services.supabase_admin import fetch_all, get_supabase_admin_client, insert_rows
from app.services.supabase_attendance import get_students_count as get_supabase_students_count
from app.services.supabase_hostels import sync_room_occupancy as supabase_sync_room_occupancy
from app.services.supabase_hostel_requests import (
    approve_hostel_request as approve_hostel_request_supabase,
    create_or_update_hostel_request as create_or_update_hostel_request_supabase,
    list_hostel_requests as list_hostel_requests_supabase,
    move_hostel_allocation as move_hostel_allocation_supabase,
    reject_hostel_request as reject_hostel_request_supabase,
    vacate_hostel_allocation as vacate_hostel_allocation_supabase,
)
from app.services.supabase_students import (
    delete_all_students as delete_all_students_supabase,
    delete_student as delete_student_supabase,
    delete_students as delete_students_supabase,
    find_student_by_roll_number,
    get_student as get_student_supabase,
    list_students as list_students_supabase,
    upsert_student as upsert_student_supabase,
)
from app.services.bulk_action_requests import create_bulk_action_request, is_platform_admin_user
import re

logger = logging.getLogger(__name__)
router = APIRouter()


def _bulk_action_response(request: dict[str, Any], *, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "mode": "approval_required",
            "request_id": request.get("id"),
            "status": request.get("status"),
            "message": message,
        },
    )


def is_uuid_school_id(value: Any) -> bool:
    try:
        UUID(str(value or "").strip())
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def ensure_students_legacy_routes_available(school_id: str) -> None:
    ensure_legacy_sqlite_route_available(
        "Student management",
        school_id,
        reason="Only the Supabase-backed student import flow remains enabled during migration.",
    )


def build_batch_code(batch_name: str, fallback_index: int) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", (batch_name or "").strip().upper()).strip("_")
    normalized = normalized[:32] if normalized else ""
    return normalized or f"BATCH_{fallback_index}"


def format_bulk_import_exception(exc: Exception) -> str:
    detail = str(exc).strip()
    if not detail:
        return "Unknown import error"

    lower_detail = detail.lower()
    if "duplicate key value" in lower_detail:
        if "roll" in lower_detail:
            return "Student with this roll number already exists"
        if "admission" in lower_detail:
            return "Student with this admission id already exists"
        return "Duplicate record already exists"

    if "permission denied" in lower_detail or "not allowed" in lower_detail:
        return "Supabase permission denied during bulk import"

    if "relation" in lower_detail and "does not exist" in lower_detail:
        return "Required Supabase table is missing for student import"

    return detail


def normalize_student_class_name(class_name: str | None, batch_name: str | None = None) -> str | None:
    normalized_class = (class_name or "").strip()
    if not normalized_class:
        return None

    return normalized_class


def build_student_import_metadata(student_data: dict[str, Any], batch_name: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "managed_batch": batch_name,
        "legacy_batch_label": batch_name,
        "source": "student_bulk_upload",
    }

    metadata_field_map = {
        "sr_no": "sr_no",
        "program": "program",
        "course": "course",
        "local_name": "local_name",
        "age_as_of_today": "age_as_of_today",
        "admission_date": "admission_date",
        "fee_schedule": "fee_schedule",
        "tc_number": "tc_number",
        "previous_school": "previous_school",
        "previous_exam": "previous_exam",
        "previous_board": "previous_board",
        "previous_percentage": "previous_percentage",
        "previous_total_marks": "previous_total_marks",
        "previous_average": "previous_average",
        "father_mobile": "father_mobile",
        "father_occupation": "father_occupation",
        "mother_mobile": "mother_mobile",
        "mother_occupation": "mother_occupation",
        "category": "category",
        "sub_category": "sub_category",
        "sibling_name": "sibling_name",
        "sibling_school": "sibling_school",
        "guardian_relation": "guardian_relation",
        "guardian_address": "guardian_address",
        "emergency_name": "emergency_name",
        "emergency_mobile": "emergency_mobile",
        "priority_contact": "priority_contact",
        "address1": "address_line_1",
        "address2": "address_line_2",
        "city": "city",
        "state": "state",
        "country": "country",
        "pincode": "pincode",
        "region": "region",
        "reference_name": "reference_name",
        "reference_number": "reference_number",
        "reference_remark": "reference_remark",
        "admission_type": "admission_type",
        "availing_mess_facility": "availing_mess_facility",
        "preferred_hostel": "preferred_hostel",
        "hostel_request_note": "hostel_request_note",
        "pickup_enabled": "pickup_enabled",
        "drop_enabled": "drop_enabled",
        "transport_month": "transport_month",
        "transport_route": "transport_route",
        "transport_stop": "transport_stop",
        "room_no": "legacy_room_no",
        "source_roll_no": "source_roll_no",
    }

    for source_key, metadata_key in metadata_field_map.items():
        value = student_data.get(source_key)
        if value not in (None, "", []):
            metadata[metadata_key] = value

    return metadata


def release_student_seats(db: Session, student_ids: List[int]) -> int:
    """
    Remove student assignments from seats before deleting student rows.
    """
    if not student_ids:
        return 0

    seats = db.query(Seat).filter(Seat.student_id.in_(student_ids)).all()
    for seat in seats:
        seat.student_id = None
        seat.is_occupied = False
    return len(seats)


def get_or_create_batch(
    db: Session,
    school_id: int,
    batch_name: str,
    category: str = "batch",
    course: str | None = None,
    program: str | None = None,
) -> BatchTable:
    """
    Resolve batch by name and create it on the fly when missing.
    """
    cleaned_name = (batch_name or "").strip()
    cleaned_course = (course or "").strip()
    cleaned_program = (program or "").strip()
    syllabus_parts = [part for part in [cleaned_program, cleaned_course] if part]
    computed_syllabus = " | ".join(syllabus_parts) if syllabus_parts else None

    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch name is required",
        )

    def merge_syllabus(existing_value: str | None, program_value: str, course_value: str) -> str | None:
        current_parts = [part.strip() for part in (existing_value or "").split("|") if part.strip()]
        normalized_parts = {part.lower() for part in current_parts}

        if program_value and program_value.lower() not in normalized_parts:
            current_parts.insert(0, program_value)
            normalized_parts.add(program_value.lower())

        if course_value and course_value.lower() not in normalized_parts:
            current_parts.append(course_value)

        return " | ".join(current_parts) if current_parts else None

    existing_batch = db.query(BatchTable).filter(
        BatchTable.school_id == school_id,
        BatchTable.category == category,
        BatchTable.name.ilike(cleaned_name),
    ).first()
    if existing_batch:
        if not existing_batch.is_active:
            existing_batch.is_active = True
        if computed_syllabus:
            existing_batch.syllabus = merge_syllabus(existing_batch.syllabus, cleaned_program, cleaned_course)
        db.flush()
        return existing_batch

    new_batch = BatchTable(
        name=cleaned_name,
        category=category,
        syllabus=computed_syllabus,
        school_id=school_id,
        is_active=True,
    )
    db.add(new_batch)
    db.flush()
    return new_batch


def delete_school_batches(db: Session, school_id: int) -> int:
    """
    Delete all batches for the school and release optional references first.
    """
    batches = db.query(BatchTable).filter(BatchTable.school_id == school_id).all()
    if not batches:
        return 0

    batch_ids = [batch.id for batch in batches]

    # Keep inventory history labels intact via batch_name, but remove FK links.
    db.query(StockOutEntry).filter(
        StockOutEntry.school_id == school_id,
        StockOutEntry.batch_id.in_(batch_ids),
    ).update(
        {StockOutEntry.batch_id: None},
        synchronize_session=False,
    )

    for batch in batches:
        db.delete(batch)

    return len(batches)


def serialize_student(student: Student) -> StudentResponse:
    safe_class_name = normalize_student_class_name(student.class_name, student.batch)
    return StudentResponse(
        id=student.id,
        roll_number=student.roll_number,
        name=student.name,
        father_name=student.father_name,
        batch=student.batch,
        class_name=safe_class_name,
        section=student.section,
        academic_session=student.academic_session,
        email=student.email,
        phone=student.phone,
        special_needs=student.special_needs,
        requires_near_exit=bool(student.requires_near_exit),
        requires_extra_time=bool(student.requires_extra_time),
        reference_name=student.reference_name,
        reference_number=student.reference_number,
        reference_remark=student.reference_remark,
        school_id=student.school_id,
        is_active=student.is_active,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


def serialize_hostel_request(request: StudentHostelRequest) -> StudentHostelRequestResponse:
    is_active_allocation = request.status == "approved" and bool(request.room_id)
    return StudentHostelRequestResponse(
        id=request.id,
        student_id=request.student_id,
        student_name=request.student.name if request.student else "",
        roll_number=request.student.roll_number if request.student else "",
        batch=request.student.batch if request.student else "",
        class_name=request.student.class_name if request.student else None,
        section=request.student.section if request.student else None,
        reference_name=request.student.reference_name if request.student else None,
        reference_number=request.student.reference_number if request.student else None,
        reference_remark=request.student.reference_remark if request.student else None,
        hostel_id=request.hostel_id,
        hostel_name=request.hostel.name if request.hostel else "",
        room_id=request.room_id,
        room_number=request.room.room_number if request.room else None,
        current_room=request.room.room_number if request.room else None,
        requested_notes=request.requested_notes,
        status=request.status,
        request_status=request.status,
        allocation_active=is_active_allocation,
        allocation_status="active" if is_active_allocation else ("released" if request.status == "vacated" else None),
        assigned_bed_label=request.assigned_bed_label,
        reviewed_by=request.reviewed_by,
        review_notes=request.review_notes,
        requested_at=request.requested_at,
        reviewed_at=request.reviewed_at,
        vacated_at=request.reviewed_at if request.status == "vacated" else None,
        vacated_by=request.reviewed_by if request.status == "vacated" else None,
    )


def sync_hostel_room_occupancy(db: Session, room_id: int | None) -> None:
    if not room_id:
        return
    # SessionLocal uses autoflush=False, so push in-memory room/student moves
    # before recounting approved allocations for a room.
    db.flush()
    room = db.query(HostelRoom).filter(HostelRoom.id == room_id).first()
    if not room:
        return
    room.occupied_beds = db.query(Student).filter(
        Student.assigned_room_id == room_id,
        Student.hostel_request_status == "approved",
    ).count()
    db.flush()


def build_next_bed_label(room: HostelRoom) -> str:
    next_bed_index = int(room.occupied_beds or 0)
    return f"Bed {next_bed_index}"


def _find_supabase_room_id(school_id: str, legacy_room_id: int | None, db: Session) -> str | None:
    """Resolve a legacy SQLite hostel_room ID to a Supabase hostel_room UUID.

    Uses hostel name + room_number as the cross-reference key.
    Returns None if no match is found (graceful fallback).
    """
    if not legacy_room_id:
        return None
    legacy_room = db.query(HostelRoom).filter(HostelRoom.id == legacy_room_id).first()
    if not legacy_room or not legacy_room.hostel:
        return None
    hostel_name = legacy_room.hostel.name
    room_number = legacy_room.room_number
    client = get_supabase_admin_client()
    hostel_rows = (
        client.schema("hostel").table("hostels")
        .select("id")
        .eq("school_id", school_id)
        .eq("name", hostel_name)
        .limit(1)
        .execute()
    )
    hostel_data = list(hostel_rows.data or [])
    if not hostel_data:
        return None
    room_rows = (
        client.schema("hostel").table("hostel_rooms")
        .select("id")
        .eq("hostel_id", hostel_data[0]["id"])
        .eq("room_number", room_number)
        .limit(1)
        .execute()
    )
    room_data = list(room_rows.data or [])
    return room_data[0]["id"] if room_data else None


def _sync_supabase_student_hostel(
    school_id: str,
    roll_number: str,
    hostel_request_status: str,
    assigned_hostel_id: int | None = None,
    assigned_room_id: int | None = None,
    assigned_bed_label: str | None = None,
    hostel_notes: str | None = None,
    db: Session | None = None,
) -> None:
    """Synchronize hostel-related fields from legacy SQLite to Supabase student record.

    Uses roll_number as the cross-reference key. Finds the corresponding
    Supabase hostel_room UUID and calls sync_room_occupancy to keep
    occupied_beds consistent on the Supabase side.
    Gracefully skips if the Supabase records are not found.
    """
    try:
        supabase_student = find_student_by_roll_number(school_id, roll_number)
        if not supabase_student:
            return

        old_supabase_room_id = supabase_student.get("assigned_room_id") or None
        update_data: dict[str, Any] = {
            "hostel_request_status": hostel_request_status,
        }
        new_supabase_room_id: str | None = None
        if db is not None:
            new_supabase_room_id = _find_supabase_room_id(school_id, assigned_room_id, db)
            if new_supabase_room_id:
                update_data["assigned_room_id"] = new_supabase_room_id
            elif assigned_room_id is not None:
                update_data["assigned_room_id"] = None
        if assigned_bed_label is not None:
            update_data["assigned_bed_label"] = assigned_bed_label
        if hostel_notes is not None:
            update_data["hostel_notes"] = hostel_notes

        client = get_supabase_admin_client()
        client.table("students").update(update_data).eq("id", supabase_student["id"]).execute()

        synced_rooms: set[str] = set()
        if old_supabase_room_id and old_supabase_room_id != new_supabase_room_id:
            supabase_sync_room_occupancy(school_id, old_supabase_room_id)
            synced_rooms.add(old_supabase_room_id)
        if new_supabase_room_id and new_supabase_room_id not in synced_rooms:
            supabase_sync_room_occupancy(school_id, new_supabase_room_id)

    except Exception as exc:
        logger.warning("supabase_sync_skipped roll=%s err=%s", roll_number, exc)


@router.get("/template/download", responses={200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}})
async def download_student_template():
    """
    Download Excel template for student data upload
    """
    try:
        excel_file = create_student_excel_template()
        return Response(
            content=excel_file.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": "attachment; filename=student_data_template.xlsx",
                "Cache-Control": "no-store",
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating template: {str(e)}")


@router.post("/import", response_model=StudentImportResponse)
async def import_students(
    file: UploadFile = File(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Import students from Excel file
    """
    # Validate file type
    if not file.filename.lower().endswith('.xlsx'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only .xlsx Excel files are allowed."
        )

    # Read file
    content = await file.read()

    # Parse Excel
    valid_students, errors = parse_student_excel(content)

    if not valid_students and errors:
        # If the file is invalid or missing required columns, return a clear error
        first_error = errors[0].get('error', 'Invalid Excel file. Please use the provided template.')
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=first_error
        )

    imported_count = 0
    skipped_count = 0
    try:
        try:
            supabase = get_supabase_admin_client()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        try:
            schools = fetch_all(supabase, "schools", select="id,name", filters={"id": school_id})
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to verify school in Supabase: {format_bulk_import_exception(exc)}",
            ) from exc

        if not schools:
            raise HTTPException(status_code=400, detail="Supabase school not found for import.")

        try:
            existing_batches = fetch_all(
                supabase,
                "batches",
                select="id,name,batch_code,class_name,section,category",
                filters={"school_id": school_id},
            )
            existing_students = fetch_all(
                supabase,
                "students",
                select="id,roll_number,admission_no",
                filters={"school_id": school_id},
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load existing students or batches from Supabase: {format_bulk_import_exception(exc)}",
            ) from exc

        batch_by_name = {
            str(batch["name"]).strip().lower(): batch
            for batch in existing_batches
            if batch.get("name") and str(batch.get("category") or "batch").strip().lower() != "class"
        }
        class_by_name = {
            str(batch["name"]).strip().lower(): batch
            for batch in existing_batches
            if batch.get("name") and str(batch.get("category") or "").strip().lower() == "class"
        }
        existing_roll_numbers = {
            str(student["roll_number"]).strip().lower()
            for student in existing_students
            if student.get("roll_number")
        }
        existing_admission_numbers = {
            str(student["admission_no"]).strip().lower()
            for student in existing_students
            if student.get("admission_no")
        }

        pending_batch_names: list[str] = []
        pending_batch_rows: list[dict[str, Any]] = []
        pending_class_names: list[str] = []
        pending_class_rows: list[dict[str, Any]] = []

        for student_data in valid_students:
            batch_name = str(student_data.get("batch") or "").strip()
            normalized_batch_name = batch_name.lower()
            if not batch_name:
                continue

            class_name, section = split_batch_to_class_section(batch_name)
            if is_class_only_upload_name(batch_name) and class_name:
                normalized_class_name = class_name.lower()
                if normalized_class_name in class_by_name or normalized_class_name in pending_class_names:
                    continue

                pending_class_names.append(normalized_class_name)
                pending_class_rows.append(
                    {
                        "school_id": school_id,
                        "batch_code": build_batch_code(class_name, len(pending_class_rows) + 1),
                        "name": class_name,
                        "category": "class",
                        "class_name": class_name,
                        "section": section,
                        "academic_session": student_data.get("academic_session") or None,
                        "stream": None,
                        "syllabus": None,
                        "display_order": len(existing_batches) + len(pending_batch_rows) + len(pending_class_rows),
                        "metadata": {
                            "source": "student_bulk_upload",
                            "source_batch_value": batch_name,
                        },
                        "is_active": True,
                    }
                )
                continue

            if normalized_batch_name in batch_by_name or normalized_batch_name in pending_batch_names:
                continue

            pending_batch_names.append(normalized_batch_name)
            pending_batch_rows.append(
                {
                    "school_id": school_id,
                    "batch_code": build_batch_code(batch_name, len(pending_batch_rows) + 1),
                    "name": batch_name,
                    "category": "batch",
                    "class_name": class_name,
                    "section": section,
                    "academic_session": student_data.get("academic_session") or None,
                    "stream": (student_data.get("course") or "").strip() or None,
                    "syllabus": " | ".join(
                        [part for part in [student_data.get("program"), student_data.get("course")] if part]
                    ) or None,
                    "display_order": len(existing_batches) + len(pending_batch_rows),
                    "metadata": {
                        "source": "student_bulk_upload",
                    },
                    "is_active": True,
                }
            )

        if pending_batch_rows or pending_class_rows:
            for batch_row in [*pending_batch_rows, *pending_class_rows]:
                batch_name = str(batch_row.get("name") or "").strip()
                try:
                    insert_rows(supabase, "batches", [batch_row])
                except Exception as exc:
                    try:
                        refreshed_batches = fetch_all(
                            supabase,
                            "batches",
                            select="id,name,batch_code,class_name,section,category",
                            filters={"school_id": school_id},
                        )
                        existing_batches = refreshed_batches
                        batch_by_name = {
                            str(batch["name"]).strip().lower(): batch
                            for batch in existing_batches
                            if batch.get("name") and str(batch.get("category") or "batch").strip().lower() != "class"
                        }
                        class_by_name = {
                            str(batch["name"]).strip().lower(): batch
                            for batch in existing_batches
                            if batch.get("name") and str(batch.get("category") or "").strip().lower() == "class"
                        }
                        if batch_name.lower() in batch_by_name or batch_name.lower() in class_by_name:
                            continue
                    except Exception:
                        pass

                    errors.append({
                        "batch": batch_name,
                        "error": f"Failed to create batch '{batch_name}': {format_bulk_import_exception(exc)}",
                    })

            existing_batches = fetch_all(
                supabase,
                "batches",
                select="id,name,batch_code,class_name,section,category",
                filters={"school_id": school_id},
            )
            batch_by_name = {
                str(batch["name"]).strip().lower(): batch
                for batch in existing_batches
                if batch.get("name") and str(batch.get("category") or "batch").strip().lower() != "class"
            }

        pending_students: list[dict[str, Any]] = []
        pending_admission_numbers: set[str] = set()

        for student_data in valid_students:
            roll_number = str(student_data["roll_no"]).strip()
            normalized_roll_number = roll_number.lower()
            if normalized_roll_number in existing_roll_numbers:
                skipped_count += 1
                errors.append({
                    "roll_no": roll_number,
                    "error": "Student already exists",
                })
                continue

            admission_no = str(student_data.get("admission_id") or "").strip()
            normalized_admission_no = admission_no.lower()
            if admission_no and (
                normalized_admission_no in existing_admission_numbers
                or normalized_admission_no in pending_admission_numbers
            ):
                skipped_count += 1
                errors.append({
                    "roll_no": roll_number,
                    "admission_no": admission_no,
                    "error": "Admission ID already exists",
                })
                continue

            batch_name = str(student_data.get("batch") or "").strip()
            matched_batch = batch_by_name.get(batch_name.lower())
            class_name = str(student_data.get("class_name") or "").strip()
            section = str(student_data.get("section") or "").strip()
            if not class_name and batch_name:
                class_name, section = split_batch_to_class_section(batch_name)
            if is_class_only_upload_name(batch_name) and class_name:
                matched_batch = None

            normalized_class_name = class_name or None
            normalized_section = section or None
            metadata = build_student_import_metadata(student_data, batch_name)
            guardian_name = (student_data.get("guardian_name") or "").strip() or (student_data.get("father_name") or "").strip() or None
            guardian_phone = (student_data.get("guardian_mobile") or "").strip() or (student_data.get("father_mobile") or "").strip() or None

            pending_students.append(
                {
                    "school_id": school_id,
                    "batch_id": matched_batch["id"] if matched_batch else None,
                    "admission_no": admission_no or None,
                    "roll_number": roll_number,
                    "full_name": str(student_data["candidate_name"]).strip(),
                    "father_name": (student_data.get("father_name") or "").strip() or None,
                    "mother_name": (student_data.get("mother_name") or "").strip() or None,
                    "email": (student_data.get("email") or "").strip() or None,
                    "phone": (student_data.get("phone") or "").strip() or None,
                    "guardian_name": guardian_name,
                    "guardian_phone": guardian_phone,
                    "class_name": normalized_class_name,
                    "section": normalized_section,
                    "academic_session": (student_data.get("academic_session") or "").strip() or None,
                    "date_of_birth": (student_data.get("dob") or "").strip() or None,
                    "gender": (student_data.get("gender") or "").strip() or None,
                    "special_needs": (student_data.get("special_needs") or "").strip() or None,
                    "boarding_type": (student_data.get("boarding_type") or "").strip() or None,
                    "hostel_required": bool(student_data.get("hostel_required", False)),
                    "metadata": metadata,
                    "is_active": True,
                }
            )
            existing_roll_numbers.add(normalized_roll_number)
            if normalized_admission_no:
                pending_admission_numbers.add(normalized_admission_no)
                existing_admission_numbers.add(normalized_admission_no)

        if pending_students:
            for student_row in pending_students:
                try:
                    insert_rows(supabase, "students", [student_row])
                    imported_count += 1
                except Exception as exc:
                    skipped_count += 1
                    errors.append({
                        "roll_no": student_row.get("roll_number"),
                        "admission_no": student_row.get("admission_no"),
                        "student_name": student_row.get("full_name"),
                        "batch": student_row.get("metadata", {}).get("managed_batch"),
                        "error": f"Failed to import student into Supabase: {format_bulk_import_exception(exc)}",
                    })
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Student bulk import failed: {format_bulk_import_exception(exc)}",
        ) from exc

    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {imported_count}")
    return StudentImportResponse(
        imported_count=imported_count,
        skipped_count=skipped_count,
        errors=errors,
        message=f"Imported {imported_count} students, skipped {skipped_count}"
    )


@router.post("", response_model=StudentResponse)
async def create_student(
    student: StudentCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Create a new student
    """
    if is_uuid_school_id(school_id):
        payload = student.dict(exclude_unset=True)
        payload["preferred_hostel_id"] = str(payload["preferred_hostel_id"]).strip() if payload.get("preferred_hostel_id") is not None else None
        db_student = upsert_student_supabase(school_id, payload)
        if db_student.get("hostel_required") and db_student.get("preferred_hostel_id"):
            create_or_update_hostel_request_supabase(
                school_id,
                str(db_student["id"]).strip(),
                hostel_id=str(db_student["preferred_hostel_id"]).strip(),
                requested_notes=payload.get("hostel_notes"),
            )
            db_student = get_student_supabase(school_id, str(db_student["id"]).strip())
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return db_student

    ensure_students_legacy_routes_available(school_id)
    # Check if roll number already exists
    existing = db.query(Student).filter(
        Student.roll_number == student.roll_number,
        Student.school_id == school_id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student with this roll number already exists"
        )

    batch = get_or_create_batch(db, school_id, student.batch, category="batch")
    normalized_class_name = normalize_student_class_name(student.class_name, student.batch)
    normalized_section = (student.section or "").strip() or None
    if normalized_class_name:
        get_or_create_batch(db, school_id, normalized_class_name, category="class")

    # Create student
    db_student = Student(
        roll_number=student.roll_number,
        name=student.name,
        father_name=student.father_name,
        batch=batch.name,
        batch_id=batch.id,
        class_name=normalized_class_name,
        section=normalized_section,
        academic_session=student.academic_session,
        email=student.email,
        phone=student.phone,
        special_needs=student.special_needs,
        boarding_type=student.boarding_type,
        hostel_required=student.hostel_required,
        preferred_hostel_id=student.preferred_hostel_id,
        hostel_request_status="pending" if student.hostel_required and student.preferred_hostel_id else (student.hostel_request_status or "not_requested"),
        hostel_notes=student.hostel_notes,
        reference_name=student.reference_name,
        reference_number=student.reference_number,
        reference_remark=student.reference_remark,
        school_id=school_id,
    )
    db.add(db_student)
    db.commit()
    db.refresh(db_student)
    if db_student.hostel_required and db_student.preferred_hostel_id:
        request = StudentHostelRequest(
            school_id=school_id,
            student_id=db_student.id,
            hostel_id=db_student.preferred_hostel_id,
            requested_notes=student.hostel_notes,
            status="pending",
        )
        db.add(request)
        db.commit()
        db.refresh(db_student)

    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_student(db_student)


@router.get("", response_model=List[StudentResponse])
async def list_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    skip: int = 0,
    limit: int = 100,
    batch: str = None,
    db: Session = Depends(get_db),
):
    """
    List students for a school
    """
    if not is_legacy_sqlite_mode():
        return list_students_supabase(school_id, batch=batch, skip=skip, limit=limit)

    ensure_students_legacy_routes_available(school_id)
    query = db.query(Student).filter(Student.school_id == school_id)
    
    if batch:
        query = query.filter(Student.batch == batch)
    
    students = query.offset(skip).limit(limit).all()
    
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(students)}")
    return [serialize_student(student) for student in students]


@router.get("/count")
async def get_students_count(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode() or is_uuid_school_id(school_id):
        total = get_supabase_students_count(school_id)
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {total}")
        return total

    ensure_students_legacy_routes_available(school_id)
    total = db.query(Student).filter(Student.school_id == school_id).count()
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {total}")
    return total

@router.get("/hostel-requests", response_model=List[StudentHostelRequestResponse])
async def list_hostel_requests(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    status_filter: str | None = None,
    db: Session = Depends(get_db),
):
    if is_uuid_school_id(school_id):
        requests = list_hostel_requests_supabase(school_id, status_filter=status_filter)
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(requests)}")
        return requests
    ensure_students_legacy_routes_available(school_id)
    try:
        query = (
            db.query(StudentHostelRequest)
            .options(
                selectinload(StudentHostelRequest.student),
                selectinload(StudentHostelRequest.hostel),
                selectinload(StudentHostelRequest.room),
            )
            .filter(StudentHostelRequest.school_id == school_id)
        )
        if status_filter:
            query = query.filter(StudentHostelRequest.status == status_filter)
        requests = query.order_by(StudentHostelRequest.requested_at.desc(), StudentHostelRequest.id.desc()).all()
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(requests)}")
        return [serialize_hostel_request(item) for item in requests]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load hostel requests: {exc}") from exc


@router.post("/{student_id}/hostel-request", response_model=StudentHostelRequestResponse)
async def create_or_update_hostel_request(
    student_id: str,
    payload: StudentHostelRequestCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if is_uuid_school_id(school_id):
        request = create_or_update_hostel_request_supabase(
            school_id,
            str(student_id).strip(),
            hostel_id=str(payload.hostel_id),
            requested_notes=payload.requested_notes,
        )
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return request
    ensure_students_legacy_routes_available(school_id)
    try:
        legacy_student_id = int(str(student_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Student not found")
    student = db.query(Student).filter(Student.id == legacy_student_id, Student.school_id == school_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    hostel = db.query(Hostel).filter(Hostel.id == payload.hostel_id, Hostel.school_id == school_id, Hostel.is_active == True).first()
    if not hostel:
        raise HTTPException(status_code=404, detail="Hostel not found")

    request = db.query(StudentHostelRequest).filter(
        StudentHostelRequest.student_id == legacy_student_id,
        StudentHostelRequest.status.in_(["pending", "approved"]),
    ).order_by(StudentHostelRequest.id.desc()).first()

    if request and request.status == "approved":
        raise HTTPException(status_code=400, detail="Hostel already allocated for this student")

    if request:
        request.hostel_id = hostel.id
        request.requested_notes = payload.requested_notes
        request.status = "pending"
        request.reviewed_by = None
        request.review_notes = None
        request.reviewed_at = None
        request.room_id = None
        request.assigned_bed_label = None
    else:
        request = StudentHostelRequest(
            school_id=school_id,
            student_id=legacy_student_id,
            hostel_id=hostel.id,
            requested_notes=payload.requested_notes,
            status="pending",
        )
        db.add(request)

    student.hostel_required = True
    student.preferred_hostel_id = hostel.id
    student.hostel_request_status = "pending"
    student.hostel_notes = payload.requested_notes
    student.assigned_hostel_id = None
    student.assigned_room_id = None
    student.assigned_bed_label = None
    db.commit()
    db.refresh(request)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_hostel_request(request)


@router.post("/hostel-requests/{request_id}/approve", response_model=StudentHostelRequestResponse)
async def approve_hostel_request(
    request_id: str,
    payload: StudentHostelRequestDecision,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if is_uuid_school_id(school_id):
        request = approve_hostel_request_supabase(
            school_id,
            str(request_id).strip(),
            actor_profile_id=actor.get("profile_id"),
            hostel_id=str(payload.hostel_id).strip() if payload.hostel_id is not None else None,
            room_id=str(payload.room_id).strip() if payload.room_id is not None else None,
            review_notes=payload.review_notes,
        )
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return request
    ensure_students_legacy_routes_available(school_id)
    request = db.query(StudentHostelRequest).filter(
        StudentHostelRequest.id == request_id,
        StudentHostelRequest.school_id == school_id,
    ).first()
    if not request:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    if request.status == "approved":
        raise HTTPException(status_code=400, detail="Hostel request already approved")

    if payload.hostel_id:
        target_hostel = db.query(Hostel).filter(
            Hostel.id == payload.hostel_id,
            Hostel.school_id == school_id,
            Hostel.is_active == True,
        ).first()
        if not target_hostel:
            raise HTTPException(status_code=404, detail="Selected hostel not found")
        request.hostel_id = target_hostel.id

    room_query = db.query(HostelRoom).filter(
        HostelRoom.hostel_id == request.hostel_id,
        HostelRoom.is_active == True,
    )
    if payload.room_id:
        room_query = room_query.filter(HostelRoom.id == payload.room_id)

    room = room_query.order_by(HostelRoom.room_number.asc()).first()
    if not room:
        raise HTTPException(status_code=400, detail="No hostel room available for allocation")
    if int(room.occupied_beds or 0) >= int(room.total_beds or 0):
        raise HTTPException(status_code=400, detail="Selected room is already full")

    student = request.student
    previous_room_id = student.assigned_room_id
    if previous_room_id and previous_room_id != room.id:
        sync_hostel_room_occupancy(db, previous_room_id)

    room.occupied_beds = int(room.occupied_beds or 0) + 1
    assigned_bed_label = build_next_bed_label(room)

    request.status = "approved"
    request.room_id = room.id
    request.assigned_bed_label = assigned_bed_label
    request.reviewed_by = payload.reviewed_by or request.hostel.hostel_head or request.hostel.warden_name
    request.review_notes = payload.review_notes
    request.reviewed_at = datetime.now(timezone.utc)

    student.hostel_required = True
    student.hostel_request_status = "approved"
    student.assigned_hostel_id = request.hostel_id
    student.assigned_room_id = room.id
    student.assigned_bed_label = assigned_bed_label
    student.hostel_notes = request.requested_notes
    db.commit()
    _sync_supabase_student_hostel(
        school_id, student.roll_number, "approved",
        assigned_hostel_id=student.assigned_hostel_id,
        assigned_room_id=student.assigned_room_id,
        assigned_bed_label=assigned_bed_label,
        hostel_notes=student.hostel_notes,
        db=db,
    )
    db.refresh(request)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_hostel_request(request)


@router.post("/hostel-requests/{request_id}/move", response_model=StudentHostelRequestResponse)
async def move_hostel_allocation(
    request_id: str,
    payload: StudentHostelRequestDecision,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if is_uuid_school_id(school_id):
        request = move_hostel_allocation_supabase(
            school_id,
            str(request_id).strip(),
            actor_profile_id=actor.get("profile_id"),
            hostel_id=str(payload.hostel_id).strip() if payload.hostel_id is not None else None,
            room_id=str(payload.room_id).strip() if payload.room_id is not None else None,
            review_notes=payload.review_notes,
        )
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return request
    ensure_students_legacy_routes_available(school_id)
    request = db.query(StudentHostelRequest).filter(
        StudentHostelRequest.id == request_id,
        StudentHostelRequest.school_id == school_id,
    ).first()
    if not request:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    if request.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved hostel allocations can be moved")

    target_hostel_id = payload.hostel_id or request.hostel_id
    target_hostel = db.query(Hostel).filter(
        Hostel.id == target_hostel_id,
        Hostel.school_id == school_id,
        Hostel.is_active == True,
    ).first()
    if not target_hostel:
        raise HTTPException(status_code=404, detail="Selected hostel not found")

    room_query = db.query(HostelRoom).filter(
        HostelRoom.hostel_id == target_hostel.id,
        HostelRoom.is_active == True,
    )
    if payload.room_id:
        room_query = room_query.filter(HostelRoom.id == payload.room_id)

    room = room_query.order_by(HostelRoom.room_number.asc()).first()
    if not room:
        raise HTTPException(status_code=400, detail="No hostel room available for move")
    if int(room.occupied_beds or 0) >= int(room.total_beds or 0) and room.id != request.room_id:
        raise HTTPException(status_code=400, detail="Selected room is already full")

    student = request.student
    previous_room_id = request.room_id
    previous_hostel_id = request.hostel_id

    request.hostel_id = target_hostel.id
    request.room_id = room.id
    request.assigned_bed_label = build_next_bed_label(room) if room.id != previous_room_id else request.assigned_bed_label
    request.reviewed_by = payload.reviewed_by or request.reviewed_by or target_hostel.hostel_head or target_hostel.warden_name
    request.review_notes = payload.review_notes
    request.reviewed_at = datetime.now(timezone.utc)

    student.hostel_required = True
    student.preferred_hostel_id = target_hostel.id
    student.hostel_request_status = "approved"
    student.assigned_hostel_id = target_hostel.id
    student.assigned_room_id = room.id
    student.assigned_bed_label = request.assigned_bed_label

    sync_hostel_room_occupancy(db, previous_room_id)
    sync_hostel_room_occupancy(db, room.id)
    db.commit()
    _sync_supabase_student_hostel(
        school_id, student.roll_number, "approved",
        assigned_hostel_id=student.assigned_hostel_id,
        assigned_room_id=student.assigned_room_id,
        assigned_bed_label=student.assigned_bed_label,
        db=db,
    )
    db.refresh(request)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_hostel_request(request)


@router.post("/hostel-requests/{request_id}/reject", response_model=StudentHostelRequestResponse)
async def reject_hostel_request(
    request_id: str,
    payload: StudentHostelRequestDecision,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if is_uuid_school_id(school_id):
        request = reject_hostel_request_supabase(
            school_id,
            str(request_id).strip(),
            actor_profile_id=actor.get("profile_id"),
            review_notes=payload.review_notes,
        )
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return request
    ensure_students_legacy_routes_available(school_id)
    request = db.query(StudentHostelRequest).filter(
        StudentHostelRequest.id == request_id,
        StudentHostelRequest.school_id == school_id,
    ).first()
    if not request:
        raise HTTPException(status_code=404, detail="Hostel request not found")

    request.status = "rejected"
    request.reviewed_by = payload.reviewed_by or request.hostel.hostel_head or request.hostel.warden_name
    request.review_notes = payload.review_notes
    request.reviewed_at = datetime.now(timezone.utc)

    student = request.student
    previous_room_id = student.assigned_room_id if student else None
    if student:
        student.hostel_request_status = "rejected"
        student.assigned_hostel_id = None
        student.assigned_room_id = None
        student.assigned_bed_label = None

    sync_hostel_room_occupancy(db, previous_room_id)
    db.commit()
    if student:
        _sync_supabase_student_hostel(
            school_id, student.roll_number, "rejected",
            assigned_room_id=None,
            db=db,
        )
    db.refresh(request)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_hostel_request(request)

@router.post("/hostel-requests/{request_id}/vacate", response_model=StudentHostelRequestResponse)
async def vacate_hostel_allocation(
    request_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """Vacate a hostel allocation — releases the bed while preserving request history.

    The request status stays 'approved' (historical record) but the room
    assignment and bed label are cleared, making the bed available for
    re-allocation.
    """
    if is_uuid_school_id(school_id):
        request = vacate_hostel_allocation_supabase(
            school_id,
            str(request_id).strip(),
            actor_profile_id=actor.get("profile_id"),
        )
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return request
    ensure_students_legacy_routes_available(school_id)
    request = db.query(StudentHostelRequest).filter(
        StudentHostelRequest.id == request_id,
        StudentHostelRequest.school_id == school_id,
    ).first()
    if not request:
        raise HTTPException(status_code=404, detail="Hostel request not found")
    if request.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved hostel allocations can be vacated")

    previous_room_id = request.room_id
    request.status = "vacated"
    request.room_id = None
    request.assigned_bed_label = None
    request.reviewed_by = actor.get("user_id") or request.reviewed_by
    request.review_notes = "Vacated"
    request.reviewed_at = datetime.now(timezone.utc)

    student = request.student
    if student:
        student.assigned_hostel_id = None
        student.assigned_room_id = None
        student.assigned_bed_label = None
        student.hostel_request_status = "vacated"

    sync_hostel_room_occupancy(db, previous_room_id)
    db.commit()
    if student:
        _sync_supabase_student_hostel(
            school_id, student.roll_number, "vacated",
            assigned_room_id=None,
            db=db,
        )
    db.refresh(request)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_hostel_request(request)


@router.post("/transfer", response_model=StudentBatchTransferResponse)
async def transfer_students_to_batch(
    transfer_data: StudentBatchTransferRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Transfer selected students or a whole batch to another batch.
    """
    ensure_students_legacy_routes_available(school_id)
    target_batch = get_or_create_batch(db, school_id, transfer_data.target_batch)
    normalized_source_batch = (transfer_data.source_batch or "").strip() or None

    if transfer_data.transfer_all_from_batch:
        if not normalized_source_batch:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Source batch is required when transferring all students from a batch",
            )

        if normalized_source_batch.lower() == target_batch.name.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Source batch and target batch cannot be the same",
            )

        students_to_transfer = db.query(Student).filter(
            Student.school_id == school_id,
            Student.batch == normalized_source_batch,
        ).all()
    else:
        if not transfer_data.student_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select at least one student to transfer",
            )

        students_to_transfer = db.query(Student).filter(
            Student.school_id == school_id,
            Student.id.in_(transfer_data.student_ids),
        ).all()

        if len(students_to_transfer) != len(set(transfer_data.student_ids)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more selected students were not found",
            )

        if all((student.batch or "").lower() == target_batch.name.lower() for student in students_to_transfer):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected students are already in the target batch",
            )

    if not students_to_transfer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No students found to transfer",
        )

    source_batches_before_transfer = sorted({student.batch for student in students_to_transfer if student.batch})

    for student in students_to_transfer:
        student.batch = target_batch.name
        student.batch_id = target_batch.id

    db.commit()
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: {len(students_to_transfer)}")

    source_batch_label = normalized_source_batch
    if not source_batch_label and len(source_batches_before_transfer) == 1:
        source_batch_label = source_batches_before_transfer[0]

    return StudentBatchTransferResponse(
        transferred_count=len(students_to_transfer),
        source_batch=source_batch_label,
        target_batch=target_batch.name,
        message=f"{len(students_to_transfer)} student(s) transferred to {target_batch.name}",
    )


@router.get("/{student_id}", response_model=StudentResponse)
async def get_student(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Get student by ID
    """
    if not is_legacy_sqlite_mode():
        return get_student_supabase(school_id, student_id)

    try:
        legacy_student_id = int(str(student_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Student not found")

    student = db.query(Student).filter(Student.id == legacy_student_id, Student.school_id == school_id).first()
    
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_student(student)


@router.post("/bulk-delete")
async def bulk_delete_students(
    payload: StudentBulkDeleteRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    summary = delete_students_supabase(school_id, payload.student_ids)
    logger.info(
        "Action completed - User ID: %s, School ID: %s, Bulk deleted %s/%s students, Remaining matched: %s",
        actor.get("user_id"),
        school_id,
        summary["deleted"],
        summary["matched"],
        summary["remaining"],
    )
    return {
        "message": f"Deleted {summary['deleted']} of {summary['matched']} selected students",
        **summary,
    }


@router.put("/{student_id}", response_model=StudentResponse)
async def update_student(
    student_id: str,
    update_data: StudentUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    """
    Update student information
    """
    if is_uuid_school_id(school_id):
        existing_student = get_student_supabase(school_id, student_id)
        payload = existing_student | update_data.dict(exclude_unset=True)
        payload["preferred_hostel_id"] = str(payload["preferred_hostel_id"]).strip() if payload.get("preferred_hostel_id") is not None else None
        updated_student = upsert_student_supabase(school_id, payload)
        if updated_student.get("hostel_required") and updated_student.get("preferred_hostel_id"):
            create_or_update_hostel_request_supabase(
                school_id,
                str(updated_student["id"]).strip(),
                hostel_id=str(updated_student["preferred_hostel_id"]).strip(),
                requested_notes=payload.get("hostel_notes"),
            )
            updated_student = get_student_supabase(school_id, str(updated_student["id"]).strip())
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
        return updated_student

    ensure_students_legacy_routes_available(school_id)
    try:
        legacy_student_id = int(str(student_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Student not found")
    student = db.query(Student).filter(Student.id == legacy_student_id, Student.school_id == school_id).first()
    
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Update fields
    update_dict = update_data.dict(exclude_unset=True)
    if 'roll_number' in update_dict and update_dict['roll_number'] is not None:
        normalized_roll_number = update_dict['roll_number'].strip()
        if not normalized_roll_number:
            raise HTTPException(status_code=400, detail="Roll number cannot be empty")

        existing_student = db.query(Student).filter(
            Student.roll_number == normalized_roll_number,
            Student.id != student.id,
            Student.school_id == student.school_id,
        ).first()
        if existing_student:
            raise HTTPException(status_code=400, detail="Student with this roll number already exists")

        update_dict['roll_number'] = normalized_roll_number

    if 'batch' in update_dict and update_dict['batch'] is not None:
        batch = get_or_create_batch(db, student.school_id, update_dict['batch'], category="batch")
        update_dict['batch'] = batch.name
        update_dict['batch_id'] = batch.id

    if 'class_name' in update_dict:
        normalized_class_name = normalize_student_class_name(update_dict['class_name'], update_dict.get('batch', student.batch))
        update_dict['class_name'] = normalized_class_name or None
        if normalized_class_name:
            get_or_create_batch(db, student.school_id, normalized_class_name, category="class")

    if 'section' in update_dict:
        normalized_section = (update_dict['section'] or '').strip()
        update_dict['section'] = normalized_section or None

    if "preferred_hostel_id" in update_dict and not update_dict.get("hostel_required", student.hostel_required):
        update_dict["preferred_hostel_id"] = None

    if "hostel_required" in update_dict and update_dict["hostel_required"] is False:
        if student.assigned_room_id:
            sync_hostel_room_occupancy(db, student.assigned_room_id)
        update_dict["hostel_request_status"] = "not_requested"
        update_dict["preferred_hostel_id"] = None
        update_dict["assigned_hostel_id"] = None
        update_dict["assigned_room_id"] = None
        update_dict["assigned_bed_label"] = None

    for key, value in update_dict.items():
        setattr(student, key, value)
    
    db.commit()
    db.refresh(student)

    if student.hostel_required and student.preferred_hostel_id and student.hostel_request_status in {"not_requested", "", None}:
        request = StudentHostelRequest(
            school_id=student.school_id,
            student_id=student.id,
            hostel_id=student.preferred_hostel_id,
            requested_notes=student.hostel_notes,
            status="pending",
        )
        db.add(request)
        student.hostel_request_status = "pending"
        db.commit()
        db.refresh(student)

    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Returned row count: 1")
    return serialize_student(student)


@router.delete("/{student_id}")
async def delete_student(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    """
    Delete student from Supabase
    """
    delete_student_supabase(school_id, student_id)
    logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Deleted student {student_id}")
    return {"message": "Student deleted"}


@router.delete("")
async def delete_all_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
):
    """
    Delete all students for a school from Supabase.
    """
    if is_platform_admin_user(user):
        deleted_count = delete_all_students_supabase(school_id)
        logger.info(f"Action completed - User ID: {actor.get('user_id')}, School ID: {school_id}, Deleted {deleted_count} students")
        return {
            "message": f"All {deleted_count} students deleted successfully",
            "deleted_count": deleted_count,
        }
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="Authenticated profile is required")
    request = create_bulk_action_request(
        school_id=school_id,
        module_name="students",
        action_type="delete_all",
        requested_by_profile_id=profile_id,
        requested_role=str(actor.get("role") or "viewer"),
        reason="Delete all students requires Super Admin approval.",
        payload_json={"operation": "students.delete_all_students"},
    )
    return _bulk_action_response(request, message="Bulk action request created and sent for Super Admin approval.")
