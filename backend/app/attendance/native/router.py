import asyncio
import calendar
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.attendance.logging_utils import log_attendance_mode
from app.attendance.native.service import NativeAttendanceService
from app.models import User
from app.schemas import (
    AttendanceSettingResponse,
    AttendanceSettingUpdate,
    StaffAttendanceMarkRequest,
    StaffAttendanceMarkingResponse,
    AttendanceOverviewResponse,
    AttendanceLeaveResponse,
    AttendanceStaffResponse,
    AttendanceStudentResponse,
    AttendanceSubjectResponse,
    StaffDashboardResponse,
    StaffAttendanceRecordResponse,
    StudentAttendanceDashboardSummaryResponse,
    StudentAttendanceMarkRequest,
    StudentAttendanceMarkingResponse,
    StudentAttendanceRecordResponse,
    TeacherAttendanceContextResponse,
)
from app.middleware.auth import get_authenticated_actor_context, require_permissions
from app.services.scope_engine import (
    PermissionScopeContext,
    build_scope_context,
    ensure_school_wide_scope,
)
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import resolve_school_id_from_actor

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def get_native_attendance_service() -> NativeAttendanceService:
    return NativeAttendanceService()


def require_attendance_overview_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_permissions("attendance.overview", "attendance")),
) -> PermissionScopeContext:
    return build_scope_context(user=user, actor=actor, school_id=school_id, permission_key="attendance.overview")


def require_attendance_student_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_permissions("attendance.student", "attendance")),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="attendance.student",
        include_students=True,
        include_teacher_batches=True,
    )


def require_attendance_staff_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_permissions("attendance.staff", "attendance")),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="attendance.staff",
        include_staff=True,
    )


def require_attendance_leaves_scope(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(require_permissions("attendance.leaves", "attendance")),
) -> PermissionScopeContext:
    return build_scope_context(
        user=user,
        actor=actor,
        school_id=school_id,
        permission_key="attendance.leaves",
        include_students=True,
        include_staff=True,
    )


def _normalize(value: object) -> str:
    return str(value or "").strip()


def _cf(value: object) -> str:
    return _normalize(value).casefold()


def _matches_batch(class_name: str | None, section: str | None, allowed_batches: list[tuple[str, str | None]]) -> bool:
    wanted_class = _cf(class_name)
    wanted_section = _cf(section)
    return any(
        wanted_class == _cf(batch_class)
        and (not batch_section or wanted_section == _cf(batch_section))
        for batch_class, batch_section in allowed_batches
    )


def _enforce_student_batch_scope(
    context: PermissionScopeContext,
    *,
    class_name: str | None = None,
    section: str | None = None,
    batch_name: str | None = None,
    detail: str = "You do not have access to this class attendance scope",
) -> None:
    if context.is_school_wide:
        return
    if context.student_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    resolved_class = class_name
    resolved_section = section
    if batch_name and not resolved_class:
        batch_parts = _normalize(batch_name).rsplit(" ", 1)
        if len(batch_parts) == 2:
            resolved_class, resolved_section = batch_parts[0], batch_parts[1]
        else:
            resolved_class = batch_name
    if not resolved_class or not context.assigned_batches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    if not _matches_batch(resolved_class, resolved_section, context.assigned_batches):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _filter_student_rows(rows: list[dict], context: PermissionScopeContext) -> list[dict]:
    if context.is_school_wide:
        return rows
    if context.student_ids:
        allowed_ids = {item for item in context.student_ids if item}
        return [
            row
            for row in rows
            if _normalize(row.get("id") or row.get("student_id")) in allowed_ids
        ]
    if context.assigned_batches:
        return [
            row
            for row in rows
            if _matches_batch(
                _normalize(row.get("class_name")),
                _normalize(row.get("section")),
                context.assigned_batches,
            )
        ]
    return []


def _filter_staff_rows(rows: list[dict], context: PermissionScopeContext) -> list[dict]:
    if context.is_school_wide:
        return rows
    if context.staff_member_id:
        staff_id = context.staff_member_id
        return [
            row
            for row in rows
            if _normalize(row.get("id") or row.get("staff_member_id")) == staff_id
        ]
    if context.staff_department:
        return [row for row in rows if _cf(row.get("department")) == _cf(context.staff_department)]
    return []


