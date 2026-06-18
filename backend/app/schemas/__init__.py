"""
Pydantic validation schemas
"""
import re
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from enum import Enum

from app.models import DoorLocation, LeaveStatus, LeaveType

ISO_DATE_PREFIX_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


# ==================== Auth Schemas ====================

class SendOTPRequest(BaseModel):
    """Request to send OTP"""
    email: str


class VerifyOTPRequest(BaseModel):
    """Request to verify OTP"""
    email: str
    otp_code: str


class LoginResponse(BaseModel):
    """Login successful response"""
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    access_token_expires_in_seconds: int = 0
    refresh_token_expires_in_seconds: int = 0
    user_id: int
    email: str
    username: Optional[str] = None
    full_name: str
    role: str
    user_type: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)


class PasswordLoginRequest(BaseModel):
    """Password login request"""
    username: str
    password: str


class RefreshTokenRequest(BaseModel):
    """Refresh token request."""
    refresh_token: str


class LogoutRequest(BaseModel):
    """Logout request."""
    refresh_token: Optional[str] = None


class UserBase(BaseModel):
    """Base user schema"""
    email: str
    full_name: str
    phone: Optional[str] = None


class UserCreate(UserBase):
    """Create user schema"""
    password: str


class UserResponse(UserBase):
    """User response schema"""
    id: int
    role: str
    is_active: bool
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class UserRolePowerBase(BaseModel):
    """Shared schema for admin-managed users"""
    username: Optional[str] = None
    full_name: str
    email: Optional[str] = None
    password: Optional[str] = None
    role: str
    user_type: str = "non_teaching"
    permissions: List[str] = Field(default_factory=list)


class UserRolePowerCreate(UserRolePowerBase):
    """Create role user schema"""
    pass


class UserRolePowerUpdate(BaseModel):
    """Update role user schema"""
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    user_type: Optional[str] = None
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None


class UserRolePowerResponse(UserRolePowerBase):
    """Role user response schema"""
    id: str | int
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ==================== Batch Schemas ====================

class BatchBase(BaseModel):
    """Base batch schema"""
    name: str
    category: str = "batch"
    syllabus: Optional[str] = None
    display_order: int = 0
    is_active: bool = True


class BatchCreate(BatchBase):
    """Create batch schema"""
    pass


class BatchUpdate(BaseModel):
    """Update batch schema"""
    name: Optional[str] = None
    category: Optional[str] = None
    syllabus: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class BatchResponse(BatchBase):
    """Batch response schema"""
    id: str | int
    school_id: str | int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BatchWithStudentCount(BatchResponse):
    """Batch response with student count"""
    student_count: int


class BatchReorderItem(BaseModel):
    batch_id: str | int
    display_order: int


class BatchReorderRequest(BaseModel):
    items: List[BatchReorderItem]


# ==================== Student Schemas ====================

