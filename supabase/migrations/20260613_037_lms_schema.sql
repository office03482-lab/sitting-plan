begin;

create schema if not exists lms;

create table if not exists lms.courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  course_code text,
  title text not null,
  description text,
  thumbnail_url text,
  intro_video_url text,
  target_class_name text,
  target_section text,
  visibility text not null default 'batch',
  is_published boolean not null default false,
  estimated_duration_minutes integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_courses_visibility_check check (visibility in ('public', 'batch', 'class', 'private')),
  constraint lms_courses_estimated_duration_check check (estimated_duration_minutes >= 0)
);

create unique index if not exists lms_courses_school_code_active_key
  on lms.courses (school_id, lower(course_code))
  where course_code is not null and deleted_at is null;

create index if not exists lms_courses_school_visibility_idx
  on lms.courses (school_id, visibility, is_published, created_at desc);

create index if not exists lms_courses_school_batch_idx
  on lms.courses (school_id, batch_id, created_at desc);

create table if not exists lms.course_modules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  course_id uuid not null references lms.courses (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  description text,
  display_order integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_course_modules_display_order_check check (display_order > 0)
);

create unique index if not exists lms_course_modules_course_order_active_key
  on lms.course_modules (course_id, display_order)
  where deleted_at is null;

create index if not exists lms_course_modules_school_course_idx
  on lms.course_modules (school_id, course_id, display_order);

create table if not exists lms.lessons (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  course_id uuid not null references lms.courses (id) on delete cascade,
  module_id uuid not null references lms.course_modules (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  description text,
  lesson_type text not null default 'video',
  video_url text,
  content_text text,
  duration_seconds integer not null default 0,
  display_order integer not null default 1,
  is_preview boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_lessons_type_check check (lesson_type in ('video', 'pdf', 'note', 'assignment', 'mixed')),
  constraint lms_lessons_duration_check check (duration_seconds >= 0),
  constraint lms_lessons_display_order_check check (display_order > 0)
);

create unique index if not exists lms_lessons_module_order_active_key
  on lms.lessons (module_id, display_order)
  where deleted_at is null;

create index if not exists lms_lessons_school_course_idx
  on lms.lessons (school_id, course_id, module_id, display_order);

create table if not exists lms.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  course_id uuid not null references lms.courses (id) on delete cascade,
  lesson_id uuid not null references lms.lessons (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  resource_type text not null default 'pdf',
  title text not null,
  resource_url text,
  text_content text,
  file_size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  is_downloadable boolean not null default true,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_lesson_resources_type_check check (resource_type in ('video', 'pdf', 'note', 'assignment', 'link')),
  constraint lms_lesson_resources_size_check check (file_size_bytes is null or file_size_bytes >= 0)
);

create index if not exists lms_lesson_resources_school_lesson_idx
  on lms.lesson_resources (school_id, lesson_id, created_at asc);

create table if not exists lms.student_progress (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  course_id uuid not null references lms.courses (id) on delete cascade,
  module_id uuid references lms.course_modules (id) on delete cascade,
  lesson_id uuid not null references lms.lessons (id) on delete cascade,
  last_watched_position_seconds integer not null default 0,
  watch_percentage numeric(5,2) not null default 0,
  assignment_completion_percentage numeric(5,2) not null default 0,
  course_completion_percentage numeric(5,2) not null default 0,
  lessons_completed integer not null default 0,
  is_completed boolean not null default false,
  last_accessed_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_student_progress_watch_percentage_check check (watch_percentage >= 0 and watch_percentage <= 100),
  constraint lms_student_progress_assignment_completion_check check (assignment_completion_percentage >= 0 and assignment_completion_percentage <= 100),
  constraint lms_student_progress_course_completion_check check (course_completion_percentage >= 0 and course_completion_percentage <= 100),
  constraint lms_student_progress_position_check check (last_watched_position_seconds >= 0),
  constraint lms_student_progress_lessons_completed_check check (lessons_completed >= 0)
);

create unique index if not exists lms_student_progress_student_lesson_active_key
  on lms.student_progress (student_id, lesson_id)
  where deleted_at is null;

create index if not exists lms_student_progress_school_course_idx
  on lms.student_progress (school_id, student_id, course_id, updated_at desc);

create table if not exists lms.assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  course_id uuid not null references lms.courses (id) on delete cascade,
  module_id uuid references lms.course_modules (id) on delete cascade,
  lesson_id uuid references lms.lessons (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  description text,
  attachment_url text,
  due_at timestamptz,
  max_score numeric(10,2) not null default 100,
  status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_assignments_status_check check (status in ('draft', 'published', 'closed')),
  constraint lms_assignments_max_score_check check (max_score >= 0)
);

create index if not exists lms_assignments_school_course_idx
  on lms.assignments (school_id, course_id, due_at asc);

create table if not exists lms.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  assignment_id uuid not null references lms.assignments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  submitted_by_profile_id uuid references public.profiles (id) on delete set null,
  graded_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  submission_text text,
  attachment_url text,
  status text not null default 'draft',
  score_awarded numeric(10,2),
  feedback text,
  submitted_at timestamptz,
  graded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lms_assignment_submissions_status_check check (status in ('draft', 'submitted', 'graded', 'returned')),
  constraint lms_assignment_submissions_score_check check (score_awarded is null or score_awarded >= 0)
);

