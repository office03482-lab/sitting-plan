-- Foundational Supabase schema for the ERP platform.
-- Scope:
--   1. schools
--   2. profiles
--   3. school_memberships
--   4. roles
--   5. permissions
--
-- Design goals:
-- - Canonical identity via auth.users -> public.profiles
-- - Multi-school tenancy
-- - UUID primary keys
-- - Production-grade RLS foundation
-- - Future-ready RBAC

begin;

create extension if not exists pgcrypto;

-- Keep helper objects in public for broad accessibility from RLS policies.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  school_code text not null,
  slug text not null,
  name text not null,
  legal_name text,
  timezone text not null default 'Asia/Kolkata',
  country_code text not null default 'IN',
  contact_email text,
  contact_phone text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint schools_school_code_check check (char_length(trim(school_code)) >= 2),
  constraint schools_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists schools_school_code_key
  on public.schools (lower(school_code));

create unique index if not exists schools_slug_key
  on public.schools (lower(slug));

create index if not exists schools_is_active_idx
  on public.schools (is_active);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  display_name text,
  phone text,
  avatar_url text,
  default_school_id uuid references public.schools (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists profiles_email_key
  on public.profiles (lower(email))
  where email is not null;

create index if not exists profiles_default_school_id_idx
  on public.profiles (default_school_id);

create index if not exists profiles_is_active_idx
  on public.profiles (is_active);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  role_key text not null,
  role_name text not null,
  description text,
  scope text not null default 'school',
  is_system boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint roles_role_key_check check (role_key ~ '^[a-z][a-z0-9_]*$'),
  constraint roles_scope_check check (scope in ('system', 'school')),
  constraint roles_system_scope_consistency_check check (
    (is_system = true and school_id is null and scope = 'system')
    or
    (is_system = false and school_id is not null and scope = 'school')
  )
);

create unique index if not exists roles_system_role_key_key
  on public.roles (role_key)
  where school_id is null;

create unique index if not exists roles_school_role_key_key
  on public.roles (school_id, role_key)
  where school_id is not null;

create index if not exists roles_school_id_is_active_idx
  on public.roles (school_id, is_active);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null,
  module_key text not null,
  action_key text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint permissions_permission_key_check check (
    permission_key ~ '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$'
  ),
  constraint permissions_module_key_check check (module_key ~ '^[a-z][a-z0-9_]*$'),
  constraint permissions_action_key_check check (
    action_key is null or action_key ~ '^[a-z][a-z0-9_]*$'
  )
);

create unique index if not exists permissions_permission_key_key
  on public.permissions (permission_key);

create index if not exists permissions_module_key_is_active_idx
  on public.permissions (module_key, is_active);

create table if not exists public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  status text not null default 'active',
  is_primary boolean not null default false,
  is_active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  invited_at timestamptz,
  invited_by_profile_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint school_memberships_status_check check (
    status in ('invited', 'active', 'suspended', 'left')
  ),
  constraint school_memberships_unique_school_profile unique (school_id, profile_id)
);

create unique index if not exists school_memberships_one_primary_per_profile
  on public.school_memberships (profile_id)
  where is_primary = true and is_active = true;

create index if not exists school_memberships_school_id_is_active_idx
  on public.school_memberships (school_id, is_active);

create index if not exists school_memberships_profile_id_is_active_idx
  on public.school_memberships (profile_id, is_active);

create index if not exists school_memberships_role_id_idx
  on public.school_memberships (role_id);

create or replace function public.validate_school_membership_role()
returns trigger
language plpgsql
as $$
declare
  target_role public.roles%rowtype;
begin
  select *
  into target_role
  from public.roles
  where id = new.role_id;

  if not found then
    raise exception 'Role % does not exist.', new.role_id;
  end if;

  if target_role.is_active = false then
    raise exception 'Inactive roles cannot be assigned to memberships.';
  end if;

  if target_role.school_id is not null and target_role.school_id <> new.school_id then
    raise exception 'School membership role must belong to the same school.';
  end if;

  return new;
