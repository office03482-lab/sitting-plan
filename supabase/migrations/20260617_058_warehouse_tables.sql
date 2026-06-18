-- Warehouse tables in public schema
-- Consolidated: creates all warehouse tables directly in public schema
-- with warehouse_ prefix, matching _warehouse_table() code pattern.
-- Apply via Supabase Dashboard SQL Editor.

begin;

-- ============================
-- Dimension Tables
-- ============================

create table if not exists public.warehouse_dim_date (
  date_key date primary key,
  day_of_week integer not null,
  day_name text not null,
  week_of_year integer not null,
  month_of_year integer not null,
  month_name text not null,
  quarter_of_year integer not null,
  year_number integer not null,
  is_weekend boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.warehouse_dim_school (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools (id) on delete cascade,
  school_name text not null,
  campus_name text,
  tenant_tier text,
  franchise_code text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.warehouse_dim_student (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  admission_no text,
  full_name text not null,
  class_name text,
  section text,
  academic_session text,
  boarding_type text,
  hostel_required boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, student_id)
);

create table if not exists public.warehouse_dim_staff (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  membership_id uuid,
  staff_member_id uuid references public.staff_members (id) on delete set null,
  role_id uuid references public.roles (id) on delete set null,
  role_key text,
  full_name text not null,
  email text,
  user_type text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, profile_id)
);

create table if not exists public.warehouse_dim_course (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  course_id uuid not null,
  batch_id uuid references public.batches (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete set null,
  course_code text,
  title text not null,
  visibility text,
  is_published boolean not null default false,
  estimated_duration_minutes integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, course_id)
);

-- ============================
-- Fact Tables
-- ============================

create table if not exists public.warehouse_fact_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  is_active boolean not null default true,
  hostel_required boolean not null default false,
  attendance_rate numeric(6,2) not null default 0,
  tests_attempted_count integer not null default 0,
  assignments_completed_count integer not null default 0,
  live_classes_attended_count integer not null default 0,
  revenue_ltv numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, student_id, snapshot_date)
);

create table if not exists public.warehouse_fact_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  attendance_scope text not null,
  grain_key text not null,
  student_id uuid references public.students (id) on delete cascade,
  staff_member_id uuid references public.staff_members (id) on delete set null,
  present_count integer not null default 0,
  absent_count integer not null default 0,
  late_count integer not null default 0,
  excused_count integer not null default 0,
  half_day_count integer not null default 0,
  leave_count integer not null default 0,
  attendance_percentage numeric(6,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint warehouse_fact_attendance_scope_check check (attendance_scope in ('student', 'staff')),
  unique (school_id, snapshot_date, attendance_scope, grain_key)
);

create table if not exists public.warehouse_fact_tests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  result_id uuid not null,
  test_id uuid not null,
  attempt_id uuid not null,
  student_id uuid not null references public.students (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete set null,
  test_title text,
  score_obtained numeric(12,2) not null default 0,
  max_score numeric(12,2) not null default 0,
  percentage numeric(6,2) not null default 0,
  correct_answers integer not null default 0,
  incorrect_answers integer not null default 0,
  unanswered_questions integer not null default 0,
  time_spent_seconds integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, result_id)
);

create table if not exists public.warehouse_fact_finance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  metric_type text not null,
  source_key text not null,
  source_id uuid,
  student_id uuid references public.students (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  product_id uuid,
  provider_key text,
  status text,
  category text,
  amount numeric(12,2) not null default 0,
  quantity integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, metric_type, source_key, snapshot_date)
);

create table if not exists public.warehouse_fact_lms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  progress_id uuid not null,
  student_id uuid not null references public.students (id) on delete cascade,
  course_id uuid not null,
  module_id uuid,
  lesson_id uuid not null,
  watch_percentage numeric(6,2) not null default 0,
  minutes_watched integer not null default 0,
  lessons_completed integer not null default 0,
  assignment_completion_percentage numeric(6,2) not null default 0,
  course_completion_percentage numeric(6,2) not null default 0,
  is_completed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, progress_id)
);

create table if not exists public.warehouse_fact_live_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  attendance_id uuid not null,
  session_id uuid not null,
  student_id uuid references public.students (id) on delete set null,
  course_id uuid,
  total_duration_seconds integer not null default 0,
  attendance_percentage numeric(6,2) not null default 0,
  attendance_status text not null default 'absent',
  watch_completion_percentage numeric(6,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, attendance_id)
);

create table if not exists public.warehouse_fact_operations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  metric_type text not null,
  metric_key text not null,
  metric_value numeric(12,2) not null default 0,
  quantity integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, snapshot_date, metric_type, metric_key)
);

create table if not exists public.warehouse_fact_platform_usage (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null references public.warehouse_dim_date (date_key) on delete cascade,
  school_id uuid references public.schools (id) on delete cascade,
  scope_key text not null default 'platform',
  metric_type text not null,
  metric_key text not null,
  metric_value numeric(12,2) not null default 0,
  quantity integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (snapshot_date, scope_key, metric_type, metric_key)
);

