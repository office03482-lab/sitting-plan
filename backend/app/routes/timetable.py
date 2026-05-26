"""
Timetable management routes
"""
import asyncio
from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import Room, Teacher, TimetableEntry, UserRole
from app.schemas import (
    ConflictCheckResponse,
    DayOfWeek,
    TimetableEntryCreate,
    TimetableEntryResponse,
    TimetableEntryUpdate,
    TimetableView,
)
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import is_legacy_sqlite_mode, resolve_school_id_from_actor
from app.services.supabase_timetable import (
    check_teacher_conflicts as check_teacher_conflicts_supabase,
    create_timetable_entry as create_timetable_entry_supabase,
    delete_all_timetable_entries as delete_all_timetable_entries_supabase,
    delete_timetable_entry as delete_timetable_entry_supabase,
    get_timetable_entry as get_timetable_entry_supabase,
    list_timetable_entries as list_timetable_entries_supabase,
    update_timetable_entry as update_timetable_entry_supabase,
)

router = APIRouter()
utility_router = APIRouter()

DAYS_ORDER = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
    DayOfWeek.SUNDAY,
]
DAYS_LABELS = {day.value: day.value.capitalize() for day in DAYS_ORDER}
EXPORT_GROUPINGS = {"day", "teacher", "room", "batch"}
SESSION_MODE_FILTERS = {"all", "offline", "online", "merged"}
BREAK_TEACHER_NAME = "__BREAK_SESSION__"
SELF_STUDY_TEACHER_NAME = "__SELF_STUDY_SESSION__"
DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def get_day_of_week_from_date(date_str: str) -> str:
    parts = date_str.split("-")
    d = date(int(parts[0]), int(parts[1]), int(parts[2]))
    return DAY_NAMES[d.weekday()]





def resolve_teacher_for_actor(db: Session, school_id: int, actor: Dict[str, str]) -> Optional[Teacher]:
    if actor.get("role") != UserRole.TEACHER.value:
        return None
    actor_email = (actor.get("email") or "").strip().lower()
    actor_name = (actor.get("name") or "").strip()
    if actor_email:
        teacher = (
            db.query(Teacher)
            .filter(
                Teacher.school_id == school_id,
                Teacher.is_active == True,
                func.lower(func.trim(Teacher.email)) == actor_email,
            )
            .first()
        )
        if teacher:
            return teacher
    if not actor_name:
        return None
    return (
        db.query(Teacher)
        .filter(
            Teacher.school_id == school_id,
            Teacher.is_active == True,
            func.lower(func.trim(Teacher.name)) == actor_name.lower(),
        )
        .first()
    )


