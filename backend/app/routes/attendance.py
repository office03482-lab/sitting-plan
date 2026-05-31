"""
Attendance management routes (Supabase-native)
"""

from datetime import date, datetime, time as dt_time
from io import BytesIO
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle

from app.middleware.auth import get_authenticated_actor_context
from app.models import UserRole
from app.schemas import (
    AttendanceHolidayCreate,
    AttendanceHolidayResponse,
    AttendanceLeaveCreate,
    AttendanceLeaveDecision,
    AttendanceLeaveResponse,
    AttendanceNotificationResponse,
    AttendanceOverviewResponse,
    AttendanceReportResponse,
    AttendanceReportRow,
    AttendanceSettingResponse,
    AttendanceSettingUpdate,
    AttendanceStaffCreate,
    AttendanceStaffResponse,
    AttendanceStudentCreate,
    AttendanceStudentResponse,
    AttendanceSubjectCreate,
    AttendanceSubjectResponse,
    StaffAttendanceMarkRequest,
    StaffAttendanceMarkingResponse,
    StaffAttendanceMarkingRow,
    StaffAttendanceRecordResponse,
    StaffDashboardResponse,
    StudentAttendanceMarkRequest,
    StudentAttendanceMarkingResponse,
    StudentAttendanceMarkingRow,
    StudentAttendanceDashboardSummaryResponse,
    StudentAttendanceRecordResponse,
    StudentDashboardResponse,
    TeacherAttendanceContextResponse,
)
from app.schemas import DayOfWeek as TimetableDayOfWeek
from app.services.supabase_attendance import (
    create_holiday,
    delete_holiday,
    delete_all_holidays,
    create_notification,
    get_attendance_settings,
    update_attendance_settings,
    delete_student_record,
    delete_all_student_records,
    save_student_marking as save_supabase_student_marking,
    save_staff_marking as save_supabase_staff_marking,
    save_leave_request,
    approve_leave_request,
    delete_leave_request,
    delete_all_leave_requests,
    delete_notification,
    delete_all_notifications,
    delete_staff_record as delete_supabase_staff_record,
    delete_all_staff_records as delete_all_supabase_staff_records,
    list_notifications,
    get_batch_current_class as get_supabase_batch_current_class,
    get_student_marking as get_supabase_student_marking,
    get_teacher_current_class as get_supabase_teacher_current_class,
    get_integrated_overview as get_supabase_integrated_overview,
    list_leaves as list_supabase_attendance_leaves,
    get_overview as get_supabase_attendance_overview,
    get_student_dashboard as get_supabase_student_dashboard,
    get_staff_dashboard as get_supabase_staff_dashboard,
    get_staff_marking as get_supabase_staff_marking,
    list_integrated_staff as list_supabase_integrated_staff,
    list_integrated_students as list_supabase_integrated_students,
    list_staff as list_supabase_attendance_staff,
    list_staff_records as list_supabase_staff_records,
    list_student_records as list_supabase_student_records,
    list_students as list_supabase_attendance_students,
    list_subjects as list_supabase_attendance_subjects,
)
from app.services.supabase_context import resolve_school_id_from_actor
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


def normalize_department_value(value: Optional[str]) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().casefold()


def normalize_student_batch_label(value: object) -> str:
    if value is None:
        return ""
    raw_value = getattr(value, "value", value)
    return str(raw_value).strip()


def split_batch_to_class_section(batch_name: str | None) -> tuple[str, str]:
    normalized = normalize_student_batch_label(batch_name)
    if not normalized:
        return "General", "A"

    if "|" in normalized:
        class_part, section_part = normalized.split("|", 1)
        class_name = class_part.strip() or "General"
        section = section_part.strip() or "A"
        return class_name, section

    if "-" in normalized:
        class_part, section_part = normalized.split("-", 1)
        class_name = class_part.strip() or "General"
        section = section_part.strip() or "A"
        return class_name, section

    spaced_match = re.match(r"^(.*\S)\s+([A-Za-z])$", normalized)
    if spaced_match:
        class_name = spaced_match.group(1).strip() or "General"
        section = spaced_match.group(2).strip().upper() or "A"
        return class_name, section

    compact_match = re.match(r"^([0-9IVXLCivxlc][0-9A-Za-z\s]*?)([A-Za-z])$", normalized)
    if compact_match:
        class_name = compact_match.group(1).strip() or "General"
        section = compact_match.group(2).strip().upper() or "A"
        return class_name, section

    return normalized, "A"


