from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from app.attendance.factory import get_attendance_service
from app.attendance.logging_utils import log_attendance_mode
from app.schemas import (
    AttendanceOverviewResponse,
    AttendanceStaffResponse,
    AttendanceStudentResponse,
    AttendanceSubjectResponse,
    StaffDashboardResponse,
    StaffAttendanceRecordResponse,
    StudentAttendanceMarkingResponse,
    StudentAttendanceRecordResponse,
)
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


@router.get("/overview", response_model=AttendanceOverviewResponse)
def get_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
    service=Depends(get_attendance_service),
):
    log_attendance_mode("overview", school_id)
    return AttendanceOverviewResponse(**service.get_overview(school_id=school_id))


@router.get("/integrated-overview")
def get_integrated_overview_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    service=Depends(get_attendance_service),
):
    log_attendance_mode("integrated-overview", school_id)
    return service.get_integrated_overview(school_id=school_id)


@router.get("/students", response_model=List[AttendanceStudentResponse])
def list_students_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    service=Depends(get_attendance_service),
):
    log_attendance_mode("students", school_id)
    return service.list_students(school_id=school_id, skip=skip, limit=limit, search=search)


@router.get("/integrated-students", response_model=List[AttendanceStudentResponse])
def list_integrated_students_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
    service=Depends(get_attendance_service),
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
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    service=Depends(get_attendance_service),
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
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    service=Depends(get_attendance_service),
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
    service=Depends(get_attendance_service),
):
    log_attendance_mode("subjects", school_id)
    return service.list_subjects(school_id=school_id)


@router.get("/student-marking", response_model=StudentAttendanceMarkingResponse)
def get_student_marking_route(
    date: date = Query(...),
    class_name: str = Query(...),
    section: str = Query(...),
    subject_id: str = Query(...),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    service=Depends(get_attendance_service),
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


@router.get("/student-records", response_model=List[StudentAttendanceRecordResponse])
def list_student_records_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    service=Depends(get_attendance_service),
):
    log_attendance_mode("student-records", school_id)
    return service.list_student_records(
        school_id=school_id,
        class_name=class_name,
        section=section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
    )


@router.get("/staff-records", response_model=List[StaffAttendanceRecordResponse])
def list_staff_records_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    service=Depends(get_attendance_service),
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
    service=Depends(get_attendance_service),
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

