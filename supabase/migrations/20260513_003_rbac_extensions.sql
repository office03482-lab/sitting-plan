begin;

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (role_id, permission_id)
);

create index if not exists role_permissions_role_id_idx
  on public.role_permissions (role_id);

create index if not exists role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

alter table public.role_permissions enable row level security;

create or replace function public.current_school_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select sm.school_id
  from public.school_memberships sm
  where sm.profile_id = auth.uid()
    and sm.is_active = true
    and sm.status = 'active';
$$;

create or replace function public.has_role(target_school_id uuid, target_role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_memberships sm
    join public.roles r on r.id = sm.role_id
    where sm.profile_id = auth.uid()
      and sm.is_active = true
      and sm.status = 'active'
      and r.is_active = true
      and r.role_key = target_role_key
      and (
        r.is_system = true
        or sm.school_id = target_school_id
      )
      and (
        target_school_id is null
        or sm.school_id = target_school_id
        or r.role_key = 'platform_admin'
      )
  );
$$;

create or replace function public.has_permission(target_school_id uuid, target_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_memberships sm
    join public.roles r on r.id = sm.role_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where sm.profile_id = auth.uid()
      and sm.is_active = true
      and sm.status = 'active'
      and r.is_active = true
      and p.is_active = true
      and p.permission_key = target_permission_key
      and (
        sm.school_id = target_school_id
        or r.role_key = 'platform_admin'
      )
  );
$$;

create policy role_permissions_select_scope
on public.role_permissions
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.roles r
    where r.id = role_permissions.role_id
      and (
        r.school_id is null
        or public.same_school_membership(r.school_id)
      )
  )
);

create policy role_permissions_insert_admin_only
on public.role_permissions
for insert
to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.roles r
    where r.id = role_permissions.role_id
      and r.school_id is not null
      and public.is_school_admin(r.school_id)
  )
);

create policy role_permissions_update_admin_only
on public.role_permissions
for update
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.roles r
    where r.id = role_permissions.role_id
      and r.school_id is not null
      and public.is_school_admin(r.school_id)
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.roles r
    where r.id = role_permissions.role_id
      and r.school_id is not null
      and public.is_school_admin(r.school_id)
  )
);

create policy role_permissions_delete_admin_only
on public.role_permissions
for delete
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.roles r
    where r.id = role_permissions.role_id
      and r.school_id is not null
      and public.is_school_admin(r.school_id)
  )
);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on true
where r.role_key = 'platform_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on true
where r.role_key = 'school_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'timetable',
  'timetable.view',
  'timetable.manage',
  'attendance',
  'attendance.overview',
  'attendance.student',
  'attendance.staff',
  'attendance.leaves',
  'attendance.reports',
  'admin_office',
  'admin_office.students',
  'admin_office.teachers',
  'admin_office.rooms',
  'admin_office.batches'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'inventory',
  'inventory.dashboard',
  'inventory.materials',
  'inventory.suppliers',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.reports'
)
where r.role_key = 'store_manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'attendance',
  'attendance.overview',
  'edupay',
  'edupay.parent_portal'
)
where r.role_key = 'parent'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'attendance',
  'attendance.overview'
)
where r.role_key = 'student'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'admin_office',
  'admin_office.reports',
  'attendance',
  'attendance.overview',
  'inventory',
  'inventory.dashboard',
  'edupay',
  'edupay.dashboard'
)
where r.role_key = 'viewer'
on conflict do nothing;

commit;
