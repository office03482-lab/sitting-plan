begin;

create table if not exists analytics.model_registry (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  model_key text not null,
  model_name text not null,
  model_scope text not null,
  model_type text not null default 'rule_based',
  target_metric text not null,
  version text not null default 'v1',
  status text not null default 'active',
  feature_sources jsonb not null default '[]'::jsonb,
  thresholds jsonb not null default '{}'::jsonb,
  confidence_notes text,
  last_trained_at timestamptz,
  last_run_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_model_registry_scope_check check (
    model_scope in ('student', 'parent', 'teacher', 'hostel', 'finance', 'campus')
  ),
  constraint analytics_model_registry_type_check check (
    model_type in ('rule_based', 'statistical', 'ml')
  ),
  constraint analytics_model_registry_status_check check (
    status in ('draft', 'active', 'archived')
  )
);

create unique index if not exists analytics_model_registry_school_model_key
  on analytics.model_registry (school_id, model_key, version);

create table if not exists analytics.predictions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  subject_type text not null,
  subject_key text not null,
  subject_id uuid,
  model_registry_id uuid references analytics.model_registry (id) on delete set null,
  prediction_type text not null,
  risk_level text not null default 'low',
  probability numeric(6,2) not null default 0,
  confidence_score numeric(6,2) not null default 0,
  horizon_days integer not null default 30,
  predicted_for_date date not null,
  headline text not null,
  explanation text not null,
  recommended_actions jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  feature_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_predictions_subject_type_check check (
    subject_type in ('student', 'parent', 'teacher', 'hostel', 'finance', 'campus')
  ),
  constraint analytics_predictions_risk_level_check check (
    risk_level in ('low', 'medium', 'high', 'critical')
  )
);

create unique index if not exists analytics_predictions_unique_scope
  on analytics.predictions (school_id, prediction_type, subject_type, subject_key, predicted_for_date);

create index if not exists analytics_predictions_school_generated_idx
  on analytics.predictions (school_id, generated_at desc)
  where deleted_at is null;

create table if not exists analytics.risk_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  scope_type text not null,
  scope_key text not null,
  scope_id uuid,
  risk_type text not null,
  risk_level text not null default 'low',
  score numeric(6,2) not null default 0,
  probability numeric(6,2) not null default 0,
  confidence_score numeric(6,2) not null default 0,
  contributing_factors jsonb not null default '[]'::jsonb,
  automated_actions jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_risk_scores_scope_type_check check (
    scope_type in ('student', 'parent', 'teacher', 'hostel', 'finance', 'campus')
  ),
  constraint analytics_risk_scores_level_check check (
    risk_level in ('low', 'medium', 'high', 'critical')
  )
);

create unique index if not exists analytics_risk_scores_unique_scope
  on analytics.risk_scores (school_id, scope_type, scope_key, risk_type);

create table if not exists analytics.forecasts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  scope_type text not null,
  scope_key text not null,
  scope_id uuid,
  forecast_type text not null,
  model_registry_id uuid references analytics.model_registry (id) on delete set null,
  period_key text not null,
  period_start date not null,
  period_end date not null,
  forecast_value numeric(12,2) not null default 0,
  lower_bound numeric(12,2),
  upper_bound numeric(12,2),
  confidence_score numeric(6,2) not null default 0,
  driver_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_forecasts_scope_type_check check (
    scope_type in ('student', 'parent', 'teacher', 'hostel', 'finance', 'campus')
  )
);

create unique index if not exists analytics_forecasts_unique_scope
  on analytics.forecasts (school_id, scope_type, scope_key, forecast_type, period_key);

create index if not exists analytics_forecasts_school_generated_idx
  on analytics.forecasts (school_id, generated_at desc)
  where deleted_at is null;

create trigger set_updated_at_analytics_model_registry
before update on analytics.model_registry
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_predictions
before update on analytics.predictions
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_risk_scores
before update on analytics.risk_scores
for each row execute function public.set_updated_at();

create trigger set_updated_at_analytics_forecasts
before update on analytics.forecasts
for each row execute function public.set_updated_at();

create trigger write_audit_log_analytics_model_registry
after insert or update or delete on analytics.model_registry
for each row execute function analytics.write_audit_log();

create trigger write_audit_log_analytics_predictions
after insert or update or delete on analytics.predictions
for each row execute function analytics.write_audit_log();

create trigger write_audit_log_analytics_risk_scores
after insert or update or delete on analytics.risk_scores
for each row execute function analytics.write_audit_log();

create trigger write_audit_log_analytics_forecasts
after insert or update or delete on analytics.forecasts
for each row execute function analytics.write_audit_log();

alter table analytics.model_registry enable row level security;
alter table analytics.predictions enable row level security;
alter table analytics.risk_scores enable row level security;
alter table analytics.forecasts enable row level security;

create policy analytics_model_registry_select_scope
on analytics.model_registry
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_model_registry_manage_scope
on analytics.model_registry
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
);

create policy analytics_predictions_select_scope
on analytics.predictions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_predictions_manage_scope
on analytics.predictions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
);

create policy analytics_risk_scores_select_scope
on analytics.risk_scores
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_risk_scores_manage_scope
on analytics.risk_scores
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
);

create policy analytics_forecasts_select_scope
on analytics.forecasts
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_forecasts_manage_scope
on analytics.forecasts
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'predictions.manage')
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('predictions', 'predictions', null, 'Access predictive intelligence dashboards.', true),
  ('predictions.student', 'predictions', 'student', 'View student predictive risk dashboards.', true),
  ('predictions.campus', 'predictions', 'campus', 'View campus predictive dashboards.', true),
  ('predictions.finance', 'predictions', 'finance', 'View finance predictive dashboards.', true),
  ('predictions.manage', 'predictions', 'manage', 'Manage prediction models and automated actions.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'predictions',
  'predictions.student',
  'predictions.campus',
  'predictions.finance',
  'predictions.manage'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'predictions',
  'predictions.student',
  'predictions.campus'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'predictions',
  'predictions.student'
)
where r.role_key in ('student', 'parent')
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
