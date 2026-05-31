"""
Seating plan generation routes (Supabase-native)
"""
import json
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, status
from fastapi.responses import StreamingResponse
from typing import List
from app.schemas import GenerateSeatingRequest, SeatingPlanResponse, SeatingPlanImportResponse
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_seating import (
    delete_all_seating_plans,
    delete_seating_plan,
    finalize_seating_plan,
    generate_seating_plans,
    get_seating_plan_layout,
    list_seating_plans,
)
from app.services import supabase_students
from app.utils.excel import parse_seating_plan_excel, create_seating_plan_template

router = APIRouter()


@router.post("/generate")
async def generate_seating_plans_route(
    request: GenerateSeatingRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return generate_seating_plans(
        school_id=school_id,
        exam_id=request.exam_id,
        room_ids=[str(rid) for rid in request.room_ids],
        plan_type=request.plan_type or "all_in_one",
        batches=request.batches,
        batch_conflict_groups=request.batch_conflict_groups,
        algorithm_version=request.algorithm_version or "2.1",
    )


@router.get("/plans/{room_id}", response_model=List[SeatingPlanResponse])
async def list_plans(
    room_id: str,
    exam_id: str = None,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return list_seating_plans(school_id, exam_id=exam_id, room_id=room_id)


@router.get("/plans", response_model=List[SeatingPlanResponse])
async def list_all_plans(
    exam_id: str = None,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return list_seating_plans(school_id, exam_id=exam_id)


@router.get("/{plan_id}/layout")
async def get_plan_layout(
    plan_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return get_seating_plan_layout(school_id, plan_id)


@router.post("/{plan_id}/finalize")
async def finalize_plan(
    plan_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return finalize_seating_plan(school_id, plan_id)


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return delete_seating_plan(school_id, plan_id)


@router.delete("")
async def delete_all_plans(
    is_admin: bool = False,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete all seating plans",
        )
    return delete_all_seating_plans(school_id)


@router.get("/template/download")
async def download_seating_template():
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
    exam_id: str = None,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    if not file.filename.lower().endswith('.xlsx'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only .xlsx Excel files are allowed."
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error reading file: {str(e)}"
        )

    try:
        valid_entries, parse_errors = parse_seating_plan_excel(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing seating import file: {str(e)}"
        )

    if parse_errors and not valid_entries:
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

    for entry in valid_entries:
        try:
            existing = supabase_students.find_student_by_roll_number(school_id, entry['roll_no'])
            if existing:
                supabase_students.upsert_student(school_id, {
                    "roll_number": entry['roll_no'],
                    "name": entry['candidate_name'],
                    "batch": entry['batch'],
                })
                skipped_count += 1
                import_errors.append({
                    'roll_no': entry['roll_no'],
                    'error': 'Student already exists, updated existing record'
                })
            else:
                supabase_students.upsert_student(school_id, {
                    "roll_number": entry['roll_no'],
                    "name": entry['candidate_name'],
                    "batch": entry['batch'],
                })
                imported_count += 1

            room_no = entry['room_no']
            room_summary[room_no] = room_summary.get(room_no, 0) + 1
        except Exception as e:
            import_errors.append({
                'roll_no': entry['roll_no'],
                'error': f'Error saving student: {str(e)}'
            })

    all_errors = parse_errors + import_errors
    return SeatingPlanImportResponse(
        success=len(all_errors) == 0,
        imported_count=imported_count,
        skipped_count=skipped_count,
        errors=all_errors,
        room_summary=room_summary
    )
