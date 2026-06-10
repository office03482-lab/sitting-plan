begin;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  module_key text,
  entity_table text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_logs_school_module_created_idx
  on public.audit_logs (school_id, module_key, created_at desc);

create index if not exists audit_logs_profile_created_idx
  on public.audit_logs (profile_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_scope on public.audit_logs;
create policy audit_logs_select_scope
on public.audit_logs
for select
to authenticated
using (
  public.is_platform_admin()
  or (school_id is not null and public.same_school_membership(school_id))
  or profile_id = auth.uid()
);

drop policy if exists audit_logs_insert_scope on public.audit_logs;
create policy audit_logs_insert_scope
on public.audit_logs
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and (
    school_id is null
    or public.is_platform_admin()
    or public.same_school_membership(school_id)
  )
);

notify pgrst, 'reload schema';

commit;
