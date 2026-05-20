"""
Attendance management routes
"""

from datetime import date, datetime, time as dt_time
from io import BytesIO
import re
from threading import Lock
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.attendance.guards import reject_legacy_attendance_request
from app.middleware.auth import get_authenticated_actor_context
from app.models import (
    AttendanceHoliday,
    AttendanceLeave,
    AttendanceNotification,
    AttendanceSetting,
    AttendanceStaff,
    AttendanceStudent,
    AttendanceSubject,
    EduPayStudent,
    Invigilator,
    LeaveStatus,
    LeaveType,
    School,
    StaffAttendance,
    StaffAttendanceStatus,
    Student,
    StudentAttendance,
    StudentAttendanceStatus,
    Teacher,
    TimetableEntry,
    User,
    UserRole,
    BatchTable,
)
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
    StudentAttendanceRecordResponse,
    StudentDashboardResponse,
    TeacherAttendanceContextResponse,
)
from app.schemas import DayOfWeek as TimetableDayOfWeek
from app.services.supabase_attendance import (
    get_student_marking as get_supabase_student_marking,
    get_integrated_overview as get_supabase_integrated_overview,
    get_overview as get_supabase_attendance_overview,
    get_staff_dashboard as get_supabase_staff_dashboard,
    list_integrated_staff as list_supabase_integrated_staff,
    list_integrated_students as list_supabase_integrated_students,
    list_staff as list_supabase_attendance_staff,
    list_staff_records as list_supabase_staff_records,
    list_student_records as list_supabase_student_records,
    list_students as list_supabase_attendance_students,
    list_subjects as list_supabase_attendance_subjects,
)
from app.services.supabase_context import is_legacy_sqlite_mode, resolve_school_id_from_actor

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

SEED_LOCK = Lock()
LAST_SEED_AT: Dict[int, datetime] = {}


def normalize_department_value(value: Optional[str]) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().casefold()


def apply_department_filter(query, column, department: Optional[str]):
    normalized_department = normalize_department_value(department)
    if not normalized_department:
        return query
    return query.filter(func.lower(func.trim(column)) == normalized_department)


def prune_orphan_attendance_students(db: Session, school_id: int) -> int:
    orphan_students = (
        db.query(AttendanceStudent)
        .outerjoin(StudentAttendance, StudentAttendance.student_id == AttendanceStudent.id)
        .filter(
            AttendanceStudent.school_id == school_id,
            StudentAttendance.id.is_(None),
        )
        .all()
    )
    for student in orphan_students:
        db.delete(student)
    return len(orphan_students)


def prune_linked_students_and_empty_batches(
    db: Session, school_id: int
) -> tuple[int, int]:
    orphan_attendance_students = (
        db.query(AttendanceStudent)
        .outerjoin(StudentAttendance, StudentAttendance.student_id == AttendanceStudent.id)
        .filter(
            AttendanceStudent.school_id == school_id,
            StudentAttendance.id.is_(None),
        )
        .all()
    )

    roll_numbers_to_remove = {
        str(item.roll_no).strip()
        for item in orphan_attendance_students
        if getattr(item, "roll_no", None)
    }

    deleted_students = 0
    if roll_numbers_to_remove:
        linked_students = (
            db.query(Student)
            .filter(
                Student.school_id == school_id,
                Student.roll_number.in_(list(roll_numbers_to_remove)),
            )
            .all()
        )
        deleted_students = len(linked_students)
        for student in linked_students:
            db.delete(student)

    deleted_attendance_students = len(orphan_attendance_students)
    for student in orphan_attendance_students:
        db.delete(student)

    empty_batches = (
        db.query(BatchTable)
        .outerjoin(Student, Student.batch_id == BatchTable.id)
        .filter(
            BatchTable.school_id == school_id,
            Student.id.is_(None),
        )
        .all()
    )
    deleted_batches = len(empty_batches)
    for batch in empty_batches:
        db.delete(batch)

    return deleted_attendance_students + deleted_students, deleted_batches
SEED_CACHE_SECONDS = 120

WRITE_ROLES = {
    UserRole.ADMIN.value,
    "super_admin",
    "admin_office",
    "teacher",
    "hr",
    "hr_admin",
}


def coerce_legacy_school_id(school_id: str | int | None) -> int:
    try:
        return int(str(school_id or "1"))
    except (TypeError, ValueError):
        return 1


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


def choose_timetable_entry(
    entries: List[TimetableEntry],
    current_time: str | None = None,
) -> tuple[Optional[TimetableEntry], bool]:
    matched_entry: Optional[TimetableEntry] = None
    matched_by_current_time = False
    if current_time:
        for entry in entries:
            if entry.start_time <= current_time <= entry.end_time:
                matched_entry = entry
                matched_by_current_time = True
                break

    if not matched_entry and entries:
        matched_entry = entries[0]

    return matched_entry, matched_by_current_time


def resolve_attendance_subject(
    db: Session,
    school_id: int,
    class_name: str,
    section: str,
    subject_name: str | None = None,
) -> AttendanceSubject:
    query = db.query(AttendanceSubject).filter(
        AttendanceSubject.school_id == school_id,
        AttendanceSubject.class_name == class_name,
        AttendanceSubject.section == section,
    )
    normalized_subject_name = (subject_name or "").strip()
    if normalized_subject_name:
        existing = query.filter(AttendanceSubject.name.ilike(normalized_subject_name)).first()
        if existing:
            return existing

    existing = query.order_by(AttendanceSubject.id.asc()).first()
    if existing and not normalized_subject_name:
        return existing

    subject = AttendanceSubject(
        name=normalized_subject_name or "General Attendance",
        class_name=class_name,
        section=section or "A",
        school_id=school_id,
        is_active=True,
    )
    db.add(subject)
    db.flush()
    return subject