end;
$$;

create trigger set_updated_at_schools
before update on public.schools
for each row
execute function public.set_updated_at();

create trigger set_updated_at_profiles
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_updated_at_roles
before update on public.roles
for each row
execute function public.set_updated_at();

create trigger set_updated_at_permissions
before update on public.permissions
for each row
execute function public.set_updated_at();

create trigger set_updated_at_school_memberships
before update on public.school_memberships
for each row
execute function public.set_updated_at();

create trigger validate_school_membership_role
before insert or update on public.school_memberships
for each row
execute function public.validate_school_membership_role();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    display_name,
    phone,
    avatar_url
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    phone = coalesce(excluded.phone, public.profiles.phone),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.is_platform_admin()
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
      and r.role_key = 'platform_admin'
  );
$$;

create or replace function public.is_school_admin(target_school_id uuid)
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
      and sm.school_id = target_school_id
      and sm.is_active = true
      and sm.status = 'active'
      and r.is_active = true
      and r.role_key in ('platform_admin', 'school_admin')
  );
$$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.school_memberships enable row level security;

-- Schools: members can read their own tenant rows; only platform admins can mutate directly.
create policy schools_select_member_access
on public.schools
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.school_memberships sm
    where sm.school_id = schools.id
      and sm.profile_id = auth.uid()
      and sm.is_active = true
      and sm.status = 'active'
  )
);

create policy schools_insert_platform_admin_only
on public.schools
for insert
to authenticated
with check (public.is_platform_admin());

create policy schools_update_platform_admin_only
on public.schools
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy schools_delete_platform_admin_only
on public.schools
for delete
to authenticated
using (public.is_platform_admin());

-- Profiles: canonical self-owned identity rows.
create policy profiles_select_self_or_school_admin
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.school_memberships sm
    where sm.profile_id = profiles.id
      and public.is_school_admin(sm.school_id)
  )
);

create policy profiles_insert_self_only
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy profiles_update_self_or_platform_admin
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.is_platform_admin()
)
with check (
  id = auth.uid()
  or public.is_platform_admin()
);

-- Roles: readable by authenticated users; school admins may manage only school-scoped roles for their tenant.
create policy roles_select_authenticated
on public.roles
for select
to authenticated
using (
  is_active = true
  and (
    school_id is null
    or public.is_school_admin(school_id)
    or exists (
      select 1
      from public.school_memberships sm
      where sm.school_id = roles.school_id
        and sm.profile_id = auth.uid()
        and sm.is_active = true
        and sm.status = 'active'
    )
  )
);

create policy roles_insert_school_admin_custom_roles
on public.roles
for insert
to authenticated
with check (
  school_id is not null
  and is_system = false
  and scope = 'school'
  and public.is_school_admin(school_id)
);

create policy roles_update_school_admin_custom_roles
on public.roles
for update
to authenticated
using (
  school_id is not null
  and is_system = false
  and public.is_school_admin(school_id)
)
with check (
  school_id is not null
  and is_system = false
  and scope = 'school'
  and public.is_school_admin(school_id)
);

create policy roles_delete_school_admin_custom_roles
on public.roles
for delete
to authenticated
using (
  school_id is not null
  and is_system = false
  and public.is_school_admin(school_id)
);

-- Permissions: read-only catalog for authenticated users.
create policy permissions_select_authenticated
on public.permissions
for select
to authenticated
using (is_active = true);

-- Memberships: self-read plus school-admin management.
create policy school_memberships_select_self_or_school_admin
on public.school_memberships
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy school_memberships_insert_school_admin_only
on public.school_memberships
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy school_memberships_update_school_admin_only
on public.school_memberships
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

create policy school_memberships_delete_school_admin_only
on public.school_memberships
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
);

