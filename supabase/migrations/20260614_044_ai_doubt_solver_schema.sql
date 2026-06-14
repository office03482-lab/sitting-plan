begin;

create table if not exists ai.doubt_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  role_key text not null default 'student',
  input_type text not null default 'text',
  source_language text not null default 'english',
  detected_subject text,
  detected_topic text,
  confidence_score numeric(5,2) not null default 0,
  escalation_status text not null default 'not_required',
  escalated_to_profile_id uuid references public.profiles (id) on delete set null,
  escalated_at timestamptz,
  resolved_at timestamptz,
  teacher_resolution_notes text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint doubt_sessions_input_type_check check (input_type in ('text', 'image', 'pdf', 'screenshot', 'handwritten', 'voice')),
  constraint doubt_sessions_language_check check (source_language in ('english', 'hindi', 'mixed')),
  constraint doubt_sessions_subject_check check (detected_subject is null or detected_subject in ('physics', 'chemistry', 'biology', 'mathematics', 'general')),
  constraint doubt_sessions_escalation_status_check check (escalation_status in ('not_required', 'pending_teacher', 'resolved', 'dismissed'))
);

create index if not exists doubt_sessions_scope_idx
  on ai.doubt_sessions (school_id, role_key, created_at desc)
  where deleted_at is null;

create index if not exists doubt_sessions_student_idx
  on ai.doubt_sessions (school_id, student_id, created_at desc)
  where deleted_at is null;

create table if not exists ai.doubt_questions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references ai.doubt_sessions (id) on delete cascade,
  source_type text not null default 'text',
  source_url text,
  source_name text,
  raw_prompt text,
  ocr_text text,
  normalized_text text,
  extracted_equations jsonb not null default '[]'::jsonb,
  extracted_diagrams jsonb not null default '[]'::jsonb,
  extracted_mcqs jsonb not null default '[]'::jsonb,
  extracted_numericals jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint doubt_questions_source_type_check check (source_type in ('text', 'image', 'pdf', 'screenshot', 'handwritten', 'voice'))
);

create index if not exists doubt_questions_session_idx
  on ai.doubt_questions (school_id, session_id, created_at desc)
  where deleted_at is null;

create table if not exists ai.doubt_solutions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references ai.doubt_sessions (id) on delete cascade,
  question_id uuid references ai.doubt_questions (id) on delete set null,
  solution_title text not null,
  final_answer text,
  explanation text not null,
  shortcut_method text,
  common_mistakes jsonb not null default '[]'::jsonb,
  step_by_step jsonb not null default '[]'::jsonb,
  confidence_score numeric(5,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists doubt_solutions_session_idx
  on ai.doubt_solutions (school_id, session_id, created_at desc)
  where deleted_at is null;

create table if not exists ai.doubt_recommendations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  session_id uuid not null references ai.doubt_sessions (id) on delete cascade,
  recommendation_type text not null default 'lesson',
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 3,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint doubt_recommendations_type_check check (recommendation_type in ('lesson', 'recording', 'notes', 'assignment', 'test', 'teacher_escalation'))
);

create index if not exists doubt_recommendations_session_idx
  on ai.doubt_recommendations (school_id, session_id, recommendation_type, created_at desc)
  where deleted_at is null;

create trigger set_updated_at_doubt_sessions
before update on ai.doubt_sessions
for each row execute function public.set_updated_at();

create trigger set_updated_at_doubt_questions
before update on ai.doubt_questions
for each row execute function public.set_updated_at();

create trigger set_updated_at_doubt_solutions
before update on ai.doubt_solutions
for each row execute function public.set_updated_at();

create trigger set_updated_at_doubt_recommendations
before update on ai.doubt_recommendations
for each row execute function public.set_updated_at();

alter table ai.doubt_sessions enable row level security;
alter table ai.doubt_questions enable row level security;
alter table ai.doubt_solutions enable row level security;
alter table ai.doubt_recommendations enable row level security;

create policy doubt_sessions_select_scope
on ai.doubt_sessions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or profile_id = public.current_profile_id()
);

create policy doubt_sessions_manage_scope
on ai.doubt_sessions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or public.has_permission(school_id, 'doubt_solver.escalate')
  or (public.has_permission(school_id, 'doubt_solver.solve') and profile_id = public.current_profile_id())
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or public.has_permission(school_id, 'doubt_solver.escalate')
  or (public.has_permission(school_id, 'doubt_solver.solve') and profile_id = public.current_profile_id())
);

create policy doubt_questions_select_scope
on ai.doubt_questions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_questions.session_id
      and s.profile_id = public.current_profile_id()
  )
);

create policy doubt_questions_manage_scope
on ai.doubt_questions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_questions.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_questions.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
);

create policy doubt_solutions_select_scope
on ai.doubt_solutions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_solutions.session_id
      and s.profile_id = public.current_profile_id()
  )
);

create policy doubt_solutions_manage_scope
on ai.doubt_solutions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_solutions.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_solutions.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
);

create policy doubt_recommendations_select_scope
on ai.doubt_recommendations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_recommendations.session_id
      and s.profile_id = public.current_profile_id()
  )
);

create policy doubt_recommendations_manage_scope
on ai.doubt_recommendations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or public.has_permission(school_id, 'doubt_solver.escalate')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_recommendations.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'doubt_solver.review')
  or public.has_permission(school_id, 'doubt_solver.manage')
  or public.has_permission(school_id, 'doubt_solver.escalate')
  or exists (
    select 1
    from ai.doubt_sessions s
    where s.id = doubt_recommendations.session_id
      and s.profile_id = public.current_profile_id()
      and public.has_permission(school_id, 'doubt_solver.solve')
  )
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('doubt_solver', 'doubt_solver', null, 'Access doubt solver module.', true),
  ('doubt_solver.solve', 'doubt_solver', 'solve', 'Create and solve academic doubts.', true),
  ('doubt_solver.review', 'doubt_solver', 'review', 'Review doubt history and student doubt sessions.', true),
  ('doubt_solver.manage', 'doubt_solver', 'manage', 'Manage doubt solver operations and knowledge settings.', true),
  ('doubt_solver.escalate', 'doubt_solver', 'escalate', 'Resolve or escalate low-confidence doubts to teachers.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'doubt_solver',
  'doubt_solver.solve',
  'doubt_solver.review',
  'doubt_solver.manage',
  'doubt_solver.escalate'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'doubt_solver',
  'doubt_solver.solve',
  'doubt_solver.review',
  'doubt_solver.escalate'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'doubt_solver',
  'doubt_solver.solve'
)
where r.role_key = 'student'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
