/**
 * Shared TypeScript definitions for the frontend app.
 * These are intentionally broad because multiple pages evolved faster than the
 * original type file and now share a much larger surface area.
 */

// ==================== Common ====================
export type UserRole = 'admin' | 'store_manager' | 'teacher' | 'staff' | 'student' | 'viewer';
export type UserType = 'teaching' | 'non_teaching' | 'student';

export interface ApiListMeta {
  total?: number;
  page?: number;
  page_size?: number;
  [key: string]: unknown;
}

// ==================== Batch Management ====================
export interface Batch {
  id: string | number;
  name: string;
  category?: 'batch' | 'class' | string;
  syllabus?: string;
  stream?: string;
  display_order?: number;
  school_id: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  student_count?: number;
}

// ==================== Authentication ====================
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface OTPLoginCredentials {
  email: string;
  otp_code: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  username?: string;
  user_type?: UserType;
  permissions?: string[];
  role_key?: string;
  school_id?: string;
  membership_id?: string;
  default_school_id?: string | null;
}

export interface RolePowerUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  user_type: UserType;
  permissions: string[];
  email?: string;
  password?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refresh_token: string | null;
  is_authenticated: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  access_token_expires_in_seconds: number;
  refresh_token_expires_in_seconds: number;
  user_id: number;
  email: string;
  username?: string;
  full_name: string;
  role: UserRole;
  user_type?: UserType;
  permissions: string[];
}

// ==================== Student ====================
export interface Student {
  id: number;
  roll_number: string;
  name: string;
  photoDataUrl?: string;
  father_name?: string;
  batch: string;
  class_name?: string;
  section?: string;
  academic_session?: string;
  email?: string;
  phone?: string;
  reference_name?: string;
  reference_number?: string;
  reference_remark?: string;
  special_needs?: string;
  requires_near_exit: boolean;
  requires_extra_time: boolean;
  boarding_type?: string;
  hostel_required?: boolean;
  preferred_hostel_id?: number;
  hostel_request_status?: string;
  assigned_hostel_id?: number;
  assigned_hostel_name?: string;
  assigned_room_id?: number;
  assigned_room_number?: string;
  assigned_bed_label?: string;
  hostel_notes?: string;
  is_active: boolean;
  [key: string]: unknown;
}

export type BatchType = string;

export interface StudentImportResponse {
  imported_count: number;
  skipped_count: number;
  errors: Array<{
    row?: number;
    roll_no?: string;
    error: string;
  }>;
  message: string;
}

export interface StudentBatchTransferResponse {
  transferred_count: number;
  source_batch?: string;
  target_batch: string;
  message: string;
}

export interface HostelRoom {
  id: string | number;
  hostel_id: string | number;
  room_number: string;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  is_active: boolean;
}

export interface Hostel {
  id: string | number;
  name: string;
  hostel_head?: string;
  warden_name?: string;
  gender_category?: string;
  address?: string;
  is_active: boolean;
  total_rooms: number;
  total_capacity: number;
  occupied_beds: number;
  available_beds: number;
  rooms: HostelRoom[];
}

export interface StudentHostelRequest {
  id: string | number;
  student_id: string | number;
  student_name: string;
  roll_number: string;
  batch: string;
  class_name?: string;
  section?: string;
  reference_name?: string;
  reference_number?: string;
  reference_remark?: string;
  hostel_id: string | number;
  hostel_name: string;
  room_id?: string | number;
  room_number?: string;
  requested_notes?: string;
  status: string;
  assigned_bed_label?: string;
  reviewed_by?: string;
  review_notes?: string;
  requested_at: string;
  reviewed_at?: string;
}

export interface StudentDashboard {
  student_id: number;
  student_name: string;
  class_name?: string;
  section?: string;
  present_days?: number;
  absent_days?: number;
  late_days?: number;
  attendance_percentage?: number;
  [key: string]: unknown;
}

// ==================== Room ====================
export interface Room {
  id: string | number;
  name: string;
  length_feet: number;
  width_feet: number;
  desk_length_feet: number;
  desk_width_feet: number;
  num_benches: number;
  capacity: number;
  teaching_zone_clearance_feet: number;
  aisle_width_feet: number;
  door_location:
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top_left'
    | 'top_right'
    | 'bottom_left'
    | 'bottom_right';
  window_location?: string;
  glare_mitigation: boolean;
  is_accessible: boolean;
  is_active: boolean;
}

