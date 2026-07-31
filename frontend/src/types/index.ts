/**
 * Shared TypeScript definitions for the frontend app.
 * These are intentionally broad because multiple pages evolved faster than the
 * original type file and now share a much larger surface area.
 */

// ==================== Common ====================
export type PortalIntent = 'school_erp' | 'student_portal' | 'parent_portal' | 'platform_admin';

export type UserRole =
  | 'admin'
  | 'platform_admin'
  | 'school_admin'
  | 'teacher'
  | 'staff'
  | 'student'
  | 'parent'
  | 'store_manager'
  | 'viewer';
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
  class_name?: string;
  section?: string;
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
  must_change_password?: boolean;
  first_login_completed?: boolean;
}

export interface RolePowerUser {
  id: string | number;
  username: string;
  full_name: string;
  role: UserRole;
  user_type: UserType;
  permissions: string[];
  email?: string;
  password?: string;
  is_active: boolean;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AdministratorOverviewResponse {
  platform_administrators: RolePowerUser[];
  school_administrators: RolePowerUser[];
}

export interface ParentGuardianLink {
  id: string;
  school_id: string;
  profile_id?: string | null;
  guardian_code?: string | null;
  full_name: string;
  relation_type: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  is_active: boolean;
  linked_student_count?: number;
  has_login?: boolean;
  temporary_password?: string | null;
  link_id?: string;
  student_id?: string;
  guardian_id?: string;
  is_primary?: boolean;
  can_receive_notifications?: boolean;
  linked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ParentLinkImportResult {
  created_count: number;
  linked_count: number;
  skipped_count: number;
  errors: Array<Record<string, unknown>>;
  credentials: Array<{
    student_roll_no: string;
    parent_name: string;
    email: string;
    temporary_password: string;
  }>;
}

export interface PortalAccessStatus {
  entity_type: string;
  entity_id: string;
  portal_status: 'active' | 'disabled' | 'not_created' | string;
  username: string;
  login_email?: string;
  last_login?: string | null;
  last_activity?: string | null;
  profile_linked: boolean;
  profile_id?: string | null;
  account_created_date?: string | null;
  must_change_password?: boolean;
  force_password_change?: boolean;
  last_password_reset_at?: string | null;
  active_sessions: number;
  role_key?: string;
  entity_label?: string;
  is_enabled?: boolean;
  temporary_password?: string | null;
  relation_type?: string;
}

export interface BulkPortalCredentialRow {
  name?: string;
  role?: string;
  identifier?: string;
  student_name: string;
  roll_number: string;
  username: string;
  login_email?: string;
  temporary_password: string;
  created_at?: string;
}

export interface BulkPortalGenerationResult {
  count: number;
  skipped_count?: number;
  credentials: BulkPortalCredentialRow[];
}

export interface PortalPermissionTemplate {
  key: string;
  label: string;
  selected_role: string;
  permissions: string[];
}

export interface PortalOverviewRecord extends PortalAccessStatus {
  entity_name?: string;
  roll_number?: string;
  employee_code?: string;
  batch_name?: string | null;
  class_name?: string | null;
  section?: string | null;
  batch_id?: string | null;
  phone?: string | null;
  email?: string | null;
  staff_type?: string | null;
  department?: string | null;
  designation?: string | null;
  permission_count?: number;
  school_code?: string | null;
  slug?: string | null;
  plan_tier?: string | null;
  subscription_status?: string | null;
  student_limit?: number | null;
  teacher_limit?: number | null;
  parent_limit?: number | null;
  storage_limit_gb?: number | null;
  ai_credit_limit?: number | null;
  students_used?: number;
  teachers_used?: number;
  parents_used?: number;
  storage_used?: number;
  ai_credits_used?: number;
}

export interface PortalOverviewResponse {
  summary: {
    accounts_created: number;
    accounts_pending: number;
    accounts_disabled: number;
    last_login_count: number;
    portal_active?: number;
    portal_disabled?: number;
    portal_not_created?: number;
    total_students?: number;
    total_schools?: number;
    active_schools?: number;
    disabled_schools?: number;
    total_records: number;
  };
  records: PortalOverviewRecord[];
  meta?: {
    total_count: number;
    offset: number;
    limit: number;
    returned: number;
  };
}

export interface GeneratedCredentialRecord {
  id: string;
  school_id: string;
  profile_id: string;
  entity_type: string;
  entity_id: string;
  role_key: string;
  entity_name?: string | null;
  username: string;
  login_email?: string | null;
  temporary_password: string;
  created_by?: string | null;
  viewed: boolean;
  expires_at?: string | null;
  created_at?: string | null;
}

export interface AccountHistoryItem {
  id: string;
  name: string;
  action: string;
  created_by: string;
  timestamp?: string | null;
  username?: string | null;
  entity_type?: string | null;
  target_user?: string | null;
  permission_key?: string | null;
}

export interface AccountHistoryResponse {
  items: AccountHistoryItem[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface ActiveSessionRecord {
  id: string;
  profile_id: string;
  username: string;
  full_name: string;
  email?: string | null;
  role_key: string;
  device_id: string;
  device_name?: string | null;
  browser?: string | null;
  ip_address?: string | null;
  login_time?: string | null;
  last_activity?: string | null;
  status: string;
  session_key: string;
  is_active: boolean;
}

export interface PortalPermissionGroupItem {
  key: string;
  label: string;
  granted: boolean;
  from_template: boolean;
  manually_added: boolean;
  manually_removed: boolean;
}

export interface PortalPermissionGroup {
  key: string;
  label: string;
  count: number;
  permissions: PortalPermissionGroupItem[];
}

export interface PortalPermissionSummary {
  profile_id: string;
  user_name: string;
  username: string;
  login_email?: string | null;
  role: string;
  role_label: string;
  status: string;
  is_enabled: boolean;
  last_login?: string | null;
  last_activity?: string | null;
  active_sessions: number;
  created_at?: string | null;
  permission_count: number;
  scope_assignments: Record<string, 'own' | 'assigned' | 'school' | 'platform' | string>;
  template_key: string;
  template_label: string;
  selected_role: string;
  template_permission_count: number;
  manual_add_count: number;
  manual_remove_count: number;
  permissions: string[];
  template_permissions: string[];
  manually_added: string[];
  manually_removed: string[];
  groups: PortalPermissionGroup[];
}

export interface PortalRolePermissionTemplate {
  template_key: string;
  template_label: string;
  selected_role: string;
  permission_count: number;
  groups: PortalPermissionGroup[];
}

export interface BulkActionRequest {
  id: string;
  school_id: string;
  module_name: string;
  action_type: string;
  requested_by_profile_id?: string | null;
  requested_role: string;
  reason?: string | null;
  payload_json: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed' | string;
  approved_by_profile_id?: string | null;
  approved_at?: string | null;
  rejected_by_profile_id?: string | null;
  rejected_at?: string | null;
  cancelled_by_profile_id?: string | null;
  cancelled_at?: string | null;
  executed_by_profile_id?: string | null;
  executed_at?: string | null;
  execution_result: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PlatformWorkflowEvent {
  id?: string | null;
  request_id: string;
  school_id: string;
  event_type: string;
  actor_profile_id?: string | null;
  actor_role?: string | null;
  actor_name?: string | null;
  notes?: string | null;
  payload: Record<string, unknown>;
  created_at?: string | null;
}

export interface PlatformWorkflowRequestDetail {
  request: BulkActionRequest;
  requested_by_name?: string | null;
  approved_by_name?: string | null;
  rejected_by_name?: string | null;
  executed_by_name?: string | null;
  events: PlatformWorkflowEvent[];
}

export interface PlatformDashboardSummary {
  workflow_counts: Record<string, number>;
  schools_count: number;
  active_users_count: number;
  recent_workflow_activity: PlatformWorkflowEvent[];
}

export interface PlatformAuditLog {
  id: string;
  school_id?: string | null;
  school_name?: string | null;
  profile_id?: string | null;
  profile_name?: string | null;
  action: string;
  module_key?: string | null;
  entity_table?: string | null;
  entity_id?: string | null;
  payload: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}

export interface PlatformAuditLogListResponse {
  items: PlatformAuditLog[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface PlatformSchoolSummary {
  id: string;
  school_code: string;
  slug: string;
  name: string;
  legal_name?: string | null;
  timezone: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  school_domain?: string | null;
  academic_session?: string | null;
  logo_url?: string | null;
  status: string;
  is_active: boolean;
  student_count: number;
  teacher_count: number;
  staff_count: number;
  created_at?: string | null;
  updated_at?: string | null;
  metadata: Record<string, unknown>;
  subscription?: PlatformSubscriptionSummary;
  usage?: PlatformUsageSummary;
  health?: PlatformHealthSummary;
}

export interface PlatformSchoolListResponse {
  items: PlatformSchoolSummary[];
  total_count: number;
}

export interface PlatformSubscriptionSummary {
  school_id: string;
  current_plan: string;
  status: string;
  expiry?: string | null;
  renewal?: string | null;
  usage: Record<string, unknown>;
  grace_period_days: number;
  payment_status: string;
  subscription_id?: string | null;
  billing_cycle?: string | null;
  amount?: number | null;
  currency?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformUsageSummary {
  school_id: string;
  school_name: string;
  students: number;
  teachers: number;
  parents: number;
  staff: number;
  rooms: number;
  attendance_records: number;
  ai_credits_used: number;
  ai_requests: number;
  online_tests: number;
  storage_used_gb: number;
  database_size_mb: number;
  monthly_active_users: number;
  generated_at?: string | null;
}

export interface PlatformUsageDashboardResponse {
  items: PlatformUsageSummary[];
  total_students: number;
  total_teachers: number;
  total_ai_requests: number;
  total_storage_used_gb: number;
  generated_at?: string | null;
}

export interface PlatformHealthSummary {
  school_id: string;
  school_name: string;
  api_status: string;
  background_jobs: string;
  queue_status: string;
  storage_health: string;
  last_backup?: string | null;
  last_login?: string | null;
  last_activity?: string | null;
  last_billing_event?: string | null;
}

export interface PlatformHealthDashboardResponse {
  items: PlatformHealthSummary[];
  generated_at?: string | null;
}

export interface PlatformGlobalSearchItem {
  entity_type: string;
  school_id?: string | null;
  school_name?: string | null;
  entity_id?: string | null;
  title: string;
  subtitle?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformGlobalSearchResponse {
  items: PlatformGlobalSearchItem[];
  total_count: number;
}

export interface PlatformAnalyticsOverview {
  total_schools: number;
  active_schools: number;
  trial_schools: number;
  revenue: number;
  monthly_growth: number;
  student_count: number;
  teacher_count: number;
  subscriptions: number;
  ai_usage: number;
  credit_sales: number;
  generated_at?: string | null;
}

export interface PlatformSupportActionResponse {
  school_id: string;
  action: string;
  status: string;
  audited: boolean;
  details: Record<string, unknown>;
}

export interface PlatformAuditCenterResponse {
  items: Array<Record<string, unknown>>;
  total_count: number;
}

export interface PlatformNotification {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  severity: string;
  audience_scope: string;
  school_ids: string[];
  created_by_profile_id?: string | null;
  created_at?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformNotificationListResponse {
  items: PlatformNotification[];
  total_count: number;
}

export interface PlatformOnboardingResponse {
  school: PlatformSchoolSummary;
  admin: {
    profile_id?: string | null;
    full_name: string;
    email: string;
    mobile?: string | null;
    employee_code?: string | null;
    role_key: string;
    first_login_completed: boolean;
    must_change_password: boolean;
  };
  credentials: {
    username: string;
    temporary_password: string;
    login_email: string;
    login_url: string;
    expires_at?: string | null;
    visible_once: boolean;
  };
  provisioning: Record<string, boolean>;
  roles_created: number;
  permissions_seeded: boolean;
  batches_created: number;
  subscription_initialized: boolean;
  usage_initialized: boolean;
  ai_wallet_initialized: boolean;
  admin_membership_created: boolean;
  admin_account_created: boolean;
  notification_created: boolean;
  activation_status: string;
  audit_events: string[];
}

export interface SchoolBrandAsset {
  id: string;
  asset_type: string;
  file_name: string;
  public_url: string;
  content_type?: string | null;
  size_bytes: number;
  bucket: string;
  storage_path: string;
  created_at?: string | null;
  metadata: Record<string, unknown>;
}

export interface SchoolStorageOverview {
  total_files: number;
  total_size_bytes: number;
  total_size_mb: number;
  assets: SchoolBrandAsset[];
}

export interface SchoolBackupHistoryItem {
  id: string;
  request_type: string;
  status: string;
  download_url?: string | null;
  notes?: string | null;
  created_at?: string | null;
  metadata: Record<string, unknown>;
}

export interface SchoolBackupHistoryResponse {
  items: SchoolBackupHistoryItem[];
  total_count: number;
}

export interface SchoolPublicBranding {
  school_name: string;
  portal_name: string;
  logo_url?: string | null;
  banner_url?: string | null;
  favicon_url?: string | null;
  background_image_url?: string | null;
  tagline?: string | null;
  welcome_message?: string | null;
  footer_text?: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  theme: string;
  subdomain?: string | null;
  custom_domain?: string | null;
}

export interface ManageableSchoolSummary {
  id: string;
  name: string;
  short_name?: string | null;
  slug: string;
  school_code: string;
  timezone: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  logo_url?: string | null;
  status?: string | null;
  is_active?: boolean;
}

export interface ManageableSchoolListResponse {
  items: ManageableSchoolSummary[];
  total_count: number;
}

export interface SchoolSummary {
  id: string;
  name: string;
  short_name?: string | null;
  slug: string;
  school_code: string;
  timezone: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  logo_url?: string | null;
  status?: string | null;
  is_active?: boolean;
}

export interface SchoolSelfServiceProfile {
  school_id: string;
  branding: Record<string, unknown>;
  portal_settings: Record<string, unknown>;
  domain_settings: Record<string, unknown>;
  email_templates: Record<string, string>;
  messaging_templates: Record<string, string>;
  preferences: Record<string, unknown>;
  assets: SchoolBrandAsset[];
  storage: SchoolStorageOverview;
  backups: SchoolBackupHistoryResponse;
  school_summary: SchoolSummary;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refresh_token: string | null;
  is_authenticated: boolean;
  auth_initialized: boolean;
  auth_loading: boolean;
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
  id: string | number;
  roll_number: string;
  full_name: string;
  name?: string;
  photoDataUrl?: string;
  father_name?: string;
  batch_id?: string;
  batch_name?: string;
  batch?: string;
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
  preferred_hostel_id?: string;
  hostel_request_status?: string;
  assigned_hostel_id?: string;
  assigned_hostel_name?: string;
  assigned_room_id?: string;
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
  current_room?: string;
  requested_notes?: string;
  status: string;
  request_status: string;
  allocation_active: boolean;
  allocation_status?: string;
  assigned_bed_label?: string;
  reviewed_by?: string;
  review_notes?: string;
  requested_at: string;
  reviewed_at?: string;
  vacated_at?: string;
  vacated_by?: string;
}

export interface StudentDashboard {
  student_id: string | number;
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
  room_code: string;
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
  id: string | number;
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
  id: string | number;
  name: string;
  photoDataUrl?: string;
  subject: string;
  school_id: string | number;
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
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type TimetableSessionMode = 'offline' | 'online' | 'hybrid';
export type TimetableSessionType = 'regular_class' | 'break_time' | 'doubt_session' | 'extra_class' | 'self_study';
export type TimetableExtraClassScope = 'class_wise' | 'subject_wise' | 'general';

export interface TimetableEntry {
  id: string | number;
  teacher_id?: string | number;
  school_id: string | number;
  room_id?: string | number;
  session_mode?: TimetableSessionMode;
  session_type?: TimetableSessionType;
  extra_class_scope?: TimetableExtraClassScope;
  online_platform?: string;
  online_link?: string;
  online_provider?: string;
  meeting_link?: string;
  meeting_id?: string;
  meeting_password?: string;
  recording_url?: string;
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
  start_date?: string;
  end_date?: string;
  skip_conflict_check?: boolean;
}

export interface TimetableView {
  id: string | number;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  class_name: string;
  subject: string;
  teacher_name?: string;
  teacher_id?: string | number;
  room_id?: string | number;
  room_name?: string;
  session_mode?: TimetableSessionMode;
  session_type?: TimetableSessionType;
  extra_class_scope?: TimetableExtraClassScope;
  online_platform?: string;
  online_link?: string;
  online_provider?: string;
  meeting_link?: string;
  meeting_id?: string;
  meeting_password?: string;
  recording_url?: string;
  notes?: string;
  start_date?: string;
  end_date?: string;
}

export interface LiveClassAttendance {
  id: string;
  school_id: string;
  session_id: string;
  profile_id?: string | null;
  student_id?: string | null;
  participant_name: string;
  role_key: string;
  join_timestamp?: string | null;
  leave_timestamp?: string | null;
  total_duration_seconds: number;
  attendance_percentage: number;
  attendance_status: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LiveClassSession {
  id: string;
  school_id: string;
  timetable_entry_id: string;
  course_id?: string | null;
  module_id?: string | null;
  lesson_id?: string | null;
  session_date: string;
  provider: string;
  provider_session_id?: string | null;
  meeting_link?: string | null;
  meeting_id?: string | null;
  meeting_password?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  status: string;
  notes_url?: string | null;
  recording_url?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  timetable_entry?: TimetableView | null;
  attendance_rate?: number | null;
  average_watch_time_seconds?: number | null;
  participation_count: number;
}

export interface LiveClassRecording {
  id: string;
  school_id: string;
  session_id: string;
  course_id?: string | null;
  module_id?: string | null;
  lesson_id?: string | null;
  title: string;
  recording_url: string;
  notes_url?: string | null;
  duration_seconds: number;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StorageUploadResponse {
  url: string;
  file_name: string;
  size: number;
  bucket?: string;
  storage_path?: string;
  content_type?: string;
}

export interface StudyTask {
  task_type: string;
  title: string;
  description: string;
  subject_name?: string | null;
  chapter_name?: string | null;
  recommended_resource_type?: string | null;
  recommended_resource_id?: string | null;
  recommended_resource_url?: string | null;
  estimated_minutes: number;
  priority: number;
  status: string;
  source_module?: string | null;
  source_entity_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StudyPlan {
  role: string;
  scope: string;
  plan_date: string;
  exam_mode?: string | null;
  target_student_id?: string | null;
  target_student_name?: string | null;
  total_estimated_minutes: number;
  completion_percentage: number;
  streak_count: number;
  badges: string[];
  milestones: string[];
  achievement_level?: string | null;
  risk_level?: string | null;
  tasks: StudyTask[];
  summary: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  generated_at?: string | null;
}

export interface StudyPlannerWeek {
  role: string;
  target_student_id?: string | null;
  target_student_name?: string | null;
  today_plan?: StudyPlan | null;
  tomorrow_plan?: StudyPlan | null;
  weekly_plan: Record<string, unknown>;
  monthly_plan: Record<string, unknown>;
  streak_count: number;
  badges: string[];
  milestones: string[];
  generated_at?: string | null;
}

export interface ParentTrendMetrics {
  marks: number;
  attendance: number;
  engagement: number;
}

export interface ParentInsight {
  student_id?: string;
  student_name?: string;
  insight_type: string;
  title: string;
  summary: string;
  severity: string;
  trend_window_days?: number;
  payload?: Record<string, unknown>;
}

export interface ParentAlertAction {
  action_type: string;
  label: string;
  student_id: string;
  channel?: string;
}

export interface ParentAlert {
  id?: string;
  student_id?: string;
  student_name?: string;
  alert_type: string;
  title: string;
  message: string;
  severity: string;
  status?: string;
  alert_payload?: Record<string, unknown>;
  communication_actions?: ParentAlertAction[];
}

export interface ParentChildDashboard {
  student_id: string;
  student_name: string;
  class_name?: string | null;
  section?: string | null;
  academic_health_score: number;
  attendance_score: number;
  test_performance_score: number;
  learning_consistency_score: number;
  engagement_score: number;
  risk_level: string;
  risk_factors: string[];
  trend_7d: ParentTrendMetrics;
  trend_30d: ParentTrendMetrics;
  trend_90d: ParentTrendMetrics;
  weak_topics: string[];
  strong_topics: string[];
  suggestions: string[];
  insights: ParentInsight[];
  alerts: ParentAlert[];
  communication_actions: ParentAlertAction[];
  hostel_status?: Record<string, unknown> | null;
  generated_at?: string;
}

export interface ParentDashboardResponse {
  role: string;
  children_count: number;
  academic_health_score: number;
  risk_level: string;
  children: ParentChildDashboard[];
  generated_at?: string;
}

export interface ParentInsightsResponse {
  role: string;
  insights: ParentInsight[];
  children: Array<{
    student_id: string;
    student_name: string;
    academic_health_score: number;
    weak_topics: string[];
    suggestions: string[];
    communication_actions: ParentAlertAction[];
  }>;
  generated_at?: string;
}

export interface ParentRiskScoreResponse {
  role: string;
  children: Array<{
    student_id: string;
    student_name: string;
    academic_health_score: number;
    attendance_score: number;
    test_performance_score: number;
    learning_consistency_score: number;
    engagement_score: number;
    risk_level: string;
    risk_factors: string[];
    trend_7d: ParentTrendMetrics;
    trend_30d: ParentTrendMetrics;
    trend_90d: ParentTrendMetrics;
  }>;
  generated_at?: string;
}

export interface ParentAlertsResponse {
  role: string;
  alerts: ParentAlert[];
  generated_at?: string;
}

export interface StudyRecommendationItem {
  recommendation_type: string;
  title: string;
  summary?: string | null;
  score: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LearningGoal {
  id: string;
  school_id: string;
  student_id: string;
  student_name: string;
  goal_type: string;
  exam_mode?: string | null;
  title: string;
  description?: string | null;
  target_date?: string | null;
  target_value?: number | null;
  current_value: number;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

// ==================== Invigilator ====================
export interface Invigilator {
  id: string | number;
  staff_id: string;
  name: string;
  photoDataUrl?: string;
  school_id: string | number;
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
  id: string | number;
  room_id: string | number;
  invigilator_id: string | number;
  school_id: string | number;
  exam_id?: string | number;
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
  notification_type?: string;
}

export interface AttendanceHoliday {
  id: number;
  title: string;
  holiday_date: string;
  description?: string;
}

export interface AttendanceSubject {
  id: string | number;
  name: string;
  class_name: string;
  section: string;
  batch_name?: string;
  is_active?: boolean;
}

export interface AttendanceStudent {
  id: string | number;
  name: string;
  class_name: string;
  section: string;
  batch_name?: string;
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
  student_id: string | number;
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
  subject_id?: string | number;
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
  batch_name?: string;
  subject_name?: string;
  date: string;
  status: StudentAttendanceStatus;
  absence_reason?: string;
  marked_by?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface StudentAttendanceDashboardBucket {
  label: string;
  present: number;
  absent: number;
  late: number;
  total: number;
  class_name?: string;
  section?: string;
  batch_name?: string;
}

export interface StudentAttendanceDashboardDateBucket {
  date: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export interface StudentAttendanceDashboardSummary {
  scope?: 'batch' | 'class' | string;
  date?: string;
  class_name?: string;
  batch_name?: string;
  total_count: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  class_summary: StudentAttendanceDashboardBucket[];
  batch_summary: StudentAttendanceDashboardBucket[];
  date_summary: StudentAttendanceDashboardDateBucket[];
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

export interface BatchDayClassOption extends TeacherAttendanceContext {}

export interface StaffAttendanceMarkingRow {
  staff_member_id: number;
  name: string;
  staff_name?: string;
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
  total_records?: number;
}

// ==================== Inventory ====================
export type MaterialUnitType = 'book' | 'notebook' | 'sheet' | 'kit' | 'piece' | 'set' | 'box' | 'material' | 'other';
export type StockInType = 'purchase' | 'return' | 'adjustment' | 'donation';

export interface Supplier {
  id: string | number;
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
  id: string | number;
  name: string;
  is_active: boolean;
}

export interface InventorySet {
  id: string | number;
  subject_id: string | number;
  name: string;
  is_active: boolean;
  subject_name?: string;
}

export interface InventoryVolume {
  id: string | number;
  subject_id: string | number;
  set_id?: string | number;
  volume_number: string;
  name?: string;
  is_active: boolean;
  subject_name?: string;
  set_name?: string;
}

export interface InventoryCatalogSubject {
  id?: string | number;
  name?: string;
  subject: InventorySubject;
  sets: InventorySet[];
  volumes: InventoryVolume[];
}

export interface MaterialItem {
  id: string | number;
  name: string;
  subject_id?: string | number;
  set_id?: string | number;
  volume_id?: string | number;
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
  id: string | number;
  date?: string;
  supplier_id?: string | number;
  supplier_name?: string;
  material_id: string | number;
  material_name?: string;
  quantity_received: number;
  entry_type: StockInType;
  added_by?: string;
  notes?: string;
  created_at?: string;
}

export interface StockOutEntry {
  id: string | number;
  date?: string;
  batch_id?: string | number;
  batch_name?: string;
  material_id: string | number;
  material_name?: string;
  quantity_issued: number;
  issued_by?: string;
  remarks?: string;
  created_at?: string;
}

export interface StudentIssueEntry {
  id: string | number;
  date?: string;
  batch_id?: string | number;
  batch_name?: string;
  student_id: string | number;
  student_name: string;
  material_id: string | number;
  material_name?: string;
  quantity_issued: number;
  issued_by?: string;
  remarks?: string;
  created_at?: string;
}

export interface InventoryHistoryEntry {
  id: string | number;
  action: string;
  quantity: number;
  date?: string;
  actor?: string;
  notes?: string;
  entry_kind?: string;
  entry_id?: string | number;
  counterparty?: string;
  [key: string]: unknown;
}

export interface InventoryDashboard {
  total_materials?: number;
  total_suppliers?: number;
  total_stock_in?: number;
  total_stock_out?: number;
  low_stock_items?: MaterialItem[];
  recent_activity?: InventoryHistoryEntry[];
  total_materials_registered?: number;
  total_books_in_inventory?: number;
  total_books_distributed?: number;
  current_stock_available?: number;
  low_stock_alert_count?: number;
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
  total_records?: number;
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
  assigned_students?: number;
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
  late_fee_applied?: number;
  installment_label?: string;
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
  verification_status?: string;
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

export interface CommerceOrderItem {
  product_id: string;
  title: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  product_type: string;
  pricing_model: string;
}

export interface CommerceOrderResponse {
  order_id: string;
  school_id?: string | null;
  provider_key: string;
  provider_order_id: string;
  payment_link: string;
  subtotal_amount: number;
  discount_amount: number;
  credits_redeemed: number;
  total_amount: number;
  currency: string;
  coupon?: Record<string, unknown> | null;
  items: CommerceOrderItem[];
  mode: string;
}

export interface CommercePaymentVerifyResponse {
  order_id: string;
  status: string;
  provider_payment_id: string;
  subscriptions_created: number;
  mode: string;
  verified_at?: string | null;
}

export interface CommerceCouponResponse {
  coupon_id: string;
  code: string;
  coupon_type: string;
  discount_amount: number;
  final_amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface CommerceSubscription {
  id: string;
  school_id?: string | null;
  profile_id?: string | null;
  student_id?: string | null;
  product_id: string;
  order_id?: string | null;
  provider_key: string;
  plan_name: string;
  subscription_status: string;
  start_date: string;
  expiry_date?: string | null;
  renewal_date?: string | null;
  auto_renew: boolean;
  renewal_count: number;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface CommerceSubscriptionsResponse {
  subscriptions: CommerceSubscription[];
  generated_at?: string | null;
}

export interface RevenueTopProduct {
  title: string;
  revenue: number;
}

export interface RevenueSchoolSummary {
  school_id: string;
  revenue: number;
}

export interface RevenueDashboard {
  scope: string;
  total_revenue: number;
  mrr: number;
  arr: number;
  monthly_revenue: number;
  yearly_revenue: number;
  course_sales: number;
  test_sales: number;
  affiliate_sales: number;
  affiliate_commissions: number;
  pending_payouts: number;
  active_subscriptions: number;
  orders_count: number;
  paid_orders_count: number;
  product_catalog: Record<string, unknown>[];
  top_products: RevenueTopProduct[];
  school_revenue: RevenueSchoolSummary[];
  generated_at?: string | null;
}

// ==================== Online Tests ====================
export interface OnlineTestSection {
  id: string;
  test_id: string;
  school_id: string;
  title: string;
  description?: string | null;
  display_order: number;
  question_type: string;
  marks_per_question: number;
  negative_marks: number;
  question_count: number;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTest {
  id: string;
  school_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  test_code?: string | null;
  subject_id?: string | null;
  batch_id?: string | null;
  test_type: string;
  delivery_mode: string;
  status: string;
  duration_minutes: number;
  total_marks: number;
  pass_marks?: number | null;
  max_attempts: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_result_immediately: boolean;
  allow_review: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  sections: OnlineTestSection[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestQuestion {
  id: string;
  school_id: string;
  test_id: string;
  section_id: string;
  question_code?: string | null;
  display_order: number;
  question_type: string;
  difficulty_level: string;
  prompt_text: string;
  option_items: Array<Record<string, unknown>>;
  answer_key: Record<string, unknown>;
  explanation?: string | null;
  marks: number;
  negative_marks: number;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestQuestionBankItem {
  id: string;
  school_id: string;
  subject?: string | null;
  chapter?: string | null;
  topic?: string | null;
  question_type: string;
  difficulty_level: string;
  prompt_text: string;
  option_items: Array<Record<string, unknown>>;
  answer_key: Record<string, unknown>;
  explanation?: string | null;
  marks: number;
  negative_marks: number;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestResponseEntry {
  id: string;
  school_id: string;
  attempt_id: string;
  test_id: string;
  question_id: string;
  student_id: string;
  response_payload: Record<string, unknown>;
  is_marked_for_review: boolean;
  is_correct?: boolean | null;
  marks_awarded?: number | null;
  answered_at?: string | null;
  evaluated_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestAttempt {
  id: string;
  school_id: string;
  test_id: string;
  student_id: string;
  attempt_number: number;
  status: string;
  started_at?: string | null;
  submitted_at?: string | null;
  auto_submitted_at?: string | null;
  evaluated_at?: string | null;
  total_questions_snapshot: number;
  answered_questions_snapshot: number;
  time_spent_seconds: number;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  responses: OnlineTestResponseEntry[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestResult {
  id: string;
  school_id: string;
  attempt_id: string;
  test_id: string;
  student_id: string;
  status: string;
  total_questions: number;
  attempted_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered_questions: number;
  score_obtained: number;
  max_score: number;
  percentage?: number | null;
  rank_in_batch?: number | null;
  rank_in_school?: number | null;
  passed?: boolean | null;
  pass_marks?: number | null;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OnlineTestAnalytics {
  scope: string;
  school_id?: string | null;
  test_id?: string | null;
  total_tests: number;
  total_attempts: number;
  completed_attempts: number;
  evaluated_results: number;
  average_score: number;
  average_percentage: number;
  highest_score: number;
  lowest_score: number;
  published_results: number;
  question_wise_analysis: Array<Record<string, unknown>>;
  difficulty_wise_analysis: Array<Record<string, unknown>>;
  student_ranking: Array<Record<string, unknown>>;
}

export interface AnalyticsSubjectPerformance {
  subject_id?: string | null;
  subject_name: string;
  percentage: number;
  tests_taken: number;
  score_obtained: number;
  max_score: number;
}

export interface AnalyticsChapterPerformance {
  chapter_name: string;
  percentage: number;
  attempts_count: number;
  topic_count: number;
}

export interface AnalyticsStudentRank {
  student_id: string;
  student_name: string;
  batch_id?: string | null;
  batch_name?: string | null;
  class_name?: string | null;
  percentage: number;
  score_obtained: number;
  max_score: number;
  rank: number;
}

export interface AnalyticsQuestionDifficulty {
  question_id: string;
  prompt_text: string;
  difficulty_level: string;
  correct_rate: number;
  attempted_count: number;
  average_marks: number;
  classification: string;
}

export interface AnalyticsBatchComparison {
  batch_id?: string | null;
  batch_name: string;
  student_count: number;
  average_percentage: number;
  average_score: number;
}

export interface AnalyticsTrend {
  name: string;
  average_percentage: number;
  tests_count: number;
}

export interface AnalyticsMonthlyProgress {
  period: string;
  average_percentage: number;
  tests_count: number;
}

export interface StudentAnalytics {
  school_id: string;
  student_id: string;
  student_name: string;
  overall_percentage: number;
  subject_percentages: AnalyticsSubjectPerformance[];
  chapter_percentages: AnalyticsChapterPerformance[];
  weak_topics: string[];
  strong_topics: string[];
  accuracy: number;
  speed: number;
  rank?: number | null;
  percentile: number;
  suggestions: string[];
  latest_test_id?: string | null;
  generated_at?: string | null;
}

export interface TestAnalyticsDetail {
  school_id: string;
  test_id: string;
  test_title: string;
  subject_id?: string | null;
  batch_id?: string | null;
  teacher_name?: string | null;
  average_percentage: number;
  average_score: number;
  participant_count: number;
  completion_rate: number;
  topper_list: AnalyticsStudentRank[];
  weak_students: AnalyticsStudentRank[];
  question_difficulty_analysis: AnalyticsQuestionDifficulty[];
  chapter_performance: AnalyticsChapterPerformance[];
  batch_comparison: AnalyticsBatchComparison[];
  generated_at?: string | null;
}

export interface BatchAnalytics {
  school_id: string;
  batch_id: string;
  batch_name: string;
  class_name?: string | null;
  section?: string | null;
  overall_percentage: number;
  active_students: number;
  subject_percentages: AnalyticsSubjectPerformance[];
  weak_students: AnalyticsStudentRank[];
  strong_students: AnalyticsStudentRank[];
  monthly_progress: AnalyticsMonthlyProgress[];
  weak_topics: string[];
  suggestions: string[];
  generated_at?: string | null;
}

export interface SchoolAnalytics {
  school_id: string;
  school_name: string;
  class_wise_performance: AnalyticsTrend[];
  teacher_wise_performance: AnalyticsTrend[];
  subject_wise_trends: AnalyticsTrend[];
  monthly_progress: AnalyticsMonthlyProgress[];
  active_students: number;
  active_tests: number;
  average_score: number;
  average_percentage: number;
  generated_at?: string | null;
}

export interface PlatformSchoolComparison {
  school_id: string;
  school_name: string;
  average_percentage: number;
  tests_count: number;
  active_students: number;
}

export interface PlatformAnalytics {
  cross_school_comparison: PlatformSchoolComparison[];
  active_students: number;
  active_tests: number;
  average_score: number;
  average_percentage: number;
  usage_metrics: Record<string, number | string>;
  generated_at?: string | null;
}

export interface LmsLessonResource {
  id: string;
  school_id: string;
  course_id: string;
  lesson_id: string;
  resource_type: string;
  title: string;
  resource_url?: string | null;
  text_content?: string | null;
  file_size_bytes?: number | null;
  metadata?: Record<string, unknown>;
  is_downloadable: boolean;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsLesson {
  id: string;
  school_id: string;
  course_id: string;
  module_id: string;
  title: string;
  description?: string | null;
  lesson_type: string;
  video_url?: string | null;
  content_text?: string | null;
  duration_seconds: number;
  display_order: number;
  is_preview: boolean;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  resources: LmsLessonResource[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsCourseModule {
  id: string;
  school_id: string;
  course_id: string;
  title: string;
  description?: string | null;
  display_order: number;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  lessons: LmsLesson[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsCourse {
  id: string;
  school_id: string;
  title: string;
  description?: string | null;
  course_code?: string | null;
  subject_id?: string | null;
  batch_id?: string | null;
  thumbnail_url?: string | null;
  intro_video_url?: string | null;
  target_class_name?: string | null;
  target_section?: string | null;
  visibility: string;
  is_published: boolean;
  estimated_duration_minutes: number;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  module_count: number;
  lesson_count: number;
  assignment_count: number;
  modules: LmsCourseModule[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsAssignmentSubmission {
  id: string;
  school_id: string;
  assignment_id: string;
  student_id: string;
  submission_text?: string | null;
  attachment_url?: string | null;
  submission_files?: Array<Record<string, unknown>>;
  status: string;
  score_awarded?: number | null;
  feedback?: string | null;
  submitted_at?: string | null;
  graded_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsAssignment {
  id: string;
  school_id: string;
  course_id: string;
  module_id?: string | null;
  lesson_id?: string | null;
  title: string;
  description?: string | null;
  attachment_url?: string | null;
  due_at?: string | null;
  max_score: number;
  status: string;
  batch_assignment_ids: string[];
  reference_files: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  submission?: LmsAssignmentSubmission | null;
  submission_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsProgressItem {
  id: string;
  school_id: string;
  student_id: string;
  course_id: string;
  module_id?: string | null;
  lesson_id: string;
  last_watched_position_seconds: number;
  watch_percentage: number;
  assignment_completion_percentage: number;
  course_completion_percentage: number;
  lessons_completed: number;
  is_completed: boolean;
  last_accessed_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsAiInsights {
  weak_chapters: string[];
  recommended_lessons: string[];
  recommended_tests: string[];
  revision_suggestions: string[];
}

export interface LmsDashboardCourseSummary {
  course_id: string;
  course_title: string;
  progress_percentage: number;
  videos_watched: number;
  videos_remaining: number;
  assignments_submitted: number;
  assignments_total: number;
  last_activity?: string | null;
}

export interface LmsDashboardAssignmentStatus {
  pending: number;
  submitted: number;
  graded: number;
  returned: number;
}

export interface LmsDashboardTestSummary {
  tests_taken: number;
  average_score: number;
  highest_score: number;
}

export interface LmsDashboardUpcomingTest {
  test_id: string;
  title: string;
  subject_name?: string | null;
  topic?: string | null;
  starts_at?: string | null;
}

export interface LmsDashboardTopicAnalysis {
  weak: string[];
  medium: string[];
  strong: string[];
}

export interface LmsRevisionTrackerItem {
  id?: string | null;
  school_id: string;
  student_id: string;
  topic_key: string;
  topic_name: string;
  chapter_name?: string | null;
  subject_name?: string | null;
  course_id?: string | null;
  course_title?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LmsStudentSuccessDashboard {
  student_id: string;
  student_name: string;
  overall_learning_score: number;
  attendance_percentage: number;
  course_summaries: LmsDashboardCourseSummary[];
  assignment_status: LmsDashboardAssignmentStatus;
  test_summary: LmsDashboardTestSummary;
  upcoming_tests: LmsDashboardUpcomingTest[];
  topic_analysis: LmsDashboardTopicAnalysis;
  revision_tracker: LmsRevisionTrackerItem[];
  today_tasks: string[];
}

export interface LmsParentChildOverview {
  student_id: string;
  student_name: string;
  overall_learning_score: number;
  attendance_percentage: number;
  assignments_pending: number;
  assignments_submitted: number;
  assignments_graded: number;
  upcoming_tests_count: number;
  last_activity?: string | null;
}

export interface LmsProgressDashboard {
  viewer_mode: string;
  progress_items: LmsProgressItem[];
  enrolled_courses: LmsCourse[];
  ai_insights: LmsAiInsights;
  student_dashboard?: LmsStudentSuccessDashboard | null;
  child_dashboards: LmsParentChildOverview[];
}

export interface AiTutorPracticeQuestion {
  level: string;
  question: string;
}

export interface AiTutorFlashCard {
  front: string;
  back: string;
}

export interface AiTutorResponse {
  mode: string;
  topic: string;
  student_profile: Record<string, unknown>;
  personalization: Record<string, unknown>;
  explanation: string;
  key_points: string[];
  examples: string[];
  revision_plan: string[];
  challenge_questions: string[];
  practice_questions: AiTutorPracticeQuestion[];
  answer_strategy: string[];
  chapter_summary: string[];
  revision_notes: string[];
  flash_cards: AiTutorFlashCard[];
  formula_sheet: string[];
  recommended_lessons: Record<string, unknown>[];
  recommended_recordings: Record<string, unknown>[];
  recommended_assignments: Record<string, unknown>[];
  recommended_tests: unknown[];
  planner_hits: Record<string, unknown>[];
  attendance_summary: Record<string, unknown>;
  analytics_summary: Record<string, unknown>;
  conversation_id?: string | null;
  context_id?: string | null;
  recommendation_id?: string | null;
  generated_at?: string | null;
}

export interface DoubtSolverInput {
  question?: string;
  prompt?: string;
  target_student_id?: string | null;
  source_language?: string | null;
  image_url?: string | null;
  pdf_url?: string | null;
  screenshot_url?: string | null;
  handwritten_note_url?: string | null;
  voice_reference?: string | null;
  extracted_text?: string | null;
  file_name?: string | null;
  teacher_prompt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DoubtHistoryItem {
  session_id: string;
  student_id?: string | null;
  student_name?: string | null;
  input_type: string;
  source_language: string;
  detected_subject?: string | null;
  detected_topic?: string | null;
  confidence_score: number;
  escalation_status: string;
  final_answer?: string | null;
  created_at?: string | null;
}

export interface DoubtSolverResponse {
  session_id: string;
  question_id?: string | null;
  solution_id?: string | null;
  input_type: string;
  source_language: string;
  normalized_question: string;
  extracted_text: string;
  detected_subject: string;
  detected_topic: string;
  confidence_score: number;
  extracted_equations: string[];
  extracted_diagrams: string[];
  extracted_mcqs: Array<Record<string, unknown>>;
  extracted_numericals: string[];
  explanation: string;
  final_answer?: string | null;
  shortcut_method?: string | null;
  common_mistakes: string[];
  step_by_step: string[];
  personalization: Record<string, unknown>;
  recommendations: Array<Record<string, unknown>>;
  escalation_status: string;
  teacher_resolution_notes?: string | null;
  generated_at?: string | null;
}

export interface TeacherAiGeneratedQuestion {
  question_type: string;
  difficulty: string;
  marks: number;
  prompt: string;
  source: string;
}

export interface TeacherAiQuestionPaperResponse {
  job_id: string;
  paper_id?: string | null;
  paper_type: string;
  title: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number;
  total_marks: number;
  questions: TeacherAiGeneratedQuestion[];
  instructions?: string | null;
  context_signals: Record<string, unknown>;
  metadata: Record<string, unknown>;
  generated_at?: string | null;
}

export interface TeacherAiAssignmentTask {
  task_no: number;
  task_type: string;
  difficulty_level: string;
  prompt: string;
  expected_outcome: string;
}

export interface TeacherAiAssignmentResponse {
  job_id: string;
  assignment_id?: string | null;
  assignment_type: string;
  title: string;
  difficulty_level: string;
  estimated_minutes: number;
  tasks: TeacherAiAssignmentTask[];
  instructions?: string | null;
  metadata: Record<string, unknown>;
  generated_at?: string | null;
}

export interface TeacherAiLessonPlanSlot {
  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  subject?: string | null;
  class_name?: string | null;
  chapter: string;
  objective: string;
  activity: string;
}

export interface TeacherAiLessonPlanResponse {
  job_id: string;
  plan_scope: string;
  title: string;
  topic: string;
  schedule: TeacherAiLessonPlanSlot[];
  holiday_notes: string[];
  teaching_goals: string[];
  generated_at?: string | null;
}

export interface TeacherAiReportCommentsResponse {
  job_id: string;
  report_id?: string | null;
  report_type: string;
  title: string;
  summary?: string | null;
  remarks?: string | null;
  improvement_suggestions: string[];
  score_payload: Record<string, unknown>;
  analytics_snapshot: Record<string, unknown>;
  teacher_note?: string | null;
  generated_at?: string | null;
}

export interface SchoolAiAssistantResponse {
  question: string;
  answer: string;
  attendance_insights: string[];
  performance_insights: string[];
  risk_alerts: string[];
  generated_at?: string | null;
}

export interface BiTrendPoint {
  period: string;
  value: number;
}

export interface BiWeakTopic {
  topic: string;
  mentions: number;
}

export interface AcademicBiDashboard {
  scope: string;
  school_id: string;
  period: string;
  attendance_trends: BiTrendPoint[];
  performance_trends: BiTrendPoint[];
  completion_rates: BiTrendPoint[];
  weak_topics: BiWeakTopic[];
  student_count: number;
  generated_at?: string | null;
}

export interface BiCampusRevenue {
  campus_name: string;
  revenue: number;
}

export interface FinanceBiDashboard {
  scope: string;
  school_id: string;
  period: string;
  revenue_trends: BiTrendPoint[];
  subscriptions: number;
  mrr: number;
  arr: number;
  campus_revenue: BiCampusRevenue[];
  generated_at?: string | null;
}

export interface OperationsBiDashboard {
  scope: string;
  school_id: string;
  period: string;
  hostel_utilization: number;
  inventory_utilization: number;
  staff_workload: number;
  operations_trends: BiTrendPoint[];
  generated_at?: string | null;
}

export interface PlatformBiDashboard {
  scope: string;
  period: string;
  tenant_growth: number;
  ai_usage: number;
  lms_usage: number;
  active_users: number;
  churn_risk: number;
  trends: BiTrendPoint[];
  generated_at?: string | null;
}

export interface SavedBiReport {
  id: string;
  school_id?: string | null;
  created_by_profile_id?: string | null;
  report_name: string;
  dashboard_key: string;
  filters: Record<string, unknown>;
  selected_metrics: string[];
  export_format: string;
  is_shared: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BiReportExportResponse {
  report_id?: string | null;
  filename: string;
  content_type: string;
  content: string;
  generated_at?: string | null;
}

export interface PredictiveModelRegistry {
  id?: string | null;
  school_id?: string | null;
  model_key: string;
  model_name?: string | null;
  model_scope?: string | null;
  model_type?: string | null;
  target_metric?: string | null;
  version?: string | null;
  status?: string | null;
  confidence_notes?: string | null;
  last_run_at?: string | null;
  feature_sources: string[];
  thresholds: Record<string, unknown>;
}

export interface PredictionInsight {
  prediction_type: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | string;
  score: number;
  confidence_score: number;
  headline: string;
  explanation: string;
  recommended_actions: string[];
  contributing_factors: string[];
  model_key?: string | null;
  model_type?: string | null;
  predicted_for_date?: string | null;
}

export interface StudentPredictionItem {
  student_id: string;
  student_name: string;
  class_name?: string | null;
  section?: string | null;
  overall_risk_score: number;
  overall_risk_level: 'low' | 'medium' | 'high' | 'critical' | string;
  dropout_risk: number;
  attendance_risk: number;
  exam_failure_risk: number;
  engagement_decline_risk: number;
  confidence_score: number;
  attendance_average: number;
  test_average: number;
  engagement_average: number;
  top_factors: string[];
  recommended_actions: string[];
  predictions: PredictionInsight[];
}

export interface StudentPredictionsDashboard {
  scope: string;
  school_id: string;
  generated_at?: string | null;
  students: StudentPredictionItem[];
  early_warnings: string[];
  automated_actions: string[];
  model_registry: PredictiveModelRegistry[];
}

export interface PredictionRiskOverview {
  risk_type: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | string;
  score: number;
  confidence_score: number;
  headline: string;
  explanation: string;
  recommended_actions: string[];
}

export interface PredictionForecastPoint {
  period: string;
  period_start?: string | null;
  period_end?: string | null;
  forecast_value: number;
  lower_bound?: number | null;
  upper_bound?: number | null;
}

export interface CampusPredictionsDashboard {
  scope: string;
  school_id: string;
  generated_at?: string | null;
  risk_overview: PredictionRiskOverview[];
  admissions_forecast: PredictionForecastPoint[];
  hostel_forecast: PredictionForecastPoint[];
  active_staff_count: number;
  model_registry: PredictiveModelRegistry[];
  automated_actions: string[];
}

export interface FinancePredictionsDashboard {
  scope: string;
  school_id: string;
  generated_at?: string | null;
  risk_overview: PredictionRiskOverview[];
  revenue_forecast: PredictionForecastPoint[];
  fee_default_forecast: PredictionForecastPoint[];
  total_revenue_window: number;
  total_pending_window: number;
  model_registry: PredictiveModelRegistry[];
  automated_actions: string[];
}

export interface AiAgentRunResponse {
  message: string;
  jobs: Array<Record<string, unknown>>;
  recommendations_created: number;
  actions_created: number;
  generated_at?: string | null;
}

export interface AiAgentAction {
  id?: string | null;
  school_id: string;
  job_id?: string | null;
  recommendation_id?: string | null;
  agent_id?: string | null;
  agent_key: string;
  action_label: string;
  target_module: string;
  action_type: string;
  execution_payload: Record<string, unknown>;
  approval_scope: string;
  approval_status: string;
  execution_status: string;
  approved_by_profile_id?: string | null;
  approved_at?: string | null;
  notes?: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AiAgentRecommendation {
  id: string;
  school_id: string;
  job_id?: string | null;
  agent_id?: string | null;
  agent_key: string;
  agent_name?: string | null;
  title: string;
  summary: string;
  severity: string;
  recommendation_type: string;
  target_scope: string;
  target_entity_id?: string | null;
  approval_scope: string;
  approval_status: string;
  approval_notes?: string | null;
  approved_by_profile_id?: string | null;
  approved_at?: string | null;
  source_modules: string[];
  confidence_score: number;
  rationale: Record<string, unknown>;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  actions: AiAgentAction[];
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AiAgentCard {
  agent_key: string;
  agent_name: string;
  domain_key?: string | null;
  approval_scope: string;
  source_modules: string[];
  recommendation_count: number;
  pending_count: number;
  critical_count: number;
  latest_recommendations: AiAgentRecommendation[];
}

export interface AiAgentDashboardSummary {
  agents: number;
  recommendations: number;
  pending_approvals: number;
  critical_alerts: number;
  severity_breakdown: Record<string, number>;
}

export interface AiAgentDashboard {
  scope: string;
  school_id: string;
  generated_at?: string | null;
  summary: AiAgentDashboardSummary;
  critical_alerts: AiAgentRecommendation[];
  pending_approvals: AiAgentRecommendation[];
  agent_cards: AiAgentCard[];
}

// ==================== Parent Portal ====================

export interface ParentPortalChild {
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  roll_number: string;
}

export interface ParentPortalFeeStatus {
  total_fee: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  due_date: string | null;
  payment_percentage: number;
}

export interface ParentPortalUpcomingTest {
  id: string;
  title: string;
  subject: string;
  starts_at: string;
  duration_minutes: number;
  total_marks: number;
}

export interface ParentPortalTestResult {
  title: string;
  score: number;
  total: number;
  percentage: number;
  rank: number;
}

export interface ParentPortalChildDashboard {
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  attendance_percentage: number;
  present_days: number;
  absent_days: number;
  total_days: number;
  learning_score: number;
  pending_assignments: number;
  submitted_assignments: number;
  upcoming_tests: ParentPortalUpcomingTest[];
  latest_test_result: ParentPortalTestResult | null;
  fee_status: ParentPortalFeeStatus;
}

export interface ParentPortalDashboardResponse {
  children: ParentPortalChildDashboard[];
  children_count: number;
}

export interface ParentPortalCourseProgress {
  course_name: string;
  watch_percentage: number;
  completed_lessons: number;
  total_lessons: number;
}

export interface ParentPortalAssignmentCompletion {
  total: number;
  completed: number;
  graded: number;
  completion_percentage: number;
}

export interface ParentPortalRevisionTracker {
  total_revisions: number;
  completed_revisions: number;
}

export interface ParentPortalAcademicChild {
  student_id: string;
  student_name: string;
  course_progress: {
    overall_percentage: number;
    courses: ParentPortalCourseProgress[];
    total_courses: number;
  };
  assignment_completion: ParentPortalAssignmentCompletion;
  revision_tracker: ParentPortalRevisionTracker;
  weak_topics: string[];
  strong_topics: string[];
}

export interface ParentPortalAcademicResponse {
  children: ParentPortalAcademicChild[];
}

export interface ParentPortalAttendanceOverall {
  total_days: number;
  present_days: number;
  absent_days: number;
  attendance_percentage: number;
}

export interface ParentPortalMonthlyAttendance {
  month: string;
  total_days: number;
  present_days: number;
  absent_days: number;
  attendance_percentage: number;
}

export interface ParentPortalAttendanceTrend {
  monthly_percentages: number[];
  trend: string;
}

export interface ParentPortalAttendanceChild {
  student_id: string;
  student_name: string;
  overall: ParentPortalAttendanceOverall;
  current_month: ParentPortalAttendanceOverall;
  monthly_breakdown: ParentPortalMonthlyAttendance[];
  trend: ParentPortalAttendanceTrend;
}

export interface ParentPortalAttendanceResponse {
  children: ParentPortalAttendanceChild[];
}

export interface ParentPortalTestItem {
  id: string;
  title: string;
  subject: string;
  score: number;
  total_marks: number;
  percentage: number;
  rank: number;
  completed_at: string;
}

export interface ParentPortalTestChild {
  student_id: string;
  student_name: string;
  recent_tests: ParentPortalTestItem[];
  average_percentage: number;
  best_rank: number | null;
  total_tests: number;
  improvement_trend: string;
  percentage_history: number[];
}

export interface ParentPortalTestResponse {
  children: ParentPortalTestChild[];
}

export interface ParentPortalAssignmentItem {
  id: string;
  title: string;
  course_name: string;
  due_date: string;
  status: string;
  grade: number | null;
  max_grade: number | null;
  submitted_at: string;
}

export interface ParentPortalAssignmentSummary {
  pending: number;
  submitted: number;
  graded: number;
  late: number;
  total: number;
}

export interface ParentPortalAssignmentChild {
  student_id: string;
  student_name: string;
  summary: ParentPortalAssignmentSummary;
  assignments: ParentPortalAssignmentItem[];
}

export interface ParentPortalAssignmentResponse {
  children: ParentPortalAssignmentChild[];
}

export interface ParentPortalAlertItem {
  type: string;
  severity: string;
  title: string;
  message: string;
  value: number | string;
}

export interface ParentPortalAlertChild {
  student_id: string;
  student_name: string;
  alerts: ParentPortalAlertItem[];
  total_alerts: number;
}

export interface ParentPortalAlertResponse {
  children: ParentPortalAlertChild[];
}

export interface ParentPortalAiResponse {
  answer: string;
  context_students: { student_id: string; student_name: string }[];
}

export interface ParentPortalRecommendation {
  student_id: string;
  student_name: string;
  recommendations: string[];
}

// ==================== Offline Exams ====================
export interface OfflineExam {
  id: string;
  school_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  exam_code?: string | null;
  subject_id?: string | null;
  batch_id?: string | null;
  exam_type: string;
  paper_format: string;
  status: string;
  duration_minutes: number;
  total_marks: number;
  pass_marks?: number | null;
  total_sets: number;
  shuffle_questions: boolean;
  allow_negative_marking: boolean;
  exam_date?: string | null;
  exam_start_time?: string | null;
  exam_end_time?: string | null;
  question_source: string;
  seating_required: boolean;
  invigilators_required: boolean;
  hall_tickets_required: boolean;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
  is_active: boolean;
  sections: OfflineExamSection[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamMetadata {
  subjects?: string[];
  [key: string]: unknown;
}

export interface OfflineExamStudentSummary {
  id?: string;
  full_name?: string | null;
  roll_number?: string | null;
  [key: string]: unknown;
}

export interface OfflineExamRoomSummary {
  id?: string;
  name?: string | null;
  room_number?: string | null;
  [key: string]: unknown;
}

export interface OfflineExamAnalytics {
  scope: string;
  exam_id?: string | null;
  total_exams: number;
  total_students: number;
  average_score: number;
  average_percentage: number;
  highest_score: number;
  lowest_score: number;
  pass_rate: number;
  attendance_rate: number;
}

export interface OfflineExamSection {
  id: string;
  exam_id: string;
  school_id: string;
  title: string;
  description?: string | null;
  display_order: number;
  question_type: string;
  marks_per_question: number;
  negative_marks: number;
  question_count: number;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamQuestion {
  id: string;
  school_id: string;
  exam_id: string;
  section_id: string;
  question_code?: string | null;
  display_order: number;
  question_type: string;
  difficulty_level: string;
  prompt_text: string;
  option_items: Array<Record<string, unknown>>;
  answer_key: Record<string, unknown>;
  explanation?: string | null;
  marks: number;
  negative_marks: number;
  set_labels: string[];
  metadata?: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamHallTicket {
  id: string;
  school_id: string;
  exam_id: string;
  student_id: string;
  roll_number: string;
  room_id?: string | null;
  seat_number?: string | null;
  set_label?: string | null;
  status: string;
  metadata?: OfflineExamMetadata;
  is_active: boolean;
  student?: OfflineExamStudentSummary | null;
  room?: OfflineExamRoomSummary | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamAttendance {
  id: string;
  school_id: string;
  exam_id: string;
  student_id: string;
  hall_ticket_id?: string | null;
  status: string;
  entry_time?: string | null;
  exit_time?: string | null;
  remarks?: string | null;
  marked_by?: string | null;
  is_active: boolean;
  student?: OfflineExamStudentSummary | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamEvaluation {
  id: string;
  school_id: string;
  exam_id: string;
  student_id: string;
  question_id: string;
  set_label: string;
  marks_awarded: number;
  max_marks: number;
  evaluator_id?: string | null;
  evaluation_method: string;
  remarks?: string | null;
  evaluated_at?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamResult {
  id: string;
  school_id: string;
  exam_id: string;
  student_id: string;
  total_questions: number;
  attempted_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered_questions: number;
  score_obtained: number;
  max_score: number;
  percentage?: number | null;
  rank_in_batch?: number | null;
  rank_in_school?: number | null;
  passed?: boolean | null;
  pass_marks?: number | null;
  published_at?: string | null;
  metadata?: OfflineExamMetadata;
  is_active: boolean;
  student?: OfflineExamStudentSummary | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OfflineExamSeatingPlan {
  id: string;
  school_id: string;
  exam_id: string;
  room_id: string;
  student_id: string;
  seat_number: number;
  row_number?: number | null;
  column_number?: number | null;
  set_label?: string | null;
  invigilator_id?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
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
