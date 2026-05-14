begin;

create schema if not exists hostel;
create schema if not exists reporting;

create table if not exists hostel.hostels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  hostel_code text not null,
  name text not null,
  hostel_head text,
  warden_name text,
  gender_category text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists hostels_school_hostel_code_key
  on hostel.hostels (school_id, lower(hostel_code));

create table if not exists hostel.hostel_rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  hostel_id uuid not null references hostel.hostels (id) on delete cascade,
  room_number text not null,
  total_beds integer not null default 1,
  occupied_beds integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint hostel_rooms_total_beds_check check (total_beds > 0),
  constraint hostel_rooms_occupied_beds_check check (occupied_beds >= 0 and occupied_beds <= total_beds),
  unique (hostel_id, room_number)
);

create table if not exists hostel.hostel_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  hostel_id uuid not null references hostel.hostels (id) on delete cascade,
  preferred_room_id uuid references hostel.hostel_rooms (id) on delete set null,
  requested_notes text,
  status text not null default 'pending',
  review_notes text,
  reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint hostel_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  )
);

create index if not exists hostel_requests_school_student_status_idx
  on hostel.hostel_requests (school_id, student_id, status);

create table if not exists hostel.hostel_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  hostel_id uuid not null references hostel.hostels (id) on delete cascade,
  hostel_room_id uuid references hostel.hostel_rooms (id) on delete set null,
  bed_label text,
  allocation_status text not null default 'active',
  start_date date not null default current_date,
  end_date date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint hostel_allocations_status_check check (
    allocation_status in ('active', 'moved', 'released', 'completed')
  )
);

create unique index if not exists hostel_allocations_active_student_key
  on hostel.hostel_allocations (student_id)
  where is_active = true and allocation_status = 'active';

create table if not exists reporting.generated_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  requested_by_profile_id uuid references public.profiles (id) on delete set null,
  module_key text not null,
  report_key text not null,
  export_format text not null,
  storage_bucket text,
  storage_path text,
  status text not null default 'queued',
  filters jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint generated_reports_status_check check (
    status in ('queued', 'processing', 'completed', 'failed', 'expired')
  ),
  constraint generated_reports_export_format_check check (
    export_format in ('pdf', 'xlsx', 'csv', 'json')
  )
);

create index if not exists generated_reports_school_module_status_idx
  on reporting.generated_reports (school_id, module_key, status);

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

create trigger set_updated_at_hostels
before update on hostel.hostels
for each row
execute function public.set_updated_at();

create trigger set_updated_at_hostel_rooms
before update on hostel.hostel_rooms
for each row
execute function public.set_updated_at();

create trigger set_updated_at_hostel_requests
before update on hostel.hostel_requests
for each row
execute function public.set_updated_at();

create trigger set_updated_at_hostel_allocations
before update on hostel.hostel_allocations
for each row
execute function public.set_updated_at();

create trigger set_updated_at_generated_reports
before update on reporting.generated_reports
for each row
execute function public.set_updated_at();

alter table hostel.hostels enable row level security;
alter table hostel.hostel_rooms enable row level security;
alter table hostel.hostel_requests enable row level security;
alter table hostel.hostel_allocations enable row level security;
alter table reporting.generated_reports enable row level security;
alter table public.audit_logs enable row level security;

create policy hostels_scope
on hostel.hostels
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
);

create policy hostel_rooms_scope
on hostel.hostel_rooms
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
);

create policy hostel_requests_select_scope
on hostel.hostel_requests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.students s
    where s.id = hostel_requests.student_id
      and s.profile_id = auth.uid()
  )
);

create policy hostel_requests_manage_scope
on hostel.hostel_requests
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
  or exists (
    select 1 from public.students s
    where s.id = hostel_requests.student_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
  or exists (
    select 1 from public.students s
    where s.id = hostel_requests.student_id
      and s.profile_id = auth.uid()
  )
);

create policy hostel_allocations_select_scope
on hostel.hostel_allocations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.students s
    where s.id = hostel_allocations.student_id
      and s.profile_id = auth.uid()
  )
);

create policy hostel_allocations_manage_scope
on hostel.hostel_allocations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'admin_office.hostels')
);

create policy generated_reports_select_scope
on reporting.generated_reports
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or requested_by_profile_id = auth.uid()
);

create policy generated_reports_manage_scope
on reporting.generated_reports
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or requested_by_profile_id = auth.uid()
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or requested_by_profile_id = auth.uid()
);

create policy audit_logs_select_scope
on public.audit_logs
for select
to authenticated
using (
  public.is_platform_admin()
  or (school_id is not null and public.same_school_membership(school_id))
  or profile_id = auth.uid()
);

create policy audit_logs_insert_scope
on public.audit_logs
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and (
    school_id is null
    or public.same_school_membership(school_id)
    or public.is_platform_admin()
  )
);

commit;