create unique index if not exists lms_assignment_submissions_assignment_student_active_key
  on lms.assignment_submissions (assignment_id, student_id)
  where deleted_at is null;

create index if not exists lms_assignment_submissions_school_assignment_idx
  on lms.assignment_submissions (school_id, assignment_id, created_at desc);

create or replace function lms.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, lms
as $$
declare
  v_school_id uuid;
  v_entity_id uuid;
  v_action text;
  v_row jsonb;
begin
  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_school_id := new.school_id;
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if tg_op = 'INSERT' then
    v_action := 'lms.' || tg_table_name || '.created';
  elsif tg_op = 'UPDATE' and coalesce(old.is_active, true) = true and coalesce(new.is_active, true) = false then
    v_action := 'lms.' || tg_table_name || '.soft_deleted';
  elsif tg_op = 'UPDATE' then
    v_action := 'lms.' || tg_table_name || '.updated';
  else
    v_action := 'lms.' || tg_table_name || '.deleted';
  end if;

  insert into public.audit_logs (
    school_id,
    profile_id,
    action,
    module_key,
    entity_table,
    entity_id,
    payload
  )
  values (
    v_school_id,
    auth.uid(),
    v_action,
    'lms',
    'lms.' || tg_table_name,
    v_entity_id,
    jsonb_build_object(
      'course_id', nullif(v_row ->> 'course_id', ''),
      'module_id', nullif(v_row ->> 'module_id', ''),
      'lesson_id', nullif(v_row ->> 'lesson_id', ''),
      'student_id', nullif(v_row ->> 'student_id', ''),
      'assignment_id', nullif(v_row ->> 'assignment_id', ''),
      'status', nullif(v_row ->> 'status', ''),
      'is_active', coalesce((v_row ->> 'is_active')::boolean, true)
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger set_updated_at_lms_courses before update on lms.courses for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_course_modules before update on lms.course_modules for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_lessons before update on lms.lessons for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_lesson_resources before update on lms.lesson_resources for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_student_progress before update on lms.student_progress for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_assignments before update on lms.assignments for each row execute function public.set_updated_at();
create trigger set_updated_at_lms_assignment_submissions before update on lms.assignment_submissions for each row execute function public.set_updated_at();

create trigger audit_lms_courses after insert or update or delete on lms.courses for each row execute function lms.write_audit_log();
create trigger audit_lms_course_modules after insert or update or delete on lms.course_modules for each row execute function lms.write_audit_log();
create trigger audit_lms_lessons after insert or update or delete on lms.lessons for each row execute function lms.write_audit_log();
create trigger audit_lms_lesson_resources after insert or update or delete on lms.lesson_resources for each row execute function lms.write_audit_log();
create trigger audit_lms_student_progress after insert or update or delete on lms.student_progress for each row execute function lms.write_audit_log();
create trigger audit_lms_assignments after insert or update or delete on lms.assignments for each row execute function lms.write_audit_log();
create trigger audit_lms_assignment_submissions after insert or update or delete on lms.assignment_submissions for each row execute function lms.write_audit_log();

alter table lms.courses enable row level security;
alter table lms.course_modules enable row level security;
alter table lms.lessons enable row level security;
alter table lms.lesson_resources enable row level security;
alter table lms.student_progress enable row level security;
alter table lms.assignments enable row level security;
alter table lms.assignment_submissions enable row level security;

create policy lms_courses_select_scope on lms.courses
for select to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy lms_courses_manage_scope on lms.courses
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'));

create policy lms_course_modules_select_scope on lms.course_modules
for select to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy lms_course_modules_manage_scope on lms.course_modules
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'));

create policy lms_lessons_select_scope on lms.lessons
for select to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy lms_lessons_manage_scope on lms.lessons
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'));

create policy lms_lesson_resources_select_scope on lms.lesson_resources
for select to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy lms_lesson_resources_manage_scope on lms.lesson_resources
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'));

create policy lms_student_progress_select_scope on lms.student_progress
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = student_progress.student_id
      and s.school_id = student_progress.school_id
      and s.profile_id = auth.uid()
  )
);

create policy lms_student_progress_manage_scope on lms.student_progress
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = student_progress.student_id
      and s.school_id = student_progress.school_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = student_progress.student_id
      and s.school_id = student_progress.school_id
      and s.profile_id = auth.uid()
  )
);

create policy lms_assignments_select_scope on lms.assignments
for select to authenticated
using (public.is_platform_admin() or public.same_school_membership(school_id));

create policy lms_assignments_manage_scope on lms.assignments
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'lms.manage'));

create policy lms_assignment_submissions_select_scope on lms.assignment_submissions
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = assignment_submissions.student_id
      and s.school_id = assignment_submissions.school_id
      and s.profile_id = auth.uid()
  )
);

create policy lms_assignment_submissions_manage_scope on lms.assignment_submissions
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = assignment_submissions.student_id
      and s.school_id = assignment_submissions.school_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'lms.manage')
  or exists (
    select 1 from public.students s
    where s.id = assignment_submissions.student_id
      and s.school_id = assignment_submissions.school_id
      and s.profile_id = auth.uid()
  )
);

notify pgrst, 'reload schema';

commit;