def _enforce_student_entry_scope(
    context: PermissionScopeContext,
    *,
    school_id: str,
    entries: list[dict],
    detail: str,
) -> None:
    if context.is_school_wide:
        return
    if context.student_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    student_ids = sorted({_normalize(entry.get("student_id")) for entry in entries if _normalize(entry.get("student_id"))})
    if not student_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    student_rows = list(
        get_supabase_admin_client()
        .table("students")
        .select("id,class_name,section")
        .eq("school_id", school_id)
        .in_("id", student_ids)
        .execute()
        .data
        or []
    )
    if len(student_rows) != len(student_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    for row in student_rows:
        if not _matches_batch(_normalize(row.get("class_name")), _normalize(row.get("section")), context.assigned_batches):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def _collect_scoped_student_records(
    *,
    service: NativeAttendanceService,
    school_id: str,
    context: PermissionScopeContext,
    class_name: str | None = None,
    section: str | None = None,
    student_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    batch_name: str | None = None,
) -> list[dict]:
    batch_filters = None
    if context.assigned_batches:
        batch_filters = context.assigned_batches
    elif batch_name:
        batch_filters = [(batch_name, None)]
    page = 0
    page_size = 500
    results: list[dict] = []
    while True:
        rows = await service.list_student_records(
            school_id=school_id,
            class_name=class_name,
            section=section,
            student_name=student_name,
            date_from=date_from,
            date_to=date_to,
            skip=page * page_size,
            limit=page_size,
            batch_filters=batch_filters,
        )
        if not rows:
            break
        filtered_rows = _filter_student_rows(rows, context)
        if batch_name:
            filtered_rows = [
                row
                for row in filtered_rows
                if _cf(row.get("batch_name")) == _cf(batch_name)
                or _cf(f"{_normalize(row.get('class_name'))} {_normalize(row.get('section'))}") == _cf(batch_name)
            ]
        results.extend(filtered_rows)
        if len(rows) < page_size:
            break
        page += 1
        if page >= 100:
            break
    return results


def _build_calendar_payload(month: str | None, rows: list[dict]) -> dict:
    today = date.today()
    month_text = (month or today.isoformat())[:7]
    try:
        year_int, month_int = map(int, month_text.split("-"))
    except Exception:
        year_int = today.year
        month_int = today.month
    days_in_month = calendar.monthrange(year_int, month_int)[1]
    day_map: dict[str, dict[str, int]] = {}
    marked_dates: set[str] = set()
    for row in rows:
        dt = _normalize(row.get("date"))[:10]
        if not dt:
            continue
        marked_dates.add(dt)
        bucket = day_map.setdefault(dt, {"present": 0, "absent": 0, "late": 0, "total": 0})
        status_value = _cf(row.get("status")) or "present"
        if status_value == "absent":
            bucket["absent"] += 1
        elif status_value == "late":
            bucket["late"] += 1
        else:
            bucket["present"] += 1
        bucket["total"] += 1
    day_summary: list[dict] = []
    monthly_present = monthly_absent = monthly_late = monthly_total = 0
    for day_value in range(1, days_in_month + 1):
        dt = date(year_int, month_int, day_value).isoformat()
        bucket = day_map.get(dt, {"present": 0, "absent": 0, "late": 0, "total": 0})
        present = int(bucket["present"])
        absent = int(bucket["absent"])
        late = int(bucket["late"])
        total = int(bucket["total"])
        status_value = "absent" if absent > 0 else "present" if present > 0 else "late" if late > 0 else ""
        day_summary.append({
            "date": dt,
            "day": day_value,
            "status": status_value,
            "present": present,
            "absent": absent,
            "late": late,
            "total": total,
        })
        monthly_present += present
        monthly_absent += absent
        monthly_late += late
        monthly_total += total
    return {
        "month": f"{year_int:04d}-{month_int:02d}",
        "marked_dates": sorted(marked_dates),
        "day_summary": day_summary,
        "monthly_totals": {
            "present_count": monthly_present,
            "absent_count": monthly_absent,
            "late_count": monthly_late,
            "total": monthly_total,
        },
    }


def _build_dashboard_payload(
    *,
    scope: str,
    date_value: str | None,
    class_name: str | None,
    batch_name: str | None,
    rows: list[dict],
) -> dict:
    present_count = sum(1 for row in rows if _cf(row.get("status")) == "present")
    absent_count = sum(1 for row in rows if _cf(row.get("status")) == "absent")
    late_count = sum(1 for row in rows if _cf(row.get("status")) == "late")
    class_buckets: dict[str, dict[str, int | str]] = {}
    batch_buckets: dict[str, dict[str, int | str]] = {}
    date_buckets: dict[str, dict[str, int | str]] = {}
    for row in rows:
        status_value = _cf(row.get("status")) or "present"
        class_key = _normalize(row.get("class_name")) or "Unknown"
        batch_key = _normalize(row.get("batch_name")) or class_key
        date_key = _normalize(row.get("date"))[:10]
        for bucket_map, key_name, key_value in (
            (class_buckets, "class_name", class_key),
            (batch_buckets, "batch_name", batch_key),
            (date_buckets, "date", date_key),
        ):
            bucket = bucket_map.setdefault(key_value, {"present_count": 0, "absent_count": 0, "late_count": 0, "total_count": 0, key_name: key_value})
            if status_value == "absent":
                bucket["absent_count"] += 1
            elif status_value == "late":
                bucket["late_count"] += 1
            else:
                bucket["present_count"] += 1
            bucket["total_count"] += 1
    return {
        "scope": scope,
        "date": date_value,
        "class_name": class_name,
        "batch_name": batch_name,
        "total_count": len(rows),
        "present_count": present_count,
        "absent_count": absent_count,
        "late_count": late_count,
        "class_summary": list(class_buckets.values()),
        "batch_summary": list(batch_buckets.values()),
        "date_summary": list(date_buckets.values()),
    }


@router.get("/overview", response_model=AttendanceOverviewResponse)
def get_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
    _scope: PermissionScopeContext = Depends(require_attendance_overview_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("overview", school_id)
    return AttendanceOverviewResponse(**service.get_overview(school_id=school_id))


@router.get("/integrated-overview")
def get_integrated_overview_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    _scope: PermissionScopeContext = Depends(require_attendance_overview_scope),
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
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("students", school_id)
    return _filter_student_rows(
        service.list_students(school_id=school_id, skip=skip, limit=limit, search=search),
        scope_context,
    )


@router.get("/integrated-students", response_model=List[AttendanceStudentResponse])
def list_integrated_students_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=10000),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("integrated-students", school_id)
    return _filter_student_rows(service.list_integrated_students(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        batch=batch,
    ), scope_context)


@router.get("/staff", response_model=List[AttendanceStaffResponse])
def list_staff_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff", school_id)
    return _filter_staff_rows(service.list_staff(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    ), scope_context)


@router.get("/integrated-staff", response_model=List[AttendanceStaffResponse])
def list_integrated_staff_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("integrated-staff", school_id)
    return _filter_staff_rows(service.list_integrated_staff(
        school_id=school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    ), scope_context)


@router.get("/subjects", response_model=List[AttendanceSubjectResponse])
def list_subjects_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    _scope: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("subjects", school_id)
    return service.list_subjects(school_id=school_id)


@router.get("/settings", response_model=AttendanceSettingResponse)
def get_settings_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_attendance_overview_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    ensure_school_wide_scope(scope_context, "Only school-wide attendance access can view settings")
    log_attendance_mode("settings", school_id)
    return AttendanceSettingResponse(**service.get_settings(school_id=school_id))


@router.put("/settings", response_model=AttendanceSettingResponse)
def update_settings_route(
    payload: AttendanceSettingUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_attendance_overview_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    ensure_school_wide_scope(scope_context, "Only school-wide attendance access can update settings")
    log_attendance_mode("settings.update", school_id)
    return AttendanceSettingResponse(
        **service.update_settings(
            school_id=school_id,
            minimum_attendance_threshold=payload.minimum_attendance_threshold,
            working_hours_start=payload.working_hours_start,
            working_hours_end=payload.working_hours_end,
        )
    )


@router.get("/batch-current-class", response_model=TeacherAttendanceContextResponse)
def get_batch_current_class_route(
    class_name: str = Query(...),
    section: str = Query(...),
    batch_name: Optional[str] = Query(default=None),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("batch-current-class", school_id)
    _enforce_student_batch_scope(scope_context, class_name=class_name, section=section, batch_name=batch_name)
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
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("batch-day-classes", school_id)
    _enforce_student_batch_scope(scope_context, class_name=class_name, section=section, batch_name=batch_name)
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
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-marking", school_id)
    _enforce_student_batch_scope(scope_context, class_name=class_name, section=section)
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
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-marking.save", school_id)
    if payload.entries:
        _enforce_student_entry_scope(
            scope_context,
            school_id=school_id,
            entries=[entry.model_dump() for entry in payload.entries],
            detail="You do not have access to mark attendance for this batch",
        )
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
    limit: int = Query(default=100, ge=1, le=500),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("student-records", school_id)
    batch_filters = None
    resolved_class_name = class_name
    resolved_section = section
    if batch_name:
        _enforce_student_batch_scope(scope_context, class_name=class_name, section=section, batch_name=batch_name)
        batch_filters = [(batch_name, None)]
        # Batch-wise filtering is authoritative; avoid over-filtering from stale UI class/section values.
        if not class_name:
            resolved_class_name = None
        if not section:
            resolved_section = None
    rows = await service.list_student_records(
        school_id=school_id,
        class_name=resolved_class_name,
        section=resolved_section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
        batch_filters=batch_filters,
    )
    return _filter_student_rows(rows, scope_context)


@router.get("/dashboard", response_model=StudentAttendanceDashboardSummaryResponse)
async def get_student_dashboard_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    date: Optional[date] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
):
    log_attendance_mode("dashboard", school_id)
    if scope_context.is_school_wide:
        return StudentAttendanceDashboardSummaryResponse(
            **service.get_student_dashboard(
                school_id=school_id,
                date_value=date.isoformat() if date else None,
                class_name=class_name,
                batch_name=batch_name,
                scope=scope,
            )
        )
    scoped_rows = await _collect_scoped_student_records(
        service=service,
        school_id=school_id,
        context=scope_context,
        class_name=class_name,
        student_name=None,
        date_from=date.isoformat() if date else None,
        date_to=date.isoformat() if date else None,
        batch_name=batch_name,
    )
    return StudentAttendanceDashboardSummaryResponse(
        **_build_dashboard_payload(
            scope=scope or scope_context.scope,
            date_value=date.isoformat() if date else None,
            class_name=class_name,
            batch_name=batch_name,
            rows=scoped_rows,
        )
    )


@router.get("/calendar")
async def get_student_calendar_route(
    month: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("calendar", school_id)
    if scope_context.is_school_wide:
        return await service.get_student_calendar(
            school_id=school_id,
            month=month,
            class_name=class_name,
            batch_name=batch_name,
            scope=scope,
        )
    month_text = (month or date.today().isoformat())[:7]
    scoped_rows = await _collect_scoped_student_records(
        service=service,
        school_id=school_id,
        context=scope_context,
        class_name=class_name,
        student_name=None,
        date_from=f"{month_text}-01",
        date_to=f"{month_text}-31",
        batch_name=batch_name,
    )
    return _build_calendar_payload(month, scoped_rows)


@router.delete("/student-records/{record_id}")
def delete_student_record_route(
    record_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    ensure_school_wide_scope(scope_context, "Only school-wide attendance access can delete student records")
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
    scope_context: PermissionScopeContext = Depends(require_attendance_student_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    ensure_school_wide_scope(scope_context, "Only school-wide attendance access can bulk delete student records")
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
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-records", school_id)
    return _filter_staff_rows(service.list_staff_records(
        school_id=school_id,
        department=department,
        staff_name=staff_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
    ), scope_context)


@router.get("/staff-dashboard", response_model=StaffDashboardResponse)
def get_staff_dashboard_route(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-dashboard", school_id)
    if not scope_context.is_school_wide:
        ensure_school_wide_scope(scope_context, "Only school-wide attendance access can view staff dashboards")
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
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("staff-marking", school_id)
    if not scope_context.is_school_wide and scope_context.staff_department and _cf(department) != _cf(scope_context.staff_department):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this staff department")
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
    scope_context: PermissionScopeContext = Depends(require_attendance_staff_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    ensure_school_wide_scope(scope_context, "Only school-wide attendance access can save staff attendance")
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
    _scope: PermissionScopeContext = Depends(require_attendance_leaves_scope),
    service: NativeAttendanceService = Depends(get_native_attendance_service),
):
    log_attendance_mode("leaves", school_id)
    return service.list_leaves(
        school_id=school_id,
        status_filter=status,
        actor=actor,
    )
