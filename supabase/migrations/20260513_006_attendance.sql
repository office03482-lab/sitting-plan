begin;

create schema if not exists attendance;

create table if not exists attendance.settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools (id) on delete cascade,
  minimum_attendance_threshold numeric(5,2) not null default 75.00,
  working_hours_start time not null default '09:00',
  working_hours_end time not null default '17:00',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists attendance.holidays (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null,
  holiday_date date not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, holiday_date, title)
);

create index if not exists attendance_holidays_school_date_idx
  on attendance.holidays (school_id, holiday_date, is_active);

create table if not exists attendance.leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  approver_profile_id uuid references public.profiles (id) on delete set null,
  leave_type text not null,
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending',
  review_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint leave_requests_leave_type_check check (
    leave_type in ('casual', 'sick', 'paid', 'emergency')
  ),
  constraint leave_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  constraint leave_requests_date_check check (to_date >= from_date)
);

create index if not exists leave_requests_school_staff_status_idx
  on attendance.leave_requests (school_id, staff_member_id, status);

create table if not exists attendance.student_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  timetable_entry_id uuid references scheduling.timetable_entries (id) on delete set null,
  marked_by_staff_member_id uuid references public.staff_members (id) on delete set null,
  attendance_date date not null,
  status text not null default 'present',
  absence_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint student_attendance_status_check check (
    status in ('present', 'absent', 'late', 'excused')
  ),
  unique (student_id, subject_id, attendance_date)
);

create index if not exists student_attendance_school_date_student_idx
  on attendance.student_attendance (school_id, attendance_date, student_id);

create index if not exists student_attendance_school_batch_date_idx
  on attendance.student_attendance (school_id, batch_id, attendance_date);

create table if not exists attendance.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  marked_by_staff_member_id uuid references public.staff_members (id) on delete set null,
  attendance_date date not null,
  status text not null default 'present',
  check_in time,
  check_out time,
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_attendance_status_check check (
    status in ('present', 'absent', 'late', 'half_day', 'leave')
  ),
  unique (staff_member_id, attendance_date)
);

create index if not exists staff_attendance_school_date_staff_idx
  on attendance.staff_attendance (school_id, attendance_date, staff_member_id);

create table if not exists attendance.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  title text,
  message text not null,
  notification_type text not null,
  is_read boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_notifications_type_check check (
    notification_type in ('student_attendance', 'staff_attendance', 'leave', 'system')
  )
);

create index if not exists attendance_notifications_school_profile_idx
  on attendance.notifications (school_id, profile_id, is_read);

create trigger set_updated_at_attendance_settings
before update on attendance.settings
for each row
execute function public.set_updated_at();

create trigger set_updated_at_attendance_holidays
before update on attendance.holidays
for each row
execute function public.set_updated_at();

create trigger set_updated_at_leave_requests
before update on attendance.leave_requests
for each row
execute function public.set_updated_at();

create trigger set_updated_at_student_attendance
before update on attendance.student_attendance
for each row
execute function public.set_updated_at();

create trigger set_updated_at_staff_attendance
before update on attendance.staff_attendance
for each row
execute function public.set_updated_at();

create trigger set_updated_at_attendance_notifications
before update on attendance.notifications
for each row
execute function public.set_updated_at();

alter table attendance.settings enable row level security;
alter table attendance.holidays enable row level security;
alter table attendance.leave_requests enable row level security;
alter table attendance.student_attendance enable row level security;
alter table attendance.staff_attendance enable row level security;
alter table attendance.notifications enable row level security;

create policy attendance_settings_select_scope
on attendance.settings
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy attendance_settings_manage_scope
on attendance.settings
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.overview')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.overview')
);

create policy attendance_holidays_select_scope
on attendance.holidays
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy attendance_holidays_manage_scope
on attendance.holidays
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.leaves')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.leaves')
);

create policy leave_requests_select_scope
on attendance.leave_requests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.staff_members sm
    where sm.id = leave_requests.staff_member_id
      and sm.profile_id = auth.uid()
  )
);

create policy leave_requests_manage_scope
on attendance.leave_requests
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.leaves')
  or exists (
    select 1 from public.staff_members sm
    where sm.id = leave_requests.staff_member_id
      and sm.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.leaves')
  or exists (
    select 1 from public.staff_members sm
    where sm.id = leave_requests.staff_member_id
      and sm.profile_id = auth.uid()
  )
);

create policy student_attendance_select_scope
on attendance.student_attendance
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.students s
    where s.id = student_attendance.student_id
      and s.profile_id = auth.uid()
  )
);

create policy student_attendance_manage_scope
on attendance.student_attendance
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.student')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.student')
);

create policy staff_attendance_select_scope
on attendance.staff_attendance
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.staff_members sm
    where sm.id = staff_attendance.staff_member_id
      and sm.profile_id = auth.uid()
  )
);

create policy staff_attendance_manage_scope
on attendance.staff_attendance
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.staff')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'attendance.staff')
);

create policy attendance_notifications_select_scope
on attendance.notifications
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or profile_id = auth.uid()
);

create policy attendance_notifications_manage_scope
on attendance.notifications
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or profile_id = auth.uid()
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or profile_id = auth.uid()
);

commit;