def split_timetable_class_name(value: str | None) -> tuple[str, str]:
    raw_value = normalize_student_batch_label(value)
    primary_batch = raw_value.split(",")[0].strip() if raw_value else ""
    return split_batch_to_class_section(primary_batch)


def split_timetable_batches(value: str | None) -> List[str]:
    raw_value = normalize_student_batch_label(value)
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def batch_matches_timetable_entry(class_name: str, section: str, timetable_class_name: str | None) -> bool:
    wanted_class = normalize_student_batch_label(class_name).casefold()
    wanted_section = normalize_student_batch_label(section).casefold()
    if not wanted_class or not wanted_section:
        return False

    for batch_name in split_timetable_batches(timetable_class_name):
        entry_class_name, entry_section = split_batch_to_class_section(batch_name)
        if (
            normalize_student_batch_label(entry_class_name).casefold() == wanted_class
            and normalize_student_batch_label(entry_section).casefold() == wanted_section
        ):
            return True

    return False


def day_of_week_for_date(target_date: date) -> TimetableDayOfWeek:
    mapping = {
        0: TimetableDayOfWeek.MONDAY,
        1: TimetableDayOfWeek.TUESDAY,
        2: TimetableDayOfWeek.WEDNESDAY,
        3: TimetableDayOfWeek.THURSDAY,
        4: TimetableDayOfWeek.FRIDAY,
        5: TimetableDayOfWeek.SATURDAY,
        6: TimetableDayOfWeek.SUNDAY,
    }
    return mapping[target_date.weekday()]