def require_timetable_manage_access(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers can only view their own timetable")
    return actor


def format_time_label(time_value: str) -> str:
    parsed = datetime.strptime(time_value, "%H:%M")
    return parsed.strftime("%I:%M %p")


def format_time_range(start_time: str, end_time: str) -> str:
    return f"{format_time_label(start_time)} TO {format_time_label(end_time)}"


def format_session_type(value: Optional[str]) -> str:
    mapping = {
        "regular_class": "Regular Class",
        "break_time": "Break Time",
        "doubt_session": "Doubt Session",
        "extra_class": "Extra Class",
        "self_study": "Self Study",
    }
    return mapping.get(value or "regular_class", "Regular Class")


def is_break_entry(entry: TimetableView) -> bool:
    subject_value = (entry.subject or "").strip().lower()
    return entry.session_type == "break_time" or subject_value == "break time"


def is_self_study_entry(entry: TimetableView) -> bool:
    subject_value = (entry.subject or "").strip().lower()
    return entry.session_type == "self_study" or subject_value == "self study"


def is_no_teacher_session(session_type: Optional[str], subject: Optional[str] = None) -> bool:
    normalized_type = (session_type or "").strip().lower()
    normalized_subject = (subject or "").strip().lower()
    return normalized_type in {"break_time", "self_study"} or normalized_subject in {"break time", "self study"}


def build_subject_label(entry: TimetableView) -> str:
    if is_break_entry(entry):
        return "BREAK TIME"
    return (entry.subject or "").strip()


def build_location_label(entry: TimetableView) -> str:
    if is_break_entry(entry):
        return "BREAK TIME"
    return entry.room_name or "-"


def build_teacher_label(entry: TimetableView) -> str:
    if is_break_entry(entry):
        return "BREAK TIME"
    if is_self_study_entry(entry):
        return "SELF STUDY"
    return entry.teacher_name or ""


def build_mode_type_label(entry: TimetableView) -> str:
    if is_break_entry(entry):
        return "BREAK TIME"
    return "Online" if entry.session_mode == "online" else "Offline"


def normalize_session_mode_filter(session_mode_filter: Optional[str]) -> str:
    value = (session_mode_filter or "all").strip().lower()
    return value if value in SESSION_MODE_FILTERS else "all"


def build_export_title(view_by: str, session_mode_filter: str) -> str:
    if session_mode_filter == "merged":
        return f"TIMETABLE EXPORT - MERGED ONLINE/OFFLINE - {view_by.upper()} WISE"
    if session_mode_filter in {"online", "offline"}:
        return f"TIMETABLE EXPORT - {session_mode_filter.upper()} - {view_by.upper()} WISE"
    return f"TIMETABLE EXPORT - {view_by.upper()} WISE"


def split_batch_names(class_name: str) -> List[str]:
    values = [(item or "").strip() for item in (class_name or "").split(",")]
    return [item for item in values if item]


def build_timetable_view(entry: TimetableEntry, teacher_name: str, room_name: Optional[str]) -> TimetableView:
    timetable_view = TimetableView(
        id=entry.id,
        day_of_week=entry.day_of_week,
        start_time=entry.start_time,
        end_time=entry.end_time,
        class_name=entry.class_name,
        subject=entry.subject,
        teacher_name=teacher_name,
        teacher_id=entry.teacher_id,
        room_id=entry.room_id,
        room_name=room_name,
        session_mode=entry.session_mode or "offline",
        session_type=entry.session_type or "regular_class",
        extra_class_scope=entry.extra_class_scope,
        online_platform=entry.online_platform,
        online_link=entry.online_link,
        notes=entry.notes,
    )
    if is_break_entry(timetable_view):
        timetable_view.teacher_name = "BREAK TIME"
    elif is_self_study_entry(timetable_view):
        timetable_view.teacher_name = "SELF STUDY"
    return timetable_view


def build_timetable_response(entry: TimetableEntry, teacher_name: Optional[str], room_name: Optional[str]) -> TimetableEntryResponse:
    response = TimetableEntryResponse(
        id=entry.id,
        teacher_id=entry.teacher_id,
        room_id=entry.room_id,
        school_id=entry.school_id,
        day_of_week=entry.day_of_week,
        start_time=entry.start_time,
        end_time=entry.end_time,
        class_name=entry.class_name,
        subject=entry.subject,
        is_active=entry.is_active,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        teacher_name=teacher_name,
        room_name=room_name,
        session_mode=entry.session_mode or "offline",
        session_type=entry.session_type or "regular_class",
        extra_class_scope=entry.extra_class_scope,
        online_platform=entry.online_platform,
        online_link=entry.online_link,
        notes=entry.notes,
    )
    if response.session_type == "break_time" or (response.subject or "").strip().lower() == "break time":
        response.teacher_name = "Break Time"
    elif response.session_type == "self_study" or (response.subject or "").strip().lower() == "self study":
        response.teacher_name = "Self Study"
    return response


def get_entry_query(db: Session, school_id: int):
    return (
        db.query(
            TimetableEntry,
            Teacher.name.label("teacher_name"),
            Room.name.label("room_name"),
        )
        .outerjoin(Teacher, TimetableEntry.teacher_id == Teacher.id)
        .outerjoin(Room, TimetableEntry.room_id == Room.id)
        .filter(
            TimetableEntry.school_id == school_id,
            TimetableEntry.is_active == True,
        )
    )


def ensure_break_teacher(db: Session, school_id: int) -> Teacher:
    teacher = (
        db.query(Teacher)
        .filter(
            Teacher.school_id == school_id,
            Teacher.name == BREAK_TEACHER_NAME,
        )
        .first()
    )
    if teacher:
        return teacher

    teacher = Teacher(
        name=BREAK_TEACHER_NAME,
        subject="system",
        school_id=school_id,
        email=None,
        phone=None,
        is_active=False,
    )
    db.add(teacher)
    db.flush()
    return teacher


def ensure_self_study_teacher(db: Session, school_id: int) -> Teacher:
    teacher = (
        db.query(Teacher)
        .filter(
            Teacher.school_id == school_id,
            Teacher.name == SELF_STUDY_TEACHER_NAME,
        )
        .first()
    )
    if teacher:
        return teacher

    teacher = Teacher(
        name=SELF_STUDY_TEACHER_NAME,
        subject="system",
        school_id=school_id,
        email=None,
        phone=None,
        is_active=False,
    )
    db.add(teacher)
    db.flush()
    return teacher


def fetch_export_rows(
    db: Session,
    school_id: int,
    view_by: str,
    session_mode_filter: str = "all",
    day_of_week: Optional[DayOfWeek] = None,
    teacher_id: Optional[int] = None,
    room_id: Optional[int] = None,
    batch_name: Optional[str] = None,
) -> List[TimetableView]:
    query = get_entry_query(db, school_id)
    normalized_mode_filter = normalize_session_mode_filter(session_mode_filter)

    if day_of_week:
        query = query.filter(TimetableEntry.day_of_week == day_of_week)
    if teacher_id:
        query = query.filter(TimetableEntry.teacher_id == teacher_id)
    if room_id:
        query = query.filter(TimetableEntry.room_id == room_id)
    if batch_name:
        query = query.filter(TimetableEntry.class_name.ilike(f"%{batch_name.strip()}%"))
    if normalized_mode_filter in {"online", "offline"}:
        query = query.filter(TimetableEntry.session_mode == normalized_mode_filter)

    results = query.order_by(
        TimetableEntry.day_of_week,
        TimetableEntry.class_name,
        TimetableEntry.start_time,
        TimetableEntry.id,
    ).all()

    rows = [
        build_timetable_view(result.TimetableEntry, result.teacher_name, result.room_name)
        for result in results
    ]

    if view_by != "batch":
        return rows

    batch_rows: List[TimetableView] = []
    for item in rows:
        for batch in split_batch_names(item.class_name):
            batch_rows.append(
                TimetableView(
                    id=item.id,
                    day_of_week=item.day_of_week,
                    start_time=item.start_time,
                    end_time=item.end_time,
                    class_name=batch,
                    subject=item.subject,
                    teacher_name=item.teacher_name,
                    teacher_id=item.teacher_id,
                    room_id=item.room_id,
                    room_name=item.room_name,
                    session_mode=item.session_mode,
                    session_type=item.session_type,
                    extra_class_scope=item.extra_class_scope,
                    online_platform=item.online_platform,
                    online_link=item.online_link,
                    notes=item.notes,
                )
            )
    return batch_rows


def coerce_timetable_views(entries: List[TimetableView | Dict[str, object]]) -> List[TimetableView]:
    normalized: List[TimetableView] = []
    for entry in entries:
        if isinstance(entry, TimetableView):
            normalized.append(entry)
        else:
            normalized.append(TimetableView(**entry))
    return normalized


def group_entries_for_export(entries: List[TimetableView], view_by: str, session_mode_filter: str = "all") -> List[Dict[str, object]]:
    grouped: Dict[str, List[TimetableView]] = defaultdict(list)
    titles: Dict[str, str] = {}
    normalized_mode_filter = normalize_session_mode_filter(session_mode_filter)

    for entry in entries:
        entry_mode = (entry.session_mode or "offline").upper()
        prefix = f"{entry_mode} | " if normalized_mode_filter == "merged" else ""
        mode_key_prefix = f"{entry.session_mode or 'offline'}::" if normalized_mode_filter == "merged" else ""

        if view_by == "teacher":
            key = f"{mode_key_prefix}{entry.teacher_name}"
            title = f"{prefix}{entry.teacher_name.upper()}"
        elif view_by == "room":
            room_label = entry.room_name or "NO ROOM"
            key = f"{mode_key_prefix}{room_label}"
            title = f"{prefix}{room_label.upper()}"
        elif view_by == "batch":
            key = f"{mode_key_prefix}{entry.class_name}"
            title = f"{prefix}{entry.class_name.upper()}"
        else:
            key = f"{entry.session_mode or 'offline'}-{entry.day_of_week.value}" if normalized_mode_filter == "merged" else entry.day_of_week.value
            title = f"{prefix}{DAYS_LABELS[entry.day_of_week.value].upper()} TIMETABLE"

        grouped[key].append(entry)
        titles[key] = title

    sections: List[Dict[str, object]] = []
    for key in sorted(grouped.keys()):
        section_entries = sorted(
            grouped[key],
            key=lambda item: (item.day_of_week.value, item.start_time, item.teacher_name.lower(), item.class_name.lower()),
        )
        sections.append(
            {
                "key": key,
                "title": titles[key],
                "entries": section_entries,
            }
        )
    return sections


def create_timetable_excel(entries: List[TimetableView], view_by: str, session_mode_filter: str = "all") -> BytesIO:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Timetable Export"
    worksheet.freeze_panes = "A2"

    thin = Side(style="thin", color="1E3A8A")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    title_fill = PatternFill("solid", fgColor="00A3E0")
    time_fill = PatternFill("solid", fgColor="F4C542")
    row_fill = PatternFill("solid", fgColor="E8FF72")

    worksheet.merge_cells("A1:G1")
    worksheet["A1"] = build_export_title(view_by, normalize_session_mode_filter(session_mode_filter))
    worksheet["A1"].font = Font(size=16, bold=True, color="FFFFFF")
    worksheet["A1"].fill = title_fill
    worksheet["A1"].alignment = Alignment(horizontal="center", vertical="center")

    row_cursor = 3
    sections = group_entries_for_export(entries, view_by, session_mode_filter)
    for section in sections:
        worksheet.merge_cells(start_row=row_cursor, start_column=1, end_row=row_cursor, end_column=7)
        cell = worksheet.cell(row=row_cursor, column=1)
        cell.value = section["title"]
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = title_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
        row_cursor += 1

        headers = ["TIMINGS", "DAY", "BATCH / CLASS", "TEACHER", "SUBJECT", "MODE TYPE", "ROOM"]
        for col_index, header in enumerate(headers, start=1):
            header_cell = worksheet.cell(row=row_cursor, column=col_index)
            header_cell.value = header
            header_cell.font = Font(bold=True)
            header_cell.fill = time_fill if col_index == 1 else title_fill
            header_cell.alignment = Alignment(horizontal="center", vertical="center")
            header_cell.border = border
        row_cursor += 1

        for entry in section["entries"]:
            values = [
                format_time_range(entry.start_time, entry.end_time),
                DAYS_LABELS[entry.day_of_week.value],
                entry.class_name,
                build_teacher_label(entry),
                build_subject_label(entry),
                build_mode_type_label(entry),
                build_location_label(entry),
            ]
            for col_index, value in enumerate(values, start=1):
                data_cell = worksheet.cell(row=row_cursor, column=col_index)
                data_cell.value = value
                data_cell.fill = time_fill if col_index == 1 else row_fill
                data_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                data_cell.border = border
            row_cursor += 1

        row_cursor += 1

    widths = {
        "A": 22,
        "B": 14,
        "C": 28,
        "D": 26,
        "E": 24,
        "F": 16,
        "G": 18,
    }
    for column, width in widths.items():
        worksheet.column_dimensions[column].width = width

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def create_timetable_pdf(entries: List[TimetableView], view_by: str, session_mode_filter: str = "all") -> BytesIO:
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=20,
        rightMargin=20,
        topMargin=20,
        bottomMargin=20,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        alignment=1,
        textColor=colors.white,
        backColor=colors.HexColor("#00A3E0"),
        spaceAfter=10,
        leading=18,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        alignment=1,
        textColor=colors.white,
        backColor=colors.HexColor("#00A3E0"),
        spaceBefore=8,
        spaceAfter=6,
        leading=16,
    )

    story = [Paragraph(build_export_title(view_by, normalize_session_mode_filter(session_mode_filter)), title_style), Spacer(1, 8)]
    sections = group_entries_for_export(entries, view_by, session_mode_filter)
    for section in sections:
        story.append(Paragraph(str(section["title"]), section_style))
        table_rows = [["TIMINGS", "DAY", "BATCH / CLASS", "TEACHER", "SUBJECT", "MODE TYPE", "ROOM"]]
        for entry in section["entries"]:
            table_rows.append(
                [
                    format_time_range(entry.start_time, entry.end_time),
                    DAYS_LABELS[entry.day_of_week.value],
                    entry.class_name,
                    build_teacher_label(entry),
                    build_subject_label(entry),
                    build_mode_type_label(entry),
                    build_location_label(entry),
                ]
            )

        table = Table(table_rows, colWidths=[100, 65, 120, 105, 105, 75, 80], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#00A3E0")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#F4C542")),
                    ("BACKGROUND", (1, 1), (-1, -1), colors.HexColor("#E8FF72")),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#1E3A8A")),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                    ("TOPPADDING", (0, 0), (-1, 0), 8),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 10))

    document.build(story)
    buffer.seek(0)
    return buffer


def check_teacher_conflict(
    db: Session,
    teacher_id: int,
    day_of_week: DayOfWeek,
    start_time: str,
    end_time: str,
    exclude_entry_id: int = None,
) -> List[TimetableEntry]:
    """
    Check if teacher has conflicting timetable entries
    """
    query = db.query(TimetableEntry).filter(
        TimetableEntry.teacher_id == teacher_id,
        TimetableEntry.day_of_week == day_of_week,
        TimetableEntry.is_active == True,
    )

    if exclude_entry_id:
        query = query.filter(TimetableEntry.id != exclude_entry_id)

    existing_entries = query.all()

    conflicts = []
    for entry in existing_entries:
        if start_time < entry.end_time and end_time > entry.start_time:
            conflicts.append(entry)

    return conflicts


@router.post("", response_model=TimetableEntryResponse)
async def create_timetable_entry(
    entry: TimetableEntryCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return create_timetable_entry_supabase(school_id, entry.model_dump())

    is_break_session = entry.session_type == "break_time"
    is_no_teacher_entry = is_no_teacher_session(entry.session_type, entry.subject)
    teacher = None
    if is_break_session:
        teacher = ensure_break_teacher(db, school_id)
    elif entry.session_type == "self_study":
        teacher = ensure_self_study_teacher(db, school_id)
    elif not is_no_teacher_entry:
        if not entry.teacher_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is required")
        teacher = db.query(Teacher).filter(
            Teacher.id == entry.teacher_id,
            Teacher.school_id == school_id,
            Teacher.is_active == True,
        ).first()
        if not teacher:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")

    room_name = None
    if entry.room_id:
        room = db.query(Room).filter(Room.id == entry.room_id, Room.school_id == school_id).first()
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
        room_name = room.name

    conflicts = []
    if not is_no_teacher_entry and teacher:
        conflicts = check_teacher_conflict(db, teacher.id, entry.day_of_week, entry.start_time, entry.end_time)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Teacher conflict: {teacher.name} is already assigned to {conflicts[0].class_name} during this time",
        )

    db_entry = TimetableEntry(
        teacher_id=teacher.id if teacher else None,
        room_id=entry.room_id,
        school_id=school_id,
        session_mode=entry.session_mode,
        session_type=entry.session_type,
        extra_class_scope=entry.extra_class_scope,
        online_platform=entry.online_platform,
        online_link=entry.online_link,
        notes=entry.notes,
        day_of_week=entry.day_of_week,
        start_time=entry.start_time,
        end_time=entry.end_time,
        class_name=entry.class_name,
        subject=entry.subject,
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)

    return build_timetable_response(db_entry, teacher.name if teacher else None, room_name)


@router.get("", response_model=List[TimetableView])
async def list_timetable_entries(
    school_id: str = Depends(resolve_school_id_from_actor),
    day_of_week: Optional[DayOfWeek] = None,
    teacher_id: Optional[str | int] = None,
    class_name: Optional[str] = None,
    room_id: Optional[str | int] = None,
    reference_date: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: list_timetable_entries_supabase(
                school_id,
                day_of_week=day_of_week.value if day_of_week else None,
                teacher_id=str(teacher_id) if teacher_id else None,
                class_name=class_name,
                room_id=str(room_id) if room_id else None,
                reference_date=reference_date.isoformat() if reference_date else None,
            ),
        )

    query = get_entry_query(db, school_id)
    actor_teacher = resolve_teacher_for_actor(db, school_id, actor)
    if actor.get("role") == UserRole.TEACHER.value:
        if not actor_teacher:
            return []
        teacher_id = actor_teacher.id

    if day_of_week:
        query = query.filter(TimetableEntry.day_of_week == day_of_week)
    if teacher_id:
        query = query.filter(TimetableEntry.teacher_id == teacher_id)
    if class_name:
        query = query.filter(TimetableEntry.class_name.ilike(f"%{class_name.strip()}%"))
    if room_id:
        query = query.filter(TimetableEntry.room_id == room_id)

    results = query.order_by(TimetableEntry.day_of_week, TimetableEntry.start_time, TimetableEntry.class_name).all()
    return [build_timetable_view(result.TimetableEntry, result.teacher_name, result.room_name) for result in results]


@router.get("/export")
async def export_timetable(
    export_format: str = Query(..., pattern="^(excel|pdf)$"),
    view_by: str = Query(default="day", pattern="^(day|teacher|room|batch)$"),
    session_mode_filter: str = Query(default="all", pattern="^(all|offline|online|merged)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    day_of_week: Optional[DayOfWeek] = Query(default=None),
    teacher_id: Optional[str | int] = Query(default=None),
    room_id: Optional[str | int] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        entries = coerce_timetable_views(list_timetable_entries_supabase(
            school_id,
            day_of_week=day_of_week.value if day_of_week else None,
            teacher_id=str(teacher_id) if teacher_id else None,
            class_name=batch_name if view_by == "batch" else None,
            room_id=str(room_id) if room_id else None,
        ))
        if not entries:
            raise HTTPException(status_code=404, detail="No timetable entries found for export")

        if export_format == "excel":
            buffer = create_timetable_excel(entries, view_by, session_mode_filter)
            filename = f"timetable-{session_mode_filter}-{view_by}-wise.xlsx"
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            buffer = create_timetable_pdf(entries, view_by, session_mode_filter)
            filename = f"timetable-{session_mode_filter}-{view_by}-wise.pdf"
            media_type = "application/pdf"

        return StreamingResponse(
            buffer,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    actor_teacher = resolve_teacher_for_actor(db, school_id, actor)
    if actor.get("role") == UserRole.TEACHER.value:
        if not actor_teacher:
            raise HTTPException(status_code=404, detail="Teacher timetable not found")
        teacher_id = actor_teacher.id
        view_by = "teacher"
        room_id = None
        batch_name = None
    entries = fetch_export_rows(
        db,
        school_id,
        view_by=view_by,
        session_mode_filter=session_mode_filter,
        day_of_week=day_of_week,
        teacher_id=teacher_id,
        room_id=room_id,
        batch_name=batch_name,
    )
    if not entries:
        raise HTTPException(status_code=404, detail="No timetable entries found for export")

    if export_format == "excel":
        buffer = create_timetable_excel(entries, view_by, session_mode_filter)
        filename = f"timetable-{session_mode_filter}-{view_by}-wise.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        buffer = create_timetable_pdf(entries, view_by, session_mode_filter)
        filename = f"timetable-{session_mode_filter}-{view_by}-wise.pdf"
        media_type = "application/pdf"

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{entry_id}", response_model=TimetableEntryResponse)
async def get_timetable_entry(
    entry_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return get_timetable_entry_supabase(school_id, entry_id)

    result = get_entry_query(db, school_id).filter(TimetableEntry.id == entry_id).first()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable entry not found")
    actor_teacher = resolve_teacher_for_actor(db, school_id, actor)
    if actor.get("role") == UserRole.TEACHER.value and (
        not actor_teacher or result.TimetableEntry.teacher_id != actor_teacher.id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable entry not found")
    return build_timetable_response(result.TimetableEntry, result.teacher_name, result.room_name)


@router.put("/{entry_id}", response_model=TimetableEntryResponse)
async def update_timetable_entry(
    entry_id: str,
    entry_update: TimetableEntryUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return update_timetable_entry_supabase(school_id, entry_id, entry_update.model_dump(exclude_unset=True))

    entry = db.query(TimetableEntry).filter(
        TimetableEntry.id == entry_id,
        TimetableEntry.school_id == school_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable entry not found")

    next_session_type = entry_update.session_type or entry.session_type
    next_subject = entry_update.subject or entry.subject
    is_break_session = next_session_type == "break_time"
    is_no_teacher_entry = is_no_teacher_session(next_session_type, next_subject)
    teacher_id = entry_update.teacher_id if entry_update.teacher_id is not None else entry.teacher_id
    day_of_week = entry_update.day_of_week or entry.day_of_week
    start_time = entry_update.start_time or entry.start_time
    end_time = entry_update.end_time or entry.end_time

    if is_break_session:
        teacher_id = ensure_break_teacher(db, school_id).id
    elif next_session_type == "self_study":
        teacher_id = ensure_self_study_teacher(db, school_id).id
    elif is_no_teacher_entry:
        teacher_id = entry.teacher_id
    elif not teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teacher is required")

    conflicts = []
    if not is_no_teacher_entry:
        conflicts = check_teacher_conflict(db, teacher_id, day_of_week, start_time, end_time, entry_id)
    if conflicts:
        teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Teacher conflict: {teacher.name if teacher else 'Teacher'} is already assigned to {conflicts[0].class_name} during this time",
        )

    update_data = entry_update.dict(exclude_unset=True)
    update_data["teacher_id"] = teacher_id
    if "room_id" in update_data and update_data["room_id"] is not None:
        room = db.query(Room).filter(Room.id == update_data["room_id"], Room.school_id == school_id).first()
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    for field, value in update_data.items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)

    teacher = db.query(Teacher).filter(Teacher.id == entry.teacher_id).first()
    room = db.query(Room).filter(Room.id == entry.room_id).first() if entry.room_id else None
    return build_timetable_response(entry, teacher.name if teacher else None, room.name if room else None)


@router.delete("/{entry_id}")
async def delete_timetable_entry(
    entry_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return delete_timetable_entry_supabase(school_id, entry_id)

    entry = db.query(TimetableEntry).filter(
        TimetableEntry.id == entry_id,
        TimetableEntry.school_id == school_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable entry not found")

    entry.is_active = False
    db.commit()
    return {"message": "Timetable entry deleted successfully"}


@router.delete("")
async def delete_all_timetable_entries(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_admin: bool = Query(default=False),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
    db: Session = Depends(get_db),
):
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admin can delete all timetable entries")

    if not is_legacy_sqlite_mode():
        return delete_all_timetable_entries_supabase(school_id)

    entries = db.query(TimetableEntry).filter(TimetableEntry.school_id == school_id, TimetableEntry.is_active == True).all()
    for entry in entries:
        entry.is_active = False
    db.commit()
    return {"message": f"{len(entries)} timetable entries deleted successfully"}


@router.post("/check-conflict", response_model=ConflictCheckResponse)
async def check_conflict(
    teacher_id: str | int = Body(...),
    day_of_week: DayOfWeek = Body(...),
    start_time: str = Body(...),
    end_time: str = Body(...),
    exclude_entry_id: str | int = Body(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        conflicts = check_teacher_conflicts_supabase(
            school_id,
            str(teacher_id),
            day_of_week.value,
            start_time,
            end_time,
            exclude_entry_id=str(exclude_entry_id) if exclude_entry_id else None,
        )
        if conflicts:
            return ConflictCheckResponse(
                has_conflict=True,
                conflicting_entries=[
                    get_timetable_entry_supabase(school_id, str(conflict["id"]))
                    for conflict in conflicts
                ],
                message="Conflict detected: Teacher is already assigned during this time slot",
            )
    return ConflictCheckResponse(has_conflict=False, message="No conflicts detected")


@utility_router.get("/template")
async def download_timetable_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "Timetable Template"
    headers = ["Date", "Day", "Teacher", "Batch/Class", "Subject", "Start Time", "End Time", "Room", "Mode"]
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 25
    ws.column_dimensions["D"].width = 20
    ws.column_dimensions["E"].width = 20
    ws.column_dimensions["F"].width = 14
    ws.column_dimensions["G"].width = 14
    ws.column_dimensions["H"].width = 20
    ws.column_dimensions["I"].width = 12
    stream = BytesIO()
    wb.save(stream)
    stream.seek(0)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=timetable_template.xlsx"},
    )


@utility_router.post("/upload")
async def upload_timetable_excel(
    file: UploadFile = File(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_timetable_manage_access),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx or .xls files are supported")
    contents = await file.read()
    try:
        wb = load_workbook(BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel file parse nahi ho paaya: {e}")
    ws = wb.active
    try:
        rows = list(ws.iter_rows(min_row=2, values_only=True))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel rows parse nahi ho paaya: {e}")
    created = []
    errors = []
    supabase = get_supabase_admin_client()
    teacher_cache: dict[str, str | None] = {}
    room_cache: dict[str, str | None] = {}
    teacher_subject_cache: dict[str, str] = {}

    try:
        # Pre-load teacher subject assignments from academic schema
        try:
            acad = get_supabase_admin_client()
            assignments_resp = (
                acad.schema("academic").table("staff_subject_assignments")
                .select("staff_member_id, subject_id")
                .eq("school_id", school_id)
                .eq("is_active", True)
                .execute()
            )
            for a in (assignments_resp.data or []):
                sm_id = str(a.get("staff_member_id") or "")
                subj_id = str(a.get("subject_id") or "")
                if sm_id and subj_id:
                    teacher_subject_cache[sm_id] = subj_id
        except Exception as e:
            errors.append(f"Subject assignments load failed: {e}")

        # Pre-load subject names
        subject_name_cache: dict[str, str] = {}
        try:
            subjects_resp = (
                supabase.table("subjects")
                .select("id, name")
                .eq("school_id", school_id)
                .execute()
            )
            for s in (subjects_resp.data or []):
                subject_name_cache[str(s.get("id"))] = str(s.get("name") or "")
        except Exception as e:
            errors.append(f"Subjects load failed: {e}")

        def resolve_teacher_id(name: str) -> str | None:
            if not name or not name.strip():
                return None
            key = name.strip().lower()
            if key in teacher_cache:
                return teacher_cache[key]
            response = (
                supabase.table("staff_members")
                .select("id")
                .ilike("full_name", f"%{name.strip()}%")
                .eq("school_id", school_id)
                .limit(1)
                .execute()
            )
            data = response.data if isinstance(response.data, list) else []
            result = str(data[0]["id"]) if data else None
            teacher_cache[key] = result
            return result

        def resolve_room_id(name: str) -> str | None:
            if not name or not name.strip():
                return None
            name_key = name.strip().lower()
            if name_key in room_cache:
                return room_cache[name_key]
            response = (
                supabase.table("rooms")
                .select("id")
                .ilike("name", f"%{name.strip()}%")
                .eq("school_id", school_id)
                .limit(1)
                .execute()
            )
            data = response.data if isinstance(response.data, list) else []
            result = str(data[0]["id"]) if data else None
            room_cache[name_key] = result
            return result

        payloads: list[dict[str, Any]] = []
        for idx, row in enumerate(rows, 2):
            date_val, day_val, teacher_name, batch_val, subject_val, start_time, end_time, room_name, mode_val = (
                (str(v).strip() if v else "") for v in (row + (None,) * (9 - len(row)))[:9]
            )
            if not teacher_name or not batch_val or not start_time or not end_time:
                errors.append(f"Row {idx}: Teacher, Batch, Start Time, End Time required")
                continue
            if not date_val:
                errors.append(f"Row {idx}: Date required")
                continue

            teacher_id = resolve_teacher_id(teacher_name)
            if not teacher_id:
                errors.append(f"Row {idx}: Teacher '{teacher_name}' system mein nahi mila")
                continue
            room_id = resolve_room_id(room_name) if room_name else None
            day_of_week = day_val.lower() if day_val else get_day_of_week_from_date(date_val)

            # Auto-detect subject if not provided
            if not subject_val or subject_val.strip() == "":
                detected_subject_id = teacher_subject_cache.get(teacher_id)
                if detected_subject_id:
                    subject_val = subject_name_cache.get(detected_subject_id, "General")
                else:
                    try:
                        teacher_info = (
                            supabase.table("staff_members")
                            .select("department")
                            .eq("id", teacher_id)
                            .single()
                            .execute()
                        )
                        dept = (teacher_info.data or {}).get("department") or ""
                        subject_val = dept if dept.strip() else "General"
                    except Exception:
                        subject_val = "General"

            payloads.append({
                "teacher_id": teacher_id,
                "room_id": room_id,
                "school_id": school_id,
                "day_of_week": day_of_week,
                "start_time": start_time[:5],
                "end_time": end_time[:5],
                "class_name": batch_val,
                "subject": subject_val or "General",
                "session_mode": mode_val.lower() if mode_val in ("offline", "online") else "offline",
                "session_type": "regular_class",
                "start_date": date_val[:10],
                "skip_conflict_check": True,
            })

        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(create_timetable_entry_supabase, school_id, p): i for i, p in enumerate(payloads)}
            for future in as_completed(futures):
                idx = futures[future]
                try:
                    result = future.result()
                    created.append(result)
                except Exception as e:
                    errors.append(f"Row {idx + 2}: {str(e)}")

    except Exception as e:
        errors.append(f"Upload processing failed: {e}")

    return {
        "created": len(created),
        "errors": errors,
        "entries": created,
    }

    conflicts = check_teacher_conflict(db, teacher_id, day_of_week, start_time, end_time, exclude_entry_id)
    if conflicts:
        teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
        return ConflictCheckResponse(
            has_conflict=True,
            conflicting_entries=[
                build_timetable_response(c, teacher.name if teacher else None, c.room.name if c.room else None)
                for c in conflicts
            ],
            message=f"Conflict detected: {teacher.name if teacher else 'Teacher'} is already assigned during this time slot",
        )

    return ConflictCheckResponse(has_conflict=False, message="No conflicts detected")
