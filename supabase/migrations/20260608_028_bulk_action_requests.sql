begin;

create schema if not exists workflow;

create table if not exists workflow.bulk_action_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  module_name text not null,
  action_type text not null,
  requested_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  requested_role text not null,
  reason text,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  approved_by_profile_id uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by_profile_id uuid references public.profiles (id) on delete set null,
  rejected_at timestamptz,
  cancelled_by_profile_id uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  executed_by_profile_id uuid references public.profiles (id) on delete set null,
  executed_at timestamptz,
  execution_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bulk_action_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled', 'executed')
  ),
  constraint bulk_action_requests_action_type_check check (
    action_type in ('delete_all', 'bulk_delete', 'purge_data', 'reset_data', 'mass_remove')
  )
);

create index if not exists bulk_action_requests_school_status_idx
  on workflow.bulk_action_requests (school_id, status, created_at desc);

create index if not exists bulk_action_requests_module_status_idx
  on workflow.bulk_action_requests (module_name, status, created_at desc);

create index if not exists bulk_action_requests_requester_idx
  on workflow.bulk_action_requests (requested_by_profile_id, created_at desc);

create table if not exists workflow.bulk_action_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references workflow.bulk_action_requests (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint bulk_action_events_type_check check (
    event_type in ('created', 'approved', 'rejected', 'cancelled', 'execution_started', 'executed', 'execution_failed')
  )
);

create index if not exists bulk_action_events_request_created_idx
  on workflow.bulk_action_events (request_id, created_at asc);

create trigger set_updated_at_bulk_action_requests
before update on workflow.bulk_action_requests
for each row
execute function public.set_updated_at();

alter table workflow.bulk_action_requests enable row level security;
alter table workflow.bulk_action_events enable row level security;

create policy bulk_action_requests_select_scope
on workflow.bulk_action_requests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy bulk_action_requests_insert_scope
on workflow.bulk_action_requests
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy bulk_action_requests_update_platform_admin_or_requester
on workflow.bulk_action_requests
for update
to authenticated
using (
  public.is_platform_admin()
  or (
    status = 'pending'
    and requested_by_profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or (
    status = 'cancelled'
    and requested_by_profile_id = auth.uid()
  )
);

create policy bulk_action_events_select_scope
on workflow.bulk_action_events
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy bulk_action_events_insert_platform_admin_only
on workflow.bulk_action_events
for insert
to authenticated
with check (
  public.is_platform_admin()
);

commit;