// ==================== Exam ====================
export interface Exam {
  id: string | number;
  name: string;
  school_id: string | number;
  subject?: string;
  exam_date?: string;
  duration_minutes?: number;
  total_students: number;
  total_batches: number;
  is_active: boolean;
}

// ==================== Desk & Seat ====================
export interface SeatPosition {
  seat_id: number;
  desk_id: number;
  position: 1 | 2;
  student_id?: number;
  student_name?: string;
  student_roll?: string;
  batch?: BatchType;
  is_occupied: boolean;
  row: number;
  col: number;
}

export interface DeskLayout {
  desk_id: number;
  row: number;
  col: number;
  seats: SeatPosition[];
  is_reserved: boolean;
  reservation_reason?: string;
}

export interface RoomLayout {
  room_id: string | number;
  room_name: string;
  desks: DeskLayout[];
  dimensions: {
    length_feet: number;
    width_feet: number;
  };
  capacity: number;
  occupied: number;
}

// ==================== Seating Plan ====================
export interface SeatingPlan {
  id: number;
  exam_id: string | number;
  room_id: string | number;
  exam_name?: string;
  exam_subject?: string;
  room_name?: string;
  batches?: string[];
  batch_distribution?: Array<{
    batch: string;
    count: number;
    percentage: number;
  }>;
  name: string;
  plan_type: 'strict' | 'compact' | 'all_in_one';
  status: 'draft' | 'reviewed' | 'finalized' | 'archived';
  students_assigned: number;
  is_valid: boolean;
  validation_errors?: string[];
  created_at: string;
}

export interface PlanComparison {
  plan_a: SeatingPlan;
  plan_b: SeatingPlan;
  room_layout_a: RoomLayout;
  room_layout_b: RoomLayout;
}