def day_of_week_for_date(target_date: date) -> TimetableDayOfWeek:
    mapping = {
        0: TimetableDayOfWeek.MONDAY,
        1: TimetableDayOfWeek.TUESDAY,
        2: TimetableDayOfWeek.WEDNESDAY,
        3: TimetableDayOfWeek.THURSDAY,
        4: TimetableDayOfWeek.FRIDAY,
        5: TimetableDayOfWeek.SATURDAY,
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


def ensure_school_context(db: Session, school_id: int = 1) -> int:
    school_row = db.query(School.id).filter(School.id == school_id).first()
    if school_row:
        return school_id

    admin = db.query(User).filter(User.id == 1).first()
    if not admin:
        admin = User(
            id=1,
            email="admin@school.edu",
            full_name="System Administrator",
            password_hash="dummy_hash",
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    school = School(
        id=school_id, name="Default School", admin_id=admin.id, is_active=True
    )
    db.add(school)
    db.commit()
    return school_id


def resolve_teacher_for_actor(
    db: Session,
    school_id: int,
    actor: Dict[str, str],
) -> Optional[Teacher]:
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


def resolve_attendance_staff_for_teacher(
    db: Session,
    school_id: int,
    teacher: Optional[Teacher],
) -> Optional[AttendanceStaff]:
    if not teacher:
        return None

    teacher_staff_id = f"TCH{teacher.id:04d}"
    attendance_staff = (
        db.query(AttendanceStaff)
        .filter(
            AttendanceStaff.school_id == school_id,
            AttendanceStaff.is_active == True,
            AttendanceStaff.staff_id == teacher_staff_id,
        )
        .first()
    )
    if attendance_staff:
        return attendance_staff

    teacher_name = (teacher.name or "").strip()
    teacher_email = (teacher.email or "").strip().lower()
    query = db.query(AttendanceStaff).filter(
        AttendanceStaff.school_id == school_id,
        AttendanceStaff.is_active == True,
    )
    if teacher_email:
        attendance_staff = query.filter(func.lower(func.trim(AttendanceStaff.email)) == teacher_email).first()
        if attendance_staff:
            return attendance_staff
    if teacher_name:
        attendance_staff = query.filter(func.lower(func.trim(AttendanceStaff.name)) == teacher_name.lower()).first()
        if attendance_staff:
            return attendance_staff
    return None


def require_teacher_staff_for_actor(
    db: Session,
    school_id: int,
    actor: Dict[str, str],
) -> Optional[AttendanceStaff]:
    teacher = resolve_teacher_for_actor(db, school_id, actor)
    if not teacher:
        return None
    staff = resolve_attendance_staff_for_teacher(db, school_id, teacher)
    if not staff:
        raise HTTPException(status_code=404, detail="Teacher attendance profile not found")
    return staff


def require_write_access(
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current role cannot modify attendance records",
        )
    return actor


def serialize_student(student: AttendanceStudent) -> AttendanceStudentResponse:
    return AttendanceStudentResponse.model_validate(student, from_attributes=True)


def serialize_staff(staff: AttendanceStaff) -> AttendanceStaffResponse:
    return AttendanceStaffResponse.model_validate(staff, from_attributes=True)


def serialize_subject(subject: AttendanceSubject) -> AttendanceSubjectResponse:
    return AttendanceSubjectResponse.model_validate(subject, from_attributes=True)


def serialize_holiday(holiday: AttendanceHoliday) -> AttendanceHolidayResponse:
    return AttendanceHolidayResponse.model_validate(holiday, from_attributes=True)


def serialize_notification(
    notification: AttendanceNotification,
) -> AttendanceNotificationResponse:
    return AttendanceNotificationResponse.model_validate(
        notification, from_attributes=True
    )


def serialize_leave(leave: AttendanceLeave) -> AttendanceLeaveResponse:
    return AttendanceLeaveResponse(
        id=leave.id,
        staff_member_id=leave.staff_member_id,
        staff_name=leave.staff_member.name if leave.staff_member else "",
        leave_type=leave.leave_type,
        from_date=leave.from_date,
        to_date=leave.to_date,
        reason=leave.reason,
        status=leave.status,
        approved_by=leave.approved_by,
        created_at=leave.created_at,
    )


def serialize_student_attendance(
    record: StudentAttendance,
) -> StudentAttendanceRecordResponse:
    return StudentAttendanceRecordResponse(
        id=record.id,
        student_id=record.student_id,
        student_name=record.student.name if record.student else "",
        roll_no=record.student.roll_no if record.student else "",
        class_name=record.student.class_name if record.student else "",
        section=record.student.section if record.student else "",
        date=record.date,
        subject_id=record.subject_id,
        subject_name=record.subject.name if record.subject else "",
        status=record.status,
        absence_reason=record.absence_reason,
        marked_by=record.marked_by,
        created_at=record.created_at,
    )


def serialize_staff_attendance(
    record: StaffAttendance,
) -> StaffAttendanceRecordResponse:
    staff = record.staff_member
    return StaffAttendanceRecordResponse(
        id=record.id,
        staff_member_id=record.staff_member_id,
        staff_id=staff.staff_id if staff else "",
        staff_name=staff.name if staff else "",
        department=staff.department if staff else "",
        designation=staff.designation if staff else None,
        date=record.date,
        status=record.status,
        check_in=record.check_in,
        check_out=record.check_out,
        marked_by=record.marked_by,
        created_at=record.created_at,
    )


def get_settings(db: Session, school_id: int) -> AttendanceSetting:
    reject_legacy_attendance_request()
    settings = (
        db.query(AttendanceSetting)
        .filter(AttendanceSetting.school_id == school_id)
        .first()
    )
    if settings:
        return settings
    settings = AttendanceSetting(
        school_id=school_id,
        minimum_attendance_threshold=75.0,
        working_hours_start="09:00",
        working_hours_end="17:00",
    )
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def create_notification(
    db: Session,
    school_id: int,
    message: str,
    notification_type: str,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
    ) -> None:
    db.add(
        AttendanceNotification(
            school_id=school_id,
            user_name=user_name,
            user_role=user_role,
            message=message,
            notification_type=notification_type,
            is_read=False,
        )
    )


def log_attendance_sync_warning(exc: Exception) -> None:
    # Keep attendance screens available even if source modules contain
    # inconsistent legacy data that cannot be synced cleanly right now.
    print(f"[attendance-sync-warning] {exc}")


def seed_attendance_data(db: Session, school_id: int = 1, force: bool = False) -> None:
    reject_legacy_attendance_request()
    last_seed_at = LAST_SEED_AT.get(school_id)
    now = datetime.now()
    if not force and last_seed_at and (now - last_seed_at).total_seconds() < SEED_CACHE_SECONDS:
        return

    lock_acquired = SEED_LOCK.acquire(blocking=force)
    if not lock_acquired:
        return

    try:
        last_seed_at = LAST_SEED_AT.get(school_id)
        now = datetime.now()
        if not force and last_seed_at and (now - last_seed_at).total_seconds() < SEED_CACHE_SECONDS:
            return
        ensure_school_context(db, school_id)
        get_settings(db, school_id)
        try:
            students = (
                db.query(Student)
                .filter(Student.school_id == school_id, Student.is_active == True)
                .all()
            )
            batches = (
                db.query(BatchTable)
                .filter(BatchTable.school_id == school_id, BatchTable.is_active == True)
                .all()
            )
            batch_by_id = {item.id: item for item in batches}

            existing_students = (
                db.query(AttendanceStudent)
                .filter(AttendanceStudent.school_id == school_id)
                .all()
            )
            attendance_students_by_roll = {
                item.roll_no.strip().lower(): item
                for item in existing_students
                if item.roll_no and item.roll_no.strip()
            }
            synced_roll_numbers = set()

            for student in students:
                roll_no = (student.roll_number or "").strip()
                if not roll_no:
                    continue
                roll_key = roll_no.lower()
                synced_roll_numbers.add(roll_key)

                batch_name = normalize_student_batch_label(student.batch)
                if not batch_name and student.batch_id:
                    batch = batch_by_id.get(student.batch_id)
                    batch_name = batch.name.strip() if batch and batch.name else ""

                class_name = (student.class_name or "").strip()
                section = (student.section or "").strip()
                if not class_name:
                    class_name, section = split_batch_to_class_section(batch_name)

                mapped_student = attendance_students_by_roll.get(roll_key)
                if mapped_student:
                    mapped_student.name = student.name
                    mapped_student.class_name = class_name
                    mapped_student.section = section
                    mapped_student.parent_contact = student.phone
                    mapped_student.is_active = True
                else:
                    db.add(
                        AttendanceStudent(
                            name=student.name,
                            class_name=class_name,
                            section=section,
                            roll_no=roll_no,
                            parent_contact=student.phone,
                            school_id=school_id,
                            is_active=True,
                        )
                    )

            for mapped_student in existing_students:
                roll_key = (mapped_student.roll_no or "").strip().lower()
                if not roll_key:
                    continue
                if roll_key not in synced_roll_numbers:
                    mapped_student.is_active = False

            teachers = (
                db.query(Teacher)
                .filter(Teacher.school_id == school_id, Teacher.is_active == True)
                .all()
            )
            invigilators = (
                db.query(Invigilator)
                .filter(Invigilator.school_id == school_id, Invigilator.is_active == True)
                .all()
            )

            existing_staff = (
                db.query(AttendanceStaff).filter(AttendanceStaff.school_id == school_id).all()
            )
            attendance_staff_by_id = {
                item.staff_id.strip().lower(): item
                for item in existing_staff
                if item.staff_id and item.staff_id.strip()
            }
            synced_staff_ids = set()

            for teacher in teachers:
                staff_id = f"TCH{teacher.id:04d}"
                staff_key = staff_id.lower()
                synced_staff_ids.add(staff_key)
                mapped_staff = attendance_staff_by_id.get(staff_key)
                if mapped_staff:
                    mapped_staff.name = teacher.name
                    mapped_staff.department = teacher.subject or "Academics"
                    mapped_staff.designation = "Teacher"
                    mapped_staff.email = teacher.email
                    mapped_staff.phone = teacher.phone
                    mapped_staff.is_active = True
                else:
                    db.add(
                        AttendanceStaff(
                            staff_id=staff_id,
                            name=teacher.name,
                            department=teacher.subject or "Academics",
                            designation="Teacher",
                            shift=None,
                            email=teacher.email,
                            phone=teacher.phone,
                            school_id=school_id,
                            is_active=True,
                        )
                    )

            for invigilator in invigilators:
                raw_staff_id = (invigilator.staff_id or "").strip()
                staff_id = raw_staff_id or f"INV{invigilator.id:04d}"
                staff_key = staff_id.lower()
                department = (
                    (invigilator.department or "").strip()
                    or (invigilator.designation or "").strip()
                    or "Invigilation"
                )
                designation = (invigilator.designation or "").strip() or "Invigilator"
                synced_staff_ids.add(staff_key)
                mapped_staff = attendance_staff_by_id.get(staff_key)
                if mapped_staff:
                    mapped_staff.name = invigilator.name
                    mapped_staff.department = department
                    mapped_staff.designation = designation
                    mapped_staff.email = invigilator.email
                    mapped_staff.phone = invigilator.phone
                    mapped_staff.is_active = True
                else:
                    db.add(
                        AttendanceStaff(
                            staff_id=staff_id,
                            name=invigilator.name,
                            department=department,
                            designation=designation,
                            shift=None,
                            email=invigilator.email,
                            phone=invigilator.phone,
                            school_id=school_id,
                            is_active=True,
                        )
                    )

            for mapped_staff in existing_staff:
                staff_key = (mapped_staff.staff_id or "").strip().lower()
                if not staff_key:
                    continue
                if staff_key not in synced_staff_ids:
                    mapped_staff.is_active = False

            db.flush()

            active_class_sections = (
                db.query(AttendanceStudent.class_name, AttendanceStudent.section)
                .filter(
                    AttendanceStudent.school_id == school_id, AttendanceStudent.is_active == True
                )
                .distinct()
                .all()
            )
            existing_subject_keys = {
                (item.class_name.strip(), item.section.strip())
                for item in db.query(AttendanceSubject)
                .filter(AttendanceSubject.school_id == school_id)
                .all()
            }

            for class_name, section in active_class_sections:
                class_value = (class_name or "").strip()
                section_value = (section or "").strip()
                if not class_value:
                    continue
                key = (class_value, section_value)
                if key in existing_subject_keys:
                    continue
                db.add(
                    AttendanceSubject(
                        name="General Attendance",
                        class_name=class_value,
                        section=section_value or "A",
                        school_id=school_id,
                        is_active=True,
                    )
                )
                existing_subject_keys.add(key)

            db.commit()
            LAST_SEED_AT[school_id] = now
        except Exception as exc:
            db.rollback()
            log_attendance_sync_warning(exc)
    finally:
        SEED_LOCK.release()


def build_report_rows(
    report_type: str,
    student_rows: List[StudentAttendanceRecordResponse],
    staff_rows: List[StaffAttendanceRecordResponse],
    leaves: List[AttendanceLeaveResponse],
) -> List[Dict[str, object]]:
    if report_type == "student_summary":
        overall = {"present": 0, "absent": 0, "late": 0, "total": 0}
        batch_totals: Dict[str, Dict[str, int]] = {}
        student_totals: Dict[tuple, Dict[str, object]] = {}

        for row in student_rows:
            status = row.status.value if hasattr(row.status, "value") else str(row.status)
            batch_name = f"{row.class_name} | {row.section}"
            batch_bucket = batch_totals.setdefault(
                batch_name, {"present": 0, "absent": 0, "late": 0, "total": 0}
            )
            student_key = (batch_name, row.student_id, row.student_name)
            student_bucket = student_totals.setdefault(
                student_key,
                {
                    "batch": batch_name,
                    "student_name": row.student_name,
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
                "date": row.date.strftime("%Y-%m-%d"),
                "staff_name": row.staff_name,
                "department": row.department,
                "designation": row.designation or "",
                "status": row.status.value
                if hasattr(row.status, "value")
                else row.status,
                "check_in": row.check_in or "",
                "check_out": row.check_out or "",
            }
            for row in staff_rows
        ]
    if report_type == "leave_summary":
        return [
            {
                "staff_name": row.staff_name,
                "leave_type": row.leave_type.value
                if hasattr(row.leave_type, "value")
                else row.leave_type,
                "from_date": row.from_date.strftime("%Y-%m-%d"),
                "to_date": row.to_date.strftime("%Y-%m-%d"),
                "status": row.status.value
                if hasattr(row.status, "value")
                else row.status,
                "approved_by": row.approved_by or "",
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


def collect_student_report_records(
    school_id: int,
    class_name: Optional[str],
    section: Optional[str],
    batch_names: Optional[str],
    date_from: Optional[date],
    date_to: Optional[date],
    db: Session,
) -> List[StudentAttendanceRecordResponse]:
    parsed_batches = parse_batch_filters(batch_names)
    if not is_legacy_sqlite_mode():
        return list_supabase_student_records(
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
    if not parsed_batches:
        return list_student_records(
            school_id, class_name, section, None, date_from, date_to, 0, 1000, db
        )

    combined: Dict[int, StudentAttendanceRecordResponse] = {}
    for selected_class, selected_section in parsed_batches:
        rows = list_student_records(
            school_id,
            selected_class,
            selected_section,
            None,
            date_from,
            date_to,
            0,
            1000,
            db,
        )
        for row in rows:
            combined[row.id] = row

    return sorted(
        combined.values(),
        key=lambda item: (item.date, item.id),
        reverse=True,
    )


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


@router.get("/overview", response_model=AttendanceOverviewResponse)
def get_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return AttendanceOverviewResponse(**get_supabase_attendance_overview(school_id))
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    settings = get_settings(db, school_id)
    student_count = (
        db.query(func.count(AttendanceStudent.id))
        .filter(
            AttendanceStudent.school_id == school_id,
            AttendanceStudent.is_active == True,
        )
        .scalar()
        or 0
    )
    staff_count = (
        db.query(func.count(AttendanceStaff.id))
        .filter(
            AttendanceStaff.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
        .scalar()
        or 0
    )
    class_options = sorted(
        item[0]
        for item in db.query(AttendanceStudent.class_name)
        .filter(
            AttendanceStudent.school_id == school_id,
            AttendanceStudent.is_active == True,
        )
        .distinct()
        .all()
        if isinstance(item[0], str) and item[0].strip()
    )
    section_options = sorted(
        item[0]
        for item in db.query(AttendanceStudent.section)
        .filter(
            AttendanceStudent.school_id == school_id,
            AttendanceStudent.is_active == True,
        )
        .distinct()
        .all()
        if isinstance(item[0], str) and item[0].strip()
    )
    department_values: Dict[str, str] = {}
    for item in (
        db.query(AttendanceStaff.department)
        .filter(
            AttendanceStaff.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
        .distinct()
        .all()
    ):
        raw_department = item[0]
        if not isinstance(raw_department, str) or not raw_department.strip():
            continue
        cleaned_department = raw_department.strip()
        department_values.setdefault(
            normalize_department_value(cleaned_department), cleaned_department
        )
    department_options = sorted(
        department_values.values(), key=lambda item: item.casefold()
    )
    subjects = (
        db.query(AttendanceSubject)
        .filter(AttendanceSubject.school_id == school_id)
        .order_by(
            AttendanceSubject.class_name,
            AttendanceSubject.section,
            AttendanceSubject.name,
        )
        .all()
    )
    notifications = (
        db.query(AttendanceNotification)
        .filter(AttendanceNotification.school_id == school_id)
        .order_by(AttendanceNotification.created_at.desc())
        .limit(8)
        .all()
    )
    holidays = (
        db.query(AttendanceHoliday)
        .filter(AttendanceHoliday.school_id == school_id)
        .order_by(AttendanceHoliday.holiday_date.asc())
        .all()
    )
    return AttendanceOverviewResponse(
        student_count=student_count,
        staff_count=staff_count,
        class_options=class_options,
        section_options=section_options,
        subject_options=[serialize_subject(item) for item in subjects],
        department_options=department_options,
        notifications=[serialize_notification(item) for item in notifications],
        holidays=[serialize_holiday(item) for item in holidays],
        settings=AttendanceSettingResponse(
            minimum_attendance_threshold=settings.minimum_attendance_threshold,
            working_hours_start=settings.working_hours_start,
            working_hours_end=settings.working_hours_end,
            updated_at=settings.updated_at,
        ),
    )


@router.get("/students", response_model=List[AttendanceStudentResponse])
def list_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return list_supabase_attendance_students(
            school_id,
            skip=skip,
            limit=limit,
            search=search,
        )
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    query = db.query(AttendanceStudent).filter(AttendanceStudent.school_id == school_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            (AttendanceStudent.name.ilike(pattern))
            | (AttendanceStudent.roll_no.ilike(pattern))
            | (AttendanceStudent.class_name.ilike(pattern))
            | (AttendanceStudent.section.ilike(pattern))
        )
    return [
        serialize_student(item)
        for item in query.order_by(AttendanceStudent.name.asc())
        .offset(skip)
        .limit(limit)
        .all()
    ]


@router.post("/students", response_model=AttendanceStudentResponse)
def create_student(
    payload: AttendanceStudentCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
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
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return list_supabase_attendance_staff(
            school_id,
            skip=skip,
            limit=limit,
            search=search,
        )
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    query = db.query(AttendanceStaff).filter(
        AttendanceStaff.school_id == school_id,
        AttendanceStaff.is_active == True,
    )
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    if actor_staff:
        query = query.filter(AttendanceStaff.id == actor_staff.id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            (AttendanceStaff.name.ilike(pattern))
            | (AttendanceStaff.staff_id.ilike(pattern))
            | (AttendanceStaff.department.ilike(pattern))
            | (AttendanceStaff.designation.ilike(pattern))
        )
    return [
        serialize_staff(item)
        for item in query.order_by(AttendanceStaff.name.asc())
        .offset(skip)
        .limit(limit)
        .all()
    ]


@router.post("/staff", response_model=AttendanceStaffResponse)
def create_staff(
    payload: AttendanceStaffCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    raise HTTPException(
        status_code=400,
        detail="Manage Teacher se staff add/edit karein. Attendance module auto-sync karta hai.",
    )


@router.get("/subjects", response_model=List[AttendanceSubjectResponse])
def list_subjects(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return list_supabase_attendance_subjects(school_id)
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    subjects = (
        db.query(AttendanceSubject)
        .filter(AttendanceSubject.school_id == school_id)
        .order_by(
            AttendanceSubject.class_name,
            AttendanceSubject.section,
            AttendanceSubject.name,
        )
        .all()
    )
    return [serialize_subject(item) for item in subjects]


@router.post("/subjects", response_model=AttendanceSubjectResponse)
def create_subject(
    payload: AttendanceSubjectCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    subject = AttendanceSubject(
        name=payload.name.strip(),
        class_name=payload.class_name.strip(),
        section=payload.section.strip(),
        school_id=school_id,
        is_active=True,
    )
    db.add(subject)
    create_notification(
        db,
        school_id,
        f"Attendance subject added: {subject.name}",
        "subject_added",
        actor["name"],
        actor["role"],
    )
    db.commit()
    db.refresh(subject)
    return serialize_subject(subject)


@router.get("/settings", response_model=AttendanceSettingResponse)
def get_attendance_settings(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    settings = get_settings(db, school_id)
    return AttendanceSettingResponse(
        minimum_attendance_threshold=settings.minimum_attendance_threshold,
        working_hours_start=settings.working_hours_start,
        working_hours_end=settings.working_hours_end,
        updated_at=settings.updated_at,
    )


@router.put("/settings", response_model=AttendanceSettingResponse)
def update_attendance_settings(
    payload: AttendanceSettingUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    settings = get_settings(db, school_id)
    settings.minimum_attendance_threshold = payload.minimum_attendance_threshold
    settings.working_hours_start = payload.working_hours_start
    settings.working_hours_end = payload.working_hours_end
    create_notification(
        db,
        school_id,
        "Attendance settings updated",
        "settings",
        actor["name"],
        actor["role"],
    )
    db.commit()
    db.refresh(settings)
    return AttendanceSettingResponse(
        minimum_attendance_threshold=settings.minimum_attendance_threshold,
        working_hours_start=settings.working_hours_start,
        working_hours_end=settings.working_hours_end,
        updated_at=settings.updated_at,
    )


@router.get("/holidays", response_model=List[AttendanceHolidayResponse])
def list_holidays(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    holidays = (
        db.query(AttendanceHoliday)
        .filter(AttendanceHoliday.school_id == school_id)
        .order_by(AttendanceHoliday.holiday_date.asc())
        .all()
    )
    return [serialize_holiday(item) for item in holidays]


@router.post("/holidays", response_model=AttendanceHolidayResponse)
def create_holiday(
    payload: AttendanceHolidayCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    holiday = AttendanceHoliday(
        title=payload.title.strip(),
        holiday_date=day_start(payload.holiday_date),
        description=payload.description,
        school_id=school_id,
    )
    db.add(holiday)
    create_notification(
        db,
        school_id,
        f"Holiday added: {holiday.title}",
        "holiday",
        actor["name"],
        actor["role"],
    )
    db.commit()
    db.refresh(holiday)
    return serialize_holiday(holiday)


@router.delete("/holidays/{holiday_id}")
def delete_holiday(
    holiday_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    holiday = (
        db.query(AttendanceHoliday)
        .filter(AttendanceHoliday.id == holiday_id, AttendanceHoliday.school_id == school_id)
        .first()
    )
    if not holiday:
        raise HTTPException(status_code=404, detail="Holiday not found")

    db.delete(holiday)
    db.commit()
    return {"message": "Holiday deleted successfully"}


@router.delete("/holidays")
def delete_all_holidays(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    holidays = db.query(AttendanceHoliday).filter(AttendanceHoliday.school_id == school_id).all()
    deleted_count = len(holidays)
    for holiday in holidays:
        db.delete(holiday)
    db.commit()
    return {"message": f"{deleted_count} holiday(s) deleted successfully", "deleted_count": deleted_count}


@router.get("/teacher-current-class", response_model=TeacherAttendanceContextResponse)
def get_teacher_current_class(
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    teacher_name = (actor.get("name") or "").strip()
    if not teacher_name:
        raise HTTPException(status_code=400, detail="Teacher name not available in session")

    teacher = (
        db.query(Teacher)
        .filter(
            Teacher.school_id == school_id,
            func.lower(Teacher.name) == teacher_name.lower(),
        )
        .first()
    )
    if not teacher:
        raise HTTPException(status_code=404, detail="Logged-in teacher mapping not found")

    selected_date = target_date or datetime.now().date()
    weekday = day_of_week_for_date(selected_date)
    entries = (
        db.query(TimetableEntry)
        .filter(
            TimetableEntry.school_id == school_id,
            TimetableEntry.teacher_id == teacher.id,
            TimetableEntry.day_of_week == weekday,
            TimetableEntry.session_type != "break_time",
            TimetableEntry.is_active == True,
        )
        .order_by(TimetableEntry.start_time.asc(), TimetableEntry.id.asc())
        .all()
    )
    matched_entry, matched_by_current_time = choose_timetable_entry(entries, current_time)

    if not matched_entry:
        fallback_entries = (
            db.query(TimetableEntry)
            .filter(
                TimetableEntry.school_id == school_id,
                TimetableEntry.teacher_id == teacher.id,
                TimetableEntry.session_type != "break_time",
                TimetableEntry.is_active == True,
            )
            .order_by(TimetableEntry.day_of_week.asc(), TimetableEntry.start_time.asc(), TimetableEntry.id.asc())
            .all()
        )
        matched_entry, matched_by_current_time = choose_timetable_entry(fallback_entries, None)

    if not matched_entry:
        return TeacherAttendanceContextResponse(
            teacher_id=teacher.id,
            teacher_name=teacher.name,
            date=day_start(selected_date),
            matched_by_current_time=False,
        )

    class_name, section = split_timetable_class_name(matched_entry.class_name)
    subject = resolve_attendance_subject(
        db,
        school_id,
        class_name,
        section,
        matched_entry.subject,
    )
    db.commit()

    return TeacherAttendanceContextResponse(
        teacher_id=teacher.id,
        teacher_name=teacher.name,
        date=day_start(selected_date),
        class_name=class_name,
        section=section,
        subject=matched_entry.subject,
        subject_id=subject.id,
        start_time=matched_entry.start_time,
        end_time=matched_entry.end_time,
        timetable_entry_id=matched_entry.id,
        matched_by_current_time=matched_by_current_time,
    )


@router.get("/batch-current-class", response_model=TeacherAttendanceContextResponse)
def get_batch_current_class(
    class_name: str = Query(...),
    section: str = Query(...),
    target_date: Optional[date] = Query(default=None),
    current_time: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    selected_date = target_date or datetime.now().date()
    weekday = day_of_week_for_date(selected_date)
    entries = (
        db.query(TimetableEntry)
        .join(Teacher, TimetableEntry.teacher_id == Teacher.id)
        .filter(
            TimetableEntry.school_id == school_id,
            TimetableEntry.day_of_week == weekday,
            TimetableEntry.session_type != "break_time",
            TimetableEntry.is_active == True,
        )
        .order_by(TimetableEntry.start_time.asc(), TimetableEntry.id.asc())
        .all()
    )
    entries = [
        entry
        for entry in entries
        if batch_matches_timetable_entry(class_name, section, entry.class_name)
    ]
    matched_entry, matched_by_current_time = choose_timetable_entry(entries, current_time)

    if not matched_entry:
        fallback_entries = (
            db.query(TimetableEntry)
            .join(Teacher, TimetableEntry.teacher_id == Teacher.id)
            .filter(
                TimetableEntry.school_id == school_id,
                TimetableEntry.session_type != "break_time",
                TimetableEntry.is_active == True,
            )
            .order_by(TimetableEntry.day_of_week.asc(), TimetableEntry.start_time.asc(), TimetableEntry.id.asc())
            .all()
        )
        fallback_entries = [
            entry
            for entry in fallback_entries
            if batch_matches_timetable_entry(class_name, section, entry.class_name)
        ]
        matched_entry, matched_by_current_time = choose_timetable_entry(fallback_entries, None)

    if not matched_entry:
        return TeacherAttendanceContextResponse(
            teacher_id=0,
            teacher_name="",
            date=day_start(selected_date),
            class_name=class_name,
            section=section,
            matched_by_current_time=False,
        )

    subject = resolve_attendance_subject(
        db,
        school_id,
        class_name,
        section,
        matched_entry.subject,
    )
    db.commit()

    return TeacherAttendanceContextResponse(
        teacher_id=matched_entry.teacher_id,
        teacher_name=matched_entry.teacher.name if matched_entry.teacher else "",
        date=day_start(selected_date),
        class_name=class_name,
        section=section,
        subject=matched_entry.subject,
        subject_id=subject.id,
        start_time=matched_entry.start_time,
        end_time=matched_entry.end_time,
        timetable_entry_id=matched_entry.id,
        matched_by_current_time=matched_by_current_time,
    )


@router.get("/student-marking", response_model=StudentAttendanceMarkingResponse)
def get_student_marking(
    date: date = Query(...),
    class_name: str = Query(...),
    section: str = Query(...),
    subject_id: str = Query(...),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        try:
            return StudentAttendanceMarkingResponse(
                **get_supabase_student_marking(
                    school_id,
                    date_value=date.isoformat(),
                    class_name=class_name,
                    section=section,
                    subject_id=str(subject_id),
                    search=search,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    seed_attendance_data(db, school_id)
    target_date = day_start(date)
    subject = (
        db.query(AttendanceSubject)
        .filter(
            AttendanceSubject.id == subject_id, AttendanceSubject.school_id == school_id
        )
        .first()
    )
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    query = db.query(AttendanceStudent).filter(
        AttendanceStudent.school_id == school_id,
        AttendanceStudent.class_name == class_name,
        AttendanceStudent.section == section,
        AttendanceStudent.is_active == True,
    )
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            (AttendanceStudent.name.ilike(pattern))
            | (AttendanceStudent.roll_no.ilike(pattern))
        )
    students = query.order_by(AttendanceStudent.roll_no.asc()).all()
    rows: List[StudentAttendanceMarkingRow] = []
    for student in students:
        existing = (
            db.query(StudentAttendance)
            .filter(
                StudentAttendance.student_id == student.id,
                StudentAttendance.subject_id == subject_id,
                StudentAttendance.date == target_date,
            )
            .first()
        )
        rows.append(
            StudentAttendanceMarkingRow(
                student_id=student.id,
                roll_no=student.roll_no,
                student_name=student.name,
                status=existing.status if existing else StudentAttendanceStatus.PRESENT,
                absence_reason=existing.absence_reason if existing else None,
            )
        )
    return StudentAttendanceMarkingResponse(
        date=target_date,
        class_name=class_name,
        section=section,
        subject_id=subject.id,
        subject_name=subject.name,
        students=rows,
    )


@router.post("/student-marking")
def save_student_marking(
    payload: StudentAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    target_date = day_start(payload.date)
    subject = (
        db.query(AttendanceSubject)
        .filter(
            AttendanceSubject.id == payload.subject_id,
            AttendanceSubject.school_id == school_id,
        )
        .first()
    )
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    for entry in payload.entries:
        student = (
            db.query(AttendanceStudent)
            .filter(
                AttendanceStudent.id == entry.student_id,
                AttendanceStudent.school_id == school_id,
            )
            .first()
        )
        if not student:
            continue
        record = (
            db.query(StudentAttendance)
            .filter(
                StudentAttendance.student_id == student.id,
                StudentAttendance.subject_id == payload.subject_id,
                StudentAttendance.date == target_date,
            )
            .first()
        )
        if not record:
            record = StudentAttendance(
                student_id=student.id,
                date=target_date,
                subject_id=payload.subject_id,
                status=entry.status,
                absence_reason=entry.absence_reason if entry.status == StudentAttendanceStatus.ABSENT else None,
                marked_by=payload.marked_by or actor["name"],
                school_id=school_id,
            )
            db.add(record)
        else:
            record.status = entry.status
            record.absence_reason = entry.absence_reason if entry.status == StudentAttendanceStatus.ABSENT else None
            record.marked_by = payload.marked_by or actor["name"]
        if entry.status == StudentAttendanceStatus.ABSENT:
            create_notification(
                db,
                school_id,
                f"Student absent notification: {student.name}",
                "student_absent",
                student.name,
                "student",
            )
    db.commit()
    return {"message": "Student attendance saved successfully"}


@router.get("/student-records", response_model=List[StudentAttendanceRecordResponse])
def list_student_records(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return list_supabase_student_records(
            school_id,
            class_name=class_name,
            section=section,
            student_name=student_name,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
            skip=skip,
            limit=limit,
        )
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    query = (
        db.query(StudentAttendance)
        .join(AttendanceStudent)
        .filter(StudentAttendance.school_id == school_id)
    )
    if class_name:
        query = query.filter(AttendanceStudent.class_name == class_name)
    if section:
        query = query.filter(AttendanceStudent.section == section)
    if student_name:
        pattern = f"%{student_name.strip()}%"
        query = query.filter(AttendanceStudent.name.ilike(pattern))
    if date_from:
        query = query.filter(StudentAttendance.date >= day_start(date_from))
    if date_to:
        query = query.filter(StudentAttendance.date <= day_end(date_to))
    records = (
        query.order_by(StudentAttendance.date.desc(), StudentAttendance.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [serialize_student_attendance(item) for item in records]


@router.delete("/student-records/{record_id}")
def delete_student_record(
    record_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    record = (
        db.query(StudentAttendance)
        .filter(StudentAttendance.id == record_id, StudentAttendance.school_id == school_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Student attendance record not found")

    sibling_records = (
        db.query(StudentAttendance)
        .filter(
            StudentAttendance.school_id == school_id,
            StudentAttendance.student_id == record.student_id,
            StudentAttendance.date == record.date,
        )
        .all()
    )
    for item in sibling_records:
        db.delete(item)
    deleted_related_students, deleted_batches = prune_linked_students_and_empty_batches(
        db, school_id
    )
    db.commit()
    return {
        "message": "Student attendance day record deleted successfully",
        "deleted_count": len(sibling_records),
        "deleted_students": deleted_related_students,
        "deleted_batches": deleted_batches,
    }


@router.delete("/student-records")
def delete_all_student_records(
    school_id: str = Depends(resolve_school_id_from_actor),
    class_name: Optional[str] = Query(default=None),
    section: Optional[str] = Query(default=None),
    student_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    query = (
        db.query(StudentAttendance)
        .join(AttendanceStudent)
        .filter(StudentAttendance.school_id == school_id)
    )
    if class_name:
        query = query.filter(AttendanceStudent.class_name == class_name)
    if section:
        query = query.filter(AttendanceStudent.section == section)
    if student_name:
        pattern = f"%{student_name.strip()}%"
        query = query.filter(AttendanceStudent.name.ilike(pattern))
    if date_from:
        query = query.filter(StudentAttendance.date >= day_start(date_from))
    if date_to:
        query = query.filter(StudentAttendance.date <= day_end(date_to))

    records = query.all()
    deleted_count = len(records)
    for record in records:
        db.delete(record)
    deleted_related_students, deleted_batches = prune_linked_students_and_empty_batches(
        db, school_id
    )
    db.commit()
    return {
        "message": f"{deleted_count} student attendance record(s) deleted successfully",
        "deleted_count": deleted_count,
        "deleted_students": deleted_related_students,
        "deleted_batches": deleted_batches,
    }


@router.get("/student-dashboard/{student_id}", response_model=StudentDashboardResponse)
def get_student_dashboard(
    student_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    student = (
        db.query(AttendanceStudent)
        .filter(
            AttendanceStudent.id == student_id, AttendanceStudent.school_id == school_id
        )
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    settings = get_settings(db, school_id)
    records = (
        db.query(StudentAttendance)
        .filter(StudentAttendance.student_id == student.id)
        .all()
    )
    total = len(records) or 1
    present_count = sum(
        1 for item in records if item.status == StudentAttendanceStatus.PRESENT
    )
    absent_count = sum(
        1 for item in records if item.status == StudentAttendanceStatus.ABSENT
    )
    late_count = sum(
        1 for item in records if item.status == StudentAttendanceStatus.LATE
    )
    percentage = round(((present_count + late_count) / total) * 100, 2)
    subject_breakdown: List[Dict[str, object]] = []
    for subject in {item.subject.name for item in records if item.subject}:
        subject_records = [
            item for item in records if item.subject and item.subject.name == subject
        ]
        subject_breakdown.append(
            {
                "subject": subject,
                "present": sum(
                    1
                    for item in subject_records
                    if item.status == StudentAttendanceStatus.PRESENT
                ),
                "absent": sum(
                    1
                    for item in subject_records
                    if item.status == StudentAttendanceStatus.ABSENT
                ),
                "late": sum(
                    1
                    for item in subject_records
                    if item.status == StudentAttendanceStatus.LATE
                ),
            }
        )
    if percentage < settings.minimum_attendance_threshold:
        create_notification(
            db,
            school_id,
            f"Low attendance alert for {student.name}",
            "low_attendance",
            student.name,
            "student",
        )
        db.commit()
    return StudentDashboardResponse(
        total_present=present_count,
        total_absent=absent_count,
        total_late=late_count,
        attendance_percentage=percentage,
        low_attendance_alert=percentage < settings.minimum_attendance_threshold,
        subject_breakdown=subject_breakdown,
    )


@router.get("/staff-marking", response_model=StaffAttendanceMarkingResponse)
def get_staff_marking(
    date: date = Query(...),
    department: str = Query(...),
    search: Optional[str] = Query(default=None),
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    target_date = day_start(date)
    query = db.query(AttendanceStaff).filter(
        AttendanceStaff.school_id == school_id,
        AttendanceStaff.is_active == True,
    )
    query = apply_department_filter(query, AttendanceStaff.department, department)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            (AttendanceStaff.name.ilike(pattern))
            | (AttendanceStaff.staff_id.ilike(pattern))
        )
    approved_leaves = (
        db.query(AttendanceLeave)
        .filter(
            AttendanceLeave.school_id == school_id,
            AttendanceLeave.status == LeaveStatus.APPROVED,
            AttendanceLeave.from_date <= target_date,
            AttendanceLeave.to_date >= target_date,
        )
        .all()
    )
    approved_leave_by_staff_id = {
        item.staff_member_id: item for item in approved_leaves if item.staff_member_id
    }
    rows: List[StaffAttendanceMarkingRow] = []
    for staff in query.order_by(AttendanceStaff.name.asc()).all():
        existing = (
            db.query(StaffAttendance)
            .filter(
                StaffAttendance.staff_member_id == staff.id,
                StaffAttendance.date == target_date,
            )
            .first()
        )
        active_leave = approved_leave_by_staff_id.get(staff.id)
        rows.append(
            StaffAttendanceMarkingRow(
                staff_member_id=staff.id,
                staff_id=staff.staff_id,
                staff_name=staff.name,
                department=staff.department,
                designation=staff.designation,
                status=(
                    existing.status
                    if existing
                    else (StaffAttendanceStatus.ABSENT if active_leave else StaffAttendanceStatus.PRESENT)
                ),
                check_in=existing.check_in if existing else None,
                check_out=existing.check_out if existing else None,
                is_on_approved_leave=active_leave is not None,
                leave_type=(
                    active_leave.leave_type.value
                    if active_leave and hasattr(active_leave.leave_type, "value")
                    else (active_leave.leave_type if active_leave else None)
                ),
                leave_reason=active_leave.reason if active_leave else None,
            )
        )
    return StaffAttendanceMarkingResponse(
        date=target_date, department=department, staff=rows
    )


@router.post("/staff-marking")
def save_staff_marking(
    payload: StaffAttendanceMarkRequest,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    target_date = day_start(payload.date)
    for entry in payload.entries:
        staff = (
            db.query(AttendanceStaff)
            .filter(
                AttendanceStaff.id == entry.staff_member_id,
                AttendanceStaff.school_id == school_id,
            )
            .first()
        )
        if not staff:
            continue
        record = (
            db.query(StaffAttendance)
            .filter(
                StaffAttendance.staff_member_id == staff.id,
                StaffAttendance.date == target_date,
            )
            .first()
        )
        if not record:
            record = StaffAttendance(
                staff_member_id=staff.id,
                date=target_date,
                status=entry.status,
                check_in=entry.check_in,
                check_out=entry.check_out,
                marked_by=payload.marked_by or actor["name"],
                school_id=school_id,
            )
            db.add(record)
        else:
            record.status = entry.status
            record.check_in = entry.check_in
            record.check_out = entry.check_out
            record.marked_by = payload.marked_by or actor["name"]
        if entry.status == StaffAttendanceStatus.ABSENT:
            create_notification(
                db,
                school_id,
                f"Staff absent alert for {staff.name}",
                "staff_absent",
                staff.name,
                "staff",
            )
    db.commit()
    return {"message": "Staff attendance saved successfully"}


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
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return list_supabase_staff_records(
            school_id,
            department=department,
            staff_name=staff_name,
            date_from=date_from.isoformat() if date_from else None,
            date_to=date_to.isoformat() if date_to else None,
            skip=skip,
            limit=limit,
        )
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    query = (
        db.query(StaffAttendance)
        .join(AttendanceStaff)
        .filter(
            StaffAttendance.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
    )
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    if actor_staff:
        query = query.filter(AttendanceStaff.id == actor_staff.id)
    query = apply_department_filter(query, AttendanceStaff.department, department)
    if staff_name:
        pattern = f"%{staff_name.strip()}%"
        query = query.filter(AttendanceStaff.name.ilike(pattern))
    if date_from:
        query = query.filter(StaffAttendance.date >= day_start(date_from))
    if date_to:
        query = query.filter(StaffAttendance.date <= day_end(date_to))
    records = (
        query.order_by(StaffAttendance.date.desc(), StaffAttendance.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [serialize_staff_attendance(item) for item in records]


@router.delete("/staff-records/{record_id}")
def delete_staff_record(
    record_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    record = (
        db.query(StaffAttendance)
        .filter(StaffAttendance.id == record_id, StaffAttendance.school_id == school_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Staff attendance record not found")

    db.delete(record)
    db.commit()
    return {"message": "Staff attendance record deleted successfully"}


@router.delete("/staff-records")
def delete_all_staff_records(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    staff_name: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    query = (
        db.query(StaffAttendance)
        .join(AttendanceStaff)
        .filter(
            StaffAttendance.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
    )
    query = apply_department_filter(query, AttendanceStaff.department, department)
    if staff_name:
        pattern = f"%{staff_name.strip()}%"
        query = query.filter(AttendanceStaff.name.ilike(pattern))
    if date_from:
        query = query.filter(StaffAttendance.date >= day_start(date_from))
    if date_to:
        query = query.filter(StaffAttendance.date <= day_end(date_to))

    records = query.all()
    deleted_count = len(records)
    for record in records:
        db.delete(record)
    db.commit()
    return {"message": f"{deleted_count} staff attendance record(s) deleted successfully", "deleted_count": deleted_count}


@router.get("/staff-dashboard", response_model=StaffDashboardResponse)
def get_staff_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    department: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    if not is_legacy_sqlite_mode():
        return StaffDashboardResponse(
            **get_supabase_staff_dashboard(
                school_id,
                department=department,
                date_from=date_from.isoformat() if date_from else None,
                date_to=date_to.isoformat() if date_to else None,
            )
        )
    school_id = coerce_legacy_school_id(school_id)
    seed_attendance_data(db, school_id)
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    base_query = (
        db.query(StaffAttendance, AttendanceStaff.department)
        .join(AttendanceStaff)
        .filter(
            StaffAttendance.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
    )
    if actor_staff:
        base_query = base_query.filter(AttendanceStaff.id == actor_staff.id)
    base_query = apply_department_filter(
        base_query, AttendanceStaff.department, department
    )

    totals = (
        db.query(
            func.count(StaffAttendance.id),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.PRESENT, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.ABSENT, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.LATE, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.HALF_DAY, 1), else_=0)),
        )
        .select_from(StaffAttendance)
        .join(AttendanceStaff)
        .filter(
            StaffAttendance.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
    )
    if actor_staff:
        totals = totals.filter(AttendanceStaff.id == actor_staff.id)
    totals = apply_department_filter(totals, AttendanceStaff.department, department)
    if date_from:
        totals = totals.filter(StaffAttendance.date >= day_start(date_from))
    if date_to:
        totals = totals.filter(StaffAttendance.date <= day_end(date_to))
    total_count, present_count, absent_count, late_count, half_day_count = totals.first() or (0, 0, 0, 0, 0)
    total = total_count or 1

    dept_rows = (
        db.query(
            AttendanceStaff.department,
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.PRESENT, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.ABSENT, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.LATE, 1), else_=0)),
            func.sum(case((StaffAttendance.status == StaffAttendanceStatus.HALF_DAY, 1), else_=0)),
        )
        .select_from(StaffAttendance)
        .join(AttendanceStaff)
        .filter(
            StaffAttendance.school_id == school_id,
            AttendanceStaff.is_active == True,
        )
        .group_by(AttendanceStaff.department)
        .order_by(AttendanceStaff.department.asc())
    )
    if actor_staff:
        dept_rows = dept_rows.filter(AttendanceStaff.id == actor_staff.id)
    dept_rows = apply_department_filter(
        dept_rows, AttendanceStaff.department, department
    )
    if date_from:
        dept_rows = dept_rows.filter(StaffAttendance.date >= day_start(date_from))
    if date_to:
        dept_rows = dept_rows.filter(StaffAttendance.date <= day_end(date_to))
    dept_rows = dept_rows.all()

    dept_summary: List[Dict[str, object]] = [
        {
            "department": dept_name,
            "present": present or 0,
            "absent": absent or 0,
            "late": late or 0,
            "half_day": half_day or 0,
        }
        for dept_name, present, absent, late, half_day in dept_rows
        if isinstance(dept_name, str) and dept_name.strip()
    ]
    return StaffDashboardResponse(
        present_count=present_count or 0,
        absent_count=absent_count or 0,
        late_count=late_count or 0,
        half_day_count=half_day_count or 0,
        monthly_attendance_percentage=round(
            (((present_count or 0) + (late_count or 0) + (half_day_count or 0) * 0.5) / total) * 100, 2
        ),
        department_summary=dept_summary,
    )


@router.get("/leaves", response_model=List[AttendanceLeaveResponse])
def list_leaves(
    school_id: str = Depends(resolve_school_id_from_actor),
    status_filter: Optional[LeaveStatus] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    query = db.query(AttendanceLeave).filter(AttendanceLeave.school_id == school_id)
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    if actor_staff:
        query = query.filter(AttendanceLeave.staff_member_id == actor_staff.id)
    if status_filter:
        query = query.filter(AttendanceLeave.status == status_filter)
    leaves = query.order_by(AttendanceLeave.created_at.desc()).all()
    return [serialize_leave(item) for item in leaves]


@router.post("/leaves", response_model=AttendanceLeaveResponse)
def create_leave(
    payload: AttendanceLeaveCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    target_staff_member_id = actor_staff.id if actor_staff else payload.staff_member_id
    staff = (
        db.query(AttendanceStaff)
        .filter(
            AttendanceStaff.id == target_staff_member_id,
            AttendanceStaff.school_id == school_id,
        )
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    leave = AttendanceLeave(
        staff_member_id=staff.id,
        leave_type=payload.leave_type,
        from_date=day_start(payload.from_date),
        to_date=day_end(payload.to_date),
        reason=payload.reason,
        status=LeaveStatus.PENDING,
        school_id=school_id,
    )
    db.add(leave)
    create_notification(
        db,
        school_id,
        f"Leave applied by {staff.name}",
        "leave_applied",
        actor["name"],
        actor["role"],
    )
    db.commit()
    db.refresh(leave)
    return serialize_leave(leave)


@router.post("/leaves/{leave_id}/decision", response_model=AttendanceLeaveResponse)
def decide_leave(
    leave_id: int,
    payload: AttendanceLeaveDecision,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers cannot approve or reject leave requests")
    leave = (
        db.query(AttendanceLeave)
        .filter(AttendanceLeave.id == leave_id, AttendanceLeave.school_id == school_id)
        .first()
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    leave.status = payload.status
    leave.approved_by = payload.approved_by
    create_notification(
        db,
        school_id,
        f"Leave {payload.status.value.replace('_', ' ')} for {leave.staff_member.name if leave.staff_member else 'staff'}",
        f"leave_{payload.status.value}",
        actor["name"],
        actor["role"],
    )
    db.commit()
    db.refresh(leave)
    return serialize_leave(leave)


@router.delete("/leaves/{leave_id}")
def delete_leave(
    leave_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    actor_staff = require_teacher_staff_for_actor(db, school_id, actor)
    leave = (
        db.query(AttendanceLeave)
        .filter(AttendanceLeave.id == leave_id, AttendanceLeave.school_id == school_id)
        .first()
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if actor_staff and leave.staff_member_id != actor_staff.id:
        raise HTTPException(status_code=403, detail="You can only delete your own leave requests")

    db.delete(leave)
    db.commit()
    return {"message": "Leave deleted successfully"}


@router.delete("/leaves")
def delete_all_leaves(
    school_id: str = Depends(resolve_school_id_from_actor),
    status_filter: Optional[LeaveStatus] = Query(default=None, alias="status"),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    if actor.get("role") == UserRole.TEACHER.value:
        raise HTTPException(status_code=403, detail="Teachers cannot delete all leave requests")
    query = db.query(AttendanceLeave).filter(AttendanceLeave.school_id == school_id)
    if status_filter:
        query = query.filter(AttendanceLeave.status == status_filter)
    leaves = query.all()
    deleted_count = len(leaves)
    for leave in leaves:
        db.delete(leave)
    db.commit()
    return {"message": f"{deleted_count} leave request(s) deleted successfully", "deleted_count": deleted_count}


@router.get("/notifications", response_model=List[AttendanceNotificationResponse])
def list_notifications(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    seed_attendance_data(db, school_id)
    items = (
        db.query(AttendanceNotification)
        .filter(AttendanceNotification.school_id == school_id)
        .order_by(AttendanceNotification.created_at.desc())
        .limit(50)
        .all()
    )
    return [serialize_notification(item) for item in items]


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    notification = (
        db.query(AttendanceNotification)
        .filter(
            AttendanceNotification.id == notification_id,
            AttendanceNotification.school_id == school_id,
        )
        .first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    db.delete(notification)
    db.commit()
    return {"message": "Notification deleted successfully"}


@router.delete("/notifications")
def delete_all_notifications(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    notifications = (
        db.query(AttendanceNotification)
        .filter(AttendanceNotification.school_id == school_id)
        .all()
    )
    deleted_count = len(notifications)
    for notification in notifications:
        db.delete(notification)
    db.commit()
    return {"message": f"{deleted_count} notification(s) deleted successfully", "deleted_count": deleted_count}


@router.get("/reports/data", response_model=AttendanceReportResponse)
def get_report_data(
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
    db: Session = Depends(get_db),
):
    student_records = (
        collect_student_report_records(
            school_id, class_name, section, batch_names, date_from, date_to, db
        )
        if report_type == "student_summary"
        else []
    )
    staff_records = (
        list_staff_records(school_id, department, None, date_from, date_to, 0, 500, db)
        if report_type == "staff_summary"
        else []
    )
    leaves = list_leaves(school_id, None, db) if report_type == "leave_summary" else []
    rows = build_report_rows(report_type, student_records, staff_records, leaves)
    return AttendanceReportResponse(
        report_type=report_type,
        generated_at=datetime.now(),
        rows=[AttendanceReportRow(values=row) for row in rows],
        total_records=len(rows),
    )


@router.get("/reports/export")
def export_report(
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
    db: Session = Depends(get_db),
):
    student_records = (
        collect_student_report_records(
            school_id, class_name, section, batch_names, date_from, date_to, db
        )
        if report_type == "student_summary"
        else []
    )
    staff_records = (
        list_staff_records(school_id, department, None, date_from, date_to, 0, 500, db)
        if report_type == "staff_summary"
        else []
    )
    leaves = list_leaves(school_id, None, db) if report_type == "leave_summary" else []
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


def serialize_integrated_student(
    student: Student, db: Session
) -> AttendanceStudentResponse:
    """Convert Student model to AttendanceStudentResponse format"""
    batch_name = normalize_student_batch_label(student.batch)
    if not batch_name and student.batch_id:
        batch = db.query(BatchTable).filter(BatchTable.id == student.batch_id).first()
        batch_name = batch.name if batch else "Unknown"

    class_name, section = split_batch_to_class_section(batch_name or "10")

    return AttendanceStudentResponse(
        id=student.id,
        name=student.name,
        class_name=class_name,
        section=section,
        roll_no=student.roll_number,
        parent_contact=student.phone,
        school_id=student.school_id,
        is_active=student.is_active,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


def serialize_integrated_staff_teacher(teacher: Teacher) -> AttendanceStaffResponse:
    """Convert Teacher model to AttendanceStaffResponse format"""
    return AttendanceStaffResponse(
        id=teacher.id,
        staff_id=f"TCH{teacher.id:04d}",
        name=teacher.name,
        department=teacher.subject,
        designation="Teacher",
        shift=None,
        email=teacher.email,
        phone=teacher.phone,
        school_id=teacher.school_id,
        is_active=teacher.is_active,
        created_at=teacher.created_at,
        updated_at=teacher.updated_at,
    )


def serialize_integrated_staff_invigilator(
    invigilator: Invigilator,
) -> AttendanceStaffResponse:
    """Convert Invigilator model to AttendanceStaffResponse format"""
    return AttendanceStaffResponse(
        id=invigilator.id,
        staff_id=invigilator.staff_id,
        name=invigilator.name,
        department=(invigilator.department or invigilator.designation or "Staff"),
        designation=invigilator.designation,
        shift=None,
        email=invigilator.email,
        phone=invigilator.phone,
        school_id=invigilator.school_id,
        is_active=invigilator.is_active,
        created_at=invigilator.created_at,
        updated_at=invigilator.updated_at,
    )


@router.get("/integrated-students", response_model=List[AttendanceStudentResponse])
def list_integrated_students(
    school_id: str = Depends(resolve_school_id_from_actor),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: Optional[str] = Query(default=None),
    batch: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """List students directly from Student Management"""
    if not is_legacy_sqlite_mode():
        return list_supabase_integrated_students(
            school_id,
            skip=skip,
            limit=limit,
            search=search,
            batch=batch,
        )
    school_id = coerce_legacy_school_id(school_id)
    try:
        query = db.query(Student).filter(
            Student.school_id == school_id, Student.is_active == True
        )

        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                (Student.name.ilike(pattern)) | (Student.roll_number.ilike(pattern))
            )

        if batch:
            query = query.filter(Student.batch.ilike(f"%{batch}%"))

        students = query.order_by(Student.name.asc()).offset(skip).limit(limit).all()
        return [serialize_integrated_student(s, db) for s in students]
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error fetching integrated students: {str(e)}"
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
    ),  # "teachers", "invigilators", "all"
    db: Session = Depends(get_db),
):
    """List staff directly from Teacher and Invigilator Management"""
    if not is_legacy_sqlite_mode():
        return list_supabase_integrated_staff(
            school_id,
            skip=skip,
            limit=limit,
            search=search,
            department=department,
            source=source,
        )
    school_id = coerce_legacy_school_id(school_id)
    try:
        results: List[AttendanceStaffResponse] = []

        if source in ("all", "teachers"):
            teacher_query = db.query(Teacher).filter(
                Teacher.school_id == school_id, Teacher.is_active == True
            )
            if search:
                pattern = f"%{search.strip()}%"
                teacher_query = teacher_query.filter(
                    (Teacher.name.ilike(pattern)) | (Teacher.subject.ilike(pattern))
                )
            if department:
                teacher_query = teacher_query.filter(
                    Teacher.subject.ilike(f"%{department}%")
                )
            teachers = (
                teacher_query.order_by(Teacher.name.asc())
                .offset(skip)
                .limit(limit)
                .all()
            )
            results.extend([serialize_integrated_staff_teacher(t) for t in teachers])

        if source in ("all", "invigilators"):
            invigilator_query = db.query(Invigilator).filter(
                Invigilator.school_id == school_id, Invigilator.is_active == True
            )
            if search:
                pattern = f"%{search.strip()}%"
                invigilator_query = invigilator_query.filter(
                    (Invigilator.name.ilike(pattern))
                    | (Invigilator.staff_id.ilike(pattern))
                    | (Invigilator.department.ilike(pattern))
                    | (Invigilator.designation.ilike(pattern))
                )
            if department:
                invigilator_query = invigilator_query.filter(
                    Invigilator.department.ilike(f"%{department}%")
                )
            invigilators = (
                invigilator_query.order_by(Invigilator.name.asc())
                .offset(skip)
                .limit(limit)
                .all()
            )
            results.extend(
                [serialize_integrated_staff_invigilator(i) for i in invigilators]
            )

        return sorted(results, key=lambda x: x.name)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error fetching integrated staff: {str(e)}"
        )


@router.get("/integrated-overview")
def get_integrated_overview(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    """Get attendance overview using integrated Student and Teacher/Invigilator data"""
    if not is_legacy_sqlite_mode():
        return get_supabase_integrated_overview(school_id)
    school_id = coerce_legacy_school_id(school_id)
    try:
        students = (
            db.query(Student)
            .filter(Student.school_id == school_id, Student.is_active == True)
            .all()
        )
        teachers = (
            db.query(Teacher)
            .filter(Teacher.school_id == school_id, Teacher.is_active == True)
            .all()
        )
        invigilators = (
            db.query(Invigilator)
            .filter(Invigilator.school_id == school_id, Invigilator.is_active == True)
            .all()
        )

        batches = (
            db.query(BatchTable)
            .filter(BatchTable.school_id == school_id, BatchTable.is_active == True)
            .all()
        )
        batch_names = sorted([b.name for b in batches])

        class_options = sorted(set(b.split("-")[0] for b in batch_names if b))
        section_options = sorted(set(b.split("-")[1] for b in batch_names if "-" in b))

        subject_options = (
            db.query(AttendanceSubject)
            .filter(AttendanceSubject.school_id == school_id)
            .order_by(
                AttendanceSubject.class_name,
                AttendanceSubject.section,
                AttendanceSubject.name,
            )
            .all()
        )
        notifications = (
            db.query(AttendanceNotification)
            .filter(AttendanceNotification.school_id == school_id)
            .order_by(AttendanceNotification.created_at.desc())
            .limit(8)
            .all()
        )
        holidays = (
            db.query(AttendanceHoliday)
            .filter(AttendanceHoliday.school_id == school_id)
            .order_by(AttendanceHoliday.holiday_date.asc())
            .all()
        )
        settings = get_settings(db, school_id)

        return {
            "student_count": len(students),
            "staff_count": len(teachers) + len(invigilators),
            "class_options": class_options,
            "section_options": section_options,
            "subject_options": [serialize_subject(item) for item in subject_options],
            "department_options": sorted(
                set(
                    [
                        t.subject.strip()
                        for t in teachers
                        if isinstance(t.subject, str) and t.subject.strip()
                    ]
                    + [
                        (i.department or i.designation or "Staff").strip()
                        for i in invigilators
                        if isinstance((i.department or i.designation or "Staff"), str)
                        and (i.department or i.designation or "Staff").strip()
                    ]
                )
            ),
            "notifications": [serialize_notification(item) for item in notifications],
            "holidays": [serialize_holiday(item) for item in holidays],
            "settings": {
                "minimum_attendance_threshold": settings.minimum_attendance_threshold,
                "working_hours_start": settings.working_hours_start,
                "working_hours_end": settings.working_hours_end,
                "updated_at": settings.updated_at,
            },
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching integrated overview: {str(e)}",
        )
