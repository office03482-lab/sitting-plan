begin;

create table if not exists analytics.study_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  generated_by_profile_id uuid references public.profiles (id) on delete set null,
  scope text not null default 'today',
  plan_date date not null,
  exam_mode text,
  total_estimated_minutes integer not null default 0,
  completion_percentage numeric(5,2) not null default 0,
  streak_count integer not null default 0,
  badges jsonb not null default '[]'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_study_plans_scope_check check (scope in ('today', 'tomorrow', 'week', 'month')),
  constraint analytics_study_plans_minutes_check check (total_estimated_minutes >= 0),
  constraint analytics_study_plans_completion_check check (completion_percentage >= 0 and completion_percentage <= 100),
  constraint analytics_study_plans_streak_check check (streak_count >= 0)
);

create unique index if not exists analytics_study_plans_student_scope_date_key
  on analytics.study_plans (school_id, student_id, scope, plan_date)
  where deleted_at is null;

create index if not exists analytics_study_plans_school_scope_idx
  on analytics.study_plans (school_id, scope, plan_date desc)
  where deleted_at is null;

create table if not exists analytics.study_tasks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  plan_id uuid not null references analytics.study_plans (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  task_type text not null default 'revision',
  title text not null,
  description text,
  subject_name text,
  chapter_name text,
  recommended_resource_type text,
  recommended_resource_id uuid,
  recommended_resource_url text,
  estimated_minutes integer not null default 0,
  priority integer not null default 1,
  status text not null default 'pending',
  source_module text,
  source_entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_study_tasks_type_check check (task_type in ('revision', 'lecture', 'assignment', 'test', 'live_class', 'goal', 'practice')),
  constraint analytics_study_tasks_status_check check (status in ('pending', 'in_progress', 'completed', 'missed')),
  constraint analytics_study_tasks_minutes_check check (estimated_minutes >= 0),
  constraint analytics_study_tasks_priority_check check (priority >= 1 and priority <= 5)
);

create index if not exists analytics_study_tasks_plan_idx
  on analytics.study_tasks (plan_id, priority asc, created_at asc)
  where deleted_at is null;

create table if not exists analytics.recommendations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  role_key text not null default 'student',
  recommendation_scope text not null default 'student',
  recommendation_type text not null default 'lesson',
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  score numeric(6,2) not null default 0,
  generated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_recommendations_scope_check check (recommendation_scope in ('student', 'parent', 'teacher', 'school', 'platform')),
  constraint analytics_recommendations_type_check check (recommendation_type in ('lesson', 'assignment', 'test', 'revision', 'risk_alert', 'cluster', 'goal', 'streak')),
  constraint analytics_recommendations_score_check check (score >= 0)
);

create index if not exists analytics_recommendations_school_scope_idx
  on analytics.recommendations (school_id, recommendation_scope, generated_at desc)
  where deleted_at is null;

create table if not exists analytics.learning_goals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  goal_type text not null default 'daily',
  exam_mode text,
  title text not null,
  description text,
  target_date date,
  target_value numeric(10,2),
  current_value numeric(10,2) not null default 0,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_learning_goals_type_check check (goal_type in ('daily', 'weekly', 'monthly', 'exam')),
  constraint analytics_learning_goals_status_check check (status in ('active', 'completed', 'paused', 'cancelled'))
);

create index if not exists analytics_learning_goals_school_student_idx
  on analytics.learning_goals (school_id, student_id, status, target_date asc)
  where deleted_at is null;

create trigger set_updated_at_analytics_study_plans
before update on analytics.study_plans
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_study_tasks
before update on analytics.study_tasks
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_recommendations
before update on analytics.recommendations
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_learning_goals
before update on analytics.learning_goals
for each row execute function public.set_updated_at();

alter table analytics.study_plans enable row level security;
alter table analytics.study_tasks enable row level security;
alter table analytics.recommendations enable row level security;
alter table analytics.learning_goals enable row level security;

create policy analytics_study_plans_select_scope
on analytics.study_plans
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_study_plans_manage_scope
on analytics.study_plans
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
  or public.has_permission(school_id, 'study_planner.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
  or public.has_permission(school_id, 'study_planner.reports')
);

create policy analytics_study_tasks_select_scope
on analytics.study_tasks
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_study_tasks_manage_scope
on analytics.study_tasks
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
  or public.has_permission(school_id, 'study_planner.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
  or public.has_permission(school_id, 'study_planner.reports')
);

create policy analytics_recommendations_select_scope
on analytics.recommendations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_recommendations_manage_scope
on analytics.recommendations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.reports')
);

create policy analytics_learning_goals_select_scope
on analytics.learning_goals
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_learning_goals_manage_scope
on analytics.learning_goals
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'study_planner.goals')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('study_planner', 'study_planner', null, 'Access study planner and academic copilot.', true),
  ('study_planner.view', 'study_planner', 'view', 'View study planner dashboards.', true),
  ('study_planner.goals', 'study_planner', 'goals', 'Create and manage learning goals.', true),
  ('study_planner.reports', 'study_planner', 'reports', 'View planner recommendations and risk reports.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'study_planner',
  'study_planner.view',
  'study_planner.goals',
  'study_planner.reports'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'study_planner',
  'study_planner.view',
  'study_planner.reports'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'study_planner',
  'study_planner.view',
  'study_planner.goals'
)
where r.role_key = 'student'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'study_planner',
  'study_planner.view'
)
where r.role_key = 'parent'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