// ==================== Teacher ====================
export interface Teacher {
  id: number;
  name: string;
  photoDataUrl?: string;
  subject: string;
  school_id: number;
  email?: string;
  phone?: string;
  employee_code?: string;
  department?: string;
  designation?: string;
  joining_date?: string;
  shift_timing?: string;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ==================== Timetable ====================
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type TimetableSessionMode = 'offline' | 'online';
export type TimetableSessionType = 'regular_class' | 'break_time' | 'doubt_session' | 'extra_class' | 'self_study';
export type TimetableExtraClassScope = 'class_wise' | 'subject_wise' | 'general';

export interface TimetableEntry {
  id: number;
  teacher_id?: number;
  school_id: number;
  room_id?: number;
  session_mode?: TimetableSessionMode;
  session_type?: TimetableSessionType;
  extra_class_scope?: TimetableExtraClassScope;
  online_platform?: string;
  online_link?: string;
  notes?: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  class_name: string;
  subject: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  teacher_name?: string;
  room_name?: string;
}

export interface TimetableView {
  id: number;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  class_name: string;
  subject: string;
  teacher_name?: string;
  teacher_id?: number;
  room_id?: number;
  room_name?: string;
  session_mode?: TimetableSessionMode;
  session_type?: TimetableSessionType;
  extra_class_scope?: TimetableExtraClassScope;
  online_platform?: string;
  online_link?: string;
  notes?: string;
}

// ==================== Invigilator ====================
export interface Invigilator {
  id: number;
  staff_id: string;
  name: string;
  photoDataUrl?: string;
  school_id: number;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  joining_date?: string;
  shift_timing?: string;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomInvigilator {
  id: number;
  room_id: string | number;
  invigilator_id: number;
  school_id: number;
  exam_id?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invigilator?: Invigilator;
  room?: Room;
}

export interface InvigilatorWithRooms extends Invigilator {
  room_assignments: RoomInvigilator[];
}

export interface ConflictCheckResponse {
  has_conflict: boolean;
  conflicting_entries?: TimetableEntry[];
  message: string;
}

// ==================== Attendance ====================
export type StudentAttendanceStatus = 'present' | 'absent' | 'late';
export type StaffAttendanceStatus = 'present' | 'absent' | 'late' | 'half_day';
export type AttendanceLeaveStatus = 'pending' | 'approved' | 'rejected';
export type AttendanceLeaveType = 'casual' | 'sick' | 'paid' | 'emergency';

export interface AttendanceSettings {
  minimum_attendance_threshold: number;
  working_hours_start: string;
  working_hours_end: string;
  updated_at?: string;
}

export interface AttendanceNotification {
  id: number;
  title?: string;
  message: string;
  created_at?: string;
  is_read?: boolean;
}

export interface AttendanceHoliday {
  id: number;
  title: string;
  holiday_date: string;
  description?: string;
}

export interface AttendanceSubject {
  id: number;
  name: string;
  class_name: string;
  section: string;
  is_active?: boolean;
}

export interface AttendanceStudent {
  id: number;
  name: string;
  class_name: string;
  section: string;
  roll_no: string;
  parent_contact?: string;
  attendance_percentage?: number;
  [key: string]: unknown;
}

export interface AttendanceStaff {
  id: number;
  staff_id: string;
  name: string;
  department: string;
  designation?: string;
  shift?: string;
  email?: string;
  phone?: string;
  attendance_percentage?: number;
  [key: string]: unknown;
}

export interface StudentAttendanceMarkingRow {
  student_id: number;
  student_name: string;
  roll_no: string;
  class_name?: string;
  section?: string;
  status?: StudentAttendanceStatus;
  absence_reason?: string;
  [key: string]: unknown;
}

export interface StudentAttendanceMarkingResponse {
  date: string;
  class_name: string;
  section: string;
  subject_id?: number;
  subject_name?: string;
  students: StudentAttendanceMarkingRow[];
}

export interface StudentAttendanceRecord {
  id: number;
  student_id: number;
  student_name: string;
  roll_no?: string;
  class_name: string;
  section: string;
  subject_name?: string;
  date: string;
  status: StudentAttendanceStatus;
  absence_reason?: string;
  marked_by?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface TeacherAttendanceContext {
  teacher_id: number;
  teacher_name: string;
  date: string;
  class_name?: string;
  section?: string;
  subject?: string;
  subject_id?: number;
  start_time?: string;
  end_time?: string;
  timetable_entry_id?: number;
  matched_by_current_time: boolean;
}

export interface StaffAttendanceMarkingRow {
  staff_member_id: number;
  name: string;
  staff_id?: string;
  department: string;
  designation?: string;
  status?: StaffAttendanceStatus;
  check_in?: string;
  check_out?: string;
  is_on_approved_leave?: boolean;
  leave_type?: string;
  leave_reason?: string;
  [key: string]: unknown;
}

export interface StaffAttendanceMarkingResponse {
  date: string;
  department: string;
  staff: StaffAttendanceMarkingRow[];
}

export interface StaffAttendanceRecord {
  id: number;
  staff_member_id: number;
  staff_name: string;
  staff_id?: string;
  department: string;
  date: string;
  status: StaffAttendanceStatus;
  check_in?: string;
  check_out?: string;
  marked_by?: string;
  [key: string]: unknown;
}

export interface StaffDashboard {
  present_count?: number;
  absent_count?: number;
  late_count?: number;
  half_day_count?: number;
  monthly_attendance_percentage?: number;
  department_summary?: Array<{
    department: string;
    present: number;
    absent: number;
    late: number;
    half_day: number;
  }>;
  [key: string]: unknown;
}

export interface AttendanceLeave {
  id: number;
  staff_member_id: number;
  staff_name?: string;
  leave_type: AttendanceLeaveType;
  from_date: string;
  to_date: string;
  reason?: string;
  status: AttendanceLeaveStatus;
  approved_by?: string;
  created_at?: string;
}

export interface AttendanceOverview {
  student_count: number;
  staff_count: number;
  class_options: string[];
  section_options: string[];
  subject_options: AttendanceSubject[];
  department_options: string[];
  notifications: AttendanceNotification[];
  holidays: AttendanceHoliday[];
  settings: AttendanceSettings;
}

export interface AttendanceReportRow {
  label?: string;
  values: Record<string, string | number | null>;
}

export interface AttendanceReportResponse {
  title?: string;
  generated_at?: string;
  rows: AttendanceReportRow[];
  summary?: Record<string, string | number>;
}

// ==================== Inventory ====================
export type MaterialUnitType = 'book' | 'notebook' | 'sheet' | 'kit' | 'piece' | 'set' | 'box';
export type StockInType = 'purchase' | 'return' | 'adjustment' | 'donation';

export interface Supplier {
  id: number;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface InventorySubject {
  id: number;
  name: string;
  is_active: boolean;
}

export interface InventorySet {
  id: number;
  subject_id: number;
  name: string;
  is_active: boolean;
}

export interface InventoryVolume {
  id: number;
  subject_id: number;
  set_id?: number;
  volume_number: string;
  name?: string;
  is_active: boolean;
}

export interface InventoryCatalogSubject {
  subject: InventorySubject;
  sets: InventorySet[];
  volumes: InventoryVolume[];
}

export interface MaterialItem {
  id: number;
  name: string;
  subject_id?: number;
  set_id?: number;
  volume_id?: number;
  subject?: string;
  set_name?: string;
  volume_name?: string;
  volume_number?: string;
  batch_names?: string[];
  description?: string;
  unit_type: MaterialUnitType;
  current_stock?: number;
  low_stock_threshold?: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface InventoryMaterialImportResponse {
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  errors: Array<Record<string, unknown>>;
  message: string;
}

export interface StockInEntry {
  id: number;
  date?: string;
  supplier_id?: number;
  supplier_name?: string;
  material_id: number;
  material_name?: string;
  quantity_received: number;
  entry_type: StockInType;
  added_by?: string;
  notes?: string;
  created_at?: string;
}

export interface StockOutEntry {
  id: number;
  date?: string;
  batch_id?: number;
  batch_name?: string;
  material_id: number;
  material_name?: string;
  quantity_issued: number;
  issued_by?: string;
  remarks?: string;
  created_at?: string;
}

export interface StudentIssueEntry {
  id: number;
  date?: string;
  batch_id?: number;
  batch_name?: string;
  student_id: number;
  student_name: string;
  material_id: number;
  material_name?: string;
  quantity_issued: number;
  issued_by?: string;
  remarks?: string;
  created_at?: string;
}

export interface InventoryHistoryEntry {
  id: number;
  action: string;
  quantity: number;
  date?: string;
  actor?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface InventoryDashboard {
  total_materials?: number;
  total_suppliers?: number;
  total_stock_in?: number;
  total_stock_out?: number;
  low_stock_items?: MaterialItem[];
  recent_activity?: InventoryHistoryEntry[];
  [key: string]: unknown;
}

export interface InventoryReportRow {
  values: Record<string, string | number | null>;
}

export interface InventoryReportResponse {
  title?: string;
  generated_at?: string;
  rows: InventoryReportRow[];
  summary?: Record<string, string | number>;
}

// ==================== EduPay ====================
export type EduPayAssignmentStatus = 'paid' | 'pending' | 'overdue';
export type EduPayInstallmentPlan = 'monthly' | 'quarterly' | 'yearly';
export type EduPayPaymentMethod = 'upi' | 'card' | 'net_banking' | 'wallet' | 'cash';

export interface EduPayStudent {
  id: number;
  admission_no: string;
  full_name: string;
  class_name: string;
  batch_name?: string;
  email?: string;
  phone?: string;
  parent_name: string;
  parent_mobile: string;
  parent_email?: string;
  parent_relation?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface EduPayFeeStructure {
  id: number;
  name: string;
  fee_type: string;
  class_name?: string;
  installment_plan: EduPayInstallmentPlan;
  total_amount: number;
  discount_amount?: number;
  late_fee_rule?: string;
  description?: string;
  is_active?: boolean;
}

export interface EduPayAssignment {
  id: number;
  student_id: number;
  student_name?: string;
  admission_no?: string;
  fee_structure_id?: number;
  fee_structure_name?: string;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  due_date?: string;
  status: EduPayAssignmentStatus;
  created_at?: string;
}

export interface EduPayPayment {
  id: number;
  assignment_id: number;
  student_name?: string;
  amount: number;
  method: EduPayPaymentMethod;
  payment_date?: string;
  transaction_reference?: string;
  receipt_number?: string;
  created_at?: string;
}

export interface EduPayDashboard {
  total_students?: number;
  total_collected?: number;
  total_pending?: number;
  overdue_count?: number;
  [key: string]: unknown;
}

export interface EduPayParentPortalChild {
  student_id: number;
  student_name: string;
  class_name: string;
  due_amount: number;
  next_due_date?: string;
  status: EduPayAssignmentStatus;
}

export interface EduPayParentPortalPayment {
  id: number;
  student_name: string;
  amount: number;
  method: EduPayPaymentMethod;
  payment_date?: string;
  receipt_number?: string;
}

export interface EduPayParentPortal {
  parent: {
    full_name: string;
    mobile_number: string;
    email?: string;
  };
  children: EduPayParentPortalChild[];
  payment_history: EduPayParentPortalPayment[];
}

// ==================== UI State ====================
export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

export interface ModalState {
  isOpen: boolean;
  type?: string;
  data?: any;
}
