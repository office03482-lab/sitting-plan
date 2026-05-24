from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from app.attendance.logging_utils import log_attendance_mode
from app.attendance.native.service import NativeAttendanceService
from app.schemas import (
    StaffAttendanceMarkRequest,
    StaffAttendanceMarkingResponse,
    AttendanceOverviewResponse,
    AttendanceLeaveResponse,
    AttendanceStaffResponse,
    AttendanceStudentResponse,
    AttendanceSubjectResponse,
    StaffDashboardResponse,
    StaffAttendanceRecordResponse,
    StudentAttendanceMarkRequest,
    StudentAttendanceMarkingResponse,
    StudentAttendanceRecordResponse,
    TeacherAttendanceContextResponse,
)
from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def get_native_attendance_service() -> NativeAttendanceService:
    return NativeAttendanceService()


@router.get("/overview", response_model=AttendanceOverviewResponse)
def get_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("overview", school_id)
    return AttendanceOverviewResponse(**service.get_overview(school_id=school_id))


@router.get("/integrated-overview")
def get_integrated_overview_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("integrated-overview", school_id)
    return service.get_integrated_overview(school_id=school_id)


@router.get("/students", response_model=List[AttendanceStudentResponse])
def list_students_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("students", school_id)
    return service.list_students(school_id=school_id, skip=skip, limit=limit, search=search)


@router.get("/integrated-students", response_model=List[AttendanceStudentResponse])
def list_integrated_students_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("integrated-students", school_id)
    return service.list_integrated_students(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        batch=batch,
    )


@router.get("/staff", response_model=List[AttendanceStaffResponse])
def list_staff_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff", school_id)
    return service.list_staff(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    )


@router.get("/integrated-staff", response_model=List[AttendanceStaffResponse])
def list_integrated_staff_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("integrated-staff", school_id)
    return service.list_integrated_staff(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    )


@router.get("/subjects", response_model=List[AttendanceSubjectResponse])
def list_subjects_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("subjects", school_id)
    return service.list_subjects(school_id=school_id)


@router.get("/batch-current-class", response_model=TeacherAttendanceContextResponse)
def get_batch_current_class_route(
    class_name: str = Query(...),
    section: str = Query(...),
    batch_name: Optional[str] = Query(default=None),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("batch-current-class", school_id)
    payload = service.get_batch_current_class(
        school_id=school_id,
        class_name=class_name,
        section=section,
        batch_name=batch_name,
        target_date=target_date.isoformat() if target_date else None,
        current_time=current_time,
    )
    return TeacherAttendanceContextResponse(**payload)


@router.get("/batch-day-classes", response_model=List[TeacherAttendanceContextResponse])
def list_batch_day_classes_route(
    class_name: str = Query(...),
    section: str = Query(...),
    batch_name: Optional[str] = Query(default=None),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("batch-day-classes", school_id)
    payload = service.list_batch_day_classes(
        school_id=school_id,
        class_name=class_name,
        section=section,
        batch_name=batch_name,
        target_date=target_date.isoformat() if target_date else None,
        current_time=current_time,
    )
    return [TeacherAttendanceContextResponse(**item) for item in payload]


@router.get("/student-marking", response_model=StudentAttendanceMarkingResponse)
def get_student_marking_route(
    date: date = Query(...),
    class_name: str = Query(...),
    section: str = Query(...),
    subject_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-marking", school_id)
    payload = service.get_student_marking(
        school_id=school_id,
        date_value=date.isoformat(),
        class_name=class_name,
        section=section,
        subject_id=subject_id,
        search=search,
    )
    return StudentAttendanceMarkingResponse(**payload)


@router.post("/student-marking")
def save_student_marking_route(
    payload: StudentAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-marking.save", school_id)
    return service.save_student_marking(
        school_id=school_id,
        date_value=payload.date.isoformat(),
        subject_id=str(payload.subject_id) if payload.subject_id is not None else None,
        marked_by=payload.marked_by or str(actor.get("name") or "").strip() or None,
        entries=[entry.model_dump() for entry in payload.entries],
    )


@router.get("/student-records", response_model=List[StudentAttendanceRecordResponse])
async def list_student_records_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-records", school_id)
    batch_filters = None
    if batch_name:
        batch_filters = [(batch_name, None)]
    return await service.list_student_records(
        school_id=school_id,
        class_name=class_name,
        section=section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
        batch_filters=batch_filters,
    )


@router.delete("/student-records/{record_id}")
def delete_student_record_route(
    record_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-records.delete", school_id)
    return service.delete_student_record(
        school_id=school_id,
        record_id=record_id,
    )


@router.delete("/student-records")
def delete_all_student_records_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-records.delete_all", school_id)
    return service.delete_all_student_records(
        school_id=school_id,
        class_name=class_name,
        section=section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
    )


@router.get("/staff-records", response_model=List[StaffAttendanceRecordResponse])
def list_staff_records_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-records", school_id)
    return service.list_staff_records(
        school_id=school_id,
        department=department,
        staff_name=staff_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
    )


@router.get("/staff-dashboard", response_model=StaffDashboardResponse)
def get_staff_dashboard_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-dashboard", school_id)
    return StaffDashboardResponse(
        **service.get_staff_dashboard(
            school_id=school_id,
            department=department,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
        )
    )


@router.get("/staff-marking", response_model=StaffAttendanceMarkingResponse)
def get_staff_marking_route(
    date: date = Query(...),
    department: str = Query(...),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-marking", school_id)
    payload = service.get_staff_marking(
        school_id=school_id,
        date_value=date.isoformat(),
        department=department,
        search=search,
    )
    return StaffAttendanceMarkingResponse(**payload)


@router.post("/staff-marking")
def save_staff_marking_route(
    payload: StaffAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-marking.save", school_id)
    return service.save_staff_marking(
        school_id=school_id,
        date_value=payload.date.isoformat(),
        marked_by=payload.marked_by,
        entries=[entry.model_dump() for entry in payload.entries],
    )


@router.get("/leaves", response_model=List[AttendanceLeaveResponse])
def list_leaves_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    status: Optional[str] = Query(default=None),
    actor: dict = Depends(get_authenticated_actor_context),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("leaves", school_id)
    return service.list_leaves(
        school_id=school_id,
        status_filter=status,
        actor=actor,
    )
