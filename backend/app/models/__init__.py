"""
SQLAlchemy ORM Models for Exam Seating System
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class UserRole(str, enum.Enum):
    """User roles"""
    ADMIN = "admin"
    TEACHER = "teacher"
    VIEWER = "viewer"
    STORE_MANAGER = "store_manager"


class Batch(str, enum.Enum):
    """Student batch types"""
    BATCH_11 = "11th"
    BATCH_12 = "12th"
    BATCH_12_MEDICAL = "12th Medical"
    BATCH_12_IIT = "12th IIT"
    DROPPER_1 = "Dropper 1"
    DROPPER_2 = "Dropper 2"
    DROPPER_3 = "Dropper 3"
    DROPPER_4 = "Dropper 4"
    DROPPER_5 = "Dropper 5"
    DROPPER_6 = "Dropper 6"
    DROPPER_7 = "Dropper 7"
    DROPPER_8 = "Dropper 8"
    DROPPER_9 = "Dropper 9"
    DROPPER_10 = "Dropper 10"


class DoorLocation(str, enum.Enum):
    """Room door locations"""
    left = "left"
    right = "right"
    top = "top"
    bottom = "bottom"
    top_left = "top_left"
    top_right = "top_right"
    bottom_left = "bottom_left"
    bottom_right = "bottom_right"
    LEFT = left
    RIGHT = right
    TOP = top
    BOTTOM = bottom
    TOP_LEFT = top_left
    TOP_RIGHT = top_right
    BOTTOM_LEFT = bottom_left
    BOTTOM_RIGHT = bottom_right


class PlanType(str, enum.Enum):
    """Seating plan types"""
    STRICT = "strict"  # Plan A - maximum separation
    COMPACT = "compact"  # Plan B - optimized spacing


class PlanStatus(str, enum.Enum):
    """Seating plan status"""
    DRAFT = "draft"
    REVIEWED = "reviewed"
    FINALIZED = "finalized"
    ARCHIVED = "archived"


# ==================== User Management ====================

class User(Base):
    """User account model"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=True)
    phone = Column(String(20), nullable=True)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.VIEWER, nullable=False)
    user_type = Column(String(20), default="non_teaching", nullable=True)
    permissions = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    schools = relationship("School", back_populates="admin")
    activity_logs = relationship("ActivityLog", back_populates="user")
    auth_tokens = relationship("Token", back_populates="user")
    auth_security_events = relationship("AuthSecurityEvent", back_populates="user")
    
    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"