def day_start(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        return value.replace(hour=0, minute=0, second=0, microsecond=0)
    return datetime.combine(value, dt_time.min)


def day_end(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        return value.replace(hour=23, minute=59, second=59, microsecond=999999)
    return datetime.combine(value, dt_time.max)


WRITE_ROLES = {
    UserRole.ADMIN.value,
    "super_admin",
    "admin_office",
    "teacher",
    "hr",
    "hr_admin",
}


def require_write_access(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current role cannot modify attendance records",
        )
    return actor


def build_report_rows(
    report_type: str,
    student_rows: List[Dict[str, Any]],
    staff_rows: List[Dict[str, Any]],
    leaves: List[Dict[str, Any]],
) -> List[Dict[str, object]]:
    if report_type == "student_summary":
        overall = {"present": 0, "absent": 0, "late": 0, "total": 0}
        batch_totals: Dict[str, Dict[str, int]] = {}
        student_totals: Dict[tuple, Dict[str, object]] = {}

        for row in student_rows:
            status = row.get("status") or "present"
            class_name = row.get("class_name") or ""
            section = row.get("section") or ""
            student_id = row.get("student_id")
            student_name = row.get("student_name") or ""
            batch_name = f"{class_name} | {section}"
            batch_bucket = batch_totals.setdefault(
                batch_name, {"present": 0, "absent": 0, "late": 0, "total": 0}
            )
            student_key = (batch_name, student_id, student_name)
            student_bucket = student_totals.setdefault(
                student_key,
                {
                    "batch": batch_name,
                    "student_name": student_name,
                    "present": 0,
                    "absent": 0,
                    "late": 0,
                    "total": 0,
                },
            )

            if status == "present":
                overall["present"] += 1
                batch_bucket["present"] += 1
                student_bucket["present"] += 1
            elif status == "absent":
                overall["absent"] += 1
                batch_bucket["absent"] += 1
                student_bucket["absent"] += 1
            elif status == "late":
                overall["late"] += 1
                batch_bucket["late"] += 1
                student_bucket["late"] += 1

            overall["total"] += 1
            batch_bucket["total"] += 1
            student_bucket["total"] += 1

        rows: List[Dict[str, object]] = [
            {
                "row_type": "overall_total",
                "batch": "ALL BATCHES",
                "student_name": "-",
                "present": overall["present"],
                "absent": overall["absent"],
                "late": overall["late"],
                "total": overall["total"],
                "attendance_percentage": round(
                    (((overall["present"] + overall["late"]) / overall["total"]) * 100), 2
                )
                if overall["total"]
                else 0,
            }
        ]

        for batch_name in sorted(batch_totals.keys()):
            totals = batch_totals[batch_name]
            rows.append(
                {
                    "row_type": "batch_total",
                    "batch": batch_name,
                    "student_name": "Total",
                    "present": totals["present"],
                    "absent": totals["absent"],
                    "late": totals["late"],
                    "total": totals["total"],
                    "attendance_percentage": round(
                        (((totals["present"] + totals["late"]) / totals["total"]) * 100), 2
                    )
                    if totals["total"]
                    else 0,
                }
            )

            batch_students = [
                value
                for value in student_totals.values()
                if value["batch"] == batch_name
            ]
            batch_students.sort(key=lambda item: str(item["student_name"]).lower())
            for student in batch_students:
                student_total = int(student["total"])
                rows.append(
                    {
                        "row_type": "student",
                        "batch": student["batch"],
                        "student_name": student["student_name"],
                        "present": student["present"],
                        "absent": student["absent"],
                        "late": student["late"],
                        "total": student_total,
                        "attendance_percentage": round(
                            (((int(student["present"]) + int(student["late"])) / student_total) * 100), 2
                        )
                        if student_total
                        else 0,
                    }
                )
        return rows
    if report_type == "staff_summary":
        return [
            {
                "date": (row.get("date") or "")[:10],
                "staff_name": row.get("staff_name", ""),
                "department": row.get("department", ""),
                "designation": row.get("designation") or "",
                "status": row.get("status", ""),
                "check_in": row.get("check_in") or "",
                "check_out": row.get("check_out") or "",
            }
            for row in staff_rows
        ]
    if report_type == "leave_summary":
        return [
            {
                "staff_name": row.get("staff_name", ""),
                "leave_type": row.get("leave_type", ""),
                "from_date": (row.get("from_date") or "")[:10],
                "to_date": (row.get("to_date") or "")[:10],
                "status": row.get("status", ""),
                "approved_by": row.get("approved_by") or "",
            }
            for row in leaves
        ]
    raise HTTPException(status_code=400, detail="Unsupported report type")


def parse_batch_filters(batch_names: Optional[str]) -> List[tuple[str, Optional[str]]]:
    if not batch_names:
        return []
    seen: set[tuple[str, Optional[str]]] = set()
    parsed: List[tuple[str, Optional[str]]] = []
    for item in batch_names.split(","):
        token = item.strip()
        if not token:
            continue
        class_name = token
        section: Optional[str] = None
        if "|" in token:
            class_part, section_part = token.split("|", 1)
            class_name = class_part.strip()
            section = section_part.strip() or None
        elif "-" in token:
            class_part, section_part = token.split("-", 1)
            class_name = class_part.strip()
            section = section_part.strip() or None
        key = (class_name, section)
        if class_name and key not in seen:
            seen.add(key)
            parsed.append(key)
    return parsed


def build_excel(rows: List[Dict[str, object]], sheet_name: str) -> BytesIO:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_name[:31]
    if rows:
        headers = list(rows[0].keys())
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header, "") for header in headers])
    else:
        sheet.append(["message"])
        sheet.append(["No records found"])
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def build_pdf(rows: List[Dict[str, object]], title: str) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=24,
        leftMargin=24,
        topMargin=24,
        bottomMargin=24,
    )
    data: List[List[str]] = [[title]]
    if rows:
        headers = list(rows[0].keys())
        data.append(headers)
        for row in rows:
            data.append([str(row.get(header, "")) for header in headers])
    else:
        data.append(["No records found"])

    table = Table(data, repeatRows=2 if rows else 1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("SPAN", (0, 0), (-1, 0)),
                ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#e2e8f0")),
                ("GRID", (0, 1), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("FONTNAME", (0, 0), (-1, 1), "Helvetica-Bold"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    doc.build([table, Spacer(1, 12)])
    buffer.seek(0)
    return buffer


async def collect_student_report_records(
    school_id: str,
    class_name: Optional[str],
    section: Optional[str],
    batch_names: Optional[str],
    date_from: Optional[date],
    date_to: Optional[date],
) -> List[Dict[str, Any]]:
    parsed_batches = parse_batch_filters(batch_names)
    return await list_supabase_student_records(
        school_id,
        class_name=class_name,
        section=section,
        student_name=None,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=0,
        limit=1000,
        batch_filters=parsed_batches or None,
    )


@router.get("/overview", response_model=AttendanceOverviewResponse)
def get_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return AttendanceOverviewResponse(**get_supabase_attendance_overview(school_id))


@router.get("/students", response_model=List[AttendanceStudentResponse])
def list_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
):
    return list_supabase_attendance_students(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
    )


@router.post("/students", response_model=AttendanceStudentResponse)
def create_student(
    payload: AttendanceStudentCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    raise HTTPException(
        status_code=400,
        detail="Student Management se student add/edit karein. Attendance module auto-sync karta hai.",
    )


@router.get("/staff", response_model=List[AttendanceStaffResponse])
def list_staff(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    return list_supabase_attendance_staff(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
    )


@router.post("/staff", response_model=AttendanceStaffResponse)
def create_staff(
    payload: AttendanceStaffCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    raise HTTPException(
        status_code=400,
        detail="Manage Teacher se staff add/edit karein. Attendance module auto-sync karta hai.",
    )


@router.get("/subjects", response_model=List[AttendanceSubjectResponse])
def list_subjects(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return list_supabase_attendance_subjects(school_id)


@router.post("/subjects", response_model=AttendanceSubjectResponse)
def create_subject(
    payload: AttendanceSubjectCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    raise HTTPException(
        status_code=400,
        detail="Subjects are managed via Course/Subject Management. Attendance module reads subjects from there.",
    )


@router.get("/settings", response_model=AttendanceSettingResponse)
def get_settings(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return AttendanceSettingResponse(**get_attendance_settings(school_id))


@router.put("/settings", response_model=AttendanceSettingResponse)
def update_attendance_settings_endpoint(
    payload: AttendanceSettingUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    result = update_attendance_settings(
        school_id,
        minimum_attendance_threshold=payload.minimum_attendance_threshold,
        working_hours_start=payload.working_hours_start,
        working_hours_end=payload.working_hours_end,
    )
    create_notification(
        school_id,
        "Attendance settings updated",
        "settings",
        user_name=actor["name"],
        user_role=actor["role"],
    )
    return AttendanceSettingResponse(**result)


@router.get("/holidays", response_model=List[AttendanceHolidayResponse])
def list_holidays(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return get_supabase_attendance_overview(school_id).get("holidays", [])


@router.post("/holidays", response_model=AttendanceHolidayResponse)
def create_holiday_endpoint(
    payload: AttendanceHolidayCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    holiday = create_holiday(
        school_id,
        {
            "title": payload.title.strip(),
            "holiday_date": payload.holiday_date.isoformat(),
            "description": payload.description,
        },
    )
    create_notification(
        school_id,
        f"Holiday added: {payload.title.strip()}",
        "holiday",
        user_name=actor["name"],
        user_role=actor["role"],
    )
    return AttendanceHolidayResponse(**holiday)


@router.delete("/holidays/{holiday_id}")
def delete_holiday_endpoint(
    holiday_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_holiday(school_id, holiday_id)


@router.delete("/holidays")
def delete_all_holidays_endpoint(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_all_holidays(school_id)


@router.get("/teacher-current-class", response_model=TeacherAttendanceContextResponse)
def get_teacher_current_class(
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    try:
        return TeacherAttendanceContextResponse(
            **get_supabase_teacher_current_class(
                school_id,
                actor=actor,
                target_date=target_date.isoformat() if target_date else None,
                current_time=current_time,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/batch-current-class", response_model=TeacherAttendanceContextResponse)
def get_batch_current_class(
    class_name: str = Query(...),
    section: str = Query(...),
    batch_name: Optional[str] = Query(default=None),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return TeacherAttendanceContextResponse(
        **get_supabase_batch_current_class(
            school_id,
            class_name=class_name,
            section=section,
            batch_name=batch_name,
            target_date=target_date.isoformat() if target_date else None,
            current_time=current_time,
        )
    )


@router.get("/student-marking", response_model=StudentAttendanceMarkingResponse)
def get_student_marking(
    date: date = Query(...),
    class_name: str = Query(...),
    section: str = Query(...),
    subject_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
):
    try:
        return StudentAttendanceMarkingResponse(
            **get_supabase_student_marking(
                school_id,
                date_value=date.isoformat(),
                class_name=class_name,
                section=section,
                subject_id=str(subject_id) if subject_id else None,
                search=search,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/student-marking")
def save_student_marking(
    payload: StudentAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    logger.info("attendance.save.request", extra={"school_id": str(school_id), "date": str(payload.date), "subject_id": str(payload.subject_id), "entries": len(payload.entries)})
    marked_by = payload.marked_by or actor["name"]
    entries_list = [
        {
            "student_id": entry.student_id,
            "status": entry.status.value if hasattr(entry.status, "value") else str(entry.status),
            "absence_reason": entry.absence_reason,
        }
        for entry in payload.entries
    ]

    result = save_supabase_student_marking(
        school_id,
        date_value=payload.date.isoformat(),
        subject_id=str(payload.subject_id) if payload.subject_id else None,
        marked_by=marked_by,
        entries=entries_list,
    )

    for entry in payload.entries:
        status_val = entry.status.value if hasattr(entry.status, "value") else str(entry.status)
        if status_val == "absent":
            create_notification(
                school_id,
                f"Student absent notification: {entry.student_id}",
                "student_absent",
                user_name=actor["name"],
                user_role=actor["role"],
            )
    return result


@router.get("/student-records", response_model=List[StudentAttendanceRecordResponse])
async def list_student_records(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    batch_filters = None
    resolved_class_name = class_name
    resolved_section = section
    if batch_name:
        batch_filters = [(batch_name, None)]
        if not class_name:
            resolved_class_name = None
        if not section:
            resolved_section = None
    return await list_supabase_student_records(
        school_id,
        class_name=resolved_class_name,
        section=resolved_section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
        batch_filters=batch_filters,
    )


@router.get("/dashboard", response_model=StudentAttendanceDashboardSummaryResponse)
def get_student_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    date: Optional[date] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
):
    return StudentAttendanceDashboardSummaryResponse(
        **get_supabase_student_dashboard(
            school_id,
            date_value=date.isoformat() if date else None,
            class_name=class_name,
            batch_name=batch_name,
            scope=scope,
        )
    )


@router.delete("/student-records/{record_id}")
def delete_student_record_endpoint(
    record_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    try:
        return delete_student_record(school_id, record_id=record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/student-records")
def delete_all_student_records_endpoint(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_all_student_records(
        school_id,
        class_name=class_name,
        section=section,
        student_name=student_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
    )


@router.get("/student-dashboard/{student_id}", response_model=StudentDashboardResponse)
def get_student_dashboard_by_id(
    student_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Student dashboard is computed from records on the frontend in Supabase mode",
    )


@router.get("/staff-marking", response_model=StaffAttendanceMarkingResponse)
def get_staff_marking(
    date: date = Query(...),
    department: str = Query(...),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return StaffAttendanceMarkingResponse(
        **get_supabase_staff_marking(
            school_id,
            date_value=date.isoformat(),
            department=department,
            search=search,
        )
    )


@router.post("/staff-marking")
def save_staff_marking(
    payload: StaffAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    marked_by = payload.marked_by or actor["name"]
    entries_list = [
        {
            "staff_member_id": entry.staff_member_id,
            "status": entry.status.value if hasattr(entry.status, "value") else str(entry.status),
            "check_in": entry.check_in,
            "check_out": entry.check_out,
        }
        for entry in payload.entries
    ]

    result = save_supabase_staff_marking(
        school_id,
        date_value=payload.date.isoformat(),
        marked_by=marked_by,
        entries=entries_list,
    )

    for entry in payload.entries:
        status_val = entry.status.value if hasattr(entry.status, "value") else str(entry.status)
        if status_val == "absent":
            create_notification(
                school_id,
                f"Staff absent alert: {entry.staff_member_id}",
                "staff_absent",
                user_name=actor["name"],
                user_role=actor["role"],
            )
    return result


@router.get("/staff-records", response_model=List[StaffAttendanceRecordResponse])
def list_staff_records(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    return list_supabase_staff_records(
        school_id,
        department=department,
        staff_name=staff_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        skip=skip,
        limit=limit,
    )


@router.delete("/staff-records/{record_id}")
def delete_staff_record_endpoint(
    record_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    try:
        return delete_supabase_staff_record(school_id, record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/staff-records")
def delete_all_staff_records_endpoint(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_all_supabase_staff_records(
        school_id,
        department=department,
        staff_name=staff_name,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
    )


@router.get("/staff-dashboard", response_model=StaffDashboardResponse)
def get_staff_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    return StaffDashboardResponse(
        **get_supabase_staff_dashboard(
            school_id,
            department=department,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
        )
    )


@router.get("/leaves", response_model=List[AttendanceLeaveResponse])
def list_leaves(
    school_id: str = Depends(resolve_school_id_from_actor),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    return list_supabase_attendance_leaves(
        school_id,
        status_filter=status_filter,
        actor=actor,
    )


@router.post("/leaves", response_model=AttendanceLeaveResponse)
def create_leave(
    payload: AttendanceLeaveCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    leave_type_val = payload.leave_type.value if hasattr(payload.leave_type, "value") else str(payload.leave_type)
    result = save_leave_request(
        school_id,
        staff_member_id=payload.staff_member_id,
        leave_type=leave_type_val,
        from_date=payload.from_date.isoformat(),
        to_date=payload.to_date.isoformat(),
        reason=payload.reason,
    )
    create_notification(
        school_id,
        f"Leave applied by {result.get('staff_name', 'staff')}",
        "leave_applied",
        user_name=actor["name"],
        user_role=actor["role"],
    )
    return AttendanceLeaveResponse(**result)


@router.post("/leaves/{leave_id}/decision", response_model=AttendanceLeaveResponse)
def decide_leave(
    leave_id: str,
    payload: AttendanceLeaveDecision,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers cannot approve or reject leave requests")
    status_val = payload.status.value if hasattr(payload.status, "value") else str(payload.status)
    result = approve_leave_request(
        school_id,
        leave_id,
        status=status_val,
        approved_by=payload.approved_by,
    )
    create_notification(
        school_id,
        f"Leave {status_val.replace('_', ' ')} for {result.get('staff_name', 'staff')}",
        f"leave_{status_val}",
        user_name=actor["name"],
        user_role=actor["role"],
    )
    return AttendanceLeaveResponse(**result)


@router.delete("/leaves/{leave_id}")
def delete_leave(
    leave_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_leave_request(school_id, leave_id)


@router.delete("/leaves")
def delete_all_leaves(
    school_id: str = Depends(resolve_school_id_from_actor),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(require_write_access),
):
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers cannot delete all leave requests")
    return delete_all_leave_requests(school_id, status_filter=status_filter)


@router.get("/notifications", response_model=List[AttendanceNotificationResponse])
def list_notifications_endpoint(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return list_notifications(school_id, limit=50)


@router.delete("/notifications/{notification_id}")
def delete_single_notification(
    notification_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_notification(school_id, notification_id)


@router.delete("/notifications")
def delete_all_notifications_endpoint(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
):
    return delete_all_notifications(school_id)


@router.get("/reports/data", response_model=AttendanceReportResponse)
async def get_report_data(
    report_type: str = Query(
        ..., pattern="^(student_summary|staff_summary|leave_summary)$"
    ),
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_names: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
):
    student_records = (
        await collect_student_report_records(
            school_id, class_name, section, batch_names, date_from, date_to
        )
        if report_type == "student_summary"
        else []
    )
    staff_records = (
        list_supabase_staff_records(
            school_id,
            department=department,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
            skip=0,
            limit=500,
        )
        if report_type == "staff_summary"
        else []
    )
    leaves = (
        list_supabase_attendance_leaves(school_id)
        if report_type == "leave_summary"
        else []
    )
    rows = build_report_rows(report_type, student_records, staff_records, leaves)
    return AttendanceReportResponse(
        report_type=report_type,
        generated_at=datetime.now(),
        rows=[AttendanceReportRow(values=row) for row in rows],
        total_records=len(rows),
    )


@router.get("/reports/export")
async def export_report(
    report_type: str = Query(
        ..., pattern="^(student_summary|staff_summary|leave_summary)$"
    ),
    export_format: str = Query(..., pattern="^(excel|pdf)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_names: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
):
    student_records = (
        await collect_student_report_records(
            school_id, class_name, section, batch_names, date_from, date_to
        )
        if report_type == "student_summary"
        else []
    )
    staff_records = (
        list_supabase_staff_records(
            school_id,
            department=department,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
            skip=0,
            limit=500,
        )
        if report_type == "staff_summary"
        else []
    )
    leaves = (
        list_supabase_attendance_leaves(school_id)
        if report_type == "leave_summary"
        else []
    )
    rows = build_report_rows(report_type, student_records, staff_records, leaves)

    if export_format == "excel":
        buffer = build_excel(rows, report_type)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{report_type}.xlsx"'
            },
        )
    buffer = build_pdf(rows, report_type.replace("_", " ").title())
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_type}.pdf"'},
    )


# ==================== Integrated Student Management ====================


@router.get("/integrated-students", response_model=List[AttendanceStudentResponse])
def list_integrated_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
):
    """List students directly from Student Management"""
    return list_supabase_integrated_students(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
        batch=batch,
    )


@router.get("/integrated-staff", response_model=List[AttendanceStaffResponse])
def list_integrated_staff(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(
        default="all", alias="source"
    ),
):
    """List staff directly from Teacher and Invigilator Management"""
    return list_supabase_integrated_staff(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
        department=department,
        source=source,
    )


@router.get("/integrated-overview")
def get_integrated_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    """Get attendance overview using integrated Student and Teacher/Invigilator data"""
    return get_supabase_integrated_overview(school_id)
