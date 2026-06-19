begin;

create table if not exists lms.student_revision_tracker (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  course_id uuid references lms.courses (id) on delete set null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  topic_key text not null,
  topic_name text not null,
  chapter_name text,
  subject_name text,
  course_title text,
  status text not null default 'not_started',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_student_revision_tracker_status_check check (status in ('not_started', 'in_progress', 'completed'))
);

create unique index if not exists lms_student_revision_tracker_student_topic_active_key
  on lms.student_revision_tracker (student_id, lower(topic_key))
  where deleted_at is null;

create index if not exists lms_student_revision_tracker_school_student_idx
  on lms.student_revision_tracker (school_id, student_id, updated_at desc);

create trigger set_updated_at_lms_student_revision_tracker
before update on lms.student_revision_tracker
for each row execute function public.set_updated_at();

create trigger audit_lms_student_revision_tracker
after insert or update or delete on lms.student_revision_tracker
for each row execute function lms.write_audit_log();

alter table lms.student_revision_tracker enable row level security;

drop policy if exists lms_student_revision_tracker_select_scope on lms.student_revision_tracker;
create policy lms_student_revision_tracker_select_scope on lms.student_revision_tracker
for select
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.school_memberships sm
    join public.roles r on r.id = sm.role_id
    where sm.profile_id = auth.uid()
      and sm.school_id = student_revision_tracker.school_id
      and sm.is_active = true
      and r.role_key in ('platform_admin', 'school_admin', 'teacher', 'staff', 'viewer', 'parent')
  )
  or exists (
    select 1
    from public.students s
    where s.id = student_revision_tracker.student_id
      and s.school_id = student_revision_tracker.school_id
      and s.profile_id = auth.uid()
  )
);

drop policy if exists lms_student_revision_tracker_manage_scope on lms.student_revision_tracker;
create policy lms_student_revision_tracker_manage_scope on lms.student_revision_tracker
for all
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.students s
    where s.id = student_revision_tracker.student_id
      and s.school_id = student_revision_tracker.school_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.students s
    where s.id = student_revision_tracker.student_id
      and s.school_id = student_revision_tracker.school_id
      and s.profile_id = auth.uid()
  )
);

create or replace view public.lms_student_revision_tracker
as
select *
from lms.student_revision_tracker;

commit;
