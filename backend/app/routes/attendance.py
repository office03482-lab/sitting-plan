"""
Attendance management routes (Supabase-native)
"""

import asyncio
import csv
from datetime import date, datetime, time as dt_time
from io import BytesIO, StringIO
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, user_has_permission
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
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
    list_batch_day_classes,
    get_batch_current_class as get_supabase_batch_current_class,
    get_student_marking as get_supabase_student_marking,
    get_student_calendar as get_supabase_student_calendar,
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
from app.services.bulk_action_requests import create_bulk_action_request, is_platform_admin_user
from app.utils.dashboard_tracing import begin_dashboard_request, finish_dashboard_request
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
    "platform_admin",
    "school_admin",
    "super_admin",
    "admin_office",
    "teacher",
    "hr",
    "hr_admin",
}


def has_write_access_role(actor_role: str | None) -> bool:
    normalized_role = str(actor_role or "").strip().lower()
    return normalized_role in WRITE_ROLES


def require_write_access(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if not has_write_access_role(actor.get("role")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current role cannot modify attendance records",
    )
    return actor


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


def _create_bulk_action_from_route(
    *,
    school_id: str,
    actor: Dict[str, str],
    module_name: str,
    action_type: str,
    reason: str,
    payload_json: dict[str, Any],
) -> JSONResponse:
    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="Authenticated profile is required")
    request = create_bulk_action_request(
        school_id=school_id,
        module_name=module_name,
        action_type=action_type,
        requested_by_profile_id=profile_id,
        requested_role=str(actor.get("role") or "viewer"),
        reason=reason,
        payload_json=payload_json,
    )
    return _bulk_action_response(request, message="Bulk action request created and sent for Super Admin approval.")


def require_leave_create_access(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
) -> Dict[str, str]:
    if actor.get("role") == "super_admin" or user.role == UserRole.ADMIN:
        return actor
    if user_has_permission(user, "attendance.leaves"):
        return actor
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Current role cannot create leave requests",
    )


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
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Table, TableStyle, Spacer, KeepTogether
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from app.utils.pdf_base import (
        ReportPdfBuilder,
        build_shared_styles,
        NAVY, SLATE_700, SLATE_500, SLATE_300, SLATE_200, SLATE_100, SLATE_50,
        WHITE, DARK_TEXT, MEDIUM_TEXT,
        make_paragraph, safe_pdf_text, fmt_timestamp,
    )

    buffer = BytesIO()
    cm = 0.4 * inch  # compact margin
    builder = ReportPdfBuilder(
        buffer,
        pagesize=landscape(A4),
        left_margin=cm, right_margin=cm,
        top_margin=1.2 * inch,
        bottom_margin=0.7 * inch,
        title=title,
        author="Sitting Plan System",
    )

    # ── Branded header drawer ──
    pw, ph = landscape(A4)
    lm = cm

    def _attendance_header(canv, ctx):
        canv.setFillColor(NAVY)
        canv.setFont("Helvetica-Bold", 14)
        canv.drawString(lm, ph - 22, "ATTENDANCE REPORT")
        canv.setFillColor(SLATE_700)
        canv.setFont("Helvetica", 9)
        canv.drawString(lm, ph - 38, safe_pdf_text(ctx.get("title", "")))
        canv.setFillColor(SLATE_500)
        canv.setFont("Helvetica", 7.5)
        canv.drawString(lm, ph - 50, f"Generated: {fmt_timestamp()}")
        canv.setStrokeColor(SLATE_300)
        canv.setLineWidth(0.5)
        canv.line(lm, ph - 56, pw - cm, ph - 56)

    # ── Determine report type and columns ──
    REPORT_TYPES = {
        "Student Summary": {
            "col_widths": [0.8*inch, 2.0*inch, 0.7*inch, 0.7*inch, 0.7*inch, 0.7*inch, 1.0*inch],
            "label": "Student Attendance Summary",
        },
        "Staff Summary": {
            "col_widths": [1.0*inch, 1.8*inch, 1.2*inch, 1.2*inch, 0.8*inch, 0.9*inch, 0.9*inch],
            "label": "Staff Attendance Summary",
        },
        "Leave Summary": {
            "col_widths": [1.8*inch, 1.2*inch, 1.0*inch, 1.0*inch, 0.8*inch, 1.5*inch],
            "label": "Leave Summary",
        },
    }
    rt_key = "Student Summary" if "student" in title.lower() else \
             "Staff Summary" if "staff" in title.lower() else \
             "Leave Summary"
    rt_info = REPORT_TYPES.get(rt_key, REPORT_TYPES["Student Summary"])
    col_widths = rt_info["col_widths"]

    # ── Empty state ──
    if not rows:
        builder.add_title(rt_info["label"])
        builder.add_subtitle(title)
        builder.add_small_note("No records found for the selected criteria.")
        return builder.build(header_context={"title": title})

    # ── Build table data ──
    raw_headers = list(rows[0].keys())
    # Filter out row_type column from display
    display_headers = [h for h in raw_headers if h != "row_type"]
    col_count = len(display_headers)

    styles = build_shared_styles()
    header_paras = [make_paragraph(h.replace("_", " ").title(), styles["table_header"]) for h in display_headers]

    table_rows: list = [header_paras]
    row_type_indices: list[tuple[int, str]] = []  # (data_row_index, row_type)

    for row in rows:
        rtype = str(row.get("row_type", "student"))
        cells = []
        for h in display_headers:
            val = str(row.get(h, ""))
            if rtype in ("overall_total", "batch_total"):
                cells.append(Paragraph(safe_pdf_text(val), styles["table_body_bold"]))
            else:
                cells.append(Paragraph(safe_pdf_text(val), styles["table_body_center"]))
        table_rows.append(cells)
        row_type_indices.append((len(table_rows) - 1, rtype))

    # Adjust col_widths length to match
    if len(col_widths) < col_count:
        col_widths = col_widths + [0.8*inch] * (col_count - len(col_widths))
    elif len(col_widths) > col_count:
        col_widths = col_widths[:col_count]

    # ── Build table with styling ──
    total_rows = len(table_rows)
    table = Table(table_rows, colWidths=col_widths, repeatRows=1, splitByRow=1)

    # Base style
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 1), (-1, -1), 0.4, SLATE_200),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]

    [style_cmds.append(("BACKGROUND", (0, idx), (-1, idx), SLATE_100))
     for idx, rtype in row_type_indices if rtype in ("overall_total", "batch_total")]

    # Zebra striping for regular student rows
    student_rows = [idx for idx, rtype in row_type_indices if rtype == "student"]
    for pos, idx in enumerate(student_rows):
        if pos % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, idx), (-1, idx), WHITE))
        else:
            style_cmds.append(("BACKGROUND", (0, idx), (-1, idx), SLATE_50))

    table.setStyle(TableStyle(style_cmds))

    # ── Assemble document ──
    builder.add_title(rt_info["label"])
    builder.add_subtitle(title)
    builder.add_table(table)
    builder.add_spacer(0.1 * inch)
    builder.add_small_note(f"Total records: {len(rows)}")

    return builder.build(header_context={"title": title})


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
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return AttendanceOverviewResponse(**get_supabase_attendance_overview(school_id))


