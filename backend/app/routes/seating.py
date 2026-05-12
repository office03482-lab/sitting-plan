"""
Seating plan generation routes
"""
import json
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Dict, List
from app.database import get_db
from app.models import SeatingPlan, Exam, Room, Student, Desk, Seat
from app.schemas import GenerateSeatingRequest, SeatingPlanResponse, PlansComparisonResponse, RoomLayout, DeskLayout, SeatPosition, SeatingPlanImportResponse
from app.services.seating_engine import SeatingAlgorithmEngine
from app.utils.excel import parse_seating_plan_excel, create_seating_plan_template

router = APIRouter()


def interleave_students_by_batch(students: List[Dict]) -> List[Dict]:
    students_by_batch: Dict[str, List[Dict]] = {}
    for student in students:
        batch_name = str(student.get("batch") or "").strip() or "Unassigned"
        students_by_batch.setdefault(batch_name, []).append(student)

    ordered_batches = sorted(
        students_by_batch.keys(),
        key=lambda batch: len(students_by_batch[batch]),
        reverse=True,
    )

    ordered_students: List[Dict] = []
    forward_pass = True
    while any(students_by_batch.values()):
        batch_pass = ordered_batches if forward_pass else list(reversed(ordered_batches))
        for batch in batch_pass:
            if students_by_batch[batch]:
                ordered_students.append(students_by_batch[batch].pop(0))
        forward_pass = not forward_pass

    return ordered_students


