begin;

create schema if not exists academic;
create schema if not exists scheduling;

create table if not exists academic.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  guardian_code text,
  full_name text not null,
  relation_type text not null default 'parent',
  email text,
  phone text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint guardians_relation_type_check check (
    relation_type in ('parent', 'father', 'mother', 'guardian', 'sponsor')
  )
);

create unique index if not exists guardians_school_guardian_code_key
  on academic.guardians (school_id, lower(guardian_code))
  where guardian_code is not null;

create unique index if not exists guardians_school_profile_key
  on academic.guardians (school_id, profile_id)
  where profile_id is not null;

create index if not exists guardians_school_active_idx
  on academic.guardians (school_id, is_active);

create table if not exists academic.student_guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  guardian_id uuid not null references academic.guardians (id) on delete cascade,
  is_primary boolean not null default false,
  can_receive_notifications boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (student_id, guardian_id)
);

create unique index if not exists student_guardians_one_primary_per_student
  on academic.student_guardians (student_id)
  where is_primary = true;

create index if not exists student_guardians_school_idx
  on academic.student_guardians (school_id);

create table if not exists academic.staff_subject_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  class_name text,
  section text,
  is_class_teacher boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists staff_subject_assignments_unique_scope
  on academic.staff_subject_assignments (
    school_id,
    staff_member_id,
    subject_id,
    coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(class_name, ''),
    coalesce(section, '')
  );

create index if not exists staff_subject_assignments_school_staff_idx
  on academic.staff_subject_assignments (school_id, staff_member_id, is_active);

create table if not exists scheduling.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  day_of_week text not null,
  start_time time not null,
  end_time time not null,
  class_name text,
  section text,
  session_mode text not null default 'offline',
  session_type text not null default 'regular_class',
  online_link text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint timetable_entries_day_of_week_check check (
    day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),
  constraint timetable_entries_time_check check (end_time > start_time),
  constraint timetable_entries_session_mode_check check (
    session_mode in ('offline', 'online', 'hybrid')
  ),
  constraint timetable_entries_session_type_check check (
    session_type in ('regular_class', 'extra_class', 'exam', 'lab', 'activity')
  )
);

create index if not exists timetable_entries_school_staff_day_idx
  on scheduling.timetable_entries (school_id, staff_member_id, day_of_week, start_time);

create index if not exists timetable_entries_school_batch_day_idx
  on scheduling.timetable_entries (school_id, batch_id, day_of_week, start_time);

create index if not exists timetable_entries_school_room_day_idx
  on scheduling.timetable_entries (school_id, room_id, day_of_week, start_time);

create trigger set_updated_at_guardians
before update on academic.guardians
for each row
execute function public.set_updated_at();

create trigger set_updated_at_staff_subject_assignments
before update on academic.staff_subject_assignments
for each row
execute function public.set_updated_at();

create trigger set_updated_at_timetable_entries
before update on scheduling.timetable_entries
for each row
execute function public.set_updated_at();

alter table academic.guardians enable row level security;
alter table academic.student_guardians enable row level security;
alter table academic.staff_subject_assignments enable row level security;
alter table scheduling.timetable_entries enable row level security;

create policy guardians_select_scope
on academic.guardians
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or profile_id = auth.uid()
);

create policy guardians_manage_admin_only
on academic.guardians
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy student_guardians_select_scope
on academic.student_guardians
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy student_guardians_manage_admin_only
on academic.student_guardians
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy staff_subject_assignments_select_scope
on academic.staff_subject_assignments
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy staff_subject_assignments_manage_school_admin
on academic.staff_subject_assignments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'timetable.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'timetable.manage')
);

create policy timetable_entries_select_scope
on scheduling.timetable_entries
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy timetable_entries_manage_scope
on scheduling.timetable_entries
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'timetable.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'timetable.manage')
);

commit;