class StudentBase(BaseModel):
    """Base student schema"""
    roll_number: str
    full_name: str = Field(validation_alias=AliasChoices("full_name", "name"))
    father_name: Optional[str] = None
    batch_id: Optional[str] = None
    batch_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("batch_name", "batch"))
    class_name: Optional[str] = None
    section: Optional[str] = None
    academic_session: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    special_needs: Optional[str] = None
    requires_near_exit: bool = False
    requires_extra_time: bool = False
    boarding_type: Optional[str] = None
    hostel_required: bool = False
    preferred_hostel_id: Optional[str] = None
    hostel_request_status: Optional[str] = None
    assigned_hostel_id: Optional[str] = None
    assigned_hostel_name: Optional[str] = None
    assigned_room_id: Optional[str] = None
    assigned_room_number: Optional[str] = None
    assigned_bed_label: Optional[str] = None
    hostel_notes: Optional[str] = None
    reference_name: Optional[str] = None
    reference_number: Optional[str] = None
    reference_remark: Optional[str] = None

    @field_validator("batch_id", mode="before")
    @classmethod
    def normalize_optional_batch_id(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("batch_name", mode="before")
    @classmethod
    def normalize_optional_batch_name(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("preferred_hostel_id", "assigned_hostel_id", "assigned_room_id", mode="before")
    @classmethod
    def normalize_optional_hostel_identifiers(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_batch_reference(self):
        if not self.batch_id and not self.batch_name:
            raise ValueError("Either batch_id or batch_name is required")
        return self


class StudentCreate(StudentBase):
    """Create student schema"""
    pass


class StudentUpdate(BaseModel):
    """Update student schema"""
    roll_number: Optional[str] = None
    full_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("full_name", "name"))
    father_name: Optional[str] = None
    batch_id: Optional[str] = None
    batch_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("batch_name", "batch"))
    class_name: Optional[str] = None
    section: Optional[str] = None
    academic_session: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    special_needs: Optional[str] = None
    requires_near_exit: Optional[bool] = None
    requires_extra_time: Optional[bool] = None
    boarding_type: Optional[str] = None
    hostel_required: Optional[bool] = None
    preferred_hostel_id: Optional[str] = None
    hostel_request_status: Optional[str] = None
    assigned_hostel_id: Optional[str] = None
    assigned_room_id: Optional[str] = None
    assigned_bed_label: Optional[str] = None
    hostel_notes: Optional[str] = None
    reference_name: Optional[str] = None
    reference_number: Optional[str] = None
    reference_remark: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("batch_id", mode="before")
    @classmethod
    def normalize_optional_batch_id(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("batch_name", mode="before")
    @classmethod
    def normalize_optional_batch_name(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("preferred_hostel_id", "assigned_hostel_id", "assigned_room_id", mode="before")
    @classmethod
    def normalize_optional_hostel_identifiers(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class StudentResponse(StudentBase):
    """Student response schema"""
    id: str | int
    school_id: str | int
    name: Optional[str] = None
    batch: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class StudentImportResponse(BaseModel):
    """Response from student import"""
    imported_count: int
    skipped_count: int
    errors: List[Dict[str, Any]]
    message: str


class StaffImportResponse(BaseModel):
    """Response from staff import"""
    imported_count: int
    updated_count: int
    skipped_count: int
    errors: List[Dict[str, Any]]
    message: str


class StudentBatchTransferRequest(BaseModel):
    """Transfer selected or whole-batch students to another batch"""
    target_batch: str
    student_ids: List[int] = Field(default_factory=list)
    source_batch: Optional[str] = None
    transfer_all_from_batch: bool = False


class StudentBatchTransferResponse(BaseModel):
    """Response for student batch transfer"""
    transferred_count: int
    source_batch: Optional[str] = None
    target_batch: str
    message: str


class StudentBulkDeleteRequest(BaseModel):
    """Delete a selected set of students."""
    student_ids: List[str] = Field(default_factory=list)


class HostelRoomCreate(BaseModel):
    room_number: str
    total_beds: int = 1


class HostelRoomUpdate(BaseModel):
    room_number: Optional[str] = None
    total_beds: Optional[int] = None
    is_active: Optional[bool] = None


class HostelRoomResponse(BaseModel):
    id: str
    hostel_id: str
    room_number: str
    total_beds: int
    occupied_beds: int
    available_beds: int
    is_active: bool


class HostelCreate(BaseModel):
    name: str
    hostel_code: Optional[str] = None
    hostel_head: Optional[str] = None
    warden_name: Optional[str] = None
    gender_category: Optional[str] = None
    address: Optional[str] = None
    is_active: bool = True
    total_rooms: int = 0
    rooms: List[HostelRoomCreate] = Field(default_factory=list)


class HostelUpdate(BaseModel):
    name: Optional[str] = None
    hostel_code: Optional[str] = None
    hostel_head: Optional[str] = None
    warden_name: Optional[str] = None
    gender_category: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class HostelResponse(BaseModel):
    id: str
    name: str
    hostel_code: Optional[str] = None
    hostel_head: Optional[str] = None
    warden_name: Optional[str] = None
    gender_category: Optional[str] = None
    address: Optional[str] = None
    is_active: bool
    total_capacity: int
    occupied_beds: int
    available_beds: int
    total_rooms: int
    rooms: List[HostelRoomResponse] = Field(default_factory=list)


class HostelReportRow(BaseModel):
    values: Dict[str, Any]


class HostelReportResponse(BaseModel):
    report_type: str
    generated_at: datetime
    rows: List[HostelReportRow] = Field(default_factory=list)
    total_records: int


class StudentHostelRequestCreate(BaseModel):
    hostel_id: str | int
    requested_notes: Optional[str] = None


class StudentHostelRequestDecision(BaseModel):
    hostel_id: Optional[str | int] = None
    room_id: Optional[str | int] = None
    reviewed_by: Optional[str] = None
    review_notes: Optional[str] = None


class StudentHostelRequestResponse(BaseModel):
    id: str | int
    student_id: str | int
    student_name: str
    roll_number: str
    batch: str
    class_name: Optional[str] = None
    section: Optional[str] = None
    reference_name: Optional[str] = None
    reference_number: Optional[str] = None
    reference_remark: Optional[str] = None
    hostel_id: str | int
    hostel_name: str
    room_id: Optional[str | int] = None
    room_number: Optional[str] = None
    current_room: Optional[str] = None
    requested_notes: Optional[str] = None
    status: str
    request_status: str
    allocation_active: bool = False
    allocation_status: Optional[str] = None
    assigned_bed_label: Optional[str] = None
    reviewed_by: Optional[str] = None
    review_notes: Optional[str] = None
    requested_at: datetime
    reviewed_at: Optional[datetime] = None
    vacated_at: Optional[datetime] = None
    vacated_by: Optional[str] = None


# ==================== Room Schemas ====================

DOOR_LOCATION_ALIASES = {
    'front': DoorLocation.top.value,
    'back': DoorLocation.bottom.value,
    'top': DoorLocation.top.value,
    'bottom': DoorLocation.bottom.value,
    'left': DoorLocation.left.value,
    'right': DoorLocation.right.value,
    'front_left': DoorLocation.top_left.value,
    'left_front': DoorLocation.top_left.value,
    'top_left': DoorLocation.top_left.value,
    'front_right': DoorLocation.top_right.value,
    'right_front': DoorLocation.top_right.value,
    'top_right': DoorLocation.top_right.value,
    'back_left': DoorLocation.bottom_left.value,
    'left_back': DoorLocation.bottom_left.value,
    'bottom_left': DoorLocation.bottom_left.value,
    'back_right': DoorLocation.bottom_right.value,
    'right_back': DoorLocation.bottom_right.value,
    'bottom_right': DoorLocation.bottom_right.value,
}

VALID_DOOR_LOCATIONS = {location.value for location in DoorLocation}


def normalize_door_location(value: Optional[str], default: Optional[str] = None) -> Optional[str]:
    if value is None:
        return default

    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")

    if not normalized:
        return default

    normalized = DOOR_LOCATION_ALIASES.get(normalized, normalized)
    if normalized not in VALID_DOOR_LOCATIONS:
        raise ValueError(f"Invalid door_location: {value}")
    return normalized


class RoomBase(BaseModel):
    """Base room schema"""
    name: str
    length_feet: float
    width_feet: float
    desk_length_feet: float = 2.0
    desk_width_feet: float = 3.0
    num_benches: int
    teaching_zone_clearance_feet: float = 5.0
    aisle_width_feet: float = 3.0
    door_location: str = DoorLocation.left.value
    window_location: Optional[str] = None
    glare_mitigation: bool = False
    is_accessible: bool = False
    room_code: Optional[str] = None

    @field_validator('door_location', mode='before')
    def validate_door_location(cls, value):
        return normalize_door_location(value, default=DoorLocation.left.value)


class RoomCreate(RoomBase):
    """Create room schema"""
    pass


class RoomUpdate(BaseModel):
    """Update room schema"""
    name: Optional[str] = None
    length_feet: Optional[float] = None
    width_feet: Optional[float] = None
    desk_length_feet: Optional[float] = None
    desk_width_feet: Optional[float] = None
    num_benches: Optional[int] = None
    teaching_zone_clearance_feet: Optional[float] = None
    aisle_width_feet: Optional[float] = None
    door_location: Optional[str] = None
    window_location: Optional[str] = None
    is_accessible: Optional[bool] = None
    glare_mitigation: Optional[bool] = None
    room_code: Optional[str] = None

    @field_validator('door_location', mode='before')
    def validate_door_location(cls, value):
        return normalize_door_location(value)


class RoomResponse(BaseModel):
    id: int | str
    room_code: str
    name: str
    length_feet: float
    width_feet: float
    desk_length_feet: float
    desk_width_feet: float
    num_benches: int
    capacity: int
    teaching_zone_clearance_feet: float
    aisle_width_feet: float
    door_location: str
    window_location: str
    glare_mitigation: bool
    is_accessible: bool
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# ==================== Seating Plan Schemas ====================

class SeatPosition(BaseModel):
    """Single seat position"""
    seat_id: int | str
    desk_id: int | str
    position: int  # 1 or 2
    student_id: Optional[int | str] = None
    student_name: Optional[str] = None
    student_roll: Optional[str] = None
    batch: Optional[str] = None
    is_occupied: bool
    row: int
    col: int


class DeskLayout(BaseModel):
    """Desk with both seat positions"""
    desk_id: int | str
    row: int
    col: int
    seats: List[SeatPosition]
    is_reserved: bool = False
    reservation_reason: Optional[str] = None


class RoomLayout(BaseModel):
    """Complete room layout"""
    room_id: int | str
    room_name: str
    desks: List[DeskLayout]
    dimensions: Dict[str, float]
    capacity: int
    occupied: int


class GenerateSeatingRequest(BaseModel):
    """Request to generate seating plans"""
    model_config = ConfigDict(populate_by_name=True)

    exam_id: int | str
    room_ids: List[int | str]
    algorithm_version: str = "1.0"
    batches: List[str] = Field(default_factory=list, validation_alias=AliasChoices("batches", "batch_names"))
    plan_type: Optional[str] = None
    generated_date: Optional[datetime] = Field(default=None, validation_alias=AliasChoices("generated_date", "generated_at"))
    invigilator_assignments: Dict[str, Optional[int]] = Field(default_factory=dict)
    batch_conflict_groups: List[List[str]] = Field(default_factory=list)


class SeatingPlanResponse(BaseModel):
    """Seating plan response"""
    id: int | str
    exam_id: int | str
    room_id: int | str
    exam_name: Optional[str] = None
    exam_subject: Optional[str] = None
    room_name: Optional[str] = None
    batches: List[str] = Field(default_factory=list)
    batch_distribution: List[dict] = Field(default_factory=list)
    name: str
    plan_type: str
    status: str
    students_assigned: int
    is_valid: bool
    validation_errors: Optional[List[str]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SeatingPlanEntry(BaseModel):
    """Individual seating plan entry from Excel"""
    sr_no: Optional[int] = None
    roll_no: str
    candidate_name: str
    father_name: Optional[str] = None
    batch: str
    room_no: str


class SeatingPlanImportResponse(BaseModel):
    """Response for seating plan import"""
    success: bool
    imported_count: int
    skipped_count: int
    errors: List[Dict[str, Any]]
    room_summary: Dict[str, int]  # room_no -> count


# ==================== Teacher Schemas ====================

class TeacherBase(BaseModel):
    """Base teacher schema"""
    name: str = Field(..., min_length=1, max_length=255)
    subject: str = Field(..., min_length=1, max_length=255)
    email: Optional[str] = None
    phone: Optional[str] = None
    employee_code: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[date | str] = None
    shift_timing: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    photoDataUrl: Optional[str] = None


class TeacherCreate(TeacherBase):
    """Create teacher schema"""
    pass


class TeacherUpdate(BaseModel):
    """Update teacher schema"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    subject: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[str] = None
    phone: Optional[str] = None
    employee_code: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[date | str] = None
    shift_timing: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    photoDataUrl: Optional[str] = None
    is_active: Optional[bool] = None


class TeacherResponse(TeacherBase):
    """Teacher response schema"""
    id: int | str
    school_id: int | str
    employee_code: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[date | str] = None
    shift_timing: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    photoDataUrl: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ==================== Timetable Schemas ====================

class DayOfWeek(str, Enum):
    """Days of the week"""
    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


class TimetableEntryBase(BaseModel):
    """Base timetable entry schema"""
    teacher_id: Optional[int | str] = None
    room_id: Optional[int | str] = None
    session_mode: str = "offline"
    session_type: str = "regular_class"
    extra_class_scope: Optional[str] = None
    online_platform: Optional[str] = None
    online_link: Optional[str] = None
    online_provider: Optional[str] = None
    meeting_link: Optional[str] = None
    meeting_id: Optional[str] = None
    meeting_password: Optional[str] = None
    recording_url: Optional[str] = None
    notes: Optional[str] = None
    day_of_week: DayOfWeek
    start_time: str = Field(..., pattern=r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$')  # HH:MM format
    end_time: str = Field(..., pattern=r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$')    # HH:MM format
    class_name: str = Field(..., min_length=1, max_length=255)
    subject: str = Field(..., min_length=1, max_length=255)
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class TimetableEntryCreate(TimetableEntryBase):
    """Create timetable entry schema"""
    skip_conflict_check: bool = False


class TimetableEntryUpdate(BaseModel):
    """Update timetable entry schema"""
    teacher_id: Optional[int | str] = None
    room_id: Optional[int | str] = None
    session_mode: Optional[str] = None
    session_type: Optional[str] = None
    extra_class_scope: Optional[str] = None
    online_platform: Optional[str] = None
    online_link: Optional[str] = None
    online_provider: Optional[str] = None
    meeting_link: Optional[str] = None
    meeting_id: Optional[str] = None
    meeting_password: Optional[str] = None
    recording_url: Optional[str] = None
    notes: Optional[str] = None
    day_of_week: Optional[DayOfWeek] = None
    start_time: Optional[str] = Field(None, pattern=r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$')
    end_time: Optional[str] = Field(None, pattern=r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$')
    class_name: Optional[str] = Field(None, min_length=1, max_length=255)
    subject: Optional[str] = Field(None, min_length=1, max_length=255)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None


class TimetableEntryResponse(TimetableEntryBase):
    """Timetable entry response schema"""
    id: int | str
    school_id: int | str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    teacher_name: Optional[str] = None  # Joined field
    room_name: Optional[str] = None


class TimetableView(BaseModel):
    """Timetable view with teacher info"""
    id: int | str
    day_of_week: DayOfWeek
    start_time: str
    end_time: str
    class_name: str
    subject: str
    teacher_name: Optional[str] = None
    teacher_id: Optional[int | str] = None
    room_id: Optional[int | str] = None
    room_name: Optional[str] = None
    session_mode: str = "offline"
    session_type: str = "regular_class"
    extra_class_scope: Optional[str] = None
    online_platform: Optional[str] = None
    online_link: Optional[str] = None
    online_provider: Optional[str] = None
    meeting_link: Optional[str] = None
    meeting_id: Optional[str] = None
    meeting_password: Optional[str] = None
    recording_url: Optional[str] = None
    notes: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ConflictCheckResponse(BaseModel):
    """Response for conflict checking"""
    has_conflict: bool
    conflicting_entries: Optional[List[TimetableEntryResponse]] = None
    message: str
    
    model_config = ConfigDict(from_attributes=True)


class PlansComparisonResponse(BaseModel):
    """Comparison of two seating plans"""
    plan_a: SeatingPlanResponse
    plan_b: SeatingPlanResponse
    room_layout_a: RoomLayout
    room_layout_b: RoomLayout


# ==================== Export Schemas ====================

class ExportPDFRequest(BaseModel):
    """Request to export PDF"""
    plan_id: int
    include_batch_info: bool = True
    include_invigilator_notes: bool = True


class ExportExcelRequest(BaseModel):
    """Request to export Excel"""
    plan_id: int
    include_room_diagram: bool = False


# ==================== Analytics Schemas ====================

class BatchDistribution(BaseModel):
    """Batch distribution in plan"""
    batch: str
    count: int
    percentage: float


class PlanStatistics(BaseModel):
    """Statistics for a seating plan"""
    plan_id: int
    total_students: int
    total_desks: int
    occupancy_rate: float
    batch_distribution: List[BatchDistribution]
    same_batch_violations: int
    adjacency_violations: int


# ==================== Error Response ====================

class ErrorResponse(BaseModel):
    """Standard error response"""
    detail: str
    error_code: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)


# ==================== Invigilator Schemas ====================

class InvigilatorBase(BaseModel):
    staff_id: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[date | str] = None
    shift_timing: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    photoDataUrl: Optional[str] = None


class InvigilatorCreate(InvigilatorBase):
    pass


class InvigilatorUpdate(BaseModel):
    staff_id: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    joining_date: Optional[date | str] = None
    shift_timing: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    photoDataUrl: Optional[str] = None
    is_active: Optional[bool] = None


class InvigilatorResponse(InvigilatorBase):
    id: int | str
    school_id: str | int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RoomInvigilatorBase(BaseModel):
    room_id: str
    invigilator_id: str
    exam_id: Optional[str] = None
    notes: Optional[str] = None


class RoomInvigilatorCreate(RoomInvigilatorBase):
    pass


class RoomInvigilatorUpdate(BaseModel):
    invigilator_id: Optional[str] = None
    exam_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class RoomInvigilatorResponse(RoomInvigilatorBase):
    id: int | str
    school_id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    invigilator: Optional[InvigilatorResponse] = None
    room: Optional[RoomResponse] = None

    model_config = ConfigDict(from_attributes=True)


class InvigilatorWithRoomsResponse(InvigilatorResponse):
    room_assignments: List[RoomInvigilatorResponse] = Field(default_factory=list)


# ==================== Inventory Schemas ====================

class SupplierBase(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    is_active: bool = True


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierResponse(SupplierBase):
    id: str
    school_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InventorySubjectBase(BaseModel):
    name: str
    is_active: bool = True


class InventorySubjectCreate(InventorySubjectBase):
    pass


class InventorySubjectUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class InventorySubjectResponse(InventorySubjectBase):
    id: str
    school_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InventorySetBase(BaseModel):
    subject_id: str
    name: str
    is_active: bool = True


class InventorySetCreate(InventorySetBase):
    pass


class InventorySetUpdate(BaseModel):
    subject_id: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class InventorySetResponse(InventorySetBase):
    id: str
    subject_name: str
    school_id: str
    created_at: datetime
    updated_at: datetime


class InventoryVolumeBase(BaseModel):
    set_id: str
    name: str
    volume_number: int
    is_active: bool = True


class InventoryVolumeCreate(InventoryVolumeBase):
    pass


class InventoryVolumeUpdate(BaseModel):
    set_id: Optional[str] = None
    name: Optional[str] = None
    volume_number: Optional[int] = None
    is_active: Optional[bool] = None


class InventoryVolumeResponse(InventoryVolumeBase):
    id: str
    set_name: str
    subject_id: str
    subject_name: str
    school_id: str
    created_at: datetime
    updated_at: datetime


class MaterialBase(BaseModel):
    name: str
    subject_id: Optional[str] = None
    subject: Optional[str] = None
    set_id: Optional[str] = None
    set_name: Optional[str] = None
    volume_id: Optional[str] = None
    volume_name: Optional[str] = None
    volume_number: Optional[int] = None
    set_part_name: Optional[str] = None
    batch_names: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    unit_type: str = "book"
    price: float = 0.0
    low_stock_threshold: int = 10
    is_active: bool = True


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(BaseModel):
    name: Optional[str] = None
    subject_id: Optional[str] = None
    subject: Optional[str] = None
    set_id: Optional[str] = None
    set_name: Optional[str] = None
    volume_id: Optional[str] = None
    volume_name: Optional[str] = None
    volume_number: Optional[int] = None
    set_part_name: Optional[str] = None
    batch_names: Optional[List[str]] = None
    description: Optional[str] = None
    unit_type: Optional[str] = None
    price: Optional[float] = None
    low_stock_threshold: Optional[int] = None
    is_active: Optional[bool] = None


class MaterialResponse(MaterialBase):
    id: str
    school_id: str
    current_stock: int = 0
    total_distributed: int = 0
    created_at: datetime
    updated_at: datetime


class InventoryMaterialImportResponse(BaseModel):
    imported_count: int
    updated_count: int
    skipped_count: int
    errors: List[Dict[str, Any]]
    message: str


class StockInCreate(BaseModel):
    date: datetime
    supplier_id: str
    material_id: str
    quantity_received: int
    entry_type: str = "purchase"
    added_by: Optional[str] = None
    notes: Optional[str] = None


class StockInResponse(BaseModel):
    id: str
    date: date
    supplier_id: Optional[str] = None
    supplier_name: str
    material_id: str
    material_name: str
    quantity_received: int
    entry_type: str
    added_by: str
    notes: Optional[str] = None
    school_id: str
    created_at: datetime


class StockOutCreate(BaseModel):
    date: datetime
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    batch_ids: List[str] = Field(default_factory=list)
    material_id: str
    quantity_issued: int
    issued_by: Optional[str] = None
    remarks: Optional[str] = None


class StockOutResponse(BaseModel):
    id: str
    date: date
    batch_id: Optional[str] = None
    batch_name: str
    material_id: str
    material_name: str
    quantity_issued: int
    issued_by: str
    remarks: Optional[str] = None
    school_id: str
    created_at: datetime


class StudentIssueCreate(BaseModel):
    date: datetime
    batch_id: Optional[str] = None
    student_ids: List[str] = Field(default_factory=list)
    material_id: str
    quantity_issued: int
    issued_by: Optional[str] = None
    remarks: Optional[str] = None


class StudentIssueResponse(BaseModel):
    id: str
    date: date
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    student_id: str
    student_name: str
    material_id: str
    material_name: str
    quantity_issued: int
    issued_by: str
    remarks: Optional[str] = None
    school_id: str
    created_at: datetime


class InventoryDashboardResponse(BaseModel):
    total_materials_registered: int
    total_books_in_inventory: int
    total_books_distributed: int
    current_stock_available: int
    low_stock_alert_count: int
    low_stock_items: List[MaterialResponse] = Field(default_factory=list)


class InventoryHistoryEntry(BaseModel):
    entry_id: str | int
    entry_kind: str
    date: date
    material_id: str | int
    material_name: str
    quantity: int
    counterparty: str
    performed_by: str
    notes: Optional[str] = None


class InventoryCatalogVolume(BaseModel):
    id: str | int
    name: str
    volume_number: int
    is_active: bool
    materials: List[MaterialResponse] = Field(default_factory=list)


class InventoryCatalogSet(BaseModel):
    id: str | int
    name: str
    is_active: bool
    volumes: List[InventoryCatalogVolume] = Field(default_factory=list)


class InventoryCatalogSubject(BaseModel):
    id: str | int
    name: str
    is_active: bool
    sets: List[InventoryCatalogSet] = Field(default_factory=list)


class InventoryReportRow(BaseModel):
    values: Dict[str, Any]


class InventoryReportResponse(BaseModel):
    report_type: str
    generated_at: datetime
    rows: List[InventoryReportRow] = Field(default_factory=list)
    total_records: int


# ==================== EduPay Schemas ====================

class EduPayParentResponse(BaseModel):
    id: int | str
    full_name: str
    mobile_number: str
    email: Optional[str] = None
    relation: str
    school_id: int | str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EduPayStudentCreate(BaseModel):
    admission_no: str
    full_name: str
    class_name: str
    batch_name: Optional[str] = None
    parent_name: str
    parent_mobile: str
    parent_email: Optional[str] = None
    parent_relation: str = "parent"
    email: Optional[str] = None
    phone: Optional[str] = None


class EduPayStudentResponse(BaseModel):
    id: int | str
    admission_no: str
    full_name: str
    class_name: str
    batch_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    school_id: int | str
    parent_id: int | str
    parent_name: str
    parent_mobile: str
    parent_email: Optional[str] = None
    total_due: float
    total_paid: float
    status: str
    next_due_date: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EduPayFeeStructureCreate(BaseModel):
    name: str
    fee_type: str
    class_name: Optional[str] = None
    installment_plan: str = "monthly"
    total_amount: float
    discount_amount: float = 0.0
    late_fee_rule: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class EduPayFeeStructureResponse(BaseModel):
    id: int | str
    name: str
    fee_type: str
    class_name: Optional[str] = None
    installment_plan: str
    total_amount: float
    discount_amount: float
    late_fee_rule: Optional[str] = None
    description: Optional[str] = None
    is_active: bool
    school_id: int | str
    assigned_students: int
    created_at: datetime
    updated_at: datetime


class EduPayFeeAssignmentResponse(BaseModel):
    id: int | str
    student_id: int | str
    student_name: str
    fee_structure_id: int | str
    fee_structure_name: str
    installment_label: str
    due_date: datetime
    amount_due: float
    amount_paid: float
    discount_amount: float
    late_fee_applied: float
    status: str
    school_id: int | str
    created_at: datetime
    updated_at: datetime


class EduPayPaymentCreate(BaseModel):
    assignment_id: int | str
    amount: float
    method: str = "upi"
    payment_date: Optional[datetime] = None
    transaction_reference: Optional[str] = None


class EduPayPaymentResponse(BaseModel):
    id: int | str
    assignment_id: int | str
    student_id: int | str
    student_name: str
    amount: float
    method: str
    payment_date: datetime
    transaction_reference: Optional[str] = None
    receipt_number: str
    verification_status: str
    school_id: int | str
    created_at: datetime


class EduPayReminderItem(BaseModel):
    title: str
    channel: str
    audience: str
    scheduled_for: str


class EduPayTrendPoint(BaseModel):
    month: str
    amount: float


class EduPayMethodSplit(BaseModel):
    method: str
    amount: float
    percentage: float


class EduPayDashboardResponse(BaseModel):
    total_collected: float
    pending_amount: float
    overdue_amount: float
    upcoming_dues: int
    total_students: int
    active_fee_structures: int
    reminders_queued: int
    collection_trend: List[EduPayTrendPoint] = Field(default_factory=list)
    payment_method_split: List[EduPayMethodSplit] = Field(default_factory=list)
    reminders: List[EduPayReminderItem] = Field(default_factory=list)
    recent_payments: List[EduPayPaymentResponse] = Field(default_factory=list)


class EduPayParentChildSummary(BaseModel):
    student_id: int | str
    student_name: str
    class_name: str
    due_amount: float
    next_due_date: Optional[datetime] = None
    status: str


class EduPayParentPortalResponse(BaseModel):
    parent: EduPayParentResponse
    children: List[EduPayParentChildSummary] = Field(default_factory=list)
    payment_history: List[EduPayPaymentResponse] = Field(default_factory=list)


class CommerceOrderItemRequest(BaseModel):
    product_id: str
    quantity: int = 1


class PaymentCreateOrderRequest(BaseModel):
    provider_key: str
    items: List[CommerceOrderItemRequest] = Field(default_factory=list)
    coupon_code: Optional[str] = None
    referral_code: Optional[str] = None
    affiliate_code: Optional[str] = None
    credits_to_redeem: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PaymentCreateOrderItemResponse(BaseModel):
    product_id: str
    title: str
    quantity: int
    unit_price: float
    total_price: float
    product_type: str
    pricing_model: str


class PaymentCreateOrderResponse(BaseModel):
    order_id: str
    school_id: Optional[str] = None
    provider_key: str
    provider_order_id: str
    payment_link: str
    subtotal_amount: float
    discount_amount: float
    credits_redeemed: float
    total_amount: float
    currency: str
    coupon: Optional[Dict[str, Any]] = None
    items: List[PaymentCreateOrderItemResponse] = Field(default_factory=list)
    mode: str


class PaymentVerifyRequest(BaseModel):
    provider_key: str
    order_id: str
    provider_order_id: str
    provider_payment_id: Optional[str] = None
    signature: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PaymentVerifyResponse(BaseModel):
    order_id: str
    status: str
    provider_payment_id: str
    subscriptions_created: int = 0
    mode: str
    verified_at: Optional[str] = None


class CouponApplyRequest(BaseModel):
    code: str
    order_amount: float


class CouponApplyResponse(BaseModel):
    coupon_id: str
    code: str
    coupon_type: str
    discount_amount: float
    final_amount: float
    currency: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CommerceSubscriptionResponse(BaseModel):
    id: str
    school_id: Optional[str] = None
    profile_id: Optional[str] = None
    student_id: Optional[str] = None
    product_id: str
    order_id: Optional[str] = None
    provider_key: str
    plan_name: str
    subscription_status: str
    start_date: str
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    auto_renew: bool = False
    renewal_count: int = 0
    amount: float
    currency: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SubscriptionListResponse(BaseModel):
    subscriptions: List[CommerceSubscriptionResponse] = Field(default_factory=list)
    generated_at: Optional[str] = None


class RevenueProductSummary(BaseModel):
    title: str
    revenue: float


class RevenueSchoolSummary(BaseModel):
    school_id: str
    revenue: float


class RevenueDashboardResponse(BaseModel):
    scope: str
    total_revenue: float
    mrr: float
    arr: float
    monthly_revenue: float
    yearly_revenue: float
    course_sales: float
    test_sales: float
    affiliate_sales: float
    affiliate_commissions: float
    pending_payouts: float
    active_subscriptions: int
    orders_count: int
    paid_orders_count: int
    product_catalog: List[Dict[str, Any]] = Field(default_factory=list)
    top_products: List[RevenueProductSummary] = Field(default_factory=list)
    school_revenue: List[RevenueSchoolSummary] = Field(default_factory=list)
    generated_at: Optional[str] = None


# ==================== Attendance Schemas ====================

class AttendanceStudentCreate(BaseModel):
    name: str
    class_name: str
    section: str
    batch_name: Optional[str] = None
    roll_no: str
    parent_contact: Optional[str] = None


class AttendanceStudentResponse(AttendanceStudentCreate):
    id: int | str
    school_id: int | str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceStaffCreate(BaseModel):
    staff_id: str
    name: str
    department: str
    designation: Optional[str] = None
    shift: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class AttendanceStaffResponse(AttendanceStaffCreate):
    id: int | str
    school_id: int | str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceSubjectCreate(BaseModel):
    name: str
    class_name: str
    section: str


class AttendanceSubjectResponse(AttendanceSubjectCreate):
    id: int | str
    school_id: int | str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceSettingUpdate(BaseModel):
    minimum_attendance_threshold: float
    working_hours_start: str
    working_hours_end: str


class AttendanceSettingResponse(AttendanceSettingUpdate):
    updated_at: datetime


class AttendanceHolidayCreate(BaseModel):
    title: str
    holiday_date: date
    description: Optional[str] = None


class AttendanceHolidayResponse(BaseModel):
    id: int | str
    title: str
    holiday_date: datetime
    description: Optional[str] = None
    school_id: int | str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceNotificationResponse(BaseModel):
    id: int | str
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    message: str
    notification_type: str
    is_read: bool
    school_id: int | str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceLeaveCreate(BaseModel):
    staff_member_id: str
    leave_type: LeaveType
    from_date: date
    to_date: date
    reason: Optional[str] = None

    @field_validator("staff_member_id", mode="before")
    @classmethod
    def normalize_staff_member_id(cls, value):
        text = str(value or "").strip()
        if not text:
            raise ValueError("staff_member_id is required")
        try:
            return str(UUID(text))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError("staff_member_id must be a valid UUID") from exc

    @field_validator("leave_type", mode="before")
    @classmethod
    def normalize_leave_type(cls, value):
        text = str(value or "").strip().casefold()
        if not text:
            raise ValueError("leave_type is required")
        for enum_value in LeaveType:
            if text in {enum_value.value.casefold(), enum_value.name.casefold()}:
                return enum_value
        raise ValueError(f"leave_type must be one of: {', '.join(item.value for item in LeaveType)}")

    @field_validator("from_date", "to_date", mode="before")
    @classmethod
    def normalize_iso_dates(cls, value):
        if isinstance(value, date):
            return value
        if isinstance(value, datetime):
            return value.date()

        text = str(value or "").strip()
        match = ISO_DATE_PREFIX_RE.search(text)
        if not match:
            raise ValueError("Date must be a valid YYYY-MM-DD string")
        return date.fromisoformat(match.group(1))

    @model_validator(mode="after")
    def validate_leave_date_range(self):
        if self.from_date > self.to_date:
            raise ValueError("from_date cannot be later than to_date")
        return self


class AttendanceLeaveDecision(BaseModel):
    status: LeaveStatus
    approved_by: Optional[str] = None


class AttendanceLeaveResponse(BaseModel):
    id: int | str
    staff_member_id: int | str
    staff_name: str
    leave_type: str
    from_date: datetime
    to_date: datetime
    reason: Optional[str] = None
    status: str
    approved_by: Optional[str] = None
    created_at: Optional[datetime] = None


class StudentAttendanceMarkingRow(BaseModel):
    student_id: int | str
    roll_no: str
    student_name: str
    status: str = "present"
    absence_reason: Optional[str] = None


class StudentAttendanceMarkEntry(BaseModel):
    student_id: int | str
    status: str = "present"
    absence_reason: Optional[str] = None


class StudentAttendanceMarkRequest(BaseModel):
    date: date
    subject_id: Optional[int | str] = None
    marked_by: Optional[str] = None
    entries: List[StudentAttendanceMarkEntry] = Field(default_factory=list)


class StudentAttendanceMarkingResponse(BaseModel):
    date: datetime
    class_name: str
    section: str
    subject_id: Optional[int | str] = None
    subject_name: Optional[str] = None
    students: List[StudentAttendanceMarkingRow] = Field(default_factory=list)


class StudentAttendanceRecordResponse(BaseModel):
    id: int | str
    student_id: int | str
    student_name: str
    roll_no: str
    class_name: str
    section: str
    batch_name: str = ""
    date: datetime
    subject_id: int | str
    subject_name: str
    status: str
    absence_reason: Optional[str] = None
    marked_by: str
    created_at: datetime


class TeacherAttendanceContextResponse(BaseModel):
    teacher_id: int | str
    teacher_name: str
    date: datetime
    class_name: Optional[str] = None
    section: Optional[str] = None
    subject: Optional[str] = None
    subject_id: Optional[int | str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    timetable_entry_id: Optional[int | str] = None
    matched_by_current_time: bool = False


class StudentDashboardResponse(BaseModel):
    total_present: int
    total_absent: int
    total_late: int
    attendance_percentage: float
    low_attendance_alert: bool
    subject_breakdown: List[Dict[str, Any]] = Field(default_factory=list)


class StudentAttendanceDashboardBucketResponse(BaseModel):
    label: str
    present: int
    absent: int
    late: int
    total: int
    class_name: Optional[str] = None
    section: Optional[str] = None
    batch_name: Optional[str] = None


class StudentAttendanceDashboardDateBucketResponse(BaseModel):
    date: date
    present: int
    absent: int
    late: int
    total: int


class StudentAttendanceDashboardSummaryResponse(BaseModel):
    scope: Optional[str] = None
    date: Optional[str] = None
    class_name: Optional[str] = None
    batch_name: Optional[str] = None
    total_count: int
    present_count: int
    absent_count: int
    late_count: int
    class_summary: List[StudentAttendanceDashboardBucketResponse] = Field(default_factory=list)
    batch_summary: List[StudentAttendanceDashboardBucketResponse] = Field(default_factory=list)
    date_summary: List[StudentAttendanceDashboardDateBucketResponse] = Field(default_factory=list)


class StaffAttendanceMarkingRow(BaseModel):
    staff_member_id: int | str
    staff_id: str
    staff_name: str
    department: str
    designation: Optional[str] = None
    status: str = "present"
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    is_on_approved_leave: bool = False
    leave_type: Optional[str] = None
    leave_reason: Optional[str] = None


class StaffAttendanceMarkEntry(BaseModel):
    staff_member_id: int | str
    status: str = "present"
    check_in: Optional[str] = None
    check_out: Optional[str] = None


class StaffAttendanceMarkRequest(BaseModel):
    date: date
    marked_by: Optional[str] = None
    entries: List[StaffAttendanceMarkEntry] = Field(default_factory=list)


class StaffAttendanceMarkingResponse(BaseModel):
    date: datetime
    department: str
    staff: List[StaffAttendanceMarkingRow] = Field(default_factory=list)


class StaffAttendanceRecordResponse(BaseModel):
    id: int | str
    staff_member_id: int | str
    staff_id: str
    staff_name: str
    department: str
    designation: Optional[str] = None
    date: datetime
    status: str
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    marked_by: str
    created_at: datetime


class StaffDashboardResponse(BaseModel):
    present_count: int
    absent_count: int
    late_count: int
    half_day_count: int
    monthly_attendance_percentage: float
    department_summary: List[Dict[str, Any]] = Field(default_factory=list)


class AttendanceOverviewResponse(BaseModel):
    student_count: int
    staff_count: int
    class_options: List[str] = Field(default_factory=list)
    section_options: List[str] = Field(default_factory=list)
    subject_options: List[AttendanceSubjectResponse] = Field(default_factory=list)
    department_options: List[str] = Field(default_factory=list)
    notifications: List[AttendanceNotificationResponse] = Field(default_factory=list)
    holidays: List[AttendanceHolidayResponse] = Field(default_factory=list)
    settings: AttendanceSettingResponse


class AttendanceReportRow(BaseModel):
    values: Dict[str, Any]


class AttendanceReportResponse(BaseModel):
    report_type: str
    generated_at: datetime
    rows: List[AttendanceReportRow] = Field(default_factory=list)
    total_records: int


class BulkActionRequestCreate(BaseModel):
    module_name: str
    action_type: str
    reason: Optional[str] = None
    payload_json: Dict[str, Any] = Field(default_factory=dict)


class BulkActionDecision(BaseModel):
    reason: Optional[str] = None


class BulkActionRequestResponse(BaseModel):
    id: str
    school_id: str
    module_name: str
    action_type: str
    requested_by_profile_id: Optional[str] = None
    requested_role: str
    reason: Optional[str] = None
    payload_json: Dict[str, Any] = Field(default_factory=dict)
    status: str
    approved_by_profile_id: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejected_by_profile_id: Optional[str] = None
    rejected_at: Optional[datetime] = None
    cancelled_by_profile_id: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    executed_by_profile_id: Optional[str] = None
    executed_at: Optional[datetime] = None
    execution_result: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PlatformWorkflowEventResponse(BaseModel):
    id: Optional[str] = None
    request_id: str
    school_id: str
    event_type: str
    actor_profile_id: Optional[str] = None
    actor_role: Optional[str] = None
    actor_name: Optional[str] = None
    notes: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class PlatformWorkflowRequestDetailResponse(BaseModel):
    request: BulkActionRequestResponse
    requested_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    rejected_by_name: Optional[str] = None
    executed_by_name: Optional[str] = None
    events: List[PlatformWorkflowEventResponse] = Field(default_factory=list)


class PlatformAuditLogResponse(BaseModel):
    id: str
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    profile_id: Optional[str] = None
    profile_name: Optional[str] = None
    action: str
    module_key: Optional[str] = None
    entity_table: Optional[str] = None
    entity_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: Optional[datetime] = None


class PlatformAuditLogListResponse(BaseModel):
    items: List[PlatformAuditLogResponse] = Field(default_factory=list)
    total_count: int = 0
    limit: int = 0
    offset: int = 0


class PlatformDashboardSummaryResponse(BaseModel):
    workflow_counts: Dict[str, int] = Field(default_factory=dict)
    schools_count: int = 0
    active_users_count: int = 0
    recent_workflow_activity: List[PlatformWorkflowEventResponse] = Field(default_factory=list)


class OnlineTestSectionResponse(BaseModel):
    id: str
    test_id: str
    school_id: str
    title: str
    description: Optional[str] = None
    display_order: int
    question_type: str
    marks_per_question: float
    negative_marks: float
    question_count: int
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OnlineTestCreate(BaseModel):
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    test_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    test_type: str = "objective"
    delivery_mode: str = "scheduled"
    status: str = "draft"
    duration_minutes: int = 60
    total_marks: float = 0
    pass_marks: Optional[float] = None
    max_attempts: int = 1
    shuffle_questions: bool = False
    shuffle_options: bool = False
    show_result_immediately: bool = False
    allow_review: bool = True
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OnlineTestUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    test_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    test_type: Optional[str] = None
    delivery_mode: Optional[str] = None
    status: Optional[str] = None
    duration_minutes: Optional[int] = None
    total_marks: Optional[float] = None
    pass_marks: Optional[float] = None
    max_attempts: Optional[int] = None
    shuffle_questions: Optional[bool] = None
    shuffle_options: Optional[bool] = None
    show_result_immediately: Optional[bool] = None
    allow_review: Optional[bool] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class OnlineTestResponse(BaseModel):
    id: str
    school_id: str
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    test_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    test_type: str
    delivery_mode: str
    status: str
    duration_minutes: int
    total_marks: float
    pass_marks: Optional[float] = None
    max_attempts: int
    shuffle_questions: bool
    shuffle_options: bool
    show_result_immediately: bool
    allow_review: bool
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    sections: List[OnlineTestSectionResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OnlineTestQuestionCreate(BaseModel):
    test_id: str
    section_id: Optional[str] = None
    question_code: Optional[str] = None
    display_order: int = 1
    question_type: str = "single_choice"
    difficulty_level: str = "medium"
    prompt_text: str
    option_items: List[Dict[str, Any]] = Field(default_factory=list)
    answer_key: Dict[str, Any] = Field(default_factory=dict)
    explanation: Optional[str] = None
    marks: float = 1
    negative_marks: float = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OnlineTestQuestionUpdate(BaseModel):
    section_id: Optional[str] = None
    question_code: Optional[str] = None
    display_order: Optional[int] = None
    question_type: Optional[str] = None
    difficulty_level: Optional[str] = None
    prompt_text: Optional[str] = None
    option_items: Optional[List[Dict[str, Any]]] = None
    answer_key: Optional[Dict[str, Any]] = None
    explanation: Optional[str] = None
    marks: Optional[float] = None
    negative_marks: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class OnlineTestQuestionResponse(BaseModel):
    id: str
    school_id: str
    test_id: str
    section_id: str
    question_code: Optional[str] = None
    display_order: int
    question_type: str
    difficulty_level: str
    prompt_text: str
    option_items: List[Dict[str, Any]] = Field(default_factory=list)
    answer_key: Dict[str, Any] = Field(default_factory=dict)
    explanation: Optional[str] = None
    marks: float
    negative_marks: float
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OnlineTestAttemptCreate(BaseModel):
    test_id: str


class OnlineTestAttemptResponseUpsert(BaseModel):
    question_id: str
    response_payload: Dict[str, Any] = Field(default_factory=dict)
    is_marked_for_review: bool = False


class OnlineTestAttemptResponse(BaseModel):
    id: str
    school_id: str
    test_id: str
    student_id: str
    attempt_number: int
    status: str
    started_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    auto_submitted_at: Optional[datetime] = None
    evaluated_at: Optional[datetime] = None
    total_questions_snapshot: int
    answered_questions_snapshot: int
    time_spent_seconds: int
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    responses: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OnlineTestResultResponse(BaseModel):
    id: str
    school_id: str
    attempt_id: str
    test_id: str
    student_id: str
    status: str
    total_questions: int
    attempted_questions: int
    correct_answers: int
    incorrect_answers: int
    unanswered_questions: int
    score_obtained: float
    max_score: float
    percentage: Optional[float] = None
    rank_in_batch: Optional[int] = None
    rank_in_school: Optional[int] = None
    passed: Optional[bool] = None
    pass_marks: Optional[float] = None
    published_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class OnlineTestAnalyticsResponse(BaseModel):
    scope: str
    school_id: Optional[str] = None
    test_id: Optional[str] = None
    total_tests: int = 0
    total_attempts: int = 0
    completed_attempts: int = 0
    evaluated_results: int = 0
    average_score: float = 0
    average_percentage: float = 0
    highest_score: float = 0
    lowest_score: float = 0
    published_results: int = 0


class AnalyticsSubjectPerformanceResponse(BaseModel):
    subject_id: Optional[str] = None
    subject_name: str
    percentage: float
    tests_taken: int
    score_obtained: float
    max_score: float


class AnalyticsChapterPerformanceResponse(BaseModel):
    chapter_name: str
    percentage: float
    attempts_count: int
    topic_count: int


class AnalyticsTopicPerformanceResponse(BaseModel):
    chapter_name: str
    topic_name: str
    attempts_count: int
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    percentage: float


class AnalyticsStudentRankResponse(BaseModel):
    student_id: str
    student_name: str
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    class_name: Optional[str] = None
    percentage: float
    score_obtained: float
    max_score: float
    rank: int


class AnalyticsQuestionDifficultyResponse(BaseModel):
    question_id: str
    prompt_text: str
    difficulty_level: str
    correct_rate: float
    attempted_count: int
    average_marks: float
    classification: str


class AnalyticsBatchComparisonResponse(BaseModel):
    batch_id: Optional[str] = None
    batch_name: str
    student_count: int
    average_percentage: float
    average_score: float


class AnalyticsTrendResponse(BaseModel):
    name: str
    average_percentage: float
    tests_count: int


class AnalyticsMonthlyProgressResponse(BaseModel):
    period: str
    average_percentage: float
    tests_count: int


class StudentAnalyticsResponse(BaseModel):
    school_id: str
    student_id: str
    student_name: str
    overall_percentage: float
    subject_percentages: List[AnalyticsSubjectPerformanceResponse] = Field(default_factory=list)
    chapter_percentages: List[AnalyticsChapterPerformanceResponse] = Field(default_factory=list)
    weak_topics: List[str] = Field(default_factory=list)
    strong_topics: List[str] = Field(default_factory=list)
    accuracy: float
    speed: float
    rank: Optional[int] = None
    percentile: float
    suggestions: List[str] = Field(default_factory=list)
    latest_test_id: Optional[str] = None
    generated_at: Optional[datetime] = None


class TestAnalyticsResponse(BaseModel):
    school_id: str
    test_id: str
    test_title: str
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    teacher_name: Optional[str] = None
    average_percentage: float
    average_score: float
    participant_count: int
    completion_rate: float
    topper_list: List[AnalyticsStudentRankResponse] = Field(default_factory=list)
    weak_students: List[AnalyticsStudentRankResponse] = Field(default_factory=list)
    question_difficulty_analysis: List[AnalyticsQuestionDifficultyResponse] = Field(default_factory=list)
    chapter_performance: List[AnalyticsChapterPerformanceResponse] = Field(default_factory=list)
    batch_comparison: List[AnalyticsBatchComparisonResponse] = Field(default_factory=list)
    generated_at: Optional[datetime] = None


class BatchAnalyticsResponse(BaseModel):
    school_id: str
    batch_id: str
    batch_name: str
    class_name: Optional[str] = None
    section: Optional[str] = None
    overall_percentage: float
    active_students: int
    subject_percentages: List[AnalyticsSubjectPerformanceResponse] = Field(default_factory=list)
    weak_students: List[AnalyticsStudentRankResponse] = Field(default_factory=list)
    strong_students: List[AnalyticsStudentRankResponse] = Field(default_factory=list)
    monthly_progress: List[AnalyticsMonthlyProgressResponse] = Field(default_factory=list)
    weak_topics: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    generated_at: Optional[datetime] = None


class SchoolAnalyticsResponse(BaseModel):
    school_id: str
    school_name: str
    class_wise_performance: List[AnalyticsTrendResponse] = Field(default_factory=list)
    teacher_wise_performance: List[AnalyticsTrendResponse] = Field(default_factory=list)
    subject_wise_trends: List[AnalyticsTrendResponse] = Field(default_factory=list)
    monthly_progress: List[AnalyticsMonthlyProgressResponse] = Field(default_factory=list)
    active_students: int
    active_tests: int
    average_score: float
    average_percentage: float
    generated_at: Optional[datetime] = None


class PlatformSchoolComparisonResponse(BaseModel):
    school_id: str
    school_name: str
    average_percentage: float
    tests_count: int
    active_students: int


class PlatformAnalyticsResponse(BaseModel):
    cross_school_comparison: List[PlatformSchoolComparisonResponse] = Field(default_factory=list)
    active_students: int
    active_tests: int
    average_score: float
    average_percentage: float
    usage_metrics: Dict[str, Any] = Field(default_factory=dict)
    generated_at: Optional[datetime] = None


class LiveClassSessionBase(BaseModel):
    timetable_entry_id: str
    session_date: date
    course_id: Optional[str] = None
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    provider: str = "google_meet"
    meeting_link: Optional[str] = None
    meeting_id: Optional[str] = None
    meeting_password: Optional[str] = None
    scheduled_start_at: Optional[datetime] = None
    scheduled_end_at: Optional[datetime] = None
    notes_url: Optional[str] = None
    recording_url: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LiveClassSessionCreate(LiveClassSessionBase):
    pass


class LiveClassSessionResponse(BaseModel):
    id: str
    school_id: str
    timetable_entry_id: str
    course_id: Optional[str] = None
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    session_date: date
    provider: str
    provider_session_id: Optional[str] = None
    meeting_link: Optional[str] = None
    meeting_id: Optional[str] = None
    meeting_password: Optional[str] = None
    scheduled_start_at: Optional[datetime] = None
    scheduled_end_at: Optional[datetime] = None
    actual_start_at: Optional[datetime] = None
    actual_end_at: Optional[datetime] = None
    status: str
    notes_url: Optional[str] = None
    recording_url: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    timetable_entry: Optional[TimetableView] = None
    attendance_rate: Optional[float] = None
    average_watch_time_seconds: Optional[float] = None
    participation_count: int = 0


class LiveClassSessionActionResponse(BaseModel):
    session: LiveClassSessionResponse
    message: str


class LiveClassJoinLeaveResponse(BaseModel):
    session_id: str
    attendance_id: str
    profile_id: Optional[str] = None
    student_id: Optional[str] = None
    join_timestamp: Optional[datetime] = None
    leave_timestamp: Optional[datetime] = None
    total_duration_seconds: int
    attendance_percentage: float
    attendance_status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LiveClassAttendanceResponse(BaseModel):
    id: str
    school_id: str
    session_id: str
    profile_id: Optional[str] = None
    student_id: Optional[str] = None
    participant_name: str = ""
    role_key: str
    join_timestamp: Optional[datetime] = None
    leave_timestamp: Optional[datetime] = None
    total_duration_seconds: int
    attendance_percentage: float
    attendance_status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LiveClassRecordingCreate(BaseModel):
    title: str
    recording_url: str
    notes_url: Optional[str] = None
    duration_seconds: int = 0
    course_id: Optional[str] = None
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LiveClassRecordingResponse(BaseModel):
    id: str
    school_id: str
    session_id: str
    course_id: Optional[str] = None
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    title: str
    recording_url: str
    notes_url: Optional[str] = None
    duration_seconds: int
    published_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LiveClassAnalyticsSummary(BaseModel):
    attendance_rate: float = 0
    average_watch_time_seconds: float = 0
    participation: int = 0
    missed_classes: int = 0
    watch_completion_percentage: float = 0


class StudyTaskResponse(BaseModel):
    task_type: str
    title: str
    description: str
    subject_name: Optional[str] = None
    chapter_name: Optional[str] = None
    recommended_resource_type: Optional[str] = None
    recommended_resource_id: Optional[str] = None
    recommended_resource_url: Optional[str] = None
    estimated_minutes: int = 0
    priority: int = 1
    status: str = "pending"
    source_module: Optional[str] = None
    source_entity_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StudyPlanResponse(BaseModel):
    role: str
    scope: str
    plan_date: str
    exam_mode: Optional[str] = None
    target_student_id: Optional[str] = None
    target_student_name: Optional[str] = None
    total_estimated_minutes: int = 0
    completion_percentage: float = 0
    streak_count: int = 0
    badges: List[str] = Field(default_factory=list)
    milestones: List[str] = Field(default_factory=list)
    achievement_level: Optional[str] = None
    risk_level: Optional[str] = None
    tasks: List[StudyTaskResponse] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    generated_at: Optional[datetime] = None


class StudyPlannerWeekResponse(BaseModel):
    role: str
    target_student_id: Optional[str] = None
    target_student_name: Optional[str] = None
    today_plan: Optional[StudyPlanResponse] = None
    tomorrow_plan: Optional[StudyPlanResponse] = None
    weekly_plan: Dict[str, Any] = Field(default_factory=dict)
    monthly_plan: Dict[str, Any] = Field(default_factory=dict)
    streak_count: int = 0
    badges: List[str] = Field(default_factory=list)
    milestones: List[str] = Field(default_factory=list)
    generated_at: Optional[datetime] = None


class StudyRecommendationItemResponse(BaseModel):
    recommendation_type: str
    title: str
    summary: Optional[str] = None
    score: float = 0
    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LearningGoalCreate(BaseModel):
    title: str
    description: Optional[str] = None
    goal_type: str = "daily"
    exam_mode: Optional[str] = None
    target_date: Optional[str] = None
    target_value: Optional[float] = None
    current_value: Optional[float] = 0
    status: Optional[str] = "active"
    target_student_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LearningGoalResponse(BaseModel):
    id: str
    school_id: str
    student_id: str
    student_name: str
    goal_type: str
    exam_mode: Optional[str] = None
    title: str
    description: Optional[str] = None
    target_date: Optional[str] = None
    target_value: Optional[float] = None
    current_value: float = 0
    status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AiTutorRequest(BaseModel):
    topic: Optional[str] = None
    question: Optional[str] = None
    prompt: Optional[str] = None
    problem_statement: Optional[str] = None
    target_student_id: Optional[str] = None
    class_level: Optional[str] = None
    image_url: Optional[str] = None
    image_reference: Optional[str] = None
    voice_reference: Optional[str] = None
    teacher_prompt: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AiTutorQuestionResponse(BaseModel):
    level: str
    question: str


class AiTutorFlashCardResponse(BaseModel):
    front: str
    back: str


class AiTutorConversationSummaryResponse(BaseModel):
    id: str
    school_id: str
    student_id: Optional[str] = None
    student_name: Optional[str] = None
    profile_id: Optional[str] = None
    role_key: str
    mode: str
    topic: str
    user_prompt: str
    response_text: str
    teacher_prompt: Optional[str] = None
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class DoubtInputBase(BaseModel):
    question: Optional[str] = None
    prompt: Optional[str] = None
    target_student_id: Optional[str] = None
    source_language: Optional[str] = "english"
    image_url: Optional[str] = None
    pdf_url: Optional[str] = None
    screenshot_url: Optional[str] = None
    handwritten_note_url: Optional[str] = None
    voice_reference: Optional[str] = None
    extracted_text: Optional[str] = None
    file_name: Optional[str] = None
    teacher_prompt: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DoubtHistoryResponse(BaseModel):
    session_id: str
    student_id: Optional[str] = None
    student_name: Optional[str] = None
    input_type: str
    source_language: str
    detected_subject: Optional[str] = None
    detected_topic: Optional[str] = None
    confidence_score: float = 0
    escalation_status: str
    final_answer: Optional[str] = None
    created_at: Optional[datetime] = None


class DoubtSolverResponse(BaseModel):
    session_id: str
    question_id: Optional[str] = None
    solution_id: Optional[str] = None
    input_type: str
    source_language: str
    normalized_question: str
    extracted_text: str
    detected_subject: str
    detected_topic: str
    confidence_score: float = 0
    extracted_equations: List[str] = Field(default_factory=list)
    extracted_diagrams: List[str] = Field(default_factory=list)
    extracted_mcqs: List[Dict[str, Any]] = Field(default_factory=list)
    extracted_numericals: List[str] = Field(default_factory=list)
    explanation: str
    final_answer: Optional[str] = None
    shortcut_method: Optional[str] = None
    common_mistakes: List[str] = Field(default_factory=list)
    step_by_step: List[str] = Field(default_factory=list)
    personalization: Dict[str, Any] = Field(default_factory=dict)
    recommendations: List[Dict[str, Any]] = Field(default_factory=list)
    escalation_status: str
    teacher_resolution_notes: Optional[str] = None
    generated_at: Optional[datetime] = None


class TeacherAiQuestionPaperRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    batch_id: Optional[str] = None
    subject_id: Optional[str] = None
    topic: Optional[str] = None
    paper_type: str = "unit_test"
    difficulty_level: str = "medium"
    question_types: List[str] = Field(default_factory=lambda: ["mcq", "subjective", "numerical", "hots"])
    question_count: int = 10
    duration_minutes: int = 60
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TeacherAiGeneratedQuestion(BaseModel):
    question_type: str
    difficulty: str
    marks: float
    prompt: str
    source: str


class TeacherAiQuestionPaperResponse(BaseModel):
    job_id: str
    paper_id: Optional[str] = None
    paper_type: str
    title: str
    topic: str
    difficulty_level: str
    duration_minutes: int
    total_marks: float
    questions: List[TeacherAiGeneratedQuestion] = Field(default_factory=list)
    instructions: Optional[str] = None
    context_signals: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    generated_at: Optional[datetime] = None


class TeacherAiAssignmentRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    batch_id: Optional[str] = None
    subject_id: Optional[str] = None
    topic: Optional[str] = None
    assignment_type: str = "homework"
    difficulty_level: str = "medium"
    task_count: int = 8
    estimated_minutes: int = 30
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TeacherAiAssignmentTask(BaseModel):
    task_no: int
    task_type: str
    difficulty_level: str
    prompt: str
    expected_outcome: str


class TeacherAiAssignmentResponse(BaseModel):
    job_id: str
    assignment_id: Optional[str] = None
    assignment_type: str
    title: str
    difficulty_level: str
    estimated_minutes: int
    tasks: List[TeacherAiAssignmentTask] = Field(default_factory=list)
    instructions: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    generated_at: Optional[datetime] = None


class TeacherAiLessonPlanRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    teacher_id: Optional[str] = None
    class_name: Optional[str] = None
    topic: Optional[str] = None
    plan_scope: str = "daily"
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TeacherAiLessonPlanSlot(BaseModel):
    day_of_week: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    subject: Optional[str] = None
    class_name: Optional[str] = None
    chapter: str
    objective: str
    activity: str


class TeacherAiLessonPlanResponse(BaseModel):
    job_id: str
    plan_scope: str
    title: str
    topic: str
    schedule: List[TeacherAiLessonPlanSlot] = Field(default_factory=list)
    holiday_notes: List[str] = Field(default_factory=list)
    teaching_goals: List[str] = Field(default_factory=list)
    generated_at: Optional[datetime] = None


class TeacherAiReportCommentsRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    student_id: str
    report_type: str = "progress_report"
    score: Optional[float] = None
    max_score: Optional[float] = None
    written_response: Optional[str] = None
    teacher_note: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TeacherAiReportCommentsResponse(BaseModel):
    job_id: str
    report_id: Optional[str] = None
    report_type: str
    title: str
    summary: Optional[str] = None
    remarks: Optional[str] = None
    improvement_suggestions: List[str] = Field(default_factory=list)
    score_payload: Dict[str, Any] = Field(default_factory=dict)
    analytics_snapshot: Dict[str, Any] = Field(default_factory=dict)
    teacher_note: Optional[str] = None
    generated_at: Optional[datetime] = None


class AiTutorResponse(BaseModel):
    mode: str
    topic: str
    student_profile: Dict[str, Any] = Field(default_factory=dict)
    personalization: Dict[str, Any] = Field(default_factory=dict)
    explanation: str
    key_points: List[str] = Field(default_factory=list)
    examples: List[str] = Field(default_factory=list)
    revision_plan: List[str] = Field(default_factory=list)
    challenge_questions: List[str] = Field(default_factory=list)
    practice_questions: List[AiTutorQuestionResponse] = Field(default_factory=list)
    answer_strategy: List[str] = Field(default_factory=list)
    chapter_summary: List[str] = Field(default_factory=list)
    revision_notes: List[str] = Field(default_factory=list)
    flash_cards: List[AiTutorFlashCardResponse] = Field(default_factory=list)
    formula_sheet: List[str] = Field(default_factory=list)
    recommended_lessons: List[Dict[str, Any]] = Field(default_factory=list)
    recommended_recordings: List[Dict[str, Any]] = Field(default_factory=list)
    recommended_assignments: List[Dict[str, Any]] = Field(default_factory=list)
    recommended_tests: List[Any] = Field(default_factory=list)
    planner_hits: List[Dict[str, Any]] = Field(default_factory=list)
    attendance_summary: Dict[str, Any] = Field(default_factory=dict)
    analytics_summary: Dict[str, Any] = Field(default_factory=dict)
    conversation_id: Optional[str] = None
    context_id: Optional[str] = None
    recommendation_id: Optional[str] = None
    generated_at: Optional[datetime] = None


class LmsLessonResourceBase(BaseModel):
    resource_type: str = "pdf"
    title: str
    resource_url: Optional[str] = None
    text_content: Optional[str] = None
    file_size_bytes: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_downloadable: bool = True


class LmsLessonResourceCreate(LmsLessonResourceBase):
    pass


class LmsLessonResourceUpdate(BaseModel):
    resource_type: Optional[str] = None
    title: Optional[str] = None
    resource_url: Optional[str] = None
    text_content: Optional[str] = None
    file_size_bytes: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    is_downloadable: Optional[bool] = None
    is_active: Optional[bool] = None


class LmsLessonResourceResponse(LmsLessonResourceBase):
    id: str
    school_id: str
    course_id: str
    lesson_id: str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsLessonBase(BaseModel):
    module_id: str
    title: str
    description: Optional[str] = None
    lesson_type: str = "video"
    video_url: Optional[str] = None
    content_text: Optional[str] = None
    duration_seconds: int = 0
    display_order: int = 1
    is_preview: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)
    resources: List[LmsLessonResourceCreate] = Field(default_factory=list)


class LmsLessonCreate(LmsLessonBase):
    course_id: str


class LmsLessonUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    lesson_type: Optional[str] = None
    video_url: Optional[str] = None
    content_text: Optional[str] = None
    duration_seconds: Optional[int] = None
    display_order: Optional[int] = None
    is_preview: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    resources: Optional[List[LmsLessonResourceCreate]] = None


class LmsLessonResponse(BaseModel):
    id: str
    school_id: str
    course_id: str
    module_id: str
    title: str
    description: Optional[str] = None
    lesson_type: str
    video_url: Optional[str] = None
    content_text: Optional[str] = None
    duration_seconds: int
    display_order: int
    is_preview: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    resources: List[LmsLessonResourceResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsCourseModuleBase(BaseModel):
    title: str
    description: Optional[str] = None
    display_order: int = 1
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LmsCourseModuleCreate(LmsCourseModuleBase):
    course_id: str


class LmsCourseModuleUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    display_order: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class LmsCourseModuleResponse(BaseModel):
    id: str
    school_id: str
    course_id: str
    title: str
    description: Optional[str] = None
    display_order: int
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    lessons: List[LmsLessonResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsCourseBase(BaseModel):
    title: str
    description: Optional[str] = None
    course_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    intro_video_url: Optional[str] = None
    target_class_name: Optional[str] = None
    target_section: Optional[str] = None
    visibility: str = "batch"
    is_published: bool = False
    estimated_duration_minutes: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LmsCourseCreate(LmsCourseBase):
    pass


class LmsCourseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    course_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    intro_video_url: Optional[str] = None
    target_class_name: Optional[str] = None
    target_section: Optional[str] = None
    visibility: Optional[str] = None
    is_published: Optional[bool] = None
    estimated_duration_minutes: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class LmsCourseResponse(BaseModel):
    id: str
    school_id: str
    title: str
    description: Optional[str] = None
    course_code: Optional[str] = None
    subject_id: Optional[str] = None
    batch_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    intro_video_url: Optional[str] = None
    target_class_name: Optional[str] = None
    target_section: Optional[str] = None
    visibility: str
    is_published: bool
    estimated_duration_minutes: int
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    module_count: int = 0
    lesson_count: int = 0
    assignment_count: int = 0
    modules: List[LmsCourseModuleResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsAssignmentBase(BaseModel):
    course_id: str
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    attachment_url: Optional[str] = None
    due_at: Optional[datetime] = None
    max_score: float = 100
    status: str = "draft"
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LmsAssignmentCreate(LmsAssignmentBase):
    pass


class LmsAssignmentUpdate(BaseModel):
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    attachment_url: Optional[str] = None
    due_at: Optional[datetime] = None
    max_score: Optional[float] = None
    status: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class LmsAssignmentSubmissionCreate(BaseModel):
    submission_text: Optional[str] = None
    attachment_url: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LmsAssignmentSubmissionGrade(BaseModel):
    status: str = "graded"
    score_awarded: Optional[float] = None
    feedback: Optional[str] = None


class LmsAssignmentSubmissionResponse(BaseModel):
    id: str
    school_id: str
    assignment_id: str
    student_id: str
    submission_text: Optional[str] = None
    attachment_url: Optional[str] = None
    status: str
    score_awarded: Optional[float] = None
    feedback: Optional[str] = None
    submitted_at: Optional[datetime] = None
    graded_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsAssignmentResponse(BaseModel):
    id: str
    school_id: str
    course_id: str
    module_id: Optional[str] = None
    lesson_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    attachment_url: Optional[str] = None
    due_at: Optional[datetime] = None
    max_score: float
    status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    submission: Optional[LmsAssignmentSubmissionResponse] = None
    submission_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsProgressUpdate(BaseModel):
    course_id: str
    module_id: Optional[str] = None
    lesson_id: str
    last_watched_position_seconds: int = 0
    watch_percentage: float = 0
    assignment_completion_percentage: float = 0
    is_completed: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LmsProgressResponse(BaseModel):
    id: str
    school_id: str
    student_id: str
    course_id: str
    module_id: Optional[str] = None
    lesson_id: str
    last_watched_position_seconds: int
    watch_percentage: float
    assignment_completion_percentage: float
    course_completion_percentage: float
    lessons_completed: int
    is_completed: bool
    last_accessed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LmsAiInsightsResponse(BaseModel):
    weak_chapters: List[str] = Field(default_factory=list)
    recommended_lessons: List[str] = Field(default_factory=list)
    recommended_tests: List[str] = Field(default_factory=list)
    revision_suggestions: List[str] = Field(default_factory=list)


class LmsProgressDashboardResponse(BaseModel):
    progress_items: List[LmsProgressResponse] = Field(default_factory=list)
    enrolled_courses: List[LmsCourseResponse] = Field(default_factory=list)
    ai_insights: LmsAiInsightsResponse = Field(default_factory=LmsAiInsightsResponse)


class BiTrendPoint(BaseModel):
    period: str
    value: float


class BiWeakTopic(BaseModel):
    topic: str
    mentions: int


class BiCampusRevenue(BaseModel):
    campus_name: str
    revenue: float


class AcademicBiResponse(BaseModel):
    scope: str
    school_id: str
    period: str
    attendance_trends: List[BiTrendPoint] = Field(default_factory=list)
    performance_trends: List[BiTrendPoint] = Field(default_factory=list)
    completion_rates: List[BiTrendPoint] = Field(default_factory=list)
    weak_topics: List[BiWeakTopic] = Field(default_factory=list)
    student_count: int = 0
    generated_at: Optional[str] = None


class FinanceBiResponse(BaseModel):
    scope: str
    school_id: str
    period: str
    revenue_trends: List[BiTrendPoint] = Field(default_factory=list)
    subscriptions: int = 0
    mrr: float = 0
    arr: float = 0
    campus_revenue: List[BiCampusRevenue] = Field(default_factory=list)
    generated_at: Optional[str] = None


class OperationsBiResponse(BaseModel):
    scope: str
    school_id: str
    period: str
    hostel_utilization: float = 0
    inventory_utilization: float = 0
    staff_workload: float = 0
    operations_trends: List[BiTrendPoint] = Field(default_factory=list)
    generated_at: Optional[str] = None


class PlatformBiResponse(BaseModel):
    scope: str
    period: str
    tenant_growth: int = 0
    ai_usage: int = 0
    lms_usage: int = 0
    active_users: int = 0
    churn_risk: float = 0
    trends: List[BiTrendPoint] = Field(default_factory=list)
    generated_at: Optional[str] = None


class SavedBiReportCreateRequest(BaseModel):
    report_name: str
    dashboard_key: str
    filters: Dict[str, Any] = Field(default_factory=dict)
    selected_metrics: List[str] = Field(default_factory=list)
    export_format: str = "csv"
    cadence: Optional[str] = None


class SavedBiReportResponse(BaseModel):
    id: str
    school_id: Optional[str] = None
    created_by_profile_id: Optional[str] = None
    report_name: str
    dashboard_key: str
    filters: Dict[str, Any] = Field(default_factory=dict)
    selected_metrics: List[str] = Field(default_factory=list)
    export_format: str
    is_shared: bool = False
    is_active: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BiReportExportResponse(BaseModel):
    report_id: Optional[str] = None
    filename: str
    content_type: str
    content: str
    generated_at: Optional[str] = None


class PredictiveModelRegistryResponse(BaseModel):
    id: Optional[str] = None
    school_id: Optional[str] = None
    model_key: str
    model_name: Optional[str] = None
    model_scope: Optional[str] = None
    model_type: Optional[str] = None
    target_metric: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    confidence_notes: Optional[str] = None
    last_run_at: Optional[str] = None
    feature_sources: List[str] = Field(default_factory=list)
    thresholds: Dict[str, Any] = Field(default_factory=dict)


class PredictionInsightResponse(BaseModel):
    prediction_type: str
    risk_level: str
    score: float
    confidence_score: float
    headline: str
    explanation: str
    recommended_actions: List[str] = Field(default_factory=list)
    contributing_factors: List[str] = Field(default_factory=list)
    model_key: Optional[str] = None
    model_type: Optional[str] = None
    predicted_for_date: Optional[str] = None


class StudentPredictionItemResponse(BaseModel):
    student_id: str
    student_name: str
    class_name: Optional[str] = None
    section: Optional[str] = None
    overall_risk_score: float
    overall_risk_level: str
    dropout_risk: float
    attendance_risk: float
    exam_failure_risk: float
    engagement_decline_risk: float
    confidence_score: float
    attendance_average: float = 0
    test_average: float = 0
    engagement_average: float = 0
    top_factors: List[str] = Field(default_factory=list)
    recommended_actions: List[str] = Field(default_factory=list)
    predictions: List[PredictionInsightResponse] = Field(default_factory=list)


class StudentPredictionsResponse(BaseModel):
    scope: str
    school_id: str
    generated_at: Optional[str] = None
    students: List[StudentPredictionItemResponse] = Field(default_factory=list)
    early_warnings: List[str] = Field(default_factory=list)
    automated_actions: List[str] = Field(default_factory=list)
    model_registry: List[PredictiveModelRegistryResponse] = Field(default_factory=list)


class PredictionRiskOverviewResponse(BaseModel):
    risk_type: str
    risk_level: str
    score: float
    confidence_score: float
    headline: str
    explanation: str
    recommended_actions: List[str] = Field(default_factory=list)


class PredictionForecastPointResponse(BaseModel):
    period: str
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    forecast_value: float
    lower_bound: Optional[float] = None
    upper_bound: Optional[float] = None


class CampusPredictionsResponse(BaseModel):
    scope: str
    school_id: str
    generated_at: Optional[str] = None
    risk_overview: List[PredictionRiskOverviewResponse] = Field(default_factory=list)
    admissions_forecast: List[PredictionForecastPointResponse] = Field(default_factory=list)
    hostel_forecast: List[PredictionForecastPointResponse] = Field(default_factory=list)
    active_staff_count: int = 0
    model_registry: List[PredictiveModelRegistryResponse] = Field(default_factory=list)
    automated_actions: List[str] = Field(default_factory=list)


class FinancePredictionsResponse(BaseModel):
    scope: str
    school_id: str
    generated_at: Optional[str] = None
    risk_overview: List[PredictionRiskOverviewResponse] = Field(default_factory=list)
    revenue_forecast: List[PredictionForecastPointResponse] = Field(default_factory=list)
    fee_default_forecast: List[PredictionForecastPointResponse] = Field(default_factory=list)
    total_revenue_window: float = 0
    total_pending_window: float = 0
    model_registry: List[PredictiveModelRegistryResponse] = Field(default_factory=list)
    automated_actions: List[str] = Field(default_factory=list)


class AiAgentRunRequest(BaseModel):
    agent_key: Optional[str] = None


class AiAgentRunResponse(BaseModel):
    message: str
    jobs: List[Dict[str, Any]] = Field(default_factory=list)
    recommendations_created: int = 0
    actions_created: int = 0
    generated_at: Optional[str] = None


class AiAgentActionResponse(BaseModel):
    id: Optional[str] = None
    school_id: str
    job_id: Optional[str] = None
    recommendation_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_key: str
    action_label: str
    target_module: str
    action_type: str
    execution_payload: Dict[str, Any] = Field(default_factory=dict)
    approval_scope: str
    approval_status: str
    execution_status: str
    approved_by_profile_id: Optional[str] = None
    approved_at: Optional[datetime] = None
    notes: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AiAgentRecommendationResponse(BaseModel):
    id: str
    school_id: str
    job_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_key: str
    agent_name: Optional[str] = None
    title: str
    summary: str
    severity: str
    recommendation_type: str
    target_scope: str
    target_entity_id: Optional[str] = None
    approval_scope: str
    approval_status: str
    approval_notes: Optional[str] = None
    approved_by_profile_id: Optional[str] = None
    approved_at: Optional[datetime] = None
    source_modules: List[str] = Field(default_factory=list)
    confidence_score: float = 0
    rationale: Dict[str, Any] = Field(default_factory=dict)
    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actions: List[AiAgentActionResponse] = Field(default_factory=list)
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AiAgentCardResponse(BaseModel):
    agent_key: str
    agent_name: str
    domain_key: Optional[str] = None
    approval_scope: str
    source_modules: List[str] = Field(default_factory=list)
    recommendation_count: int = 0
    pending_count: int = 0
    critical_count: int = 0
    latest_recommendations: List[AiAgentRecommendationResponse] = Field(default_factory=list)


class AiAgentDashboardSummaryResponse(BaseModel):
    agents: int = 0
    recommendations: int = 0
    pending_approvals: int = 0
    critical_alerts: int = 0
    severity_breakdown: Dict[str, int] = Field(default_factory=dict)


class AiAgentDashboardResponse(BaseModel):
    scope: str
    school_id: str
    generated_at: Optional[str] = None
    summary: AiAgentDashboardSummaryResponse = Field(default_factory=AiAgentDashboardSummaryResponse)
    critical_alerts: List[AiAgentRecommendationResponse] = Field(default_factory=list)
    pending_approvals: List[AiAgentRecommendationResponse] = Field(default_factory=list)
    agent_cards: List[AiAgentCardResponse] = Field(default_factory=list)


class AiAgentApproveRequest(BaseModel):
    recommendation_id: str
    decision: str
    notes: Optional[str] = None