def select_room_candidates(pending_students: List[Dict], seat_capacity: int) -> List[Dict]:
    if seat_capacity <= 0 or not pending_students:
        return []

    grouped_students: Dict[str, List[Dict]] = {}
    for student in interleave_students_by_batch(pending_students):
        batch_name = str(student.get("batch") or "").strip() or "Unassigned"
        grouped_students.setdefault(batch_name, []).append(student)

    candidate_limit = min(
        len(pending_students),
        seat_capacity + min(max(seat_capacity // 4, 6), 18),
    )
    selected_students: List[Dict] = []
    selected_batch_counts: Dict[str, int] = {}
    forward_pass = True

    while len(selected_students) < candidate_limit and any(grouped_students.values()):
        ordered_batches = sorted(
            grouped_students.keys(),
            key=lambda batch: (
                selected_batch_counts.get(batch, 0),
                -len(grouped_students[batch]),
                batch,
            ),
        )
        batch_pass = ordered_batches if forward_pass else list(reversed(ordered_batches))
        for batch in batch_pass:
            if len(selected_students) >= candidate_limit:
                break
            if not grouped_students[batch]:
                continue
            selected_students.append(grouped_students[batch].pop(0))
            selected_batch_counts[batch] = selected_batch_counts.get(batch, 0) + 1
        forward_pass = not forward_pass

    return selected_students


def allocate_students_to_room_pools(
    students: List[Dict],
    room_contexts: List[Dict],
) -> Dict[int, List[Dict]]:
    room_pools: Dict[int, List[Dict]] = {int(context["room_id"]): [] for context in room_contexts}
    room_batch_counts: Dict[int, Dict[str, int]] = {int(context["room_id"]): {} for context in room_contexts}
    room_capacities: Dict[int, int] = {
        int(context["room_id"]): max(int(context.get("seat_capacity", 0)), 0)
        for context in room_contexts
    }
    students_by_batch: Dict[str, List[Dict]] = {}
    for student in students:
        batch_name = str(student.get("batch") or "").strip() or "Unassigned"
        students_by_batch.setdefault(batch_name, []).append(student)

    ordered_batches = sorted(
        students_by_batch.keys(),
        key=lambda batch: len(students_by_batch[batch]),
        reverse=True,
    )

    for batch_name in ordered_batches:
        batch_students = list(students_by_batch[batch_name])
        while batch_students:
            candidate_rooms = [
                context
                for context in room_contexts
                if len(room_pools[int(context["room_id"])]) < room_capacities[int(context["room_id"])]
            ]
            if not candidate_rooms:
                break

            candidate_rooms.sort(
                key=lambda context: (
                    room_batch_counts[int(context["room_id"])].get(batch_name, 0),
                    len(room_pools[int(context["room_id"])]) / max(room_capacities[int(context["room_id"])], 1),
                    len(room_pools[int(context["room_id"])]),
                    int(context.get("sequence", 0)),
                )
            )

            selected_room_id = int(candidate_rooms[0]["room_id"])
            room_pools[selected_room_id].append(batch_students.pop(0))
            room_batch_counts[selected_room_id][batch_name] = room_batch_counts[selected_room_id].get(batch_name, 0) + 1

    return {
        room_id: interleave_students_by_batch(room_students)
        for room_id, room_students in room_pools.items()
    }


def serialize_seating_plan(plan: SeatingPlan) -> SeatingPlanResponse:
    validation_errors = None
    if plan.validation_errors:
        if isinstance(plan.validation_errors, list):
            validation_errors = plan.validation_errors
        else:
            try:
                parsed = json.loads(plan.validation_errors)
                if isinstance(parsed, list):
                    validation_errors = [str(item) for item in parsed]
                else:
                    validation_errors = [str(parsed)]
            except Exception:
                validation_errors = [str(plan.validation_errors)]

    batches: List[str] = []
    batch_distribution: List[Dict] = []
    if plan.batch_distribution:
        try:
            parsed_batches = json.loads(plan.batch_distribution)
            if isinstance(parsed_batches, dict):
                batches = [str(item) for item in parsed_batches.keys()]
                total_students = sum(int(value or 0) for value in parsed_batches.values()) or 0
                batch_distribution = [
                    {
                        "batch": str(batch_name),
                        "count": int(count or 0),
                        "percentage": round((int(count or 0) / total_students) * 100, 2) if total_students else 0.0,
                    }
                    for batch_name, count in parsed_batches.items()
                ]
            elif isinstance(parsed_batches, list):
                batches = [str(item) for item in parsed_batches]
        except Exception:
            batches = []
            batch_distribution = []

    return SeatingPlanResponse(
        id=plan.id,
        exam_id=plan.exam_id,
        room_id=plan.room_id,
        exam_name=plan.exam.name if plan.exam else None,
        exam_subject=plan.exam.subject if plan.exam else None,
        room_name=plan.room.name if plan.room else None,
        batches=batches,
        batch_distribution=batch_distribution,
        name=plan.name,
        plan_type=str(plan.plan_type.value if hasattr(plan.plan_type, "value") else plan.plan_type),
        status=str(plan.status.value if hasattr(plan.status, "value") else plan.status),
        students_assigned=plan.students_assigned or 0,
        is_valid=bool(plan.is_valid),
        validation_errors=validation_errors,
        created_at=plan.created_at,
    )


@router.post("/generate")
async def generate_seating_plans(
    request: GenerateSeatingRequest,
    db: Session = Depends(get_db),
):
    """
    Generate seating plans for the requested plan type.
    """
    # Get exam and students
    exam = db.query(Exam).filter(Exam.id == request.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    
    students_query = db.query(Student).filter(Student.is_active == True)
    if request.batches:
        students_query = students_query.filter(Student.batch.in_(request.batches))
    students = (
        students_query
        .order_by(Student.batch.asc(), Student.roll_number.asc(), Student.id.asc())
        .all()
    )
    
    if not students:
        raise HTTPException(status_code=400, detail="No students found")
    
    # Convert to dict for algorithm
    students_data = [
        {
            'id': s.id,
            'name': s.name,
            'roll_number': s.roll_number,
            'batch': s.batch,
            'email': s.email,
        }
        for s in students
    ]
    
    batch_distribution = {}
    for item in students_data:
        batch_name = item.get('batch') or 'Unassigned'
        batch_distribution[batch_name] = batch_distribution.get(batch_name, 0) + 1

    batch_label = ", ".join(request.batches) if request.batches else ", ".join(batch_distribution.keys())

    # Initialize algorithm
    engine = SeatingAlgorithmEngine()
    
    requested_plan_type = (request.plan_type or "").strip().lower()
    if requested_plan_type in {"strict", "compact", "all_in_one"}:
        requested_plan_types = [requested_plan_type]
    else:
        requested_plan_type = "all_in_one"
        requested_plan_types = [requested_plan_type]

    room_contexts: List[Dict] = []
    for room_id in request.room_ids:
        room = db.query(Room).filter(Room.id == room_id).first()
        if not room:
            continue

        desks = db.query(Desk).filter(
            Desk.room_id == room_id,
            Desk.is_reserved == False
        ).order_by(Desk.row.asc(), Desk.col.asc(), Desk.id.asc()).all()

        num_desks = len(desks)
        room_contexts.append(
            {
                "room_id": room_id,
                "room": room,
                "desks": desks,
                "num_desks": num_desks,
                "seat_capacity": max(num_desks * 2, 0),
                "desk_positions": {
                    index: (int(desk.row), int(desk.col))
                    for index, desk in enumerate(desks)
                },
                "sequence": len(room_contexts),
            }
        )

    room_student_pools = allocate_students_to_room_pools(students_data, room_contexts)

    # Generate plans for each room from the pre-balanced room pools
    plans = []

    for context in room_contexts:
        room_id = int(context["room_id"])
        room = context["room"]
        num_desks = int(context["num_desks"])
        desk_positions = context["desk_positions"]

        generated_for_room = {
            'room_id': room_id,
            'plans': [],
            'data': [],
        }

        room_students_data = list(room_student_pools.get(room_id, []))
        if not room_students_data:
            plans.append(generated_for_room)
            continue

        if "all_in_one" in requested_plan_types:
            all_in_one_result = engine.generate_all_in_one_plan(
                room_students_data,
                num_desks,
                desk_positions=desk_positions,
                batch_conflict_groups=request.batch_conflict_groups,
            )
            all_in_one_assigned_ids = {
                student['id']
                for assigned_students in all_in_one_result.get('assignment', {}).values()
                for student in assigned_students
            }
            all_in_one_assigned_students = [student for student in room_students_data if student['id'] in all_in_one_assigned_ids]
            all_in_one_batch_distribution = {}
            for item in all_in_one_assigned_students:
                batch_name = item.get('batch') or 'Unassigned'
                all_in_one_batch_distribution[batch_name] = all_in_one_batch_distribution.get(batch_name, 0) + 1
            all_in_one_plan = SeatingPlan(
                exam_id=exam.id,
                room_id=room_id,
                name=f"{room.name} - Batches: {batch_label} - All-in-One Plan",
                plan_type="all_in_one",
                status="draft",
                students_assigned=len(all_in_one_assigned_students),
                batch_distribution=json.dumps(all_in_one_batch_distribution),
                plan_data=json.dumps(all_in_one_result),
                validation_errors=json.dumps(all_in_one_result.get('errors', [])),
                is_valid=all_in_one_result['validity'],
                algorithm_version=request.algorithm_version,
            )
            db.add(all_in_one_plan)
            generated_for_room['plans'].append(all_in_one_plan)
            generated_for_room['data'].append(all_in_one_result)

        if "strict" in requested_plan_types:
            strict_result = engine.generate_strict_plan(
                room_students_data,
                num_desks,
                desk_positions=desk_positions,
                batch_conflict_groups=request.batch_conflict_groups,
            )
            strict_assigned_ids = {
                student['id']
                for assigned_students in strict_result.get('assignment', {}).values()
                for student in assigned_students
            }
            strict_assigned_students = [student for student in room_students_data if student['id'] in strict_assigned_ids]
            strict_batch_distribution = {}
            for item in strict_assigned_students:
                batch_name = item.get('batch') or 'Unassigned'
                strict_batch_distribution[batch_name] = strict_batch_distribution.get(batch_name, 0) + 1
            strict_plan = SeatingPlan(
                exam_id=exam.id,
                room_id=room_id,
                name=f"{room.name} - Batches: {batch_label} - Plan A (Strict)",
                plan_type="strict",
                status="draft",
                students_assigned=len(strict_assigned_students),
                batch_distribution=json.dumps(strict_batch_distribution),
                plan_data=json.dumps(strict_result),
                validation_errors=json.dumps(strict_result.get('errors', [])),
                is_valid=strict_result['validity'],
                algorithm_version=request.algorithm_version,
            )
            db.add(strict_plan)
            generated_for_room['plans'].append(strict_plan)
            generated_for_room['data'].append(strict_result)

        if "compact" in requested_plan_types:
            compact_result = engine.generate_compact_plan(
                room_students_data,
                num_desks,
                desk_positions=desk_positions,
                batch_conflict_groups=request.batch_conflict_groups,
            )
            compact_assigned_ids = {
                student['id']
                for assigned_students in compact_result.get('assignment', {}).values()
                for student in assigned_students
            }
            compact_assigned_students = [student for student in room_students_data if student['id'] in compact_assigned_ids]
            compact_batch_distribution = {}
            for item in compact_assigned_students:
                batch_name = item.get('batch') or 'Unassigned'
                compact_batch_distribution[batch_name] = compact_batch_distribution.get(batch_name, 0) + 1
            compact_plan = SeatingPlan(
                exam_id=exam.id,
                room_id=room_id,
                name=f"{room.name} - Batches: {batch_label} - Plan B (Compact)",
                plan_type="compact",
                status="draft",
                students_assigned=len(compact_assigned_students),
                batch_distribution=json.dumps(compact_batch_distribution),
                plan_data=json.dumps(compact_result),
                validation_errors=json.dumps(compact_result.get('errors', [])),
                is_valid=compact_result['validity'],
                algorithm_version=request.algorithm_version,
            )
            db.add(compact_plan)
            generated_for_room['plans'].append(compact_plan)
            generated_for_room['data'].append(compact_result)

        plans.append(generated_for_room)
    
    db.commit()
    
    # Return generated plans
    all_plan_ids = [plan.id for room_plan in plans for plan in room_plan['plans']]
    unique_unassigned_student_ids = {
        student_id
        for room_plan in plans
        for plan_data in room_plan['data']
        for student_id in plan_data.get('unassigned', [])
    }
    unassigned_count = len(unique_unassigned_student_ids)
    return {
        'message': f'Generated {len(all_plan_ids)} seating plan(s)',
        'generated_plan_type': requested_plan_type,
        'plan_ids': all_plan_ids,
        'selected_student_count': len(students_data),
        'unassigned_count': unassigned_count,
        'plans': [
            {
                'room_id': p['room_id'],
                'plan_ids': [plan.id for plan in p['plans']],
                'all_in_one_id': next((plan.id for plan in p['plans'] if str(plan.plan_type) == 'all_in_one'), None),
                'plan_a_id': next((plan.id for plan in p['plans'] if str(plan.plan_type) == 'strict'), None),
                'plan_b_id': next((plan.id for plan in p['plans'] if str(plan.plan_type) == 'compact'), None),
            }
            for p in plans
        ]
    }


@router.get("/plans/{room_id}", response_model=List[SeatingPlanResponse])
async def list_plans(
    room_id: int,
    exam_id: int = None,
    db: Session = Depends(get_db),
):
    """
    List seating plans for a room
    """
    query = db.query(SeatingPlan).filter(SeatingPlan.room_id == room_id)
    
    if exam_id:
        query = query.filter(SeatingPlan.exam_id == exam_id)
    
    plans = query.all()
    
    return [serialize_seating_plan(plan) for plan in plans]


@router.get("/plans", response_model=List[SeatingPlanResponse])
async def list_all_plans(
    exam_id: int = None,
    db: Session = Depends(get_db),
):
    """
    List all seating plans, optionally filtered by exam
    """
    query = db.query(SeatingPlan)

    if exam_id:
        query = query.filter(SeatingPlan.exam_id == exam_id)

    plans = query.order_by(SeatingPlan.created_at.desc(), SeatingPlan.id.desc()).all()
    return [serialize_seating_plan(plan) for plan in plans]


@router.get("/{plan_id}/layout")
async def get_plan_layout(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """
    Get visual layout for a seating plan
    """
    plan = db.query(SeatingPlan).filter(SeatingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    room = plan.room
    desks = db.query(Desk).filter(Desk.room_id == room.id).all()
    
    # Build desk layout
    desk_layouts = []
    occupied_count = 0
    
    for desk in desks:
        seats = db.query(Seat).filter(Seat.desk_id == desk.id).all()
        
        seat_positions = []
        for seat in seats:
            seat_pos = SeatPosition(
                seat_id=seat.id,
                desk_id=desk.id,
                position=seat.position,
                student_id=seat.student_id,
                student_name=seat.student.name if seat.student else None,
                student_roll=seat.student.roll_number if seat.student else None,
                batch=seat.student.batch if seat.student else None,
                is_occupied=seat.is_occupied or seat.student_id is not None,
                row=desk.row,
                col=desk.col,
            )
            seat_positions.append(seat_pos)
            if seat.is_occupied or seat.student_id:
                occupied_count += 1
        
        desk_layout = DeskLayout(
            desk_id=desk.id,
            row=desk.row,
            col=desk.col,
            seats=seat_positions,
            is_reserved=desk.is_reserved,
            reservation_reason=desk.reservation_reason,
        )
        desk_layouts.append(desk_layout)
    
    # Build room layout
    room_layout = RoomLayout(
        room_id=room.id,
        room_name=room.name,
        desks=desk_layouts,
        dimensions={
            'length_feet': room.length_feet,
            'width_feet': room.width_feet,
        },
        capacity=room.capacity,
        occupied=occupied_count,
    )
    
    return room_layout


@router.post("/{plan_id}/finalize")
async def finalize_plan(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """
    Finalize a seating plan
    """
    plan = db.query(SeatingPlan).filter(SeatingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    plan.status = "finalized"
    db.commit()
    
    return {"message": "Plan finalized", "plan_id": plan.id}


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """
    Delete a single seating plan
    """
    plan = db.query(SeatingPlan).filter(SeatingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    db.delete(plan)
    db.commit()
    return {"message": "Seating plan deleted successfully"}


@router.delete("")
async def delete_all_plans(
    is_admin: bool = False,
    db: Session = Depends(get_db),
):
    """
    Delete all seating plans (admin only)
    """
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete all seating plans",
        )

    plans = db.query(SeatingPlan).all()
    deleted_count = len(plans)
    for plan in plans:
        db.delete(plan)
    db.commit()
    return {
        "message": f"All {deleted_count} seating plans deleted successfully",
        "deleted_count": deleted_count,
    }


@router.get("/template/download")
async def download_seating_template():
    """
    Download Excel template for seating plan upload
    """
    try:
        excel_file = create_seating_plan_template()

        return StreamingResponse(
            excel_file,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=seating_plan_template.xlsx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating template: {str(e)}")


@router.post("/import", response_model=SeatingPlanImportResponse)
async def import_seating_plan(
    file: UploadFile = File(...),
    exam_id: int = None,
    school_id: int = 1,  # TODO: Get from authenticated user
    db: Session = Depends(get_db),
):
    """
    Import seating plan from Excel file
    """
    # Validate file type
    if not file.filename.lower().endswith('.xlsx'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only .xlsx Excel files are allowed."
        )

    # Read file content
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error reading file: {str(e)}"
        )

    # Parse Excel
    try:
        valid_entries, parse_errors = parse_seating_plan_excel(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing seating import file: {str(e)}"
        )

    if parse_errors and not valid_entries:
        # If there are critical errors and no valid entries, return error
        return SeatingPlanImportResponse(
            success=False,
            imported_count=0,
            skipped_count=0,
            errors=parse_errors,
            room_summary={}
        )

    imported_count = 0
    skipped_count = 0
    import_errors = []
    room_summary = {}

    # Process valid entries
    for entry in valid_entries:
        try:
            # Check if student already exists
            existing_student = db.query(Student).filter(
                Student.roll_number == entry['roll_no'],
                Student.school_id == school_id,
            ).first()

            if existing_student:
                # Update existing student
                existing_student.name = entry['candidate_name']
                existing_student.batch = entry['batch']
                # Could add father_name to student model if needed
                db.commit()
                student = existing_student
                skipped_count += 1
                import_errors.append({
                    'roll_no': entry['roll_no'],
                    'error': 'Student already exists, updated existing record'
                })
            else:
                # Create new student
                student = Student(
                    roll_number=entry['roll_no'],
                    name=entry['candidate_name'],
                    batch=entry['batch'],
                    school_id=school_id,
                    is_active=True,
                )
                db.add(student)
                db.commit()
                db.refresh(student)
                imported_count += 1

            # Update room summary
            room_no = entry['room_no']
            room_summary[room_no] = room_summary.get(room_no, 0) + 1

        except Exception as e:
            import_errors.append({
                'roll_no': entry['roll_no'],
                'error': f'Error saving student: {str(e)}'
            })

    # Combine parse errors and import errors
    all_errors = parse_errors + import_errors

    return SeatingPlanImportResponse(
        success=len(all_errors) == 0,
        imported_count=imported_count,
        skipped_count=skipped_count,
        errors=all_errors,
        room_summary=room_summary
    )