insert into public.roles (school_id, role_key, role_name, description, scope, is_system, is_active)
values
  (null, 'platform_admin', 'Platform Admin', 'Cross-tenant operator role for platform-level administration.', 'system', true, true),
  (null, 'school_admin', 'School Admin', 'Tenant administrator with full school-level control.', 'system', true, true),
  (null, 'teacher', 'Teacher', 'Teaching staff with timetable and attendance responsibilities.', 'system', true, true),
  (null, 'staff', 'Staff', 'Non-teaching operational staff role.', 'system', true, true),
  (null, 'store_manager', 'Store Manager', 'Inventory and stock management role.', 'system', true, true),
  (null, 'student', 'Student', 'Student self-service role.', 'system', true, true),
  (null, 'parent', 'Parent', 'Parent portal role.', 'system', true, true),
  (null, 'viewer', 'Viewer', 'Read-only ERP access role.', 'system', true, true)
on conflict do nothing;

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('admin_office', 'admin_office', null, 'Access the admin office workspace.', true),
  ('admin_office.seating_generation', 'admin_office', 'seating_generation', 'Generate seating plans.', true),
  ('admin_office.seating_plans', 'admin_office', 'seating_plans', 'Manage seating plans.', true),
  ('admin_office.seating_comparison', 'admin_office', 'seating_comparison', 'Compare seating plans.', true),
  ('admin_office.rooms', 'admin_office', 'rooms', 'Manage rooms.', true),
  ('admin_office.batches', 'admin_office', 'batches', 'Manage batches.', true),
  ('admin_office.students', 'admin_office', 'students', 'Manage students.', true),
  ('admin_office.hostels', 'admin_office', 'hostels', 'Manage hostels.', true),
  ('admin_office.teachers', 'admin_office', 'teachers', 'Manage teaching staff.', true),
  ('admin_office.invigilators', 'admin_office', 'invigilators', 'Manage invigilators.', true),
  ('admin_office.non_teaching', 'admin_office', 'non_teaching', 'Manage non-teaching staff.', true),
  ('admin_office.reports', 'admin_office', 'reports', 'Access admin office reports.', true),
  ('admin_office.access_control', 'admin_office', 'access_control', 'Manage access control.', true),
  ('timetable', 'timetable', null, 'Access timetable module.', true),
  ('timetable.view', 'timetable', 'view', 'View timetable data.', true),
  ('timetable.manage', 'timetable', 'manage', 'Manage timetable data.', true),
  ('attendance', 'attendance', null, 'Access attendance module.', true),
  ('attendance.overview', 'attendance', 'overview', 'View attendance overview.', true),
  ('attendance.student', 'attendance', 'student', 'Manage student attendance.', true),
  ('attendance.staff', 'attendance', 'staff', 'Manage staff attendance.', true),
  ('attendance.leaves', 'attendance', 'leaves', 'Manage leave workflows.', true),
  ('attendance.reports', 'attendance', 'reports', 'View attendance reports.', true),
  ('inventory', 'inventory', null, 'Access inventory module.', true),
  ('inventory.dashboard', 'inventory', 'dashboard', 'View inventory dashboard.', true),
  ('inventory.materials', 'inventory', 'materials', 'Manage material master.', true),
  ('inventory.suppliers', 'inventory', 'suppliers', 'Manage suppliers.', true),
  ('inventory.stock_in', 'inventory', 'stock_in', 'Record stock-in transactions.', true),
  ('inventory.stock_out', 'inventory', 'stock_out', 'Record stock-out transactions.', true),
  ('inventory.reports', 'inventory', 'reports', 'View inventory reports.', true),
  ('edupay', 'edupay', null, 'Access fee and payment module.', true),
  ('edupay.dashboard', 'edupay', 'dashboard', 'View EduPay dashboard.', true),
  ('edupay.students', 'edupay', 'students', 'Manage fee-linked student records.', true),
  ('edupay.fees', 'edupay', 'fees', 'Manage fee structures.', true),
  ('edupay.payments', 'edupay', 'payments', 'Track and verify payments.', true),
  ('edupay.parent_portal', 'edupay', 'parent_portal', 'Access parent portal data.', true),
  ('settings', 'settings', null, 'Manage school settings.', true)
on conflict (permission_key) do nothing;

commit;
