begin;

create table if not exists analytics.parent_insights (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  parent_profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid not null references public.students (id) on delete cascade,
  insight_type text not null default 'academic_health',
  title text not null,
  summary text not null,
  severity text not null default 'info',
  trend_window_days integer not null default 30,
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_parent_insights_type_check check (
    insight_type in ('academic_health', 'attendance', 'performance', 'engagement', 'hostel', 'assignment', 'discipline', 'trend')
  ),
  constraint analytics_parent_insights_severity_check check (
    severity in ('info', 'warning', 'critical', 'positive')
  )
);

create index if not exists analytics_parent_insights_scope_idx
  on analytics.parent_insights (school_id, parent_profile_id, student_id, generated_at desc)
  where deleted_at is null;

create table if not exists analytics.student_risk_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  parent_profile_id uuid references public.profiles (id) on delete set null,
  attendance_score numeric(5,2) not null default 0,
  test_performance_score numeric(5,2) not null default 0,
  learning_consistency_score numeric(5,2) not null default 0,
  engagement_score numeric(5,2) not null default 0,
  hostel_score numeric(5,2) not null default 100,
  academic_health_score numeric(5,2) not null default 0,
  risk_level text not null default 'low',
  risk_factors jsonb not null default '[]'::jsonb,
  trend_7d jsonb not null default '{}'::jsonb,
  trend_30d jsonb not null default '{}'::jsonb,
  trend_90d jsonb not null default '{}'::jsonb,
  alerts_snapshot jsonb not null default '[]'::jsonb,
  last_calculated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_student_risk_scores_level_check check (
    risk_level in ('low', 'medium', 'high')
  )
);

create unique index if not exists analytics_student_risk_scores_student_key
  on analytics.student_risk_scores (school_id, student_id)
  where deleted_at is null;

create table if not exists analytics.parent_alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  parent_profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid not null references public.students (id) on delete cascade,
  alert_type text not null default 'attendance_warning',
  title text not null,
  message text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  alert_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  acknowledged_at timestamptz,
  acknowledged_by_profile_id uuid references public.profiles (id) on delete set null,
  communication_actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_parent_alerts_type_check check (
    alert_type in ('attendance_warning', 'academic_decline', 'assignment_overdue', 'upcoming_exam', 'hostel_issue', 'missed_classes')
  ),
  constraint analytics_parent_alerts_severity_check check (
    severity in ('info', 'warning', 'critical')
  ),
  constraint analytics_parent_alerts_status_check check (
    status in ('open', 'acknowledged', 'resolved')
  )
);

create index if not exists analytics_parent_alerts_scope_idx
  on analytics.parent_alerts (school_id, parent_profile_id, status, generated_at desc)
  where deleted_at is null;

create trigger set_updated_at_parent_insights
before update on analytics.parent_insights
for each row execute function public.set_updated_at();

create trigger set_updated_at_student_risk_scores
before update on analytics.student_risk_scores
for each row execute function public.set_updated_at();

create trigger set_updated_at_parent_alerts
before update on analytics.parent_alerts
for each row execute function public.set_updated_at();

alter table analytics.parent_insights enable row level security;
alter table analytics.student_risk_scores enable row level security;
alter table analytics.parent_alerts enable row level security;

create policy analytics_parent_insights_select_scope
on analytics.parent_insights
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_parent_insights_manage_scope
on analytics.parent_insights
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.reports')
  or public.has_permission(school_id, 'parent_intelligence.communication')
  or public.has_permission(school_id, 'edupay.parent_portal')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.reports')
  or public.has_permission(school_id, 'parent_intelligence.communication')
  or public.has_permission(school_id, 'edupay.parent_portal')
);

create policy analytics_student_risk_scores_select_scope
on analytics.student_risk_scores
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_student_risk_scores_manage_scope
on analytics.student_risk_scores
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.reports')
);

create policy analytics_parent_alerts_select_scope
on analytics.parent_alerts
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_parent_alerts_manage_scope
on analytics.parent_alerts
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.alerts')
  or public.has_permission(school_id, 'parent_intelligence.communication')
  or public.has_permission(school_id, 'edupay.parent_portal')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'parent_intelligence.alerts')
  or public.has_permission(school_id, 'parent_intelligence.communication')
  or public.has_permission(school_id, 'edupay.parent_portal')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('parent_intelligence', 'parent_intelligence', null, 'Access parent intelligence portal.', true),
  ('parent_intelligence.view', 'parent_intelligence', 'view', 'View parent intelligence dashboards.', true),
  ('parent_intelligence.alerts', 'parent_intelligence', 'alerts', 'View and acknowledge parent alerts.', true),
  ('parent_intelligence.communication', 'parent_intelligence', 'communication', 'Contact teachers and request meetings from the parent portal.', true),
  ('parent_intelligence.reports', 'parent_intelligence', 'reports', 'View parent intelligence risk analytics and reports.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'parent_intelligence',
  'parent_intelligence.view',
  'parent_intelligence.alerts',
  'parent_intelligence.communication',
  'parent_intelligence.reports'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'parent_intelligence',
  'parent_intelligence.view',
  'parent_intelligence.reports'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'parent_intelligence',
  'parent_intelligence.view',
  'parent_intelligence.alerts',
  'parent_intelligence.communication'
)
where r.role_key = 'parent'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
