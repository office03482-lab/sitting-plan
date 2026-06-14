begin;

create table if not exists ai.teacher_assistant_jobs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  target_batch_id uuid references public.batches (id) on delete set null,
  target_subject_id uuid references public.subjects (id) on delete set null,
  job_type text not null,
  title text not null,
  prompt text,
  context_snapshot jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  status text not null default 'generated',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint teacher_assistant_jobs_type_check check (
    job_type in ('question_paper', 'assignment', 'lesson_plan', 'report_comments')
  ),
  constraint teacher_assistant_jobs_status_check check (
    status in ('draft', 'generated', 'reviewed', 'archived')
  )
);

create table if not exists ai.generated_papers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  job_id uuid not null references ai.teacher_assistant_jobs (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete set null,
  paper_type text not null,
  title text not null,
  duration_minutes integer not null default 60,
  total_marks numeric(10,2) not null default 0,
  question_payload jsonb not null default '[]'::jsonb,
  instructions text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists ai.generated_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  job_id uuid not null references ai.teacher_assistant_jobs (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  subject_id uuid references public.subjects (id) on delete set null,
  assignment_type text not null,
  title text not null,
  difficulty_level text not null default 'medium',
  estimated_minutes integer not null default 30,
  task_payload jsonb not null default '[]'::jsonb,
  instructions text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint generated_assignments_difficulty_check check (
    difficulty_level in ('easy', 'medium', 'hard')
  )
);

create table if not exists ai.generated_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  job_id uuid not null references ai.teacher_assistant_jobs (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  report_type text not null,
  title text not null,
  summary text,
  remarks text,
  improvement_suggestions jsonb not null default '[]'::jsonb,
  score_payload jsonb not null default '{}'::jsonb,
  analytics_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists teacher_assistant_jobs_school_type_idx
  on ai.teacher_assistant_jobs (school_id, job_type, created_at desc)
  where deleted_at is null;

create index if not exists generated_papers_school_batch_idx
  on ai.generated_papers (school_id, batch_id, created_at desc)
  where deleted_at is null;

create index if not exists generated_assignments_school_batch_idx
  on ai.generated_assignments (school_id, batch_id, created_at desc)
  where deleted_at is null;

create index if not exists generated_reports_school_student_idx
  on ai.generated_reports (school_id, student_id, created_at desc)
  where deleted_at is null;

create trigger set_updated_at_teacher_assistant_jobs
before update on ai.teacher_assistant_jobs
for each row execute function public.set_updated_at();

create trigger set_updated_at_generated_papers
before update on ai.generated_papers
for each row execute function public.set_updated_at();

create trigger set_updated_at_generated_assignments
before update on ai.generated_assignments
for each row execute function public.set_updated_at();

create trigger set_updated_at_generated_reports
before update on ai.generated_reports
for each row execute function public.set_updated_at();

alter table ai.teacher_assistant_jobs enable row level security;
alter table ai.generated_papers enable row level security;
alter table ai.generated_assignments enable row level security;
alter table ai.generated_reports enable row level security;

create policy teacher_assistant_jobs_select_scope
on ai.teacher_assistant_jobs
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
  or public.has_permission(school_id, 'teacher_ai.reports')
);

create policy teacher_assistant_jobs_manage_scope
on ai.teacher_assistant_jobs
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
  or public.has_permission(school_id, 'teacher_ai.evaluate')
  or public.has_permission(school_id, 'teacher_ai.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
  or public.has_permission(school_id, 'teacher_ai.evaluate')
  or public.has_permission(school_id, 'teacher_ai.reports')
);

create policy generated_papers_scope
on ai.generated_papers
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
);

create policy generated_assignments_scope
on ai.generated_assignments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.generate')
);

create policy generated_reports_scope
on ai.generated_reports
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.evaluate')
  or public.has_permission(school_id, 'teacher_ai.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'teacher_ai.evaluate')
  or public.has_permission(school_id, 'teacher_ai.reports')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('teacher_ai', 'teacher_ai', null, 'Access teacher assistant module.', true),
  ('teacher_ai.generate', 'teacher_ai', 'generate', 'Generate papers, assignments, and lesson plans.', true),
  ('teacher_ai.evaluate', 'teacher_ai', 'evaluate', 'Generate evaluation remarks and improvement suggestions.', true),
  ('teacher_ai.reports', 'teacher_ai', 'reports', 'Generate report comments and parent communication notes.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'teacher_ai',
  'teacher_ai.generate',
  'teacher_ai.evaluate',
  'teacher_ai.reports'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'teacher_ai',
  'teacher_ai.generate',
  'teacher_ai.evaluate',
  'teacher_ai.reports'
)
where r.role_key = 'teacher'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
