-- Core ERP master data schema built on top of the foundational auth layer.
-- Tables:
--   1. staff_members
--   2. students
--   3. batches
--   4. subjects
--   5. rooms
--
-- Goals:
-- - UUID primary keys
-- - school-scoped master data
-- - canonical links to profiles where identity exists
-- - ready for attendance, timetable, exams, seating, and fees

begin;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  employee_code text not null,
  full_name text not null,
  email text,
  phone text,
  staff_type text not null default 'non_teaching',
  department text,
  designation text,
  joining_date date,
  employment_status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_members_staff_type_check check (
    staff_type in ('teaching', 'non_teaching', 'invigilator', 'contract', 'admin')
  ),
  constraint staff_members_employment_status_check check (
    employment_status in ('active', 'inactive', 'on_leave', 'terminated')
  )
);

create unique index if not exists staff_members_school_employee_code_key
  on public.staff_members (school_id, lower(employee_code));

create unique index if not exists staff_members_school_profile_key
  on public.staff_members (school_id, profile_id)
  where profile_id is not null;

create index if not exists staff_members_school_staff_type_active_idx
  on public.staff_members (school_id, staff_type, is_active);

create index if not exists staff_members_school_department_active_idx
  on public.staff_members (school_id, department, is_active);

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  batch_code text not null,
  name text not null,
  category text not null default 'batch',
  class_name text,
  section text,
  academic_session text,
  stream text,
  syllabus text,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint batches_category_check check (
    category in ('batch', 'class', 'section', 'cohort')
  )
);

create unique index if not exists batches_school_batch_code_key
  on public.batches (school_id, lower(batch_code));

create index if not exists batches_school_active_display_order_idx
  on public.batches (school_id, is_active, display_order);

create index if not exists batches_school_class_section_idx
  on public.batches (school_id, class_name, section);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  admission_no text,
  roll_number text not null,
  full_name text not null,
  father_name text,
  mother_name text,
  email text,
  phone text,
  guardian_name text,
  guardian_phone text,
  class_name text,
  section text,
  academic_session text,
  date_of_birth date,
  gender text,
  special_needs text,
  requires_near_exit boolean not null default false,
  requires_extra_time boolean not null default false,
  boarding_type text,
  hostel_required boolean not null default false,
  fee_status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint students_fee_status_check check (
    fee_status in ('active', 'inactive', 'alumni', 'suspended')
  )
);

create unique index if not exists students_school_roll_number_key
  on public.students (school_id, lower(roll_number));

create unique index if not exists students_school_admission_no_key
  on public.students (school_id, lower(admission_no))
  where admission_no is not null;

create unique index if not exists students_school_profile_key
  on public.students (school_id, profile_id)
  where profile_id is not null;

create index if not exists students_school_batch_active_idx
  on public.students (school_id, batch_id, is_active);

create index if not exists students_school_class_section_active_idx
  on public.students (school_id, class_name, section, is_active);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  subject_code text not null,
  name text not null,
  short_name text,
  subject_type text not null default 'academic',
  department text,
  class_name text,
  batch_id uuid references public.batches (id) on delete set null,
  lead_staff_member_id uuid references public.staff_members (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subjects_subject_type_check check (
    subject_type in ('academic', 'lab', 'activity', 'exam', 'fee')
  )
);

create unique index if not exists subjects_school_subject_code_key
  on public.subjects (school_id, lower(subject_code));

create index if not exists subjects_school_active_idx
  on public.subjects (school_id, is_active);

create index if not exists subjects_school_batch_idx
  on public.subjects (school_id, batch_id);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  room_code text not null,
  name text not null,
  room_type text not null default 'classroom',
  building_name text,
  floor_name text,
  capacity integer not null default 0,
  exam_capacity integer,
  length_feet numeric(10,2),
  width_feet numeric(10,2),
  desk_length_feet numeric(10,2),
  desk_width_feet numeric(10,2),
  num_benches integer,
  teaching_zone_clearance_feet numeric(10,2),
  aisle_width_feet numeric(10,2),
  door_location text,
  window_location text,
  is_accessible boolean not null default false,
  is_exam_room boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint rooms_room_type_check check (
    room_type in ('classroom', 'lab', 'hall', 'office', 'hostel', 'store')
  ),
  constraint rooms_capacity_check check (capacity >= 0),
  constraint rooms_exam_capacity_check check (exam_capacity is null or exam_capacity >= 0)
);

create unique index if not exists rooms_school_room_code_key
  on public.rooms (school_id, lower(room_code));

create index if not exists rooms_school_room_type_active_idx
  on public.rooms (school_id, room_type, is_active);

create index if not exists rooms_school_exam_room_active_idx
  on public.rooms (school_id, is_exam_room, is_active);

create trigger set_updated_at_staff_members
before update on public.staff_members
for each row
execute function public.set_updated_at();

create trigger set_updated_at_batches
before update on public.batches
for each row
execute function public.set_updated_at();

create trigger set_updated_at_students
before update on public.students
for each row
execute function public.set_updated_at();

create trigger set_updated_at_subjects
before update on public.subjects
for each row
execute function public.set_updated_at();

create trigger set_updated_at_rooms
before update on public.rooms
for each row
execute function public.set_updated_at();

create or replace function public.same_school_membership(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_memberships sm
    where sm.school_id = target_school_id
      and sm.profile_id = auth.uid()
      and sm.is_active = true
      and sm.status = 'active'
  );
$$;

alter table public.staff_members enable row level security;
alter table public.batches enable row level security;
alter table public.students enable row level security;
alter table public.subjects enable row level security;
alter table public.rooms enable row level security;

-- staff_members
create policy staff_members_select_member_scope
on public.staff_members
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy staff_members_insert_school_admin_only
on public.staff_members
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy staff_members_update_school_admin_or_self
on public.staff_members
for update
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

create policy staff_members_delete_school_admin_only
on public.staff_members
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

-- batches
create policy batches_select_member_scope
on public.batches
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy batches_insert_school_admin_only
on public.batches
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy batches_update_school_admin_only
on public.batches
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy batches_delete_school_admin_only
on public.batches
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

-- students
create policy students_select_member_scope
on public.students
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.same_school_membership(school_id)
  or profile_id = auth.uid()
);

create policy students_insert_school_admin_only
on public.students
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy students_update_school_admin_or_self
on public.students
for update
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

create policy students_delete_school_admin_only
on public.students
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

-- subjects
create policy subjects_select_member_scope
on public.subjects
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy subjects_insert_school_admin_only
on public.subjects
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy subjects_update_school_admin_only
on public.subjects
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy subjects_delete_school_admin_only
on public.subjects
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

-- rooms
create policy rooms_select_member_scope
on public.rooms
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy rooms_insert_school_admin_only
on public.rooms
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy rooms_update_school_admin_only
on public.rooms
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy rooms_delete_school_admin_only
on public.rooms
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

commit;
