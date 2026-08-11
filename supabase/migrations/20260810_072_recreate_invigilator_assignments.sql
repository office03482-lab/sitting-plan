-- =============================================================================
-- Migration: Recreate exam.invigilator_assignments
--
-- Root cause: migration 20260726_001 (offline exam tables) dropped
-- exam.invigilator_assignments and never recreated it. The backend invigilator
-- room-assignment service (backend/app/services/supabase_invigilators.py)
-- targets this table, so every assignment query fails with:
--   PGRST205: Could not find the table 'exam.invigilator_assignments'
--
-- This restores the table (mirroring 20260513_005) with RLS policies, the
-- updated_at trigger, service_role/authenticated grants, and the matching
-- public view used by the other offline-exam tables.
-- =============================================================================

begin;

create table if not exists exam.invigilator_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid references exam.exams (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
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

create index if not exists invigilator_assignments_staff_member_idx
  on exam.invigilator_assignments (staff_member_id);

drop trigger if exists set_updated_at_invigilator_assignments
  on exam.invigilator_assignments;

create trigger set_updated_at_invigilator_assignments
before update on exam.invigilator_assignments
for each row
execute function public.set_updated_at();

alter table exam.invigilator_assignments enable row level security;

drop policy if exists invigilator_assignments_select_scope
  on exam.invigilator_assignments;

create policy invigilator_assignments_select_scope
on exam.invigilator_assignments
for select
to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

drop policy if exists invigilator_assignments_manage_scope
  on exam.invigilator_assignments;

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

grant usage on schema exam to authenticated, service_role;
grant select, insert, update, delete
  on exam.invigilator_assignments to authenticated, service_role;

create or replace view public.exam_invigilator_assignments
  with (security_invoker = true)
  as select * from exam.invigilator_assignments;

grant select on public.exam_invigilator_assignments to anon, authenticated, service_role;

commit;