@router.get("/students", response_model=List[AttendanceStudentResponse])
def list_students(
    tenant: TenantContext = Depends(get_tenant_context),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
):
    school_id = tenant.school_id
    return list_supabase_attendance_students(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
    )


@router.post("/students", response_model=AttendanceStudentResponse)
def create_student(
    payload: AttendanceStudentCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    raise HTTPException(
        status_code=400,
        detail="Student Management se student add/edit karein. Attendance module auto-sync karta hai.",
    )


@router.get("/staff", response_model=List[AttendanceStaffResponse])
def list_staff(
    tenant: TenantContext = Depends(get_tenant_context),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    return list_supabase_attendance_staff(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
    )


@router.post("/staff", response_model=AttendanceStaffResponse)
def create_staff(
    payload: AttendanceStaffCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    raise HTTPException(
        status_code=400,
        detail="Manage Teacher se staff add/edit karein. Attendance module auto-sync karta hai.",
    )


@router.get("/subjects", response_model=List[AttendanceSubjectResponse])
def list_subjects(
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return list_supabase_attendance_subjects(school_id)


@router.post("/subjects", response_model=AttendanceSubjectResponse)
def create_subject(
    payload: AttendanceSubjectCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    raise HTTPException(
        status_code=400,
        detail="Subjects are managed via Course/Subject Management. Attendance module reads subjects from there.",
    )


@router.get("/settings", response_model=AttendanceSettingResponse)
def get_settings(
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return AttendanceSettingResponse(**get_attendance_settings(school_id))


@router.put("/settings", response_model=AttendanceSettingResponse)
def update_attendance_settings_endpoint(
    payload: AttendanceSettingUpdate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return get_supabase_attendance_overview(school_id).get("holidays", [])


@router.post("/holidays", response_model=AttendanceHolidayResponse)
def create_holiday_endpoint(
    payload: AttendanceHolidayCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    return delete_holiday(school_id, holiday_id)


@router.delete("/holidays")
def delete_all_holidays_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if is_platform_admin_user(user):
        return delete_all_holidays(school_id)
    return _create_bulk_action_from_route(
        school_id=school_id,
        actor=actor,
        module_name="attendance",
        action_type="delete_all",
        reason="Delete all attendance holidays requires Super Admin approval.",
        payload_json={"operation": "attendance.delete_all_holidays"},
    )


@router.get("/teacher-current-class", response_model=TeacherAttendanceContextResponse)
def get_teacher_current_class(
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
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


@router.get("/batch-day-classes", response_model=List[TeacherAttendanceContextResponse])
def get_batch_day_classes(
    class_name: str = Query(...),
    section: str = Query(...),
    batch_name: Optional[str] = Query(default=None),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    payload = list_batch_day_classes(
        school_id,
        class_name=class_name,
        section=section,
        batch_name=batch_name,
        target_date=target_date.isoformat() if target_date else None,
        current_time=current_time,
    )
    return [TeacherAttendanceContextResponse(**item) for item in payload]


@router.get("/student-marking", response_model=StudentAttendanceMarkingResponse)
def get_student_marking(
    date: date = Query(...),
    class_name: str = Query(...),
    section: str = Query(...),
    subject_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    date: Optional[date] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
):
    school_id = tenant.school_id
    return StudentAttendanceDashboardSummaryResponse(
        **get_supabase_student_dashboard(
            school_id,
            date_value=date.isoformat() if date else None,
            class_name=class_name,
            batch_name=batch_name,
            scope=scope,
        )
    )


@router.get("/calendar")
async def get_student_calendar(
    month: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    scope: Optional[str] = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return await get_supabase_student_calendar(
        school_id,
        month=month,
        class_name=class_name,
        batch_name=batch_name,
        scope=scope,
    )


@router.delete("/student-records/{record_id}")
def delete_student_record_endpoint(
    record_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    try:
        return delete_student_record(school_id, record_id=record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/student-records")
def delete_all_student_records_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if is_platform_admin_user(user):
        return delete_all_student_records(
            school_id,
            class_name=class_name,
            section=section,
            student_name=student_name,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
        )
    return _create_bulk_action_from_route(
        school_id=school_id,
        actor=actor,
        module_name="attendance",
        action_type="delete_all",
        reason="Delete all student attendance records requires Super Admin approval.",
        payload_json={
            "operation": "attendance.delete_all_student_records",
            "class_name": class_name,
            "section": section,
            "student_name": student_name,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
    )


@router.get("/student-dashboard/{student_id}", response_model=StudentDashboardResponse)
def get_student_dashboard_by_id(
    student_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Student dashboard is computed from records on the frontend in Supabase mode",
    )


@router.get("/staff-marking", response_model=StaffAttendanceMarkingResponse)
def get_staff_marking(
    date: date = Query(...),
    department: str = Query(...),
    search: Optional[str] = Query(default=None),
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    try:
        return delete_supabase_staff_record(school_id, record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/staff-records")
def delete_all_staff_records_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if is_platform_admin_user(user):
        return delete_all_supabase_staff_records(
            school_id,
            department=department,
            staff_name=staff_name,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
        )
    return _create_bulk_action_from_route(
        school_id=school_id,
        actor=actor,
        module_name="staff",
        action_type="delete_all",
        reason="Delete all staff attendance records requires Super Admin approval.",
        payload_json={
            "operation": "attendance.delete_all_staff_records",
            "department": department,
            "staff_name": staff_name,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
    )


@router.get("/staff-dashboard", response_model=StaffDashboardResponse)
async def get_staff_dashboard(
    response: Response,
    tenant: TenantContext = Depends(get_tenant_context),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    del actor
    trace = begin_dashboard_request("attendance_staff_dashboard", school_id)
    response.headers["X-Dashboard-Request-Id"] = str(trace["request_id"])
    try:
        payload = await asyncio.to_thread(
            get_supabase_staff_dashboard,
            school_id,
            department=department,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
            trace=trace,
        )
        finish_dashboard_request(trace, cache_status="service_logged", execution_path="rpc_or_fallback")
        return StaffDashboardResponse(**payload)
    except Exception as exc:
        finish_dashboard_request(trace, cache_status="service_logged", execution_path="error", error=str(exc)[:200])
        raise


@router.get("/leaves", response_model=List[AttendanceLeaveResponse])
def list_leaves(
    tenant: TenantContext = Depends(get_tenant_context),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    return list_supabase_attendance_leaves(
        school_id,
        status_filter=status_filter,
        actor=actor,
    )


@router.post("/leaves", response_model=AttendanceLeaveResponse)
def create_leave(
    payload: AttendanceLeaveCreate,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_leave_create_access),
):
    school_id = tenant.school_id
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
        "leave",
        user_name=actor["name"],
        user_role=actor["role"],
        metadata={"action": "applied"},
    )
    return AttendanceLeaveResponse(**result)


@router.post("/leaves/{leave_id}/decision", response_model=AttendanceLeaveResponse)
def decide_leave(
    leave_id: str,
    payload: AttendanceLeaveDecision,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
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
        "leave",
        user_name=actor["name"],
        user_role=actor["role"],
        metadata={"action": status_val},
    )
    return AttendanceLeaveResponse(**result)


@router.delete("/leaves/{leave_id}")
def delete_leave(
    leave_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    return delete_leave_request(school_id, leave_id)


@router.delete("/leaves")
def delete_all_leaves(
    tenant: TenantContext = Depends(get_tenant_context),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(require_write_access),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers cannot delete all leave requests")
    if is_platform_admin_user(user):
        return delete_all_leave_requests(school_id, status_filter=status_filter)
    return _create_bulk_action_from_route(
        school_id=school_id,
        actor=actor,
        module_name="leaves",
        action_type="delete_all",
        reason="Delete all leave requests requires Super Admin approval.",
        payload_json={"operation": "attendance.delete_all_leaves", "status": status_filter},
    )


@router.get("/notifications", response_model=List[AttendanceNotificationResponse])
def list_notifications_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
):
    school_id = tenant.school_id
    return list_notifications(school_id, limit=50)


@router.delete("/notifications/{notification_id}")
def delete_single_notification(
    notification_id: str,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
):
    school_id = tenant.school_id
    return delete_notification(school_id, notification_id)


@router.delete("/notifications")
def delete_all_notifications_endpoint(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: Dict[str, str] = Depends(require_write_access),
    user: User = Depends(get_authenticated_user),
):
    school_id = tenant.school_id
    if is_platform_admin_user(user):
        return delete_all_notifications(school_id)
    return _create_bulk_action_from_route(
        school_id=school_id,
        actor=actor,
        module_name="attendance",
        action_type="delete_all",
        reason="Delete all attendance notifications requires Super Admin approval.",
        payload_json={"operation": "attendance.delete_all_notifications"},
    )


@router.get("/reports/data", response_model=AttendanceReportResponse)
async def get_report_data(
    report_type: str = Query(
        ..., pattern="^(student_summary|staff_summary|leave_summary)$"
    ),
    tenant: TenantContext = Depends(get_tenant_context),
    batch_names: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
):
    school_id = tenant.school_id
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
    export_format: str = Query(..., pattern="^(excel|pdf|csv)$"),
    tenant: TenantContext = Depends(get_tenant_context),
    batch_names: Optional[str] = Query(default=None),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
):
    school_id = tenant.school_id
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

    if export_format == "csv":
        text_buffer = StringIO()
        if rows:
            headers = list(rows[0].keys())
            writer = csv.DictWriter(text_buffer, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow({header: row.get(header, "") for header in headers})
        else:
            writer = csv.writer(text_buffer)
            writer.writerow(["message"])
            writer.writerow(["No records found"])
        binary_buffer = BytesIO(text_buffer.getvalue().encode("utf-8"))
        binary_buffer.seek(0)
        return StreamingResponse(
            binary_buffer,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{report_type}.csv"'},
        )

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
    tenant: TenantContext = Depends(get_tenant_context),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
):
    """List students directly from Student Management"""
    school_id = tenant.school_id
    return list_supabase_integrated_students(
        school_id,
        skip=skip,
        limit=limit,
        search=search,
        batch=batch,
    )


@router.get("/integrated-staff", response_model=List[AttendanceStaffResponse])
def list_integrated_staff(
    tenant: TenantContext = Depends(get_tenant_context),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    source: Optional[str] = Query(
        default="all", alias="source"
    ),
):
    """List staff directly from Teacher and Invigilator Management"""
    school_id = tenant.school_id
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
    tenant: TenantContext = Depends(get_tenant_context),
):
    """Get attendance overview using integrated Student and Teacher/Invigilator data"""
    school_id = tenant.school_id
    return get_supabase_integrated_overview(school_id)
