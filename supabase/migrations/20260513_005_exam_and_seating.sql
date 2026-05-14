begin;

create schema if not exists exam;

create table if not exists exam.room_desks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  row_no integer not null,
  col_no integer not null,
  x_position numeric(10,2),
  y_position numeric(10,2),
  is_reserved boolean not null default false,
  reservation_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (room_id, row_no, col_no)
);

create table if not exists exam.room_seats (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  desk_id uuid not null references exam.room_desks (id) on delete cascade,
  seat_number integer not null,
  seat_label text,
  is_blocked boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint room_seats_seat_number_check check (seat_number in (1, 2)),
  unique (desk_id, seat_number)
);

create table if not exists exam.exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  exam_code text not null,
  name text not null,
  exam_type text not null default 'written',
  exam_date date not null,
  start_time time,
  end_time time,
  duration_minutes integer,
  status text not null default 'draft',
  instructions text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint exams_exam_type_check check (
    exam_type in ('written', 'practical', 'oral', 'online')
  ),
  constraint exams_status_check check (
    status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
  )
);

create unique index if not exists exams_school_exam_code_key
  on exam.exams (school_id, lower(exam_code));

create index if not exists exams_school_exam_date_status_idx
  on exam.exams (school_id, exam_date, status);

create table if not exists exam.exam_registrations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  registration_status text not null default 'registered',
  special_arrangement text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint exam_registrations_status_check check (
    registration_status in ('registered', 'cancelled', 'absent', 'completed')
  ),
  unique (exam_id, student_id)
);

create index if not exists exam_registrations_school_exam_idx
  on exam.exam_registrations (school_id, exam_id);

create table if not exists exam.seating_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  generated_by_profile_id uuid references public.profiles (id) on delete set null,
  plan_name text not null,
  plan_type text not null default 'strict',
  status text not null default 'draft',
  algorithm_version text not null default '1.0',
  students_assigned integer not null default 0,
  is_valid boolean not null default true,
  validation_errors jsonb not null default '[]'::jsonb,
  batch_distribution jsonb not null default '{}'::jsonb,
  plan_metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint seating_plans_plan_type_check check (
    plan_type in ('strict', 'compact', 'manual')
  ),
  constraint seating_plans_status_check check (
    status in ('draft', 'reviewed', 'finalized', 'archived')
  )
);

create index if not exists seating_plans_school_exam_room_idx
  on exam.seating_plans (school_id, exam_id, room_id, plan_type);

create table if not exists exam.seating_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  seating_plan_id uuid not null references exam.seating_plans (id) on delete cascade,
  exam_registration_id uuid references exam.exam_registrations (id) on delete set null,
  student_id uuid not null references public.students (id) on delete cascade,
  room_seat_id uuid not null references exam.room_seats (id) on delete cascade,
  desk_id uuid references exam.room_desks (id) on delete set null,
  position_label text,
  assignment_status text not null default 'assigned',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint seating_assignments_status_check check (
    assignment_status in ('assigned', 'swapped', 'blocked', 'removed')
  ),
  unique (seating_plan_id, student_id),
  unique (seating_plan_id, room_seat_id)
);

create index if not exists seating_assignments_school_plan_idx
  on exam.seating_assignments (school_id, seating_plan_id);

create table if not exists exam.invigilator_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  staff_member_id uuid not null references public.staff_members (id) on delete cascade,
  assigned_by_profile_id uuid references public.profiles (id) on delete set null,
  assignment_role text not null default 'invigilator',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint invigilator_assignments_role_check check (
    assignment_role in ('invigilator', 'chief_invigilator', 'observer')
  ),
  unique (exam_id, room_id, staff_member_id)
);

create index if not exists invigilator_assignments_school_exam_room_idx
  on exam.invigilator_assignments (school_id, exam_id, room_id, is_active);

create trigger set_updated_at_room_desks
before update on exam.room_desks
for each row
execute function public.set_updated_at();

create trigger set_updated_at_room_seats
before update on exam.room_seats
for each row
execute function public.set_updated_at();

create trigger set_updated_at_exams
before update on exam.exams
for each row
execute function public.set_updated_at();

create trigger set_updated_at_exam_registrations
before update on exam.exam_registrations
for each row
execute function public.set_updated_at();

create trigger set_updated_at_seating_plans
before update on exam.seating_plans
for each row
execute function public.set_updated_at();

create trigger set_updated_at_seating_assignments
before update on exam.seating_assignments
for each row
execute function public.set_updated_at();

create trigger set_updated_at_invigilator_assignments
before update on exam.invigilator_assignments
for each row
execute function public.set_updated_at();

alter table exam.room_desks enable row level security;
alter table exam.room_seats enable row level security;
alter table exam.exams enable row level security;
alter table exam.exam_registrations enable row level security;
alter table exam.seating_plans enable row level security;
alter table exam.seating_assignments enable row level security;
alter table exam.invigilator_assignments enable row level security;

create policy room_desks_select_scope
on exam.room_desks
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy room_desks_manage_scope
on exam.room_desks
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.rooms')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.rooms')
);

create policy room_seats_select_scope
on exam.room_seats
for select
to authenticated
using (public.is_platform_admin() or exists (
  select 1 from exam.room_desks d
  where d.id = room_seats.desk_id
    and (public.is_platform_admin() or public.same_school_membership(d.school_id))
));

create policy room_seats_manage_scope
on exam.room_seats
for all
to authenticated
using (public.is_platform_admin() or exists (
  select 1 from exam.room_desks d
  where d.id = room_seats.desk_id
    and (
      public.is_platform_admin()
      or public.is_school_admin(d.school_id)
      or public.has_permission(d.school_id, 'admin_office.rooms')
    )
))
with check (public.is_platform_admin() or exists (
  select 1 from exam.room_desks d
  where d.id = room_seats.desk_id
    and (
      public.is_platform_admin()
      or public.is_school_admin(d.school_id)
      or public.has_permission(d.school_id, 'admin_office.rooms')
    )
));

create policy exams_select_scope
on exam.exams
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy exams_manage_scope
on exam.exams
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_generation')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_generation')
);

create policy exam_registrations_select_scope
on exam.exam_registrations
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy exam_registrations_manage_scope
on exam.exam_registrations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.students')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.students')
);

create policy seating_plans_select_scope
on exam.seating_plans
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy seating_plans_manage_scope
on exam.seating_plans
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_plans')
  or public.has_permission(school_id, 'admin_office.seating_generation')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_plans')
  or public.has_permission(school_id, 'admin_office.seating_generation')
);

create policy seating_assignments_select_scope
on exam.seating_assignments
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy seating_assignments_manage_scope
on exam.seating_assignments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_plans')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.seating_plans')
);

create policy invigilator_assignments_select_scope
on exam.invigilator_assignments
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy invigilator_assignments_manage_scope
on exam.invigilator_assignments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.invigilators')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.invigilators')
);

commit;