class Token(Base):
    """OTP and refresh token storage model."""
    __tablename__ = "tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    token = Column(String(255), nullable=False)
    token_jti = Column(String(64), nullable=True, index=True)
    token_family = Column(String(64), nullable=True, index=True)
    token_type = Column(String(50), nullable=False)
    otp_code = Column(String(20), nullable=True)
    is_used = Column(Boolean, default=False, nullable=False)
    failure_count = Column(Integer, default=0, nullable=False)
    replaced_by_jti = Column(String(64), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user = relationship("User", back_populates="auth_tokens")

    def __repr__(self):
        return f"<Token(email={self.email}, type={self.token_type}, used={self.is_used})>"


class AuthThrottle(Base):
    """Tracks recent auth attempts and temporary lockouts."""
    __tablename__ = "auth_throttles"

    id = Column(Integer, primary_key=True, index=True)
    scope_key = Column(String(255), unique=True, nullable=False, index=True)
    action = Column(String(50), nullable=False, index=True)
    failure_count = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    window_started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_attempt_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AuthSecurityEvent(Base):
    """Audit trail for authentication and security events."""
    __tablename__ = "auth_security_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    event_type = Column(String(50), nullable=False, index=True)
    outcome = Column(String(50), nullable=False, index=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user = relationship("User", back_populates="auth_security_events")


# ==================== School & Organization ====================

class School(Base):
    """School/Institution model"""
    __tablename__ = "schools"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(255), nullable=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    admin = relationship("User", back_populates="schools")
    rooms = relationship("Room", back_populates="school", cascade="all, delete-orphan")
    exams = relationship("Exam", back_populates="school", cascade="all, delete-orphan")
    students = relationship("Student", back_populates="school", cascade="all, delete-orphan")
    teachers = relationship("Teacher", back_populates="school", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<School(id={self.id}, name={self.name})>"


# ==================== Student Management ====================

class Student(Base):
    """Student model"""
    __tablename__ = "students"
    
    id = Column(Integer, primary_key=True, index=True)
    roll_number = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    father_name = Column(String(255), nullable=True)
    batch = Column(String(255), nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=True, index=True)
    class_name = Column(String(50), nullable=True, index=True)
    section = Column(String(20), nullable=True, index=True)
    academic_session = Column(String(50), nullable=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    
    # Special needs/conditions
    special_needs = Column(Text, nullable=True)  # e.g., "wheelchair accessible", "extra time"
    requires_near_exit = Column(Boolean, default=False)
    requires_extra_time = Column(Boolean, default=False)
    boarding_type = Column(String(100), nullable=True)
    hostel_required = Column(Boolean, default=False, nullable=False)
    preferred_hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=True, index=True)
    hostel_request_status = Column(String(50), default="not_requested", nullable=False)
    assigned_hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=True, index=True)
    assigned_room_id = Column(Integer, ForeignKey("hostel_rooms.id"), nullable=True, index=True)
    assigned_bed_label = Column(String(50), nullable=True)
    hostel_notes = Column(Text, nullable=True)
    reference_name = Column(String(255), nullable=True)
    reference_number = Column(String(50), nullable=True)
    reference_remark = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    school = relationship("School", back_populates="students")
    batch_record = relationship("BatchTable", back_populates="students")
    seats = relationship("Seat", back_populates="student")
    preferred_hostel = relationship("Hostel", foreign_keys=[preferred_hostel_id])
    assigned_hostel = relationship("Hostel", foreign_keys=[assigned_hostel_id])
    assigned_room = relationship("HostelRoom", foreign_keys=[assigned_room_id])
    hostel_requests = relationship("StudentHostelRequest", back_populates="student", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Student(roll={self.roll_number}, name={self.name}, batch={self.batch})>"


class Hostel(Base):
    """Hostel master"""
    __tablename__ = "hostels"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    hostel_head = Column(String(255), nullable=True)
    warden_name = Column(String(255), nullable=True)
    gender_category = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    school = relationship("School", overlaps="hostels")
    rooms = relationship("HostelRoom", back_populates="hostel", cascade="all, delete-orphan")
    requests = relationship("StudentHostelRequest", back_populates="hostel")


class HostelRoom(Base):
    """Rooms and beds within a hostel"""
    __tablename__ = "hostel_rooms"

    id = Column(Integer, primary_key=True, index=True)
    hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=False, index=True)
    room_number = Column(String(100), nullable=False)
    total_beds = Column(Integer, default=1, nullable=False)
    occupied_beds = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    hostel = relationship("Hostel", back_populates="rooms")
    requests = relationship("StudentHostelRequest", back_populates="room")


class StudentHostelRequest(Base):
    """Approval and allocation request for hostel seats"""
    __tablename__ = "student_hostel_requests"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("hostel_rooms.id"), nullable=True, index=True)
    requested_notes = Column(Text, nullable=True)
    status = Column(String(50), default="pending", nullable=False)
    assigned_bed_label = Column(String(50), nullable=True)
    reviewed_by = Column(String(255), nullable=True)
    review_notes = Column(Text, nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    student = relationship("Student", back_populates="hostel_requests")
    hostel = relationship("Hostel", back_populates="requests")
    room = relationship("HostelRoom", back_populates="requests")


# ==================== Room Configuration ====================

class Room(Base):
    """Exam room model"""
    __tablename__ = "rooms"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    
    # Dimensions (in feet)
    length_feet = Column(Float, nullable=False)
    width_feet = Column(Float, nullable=False)
    
    # Desk dimensions (in feet)
    desk_length_feet = Column(Float, default=2.0, nullable=False)
    desk_width_feet = Column(Float, default=3.0, nullable=False)
    
    # Capacity
    num_benches = Column(Integer, nullable=False)  # Each bench has 2 seats
    capacity = Column(Integer, nullable=False)  # num_benches * 2
    
    # Clearances and zones (in feet)
    teaching_zone_clearance_feet = Column(Float, default=5.0, nullable=False)
    aisle_width_feet = Column(Float, default=3.0, nullable=False)
    door_location = Column(Enum(DoorLocation), default=DoorLocation.LEFT, nullable=False)
    
    # Additional settings
    window_location = Column(String(50), nullable=True)  # left, right, none
    glare_mitigation = Column(Boolean, default=False)
    is_accessible = Column(Boolean, default=False)  # wheelchair accessible
    
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    school = relationship("School", back_populates="rooms")
    desks = relationship("Desk", back_populates="room", cascade="all, delete-orphan")
    seating_plans = relationship("SeatingPlan", back_populates="room")
    
    def __repr__(self):
        return f"<Room(id={self.id}, name={self.name}, capacity={self.capacity})>"


class Desk(Base):
    """Individual desk/bench in a room"""
    __tablename__ = "desks"
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    
    # Position in room grid
    row = Column(Integer, nullable=False)  # e.g., 1, 2, 3...
    col = Column(Integer, nullable=False)  # e.g., 1, 2, 3...
    
    # For reserved seats
    is_reserved = Column(Boolean, default=False)
    reservation_reason = Column(String(255), nullable=True)  # e.g., "wheelchair access", "special needs"
    
    # Physical position (in feet from corner)
    x_position = Column(Float, nullable=True)
    y_position = Column(Float, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    room = relationship("Room", back_populates="desks")
    seats = relationship("Seat", back_populates="desk", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Desk(id={self.id}, room={self.room_id}, pos=({self.row},{self.col}))>"


class Seat(Base):
    """Individual seat on a desk (2 seats per desk)"""
    __tablename__ = "seats"
    
    id = Column(Integer, primary_key=True, index=True)
    desk_id = Column(Integer, ForeignKey("desks.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True)
    
    # Seat position on desk (left=1, right=2)
    position = Column(Integer, nullable=False)  # 1 or 2
    is_occupied = Column(Boolean, default=False)
    is_blocked = Column(Boolean, default=False)  # e.g., broken seat
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    desk = relationship("Desk", back_populates="seats")
    student = relationship("Student", back_populates="seats")
    
    def __repr__(self):
        return f"<Seat(id={self.id}, desk={self.desk_id}, pos={self.position}, occupied={self.is_occupied})>"


# ==================== Exams & Seating Plans ====================

class Exam(Base):
    """Exam event model"""
    __tablename__ = "exams"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    
    subject = Column(String(255), nullable=True)
    exam_date = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    
    # Student participation
    total_students = Column(Integer, default=0)
    total_batches = Column(Integer, default=0)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    school = relationship("School", back_populates="exams")
    seating_plans = relationship("SeatingPlan", back_populates="exam", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Exam(id={self.id}, name={self.name})>"


class SeatingPlan(Base):
    """Generated seating plan"""
    __tablename__ = "seating_plans"
    
    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    plan_type = Column(String(50), default=PlanType.STRICT.value, nullable=False)
    status = Column(String(50), default=PlanStatus.DRAFT.value, nullable=False)
    plan_data = Column(Text, nullable=True)
    
    # Statistics
    students_assigned = Column(Integer, default=0)
    batch_distribution = Column(Text, nullable=True)  # JSON: batch -> count
    
    # Validation
    is_valid = Column(Boolean, default=True)
    validation_errors = Column(Text, nullable=True)  # JSON array of errors
    
    # Metadata
    algorithm_version = Column(String(50), default="1.0")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    exam = relationship("Exam", back_populates="seating_plans")
    room = relationship("Room", back_populates="seating_plans")
    school = relationship("School", back_populates="seating_plans")
    
    def __repr__(self):
        return f"<SeatingPlan(id={self.id}, type={self.plan_type}, status={self.status})>"


# ==================== Activity & Audit Logging ====================

class ActivityLog(Base):
    """User activity audit log"""
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    action = Column(String(100), nullable=False)  # e.g., "import_students", "generate_plan", "export_pdf"
    resource_type = Column(String(100), nullable=True)  # e.g., "Student", "Room", "SeatingPlan"
    resource_id = Column(Integer, nullable=True)
    
    details = Column(Text, nullable=True)  # JSON: additional context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(255), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="activity_logs")
    
    def __repr__(self):
        return f"<ActivityLog(id={self.id}, action={self.action}, user={self.user_id})>"


class DayOfWeek(str, enum.Enum):
    """Days of the week"""
    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


# ==================== Teacher Management ====================

class Teacher(Base):
    """Teacher model"""
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    subject = Column(String(255), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)

    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    school = relationship("School", back_populates="teachers")
    timetable_entries = relationship("TimetableEntry", back_populates="teacher", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Teacher(id={self.id}, name={self.name}, subject={self.subject})>"


# ==================== Timetable Management ====================

class TimetableEntry(Base):
    """Timetable entry model"""
    __tablename__ = "timetable_entries"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)

    day_of_week = Column(Enum(DayOfWeek), nullable=False)
    start_time = Column(String(10), nullable=False)  # HH:MM format
    end_time = Column(String(10), nullable=False)    # HH:MM format
    class_name = Column(String(50), nullable=False)  # e.g., "6A", "7B", "10C"
    subject = Column(String(255), nullable=False)
    session_mode = Column(String(20), default="offline", nullable=False)
    session_type = Column(String(30), default="regular_class", nullable=False)
    extra_class_scope = Column(String(20), nullable=True)
    online_platform = Column(String(100), nullable=True)
    online_link = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    teacher = relationship("Teacher", back_populates="timetable_entries")
    school = relationship("School", back_populates="timetable_entries")
    room = relationship("Room")

    def __repr__(self):
        return f"<TimetableEntry(id={self.id}, teacher={self.teacher_id}, day={self.day_of_week}, class={self.class_name})>"


School.timetable_entries = relationship("TimetableEntry", back_populates="school", cascade="all, delete-orphan")


# ==================== Settings Management ====================

class Settings(Base):
    """School settings model"""
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)

    # School Information
    name = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    principal_name = Column(String(255), nullable=True)
    established_year = Column(Integer, nullable=True)

    # System Preferences
    timezone = Column(String(50), default="Asia/Kolkata", nullable=False)
    date_format = Column(String(20), default="DD/MM/YYYY", nullable=False)
    export_format = Column(String(10), default="both", nullable=False)  # pdf, excel, both
    auto_save = Column(Boolean, default=True, nullable=False)
    conflict_detection = Column(Boolean, default=True, nullable=False)
    email_notifications = Column(Boolean, default=False, nullable=False)

    # Batch Colors (stored as JSON)
    default_batch_colors = Column(Text, nullable=True)  # JSON string

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    school = relationship("School", back_populates="settings")

    def __repr__(self):
        return f"<Settings(id={self.id}, school={self.school_id})>"


# Add settings relationship to School model
School.settings = relationship("Settings", back_populates="school", uselist=False)


class LeaveType(str, enum.Enum):
    """Staff leave categories"""
    CASUAL = "casual"
    SICK = "sick"
    PAID = "paid"
    EMERGENCY = "emergency"


class LeaveStatus(str, enum.Enum):
    """Leave approval states"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class StudentAttendanceStatus(str, enum.Enum):
    """Student attendance statuses"""
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"


class StaffAttendanceStatus(str, enum.Enum):
    """Staff attendance statuses"""
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    HALF_DAY = "half_day"


class InventoryStockInType(str, enum.Enum):
    """Inventory stock-in source types"""
    PURCHASE = "purchase"
    DONATION = "donation"
    RETURN = "return"
    ADJUSTMENT = "adjustment"


class MaterialUnitType(str, enum.Enum):
    """Inventory material unit types"""
    BOOK = "book"
    COPY = "copy"
    SET = "set"
    UNIT = "unit"


class FeeInstallmentPlan(str, enum.Enum):
    """Fee installment plans"""
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class FeeAssignmentStatus(str, enum.Enum):
    """Fee assignment statuses"""
    PENDING = "pending"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"


class PaymentMethod(str, enum.Enum):
    """Payment methods"""
    UPI = "upi"
    CASH = "cash"
    CARD = "card"
    BANK_TRANSFER = "bank_transfer"


class PaymentVerificationStatus(str, enum.Enum):
    """Payment verification states"""
    PENDING = "pending"
    VERIFIED = "verified"
    FAILED = "failed"


class BatchTable(Base):
    """Batch master table used by newer student and inventory flows"""
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    category = Column(String(20), default="batch", nullable=False, index=True)
    syllabus = Column(String(255), nullable=True)
    display_order = Column(Integer, default=0, nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    school = relationship("School", overlaps="batches")
    students = relationship("Student", back_populates="batch_record")


class Invigilator(Base):
    """Exam invigilator directory"""
    __tablename__ = "invigilators"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    staff_id = Column(String(100), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    department = Column(String(100), nullable=True)
    designation = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    room_assignments = relationship("RoomInvigilator", back_populates="invigilator", cascade="all, delete-orphan")


class RoomInvigilator(Base):
    """Room-to-invigilator assignment"""
    __tablename__ = "room_invigilators"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False, index=True)
    invigilator_id = Column(Integer, ForeignKey("invigilators.id"), nullable=False, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    invigilator = relationship("Invigilator", back_populates="room_assignments")
    room = relationship("Room")
    exam = relationship("Exam")


class Supplier(Base):
    """Inventory suppliers"""
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    contact_person = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class InventorySubject(Base):
    """Inventory subject groups"""
    __tablename__ = "inventory_subjects"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    sets = relationship("InventorySet", back_populates="subject", cascade="all, delete-orphan")


class InventorySet(Base):
    """Inventory set groups within a subject"""
    __tablename__ = "inventory_sets"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("inventory_subjects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    subject = relationship("InventorySubject", back_populates="sets")
    volumes = relationship("InventoryVolume", back_populates="inventory_set", cascade="all, delete-orphan")


class InventoryVolume(Base):
    """Inventory volumes within a set"""
    __tablename__ = "inventory_volumes"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    set_id = Column(Integer, ForeignKey("inventory_sets.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    volume_number = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    inventory_set = relationship("InventorySet", back_populates="volumes")


class MaterialItem(Base):
    """Inventory material item"""
    __tablename__ = "material_items"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("inventory_subjects.id"), nullable=True, index=True)
    subject = Column(String(255), nullable=True)
    set_id = Column(Integer, ForeignKey("inventory_sets.id"), nullable=True, index=True)
    set_name = Column(String(255), nullable=True)
    volume_id = Column(Integer, ForeignKey("inventory_volumes.id"), nullable=True, index=True)
    volume_name = Column(String(255), nullable=True)
    volume_number = Column(Integer, nullable=True)
    set_part_name = Column(String(255), nullable=True)
    batch_names = Column(Text, nullable=True)
    class_name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    unit_type = Column(String(50), default=MaterialUnitType.BOOK.value, nullable=False)
    price = Column(Float, default=0.0, nullable=False)
    low_stock_threshold = Column(Integer, default=10, nullable=False)
    current_stock = Column(Integer, default=0, nullable=False)
    total_distributed = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    inventory_subject = relationship("InventorySubject")
    inventory_set = relationship("InventorySet")
    inventory_volume = relationship("InventoryVolume")


class StockInEntry(Base):
    """Inventory stock-in ledger"""
    __tablename__ = "stock_in_entries"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    date = Column(DateTime(timezone=True), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("material_items.id"), nullable=False, index=True)
    quantity_received = Column(Integer, nullable=False)
    entry_type = Column(String(50), default=InventoryStockInType.PURCHASE.value, nullable=False)
    added_by = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    supplier = relationship("Supplier")
    material = relationship("MaterialItem")


class StockOutEntry(Base):
    """Inventory stock-out ledger"""
    __tablename__ = "stock_out_entries"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    date = Column(DateTime(timezone=True), nullable=False)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=True, index=True)
    batch_name = Column(String(255), nullable=True)
    material_id = Column(Integer, ForeignKey("material_items.id"), nullable=False, index=True)
    quantity_issued = Column(Integer, nullable=False)
    issued_by = Column(String(255), nullable=True)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    batch = relationship("BatchTable")
    material = relationship("MaterialItem")


class StudentIssueEntry(Base):
    """Inventory student-wise issue ledger"""
    __tablename__ = "student_issue_entries"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    date = Column(DateTime(timezone=True), nullable=False)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=True, index=True)
    batch_name = Column(String(255), nullable=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    student_name = Column(String(255), nullable=False)
    material_id = Column(Integer, ForeignKey("material_items.id"), nullable=False, index=True)
    quantity_issued = Column(Integer, nullable=False)
    issued_by = Column(String(255), nullable=True)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    batch = relationship("BatchTable")
    student = relationship("Student")
    material = relationship("MaterialItem")


class EduPayParent(Base):
    """EduPay parent contact"""
    __tablename__ = "edupay_parents"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    mobile_number = Column(String(20), nullable=False, index=True)
    email = Column(String(255), nullable=True)
    relation = Column(String(50), nullable=False, default="parent")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    students = relationship("EduPayStudent", back_populates="parent")


class EduPayStudent(Base):
    """EduPay student account"""
    __tablename__ = "edupay_students"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("edupay_parents.id"), nullable=False, index=True)
    admission_no = Column(String(100), nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    class_name = Column(String(100), nullable=False)
    batch_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    boarding_type = Column(String(100), nullable=True)
    hostel_required = Column(Boolean, default=False, nullable=False)
    preferred_hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=True, index=True)
    hostel_request_status = Column(String(50), default="not_requested", nullable=False)
    assigned_hostel_id = Column(Integer, ForeignKey("hostels.id"), nullable=True, index=True)
    assigned_room_id = Column(Integer, ForeignKey("hostel_rooms.id"), nullable=True, index=True)
    assigned_bed_label = Column(String(50), nullable=True)
    hostel_notes = Column(Text, nullable=True)
    reference_name = Column(String(255), nullable=True)
    reference_number = Column(String(50), nullable=True)
    reference_remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    parent = relationship("EduPayParent", back_populates="students")
    assignments = relationship("EduPayFeeAssignment", back_populates="student", cascade="all, delete-orphan")


class EduPayFeeStructure(Base):
    """EduPay fee structure"""
    __tablename__ = "edupay_fee_structures"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    fee_type = Column(String(100), nullable=False)
    class_name = Column(String(100), nullable=True)
    installment_plan = Column(Enum(FeeInstallmentPlan), default=FeeInstallmentPlan.MONTHLY, nullable=False)
    total_amount = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    late_fee_rule = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    assignments = relationship("EduPayFeeAssignment", back_populates="fee_structure", cascade="all, delete-orphan")


class EduPayFeeAssignment(Base):
    """Fee assigned to a student"""
    __tablename__ = "edupay_fee_assignments"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("edupay_students.id"), nullable=False, index=True)
    fee_structure_id = Column(Integer, ForeignKey("edupay_fee_structures.id"), nullable=False, index=True)
    installment_label = Column(String(100), nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=False)
    amount_due = Column(Float, default=0.0, nullable=False)
    amount_paid = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    late_fee_applied = Column(Float, default=0.0, nullable=False)
    status = Column(Enum(FeeAssignmentStatus), default=FeeAssignmentStatus.PENDING, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("EduPayStudent", back_populates="assignments")
    fee_structure = relationship("EduPayFeeStructure", back_populates="assignments")
    payments = relationship("EduPayPayment", back_populates="assignment", cascade="all, delete-orphan")


class EduPayPayment(Base):
    """EduPay payment entries"""
    __tablename__ = "edupay_payments"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    assignment_id = Column(Integer, ForeignKey("edupay_fee_assignments.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("edupay_students.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    method = Column(Enum(PaymentMethod), default=PaymentMethod.UPI, nullable=False)
    payment_date = Column(DateTime(timezone=True), nullable=False)
    transaction_reference = Column(String(255), nullable=True)
    receipt_number = Column(String(100), nullable=False, index=True)
    verification_status = Column(Enum(PaymentVerificationStatus), default=PaymentVerificationStatus.PENDING, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    assignment = relationship("EduPayFeeAssignment", back_populates="payments")
    student = relationship("EduPayStudent")


class AttendanceStudent(Base):
    """Attendance-specific student registry"""
    __tablename__ = "attendance_students"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    class_name = Column(String(50), nullable=False, index=True)
    section = Column(String(20), nullable=False, index=True)
    roll_no = Column(String(50), nullable=False, index=True)
    parent_contact = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    attendance_records = relationship("StudentAttendance", back_populates="student", cascade="all, delete-orphan")


class AttendanceStaff(Base):
    """Attendance-specific staff registry"""
    __tablename__ = "attendance_staff"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    staff_id = Column(String(100), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    department = Column(String(100), nullable=False, index=True)
    designation = Column(String(100), nullable=True)
    shift = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    attendance_records = relationship("StaffAttendance", back_populates="staff_member", cascade="all, delete-orphan")
    leave_requests = relationship("AttendanceLeave", back_populates="staff_member", cascade="all, delete-orphan")


class AttendanceSubject(Base):
    """Attendance subject mapping by class and section"""
    __tablename__ = "attendance_subjects"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    class_name = Column(String(50), nullable=False, index=True)
    section = Column(String(20), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    attendance_records = relationship("StudentAttendance", back_populates="subject", cascade="all, delete-orphan")


class AttendanceSetting(Base):
    """Attendance settings per school"""
    __tablename__ = "attendance_settings"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, unique=True, index=True)
    minimum_attendance_threshold = Column(Float, default=75.0, nullable=False)
    working_hours_start = Column(String(10), default="09:00", nullable=False)
    working_hours_end = Column(String(10), default="17:00", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AttendanceHoliday(Base):
    """Attendance holiday calendar"""
    __tablename__ = "attendance_holidays"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    holiday_date = Column(DateTime(timezone=True), nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AttendanceNotification(Base):
    """Attendance notifications feed"""
    __tablename__ = "attendance_notifications"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    user_name = Column(String(255), nullable=True)
    user_role = Column(String(100), nullable=True)
    message = Column(Text, nullable=False)
    notification_type = Column(String(100), nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AttendanceLeave(Base):
    """Staff leave requests"""
    __tablename__ = "attendance_leaves"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    staff_member_id = Column(Integer, ForeignKey("attendance_staff.id"), nullable=False, index=True)
    leave_type = Column(Enum(LeaveType), nullable=False)
    from_date = Column(DateTime(timezone=True), nullable=False)
    to_date = Column(DateTime(timezone=True), nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(Enum(LeaveStatus), default=LeaveStatus.PENDING, nullable=False)
    approved_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    staff_member = relationship("AttendanceStaff", back_populates="leave_requests")


class StudentAttendance(Base):
    """Student attendance records"""
    __tablename__ = "student_attendance"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("attendance_students.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("attendance_subjects.id"), nullable=False, index=True)
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(Enum(StudentAttendanceStatus), default=StudentAttendanceStatus.PRESENT, nullable=False)
    absence_reason = Column(Text, nullable=True)
    marked_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    student = relationship("AttendanceStudent", back_populates="attendance_records")
    subject = relationship("AttendanceSubject", back_populates="attendance_records")


class StaffAttendance(Base):
    """Staff attendance records"""
    __tablename__ = "staff_attendance"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False, index=True)
    staff_member_id = Column(Integer, ForeignKey("attendance_staff.id"), nullable=False, index=True)
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(Enum(StaffAttendanceStatus), default=StaffAttendanceStatus.PRESENT, nullable=False)
    check_in = Column(String(10), nullable=True)
    check_out = Column(String(10), nullable=True)
    marked_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    staff_member = relationship("AttendanceStaff", back_populates="attendance_records")


School.seating_plans = relationship("SeatingPlan", cascade="all, delete-orphan")
School.hostels = relationship("Hostel", cascade="all, delete-orphan")
Room.room_invigilators = relationship("RoomInvigilator", back_populates="room")
School.batches = relationship("BatchTable", cascade="all, delete-orphan")
School.invigilators = relationship("Invigilator", cascade="all, delete-orphan")
School.suppliers = relationship("Supplier", cascade="all, delete-orphan")
School.inventory_subjects = relationship("InventorySubject", cascade="all, delete-orphan")
School.inventory_sets = relationship("InventorySet", cascade="all, delete-orphan")
School.inventory_volumes = relationship("InventoryVolume", cascade="all, delete-orphan")
School.material_items = relationship("MaterialItem", cascade="all, delete-orphan")
School.stock_in_entries = relationship("StockInEntry", cascade="all, delete-orphan")
School.stock_out_entries = relationship("StockOutEntry", cascade="all, delete-orphan")
School.student_issue_entries = relationship("StudentIssueEntry", cascade="all, delete-orphan")
School.edupay_parents = relationship("EduPayParent", cascade="all, delete-orphan")
School.edupay_students = relationship("EduPayStudent", cascade="all, delete-orphan")
School.edupay_fee_structures = relationship("EduPayFeeStructure", cascade="all, delete-orphan")
School.edupay_fee_assignments = relationship("EduPayFeeAssignment", cascade="all, delete-orphan")
School.edupay_payments = relationship("EduPayPayment", cascade="all, delete-orphan")
School.attendance_students = relationship("AttendanceStudent", cascade="all, delete-orphan")
School.attendance_staff = relationship("AttendanceStaff", cascade="all, delete-orphan")
School.attendance_subjects = relationship("AttendanceSubject", cascade="all, delete-orphan")
School.attendance_setting = relationship("AttendanceSetting", uselist=False, cascade="all, delete-orphan")
School.attendance_holidays = relationship("AttendanceHoliday", cascade="all, delete-orphan")
School.attendance_notifications = relationship("AttendanceNotification", cascade="all, delete-orphan")
School.attendance_leaves = relationship("AttendanceLeave", cascade="all, delete-orphan")
School.student_attendance_records = relationship("StudentAttendance", cascade="all, delete-orphan")
School.staff_attendance_records = relationship("StaffAttendance", cascade="all, delete-orphan")
