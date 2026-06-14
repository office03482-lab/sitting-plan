begin;

create table if not exists ai.agent_registry (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  agent_key text not null,
  agent_name text not null,
  domain_key text not null,
  description text,
  target_roles jsonb not null default '[]'::jsonb,
  source_modules jsonb not null default '[]'::jsonb,
  approval_scope text not null default 'admin',
  orchestration_mode text not null default 'advisory',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_agent_registry_approval_scope_check check (
    approval_scope in ('teacher', 'admin', 'platform')
  ),
  constraint ai_agent_registry_mode_check check (
    orchestration_mode in ('advisory', 'approval_required')
  )
);

create unique index if not exists ai_agent_registry_school_agent_key
  on ai.agent_registry (school_id, agent_key);

create table if not exists ai.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  agent_id uuid references ai.agent_registry (id) on delete set null,
  agent_key text not null,
  triggered_by_profile_id uuid references public.profiles (id) on delete set null,
  trigger_mode text not null default 'manual',
  scope_key text not null default 'school',
  scope_id uuid,
  status text not null default 'completed',
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_agent_jobs_trigger_mode_check check (
    trigger_mode in ('manual', 'scheduled', 'event')
  ),
  constraint ai_agent_jobs_status_check check (
    status in ('queued', 'running', 'completed', 'failed')
  )
);

create index if not exists ai_agent_jobs_school_agent_idx
  on ai.agent_jobs (school_id, agent_key, created_at desc)
  where deleted_at is null;

create table if not exists ai.agent_recommendations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  job_id uuid references ai.agent_jobs (id) on delete set null,
  agent_id uuid references ai.agent_registry (id) on delete set null,
  agent_key text not null,
  title text not null,
  summary text not null,
  severity text not null default 'info',
  recommendation_type text not null,
  target_scope text not null default 'school',
  target_entity_id uuid,
  approval_scope text not null default 'admin',
  approval_status text not null default 'pending',
  approval_notes text,
  approved_by_profile_id uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  source_modules jsonb not null default '[]'::jsonb,
  confidence_score numeric(6,2) not null default 0,
  rationale jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_agent_recommendations_severity_check check (
    severity in ('info', 'warning', 'critical', 'positive')
  ),
  constraint ai_agent_recommendations_approval_scope_check check (
    approval_scope in ('teacher', 'admin', 'platform')
  ),
  constraint ai_agent_recommendations_approval_status_check check (
    approval_status in ('pending', 'approved', 'rejected')
  )
);

create index if not exists ai_agent_recommendations_school_status_idx
  on ai.agent_recommendations (school_id, approval_status, created_at desc)
  where deleted_at is null;

create table if not exists ai.agent_actions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  job_id uuid references ai.agent_jobs (id) on delete set null,
  recommendation_id uuid references ai.agent_recommendations (id) on delete set null,
  agent_id uuid references ai.agent_registry (id) on delete set null,
  agent_key text not null,
  action_label text not null,
  target_module text not null,
  action_type text not null,
  execution_payload jsonb not null default '{}'::jsonb,
  approval_scope text not null default 'admin',
  approval_status text not null default 'pending',
  execution_status text not null default 'awaiting_approval',
  approved_by_profile_id uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_agent_actions_approval_scope_check check (
    approval_scope in ('teacher', 'admin', 'platform')
  ),
  constraint ai_agent_actions_approval_status_check check (
    approval_status in ('pending', 'approved', 'rejected')
  ),
  constraint ai_agent_actions_execution_status_check check (
    execution_status in ('awaiting_approval', 'ready_for_manual_execution', 'cancelled')
  )
);

create index if not exists ai_agent_actions_school_status_idx
  on ai.agent_actions (school_id, approval_status, execution_status, created_at desc)
  where deleted_at is null;

create trigger set_updated_at_ai_agent_registry
before update on ai.agent_registry
for each row execute function public.set_updated_at();

create trigger set_updated_at_ai_agent_jobs
before update on ai.agent_jobs
for each row execute function public.set_updated_at();

create trigger set_updated_at_ai_agent_recommendations
before update on ai.agent_recommendations
for each row execute function public.set_updated_at();

create trigger set_updated_at_ai_agent_actions
before update on ai.agent_actions
for each row execute function public.set_updated_at();

alter table ai.agent_registry enable row level security;
alter table ai.agent_jobs enable row level security;
alter table ai.agent_recommendations enable row level security;
alter table ai.agent_actions enable row level security;

create policy ai_agent_registry_select_scope
on ai.agent_registry
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy ai_agent_registry_manage_scope
on ai.agent_registry
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.run')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.run')
);

create policy ai_agent_jobs_select_scope
on ai.agent_jobs
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy ai_agent_jobs_manage_scope
on ai.agent_jobs
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.run')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.run')
);

create policy ai_agent_recommendations_select_scope
on ai.agent_recommendations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy ai_agent_recommendations_manage_scope
on ai.agent_recommendations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.approve')
  or public.has_permission(school_id, 'ai_agents.run')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.approve')
  or public.has_permission(school_id, 'ai_agents.run')
);

create policy ai_agent_actions_select_scope
on ai.agent_actions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy ai_agent_actions_manage_scope
on ai.agent_actions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.approve')
  or public.has_permission(school_id, 'ai_agents.run')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_agents.approve')
  or public.has_permission(school_id, 'ai_agents.run')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('ai_agents', 'ai_agents', null, 'Access AI Academic Operating System command center.', true),
  ('ai_agents.view', 'ai_agents', 'view', 'View AI agent recommendations and summaries.', true),
  ('ai_agents.run', 'ai_agents', 'run', 'Run AI academic agents and orchestration jobs.', true),
  ('ai_agents.approve', 'ai_agents', 'approve', 'Approve or reject AI recommendations.', true),
  ('ai_agents.reports', 'ai_agents', 'reports', 'View AI operating summaries and command center reports.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'ai_agents',
  'ai_agents.view',
  'ai_agents.run',
  'ai_agents.approve',
  'ai_agents.reports'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'ai_agents',
  'ai_agents.view',
  'ai_agents.run',
  'ai_agents.approve'
)
where r.role_key = 'teacher'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
