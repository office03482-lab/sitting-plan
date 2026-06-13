begin;

alter table scheduling.timetable_entries
  add column if not exists meeting_id text,
  add column if not exists meeting_password text,
  add column if not exists recording_url text;

create index if not exists idx_timetable_entries_school_mode_provider
  on scheduling.timetable_entries (school_id, session_mode, start_time);

create table if not exists academic.live_class_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  timetable_entry_id uuid not null references scheduling.timetable_entries (id) on delete cascade,
  course_id uuid references lms.courses (id) on delete set null,
  module_id uuid references lms.course_modules (id) on delete set null,
  lesson_id uuid references lms.lessons (id) on delete set null,
  session_date date not null,
  provider text not null default 'google_meet',
  provider_session_id text,
  meeting_link text,
  meeting_id text,
  meeting_password text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  status text not null default 'scheduled',
  notes_url text,
  recording_url text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  started_by_profile_id uuid references public.profiles (id) on delete set null,
  ended_by_profile_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint live_class_sessions_provider_check check (
    provider in ('zoom', 'google_meet', 'microsoft_teams', 'jitsi_meet')
  ),
  constraint live_class_sessions_status_check check (
    status in ('scheduled', 'live', 'ended', 'cancelled')
  )
);

create unique index if not exists live_class_sessions_school_entry_date_key
  on academic.live_class_sessions (school_id, timetable_entry_id, session_date)
  where deleted_at is null;

create index if not exists live_class_sessions_school_status_idx
  on academic.live_class_sessions (school_id, status, session_date desc)
  where deleted_at is null;

create index if not exists live_class_sessions_timetable_idx
  on academic.live_class_sessions (timetable_entry_id, session_date desc)
  where deleted_at is null;

create table if not exists academic.live_class_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references academic.live_class_sessions (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  role_key text not null default 'student',
  join_timestamp timestamptz not null default timezone('utc', now()),
  leave_timestamp timestamptz,
  total_duration_seconds integer not null default 0,
  attendance_percentage numeric(5,2) not null default 0,
  attendance_status text not null default 'absent',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint live_class_attendance_status_check check (
    attendance_status in ('present', 'partial', 'absent')
  )
);

create unique index if not exists live_class_attendance_unique_profile
  on academic.live_class_attendance (session_id, profile_id)
  where profile_id is not null and deleted_at is null;

create unique index if not exists live_class_attendance_unique_student
  on academic.live_class_attendance (session_id, student_id)
  where student_id is not null and deleted_at is null;

create index if not exists live_class_attendance_school_session_idx
  on academic.live_class_attendance (school_id, session_id, attendance_status)
  where deleted_at is null;

create table if not exists academic.live_class_recordings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references academic.live_class_sessions (id) on delete cascade,
  course_id uuid references lms.courses (id) on delete set null,
  module_id uuid references lms.course_modules (id) on delete set null,
  lesson_id uuid references lms.lessons (id) on delete set null,
  title text not null,
  recording_url text not null,
  notes_url text,
  duration_seconds integer not null default 0,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists live_class_recordings_school_session_idx
  on academic.live_class_recordings (school_id, session_id, published_at desc)
  where deleted_at is null;

create table if not exists academic.live_class_chat (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references academic.live_class_sessions (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  message_type text not null default 'message',
  message_text text not null,
  sent_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint live_class_chat_type_check check (
    message_type in ('message', 'system', 'question', 'answer')
  )
);

create index if not exists live_class_chat_school_session_idx
  on academic.live_class_chat (school_id, session_id, sent_at)
  where deleted_at is null;

create trigger set_updated_at_live_class_sessions
before update on academic.live_class_sessions
for each row execute function public.set_updated_at();

create trigger set_updated_at_live_class_attendance
before update on academic.live_class_attendance
for each row execute function public.set_updated_at();

create trigger set_updated_at_live_class_recordings
before update on academic.live_class_recordings
for each row execute function public.set_updated_at();

create trigger set_updated_at_live_class_chat
before update on academic.live_class_chat
for each row execute function public.set_updated_at();

alter table academic.live_class_sessions enable row level security;
alter table academic.live_class_attendance enable row level security;
alter table academic.live_class_recordings enable row level security;
alter table academic.live_class_chat enable row level security;

create policy live_class_sessions_select_scope
on academic.live_class_sessions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy live_class_sessions_manage_scope
on academic.live_class_sessions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.manage')
);

create policy live_class_attendance_select_scope
on academic.live_class_attendance
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy live_class_attendance_manage_scope
on academic.live_class_attendance
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.attendance')
  or public.has_permission(school_id, 'live_classes.join')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.attendance')
  or public.has_permission(school_id, 'live_classes.join')
);

create policy live_class_recordings_select_scope
on academic.live_class_recordings
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy live_class_recordings_manage_scope
on academic.live_class_recordings
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.manage')
);

create policy live_class_chat_select_scope
on academic.live_class_chat
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy live_class_chat_manage_scope
on academic.live_class_chat
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.join')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'live_classes.join')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('live_classes', 'live_classes', null, 'Access live classes module.', true),
  ('live_classes.view', 'live_classes', 'view', 'View live classes.', true),
  ('live_classes.manage', 'live_classes', 'manage', 'Schedule and manage live classes.', true),
  ('live_classes.join', 'live_classes', 'join', 'Join live class sessions.', true),
  ('live_classes.attendance', 'live_classes', 'attendance', 'View and manage live class attendance.', true),
  ('live_classes.reports', 'live_classes', 'reports', 'View live class analytics and reports.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'live_classes',
  'live_classes.view',
  'live_classes.manage',
  'live_classes.join',
  'live_classes.attendance',
  'live_classes.reports'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'live_classes',
  'live_classes.view',
  'live_classes.manage',
  'live_classes.attendance'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'live_classes',
  'live_classes.view',
  'live_classes.join'
)
where r.role_key = 'student'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'live_classes',
  'live_classes.view'
)
where r.role_key = 'parent'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