create table if not exists public.warehouse_report_definitions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  report_name text not null,
  dashboard_key text not null,
  filters jsonb not null default '{}'::jsonb,
  selected_metrics jsonb not null default '[]'::jsonb,
  export_format text not null default 'csv',
  is_shared boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint warehouse_report_definitions_dashboard_check check (dashboard_key in ('academic', 'finance', 'operations', 'platform')),
  constraint warehouse_report_definitions_export_check check (export_format in ('pdf', 'xlsx', 'csv', 'json'))
);

create table if not exists public.warehouse_report_schedules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  report_definition_id uuid not null references public.warehouse_report_definitions (id) on delete cascade,
  scheduled_by_profile_id uuid references public.profiles (id) on delete set null,
  cadence text not null default 'weekly',
  next_run_at timestamptz,
  last_run_at timestamptz,
  delivery_channel text not null default 'download',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint warehouse_report_schedules_cadence_check check (cadence in ('daily', 'weekly', 'monthly', 'yearly')),
  constraint warehouse_report_schedules_delivery_check check (delivery_channel in ('download', 'email', 'storage'))
);

-- ============================
-- Indexes
-- ============================

create index if not exists warehouse_fact_students_school_snapshot_idx
  on public.warehouse_fact_students (school_id, snapshot_date desc);

create index if not exists warehouse_fact_attendance_school_snapshot_idx
  on public.warehouse_fact_attendance (school_id, snapshot_date desc, attendance_scope);

create index if not exists warehouse_fact_tests_school_snapshot_idx
  on public.warehouse_fact_tests (school_id, snapshot_date desc, batch_id);

create index if not exists warehouse_fact_finance_school_snapshot_idx
  on public.warehouse_fact_finance (school_id, snapshot_date desc, metric_type, category);

create index if not exists warehouse_fact_lms_school_snapshot_idx
  on public.warehouse_fact_lms (school_id, snapshot_date desc, course_id);

create index if not exists warehouse_fact_live_classes_school_snapshot_idx
  on public.warehouse_fact_live_classes (school_id, snapshot_date desc, session_id);

create index if not exists warehouse_fact_operations_school_snapshot_idx
  on public.warehouse_fact_operations (school_id, snapshot_date desc, metric_type);

create index if not exists warehouse_fact_platform_usage_snapshot_idx
  on public.warehouse_fact_platform_usage (snapshot_date desc, metric_type, school_id);

-- ============================
-- RLS
-- ============================

alter table public.warehouse_dim_date enable row level security;
alter table public.warehouse_dim_school enable row level security;
alter table public.warehouse_dim_student enable row level security;
alter table public.warehouse_dim_staff enable row level security;
alter table public.warehouse_dim_course enable row level security;
alter table public.warehouse_fact_students enable row level security;
alter table public.warehouse_fact_attendance enable row level security;
alter table public.warehouse_fact_tests enable row level security;
alter table public.warehouse_fact_finance enable row level security;
alter table public.warehouse_fact_lms enable row level security;
alter table public.warehouse_fact_live_classes enable row level security;
alter table public.warehouse_fact_operations enable row level security;
alter table public.warehouse_fact_platform_usage enable row level security;
alter table public.warehouse_report_definitions enable row level security;
alter table public.warehouse_report_schedules enable row level security;

-- ============================
-- RLS Policies (service_role bypasses RLS; these enable authenticated anon select)
-- ============================

create policy warehouse_dim_date_select on public.warehouse_dim_date
  for select to authenticated using (true);

create policy warehouse_dim_school_select on public.warehouse_dim_school
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_dim_student_select on public.warehouse_dim_student
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_dim_staff_select on public.warehouse_dim_staff
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_dim_course_select on public.warehouse_dim_course
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_students_select on public.warehouse_fact_students
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_attendance_select on public.warehouse_fact_attendance
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_tests_select on public.warehouse_fact_tests
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_finance_select on public.warehouse_fact_finance
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_lms_select on public.warehouse_fact_lms
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_live_classes_select on public.warehouse_fact_live_classes
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_operations_select on public.warehouse_fact_operations
  for select to authenticated
  using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy warehouse_fact_platform_usage_select on public.warehouse_fact_platform_usage
  for select to authenticated
  using (public.is_platform_admin());

create policy warehouse_report_definitions_select on public.warehouse_report_definitions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (school_id is not null and public.same_school_membership(school_id))
    or created_by_profile_id = auth.uid()
  );

create policy warehouse_report_schedules_select on public.warehouse_report_schedules
  for select to authenticated
  using (
    public.is_platform_admin()
    or (school_id is not null and public.same_school_membership(school_id))
    or scheduled_by_profile_id = auth.uid()
  );

-- ============================
-- Permissions (inserted by service_role via _upsert in Python code)
-- If these policies need INSERT/UPDATE for service_role, note that
-- service_role bypasses RLS entirely.
-- ============================

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

notify pgrst, 'reload schema';

commit;
