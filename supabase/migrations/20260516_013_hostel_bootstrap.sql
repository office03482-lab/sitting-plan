begin;

create schema if not exists hostel;

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

alter table hostel.hostels
  add column if not exists hostel_code text,
  add column if not exists hostel_head text,
  add column if not exists warden_name text,
  add column if not exists gender_category text,
  add column if not exists address text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table hostel.hostel_rooms
  add column if not exists school_id uuid references public.schools (id) on delete cascade,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table hostel.hostel_requests
  add column if not exists school_id uuid references public.schools (id) on delete cascade,
  add column if not exists preferred_room_id uuid references hostel.hostel_rooms (id) on delete set null,
  add column if not exists requested_notes text,
  add column if not exists review_notes text,
  add column if not exists reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table hostel.hostel_allocations
  add column if not exists school_id uuid references public.schools (id) on delete cascade,
  add column if not exists hostel_room_id uuid references hostel.hostel_rooms (id) on delete set null,
  add column if not exists bed_label text,
  add column if not exists allocation_status text not null default 'active',
  add column if not exists start_date date not null default current_date,
  add column if not exists end_date date,
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update hostel.hostels
set hostel_code = upper(regexp_replace(coalesce(name, 'HOSTEL'), '[^A-Za-z0-9]+', '_', 'g'))
where hostel_code is null or btrim(hostel_code) = '';

update hostel.hostel_rooms
set school_id = hostels.school_id
from hostel.hostels
where hostel_rooms.hostel_id = hostels.id
  and hostel_rooms.school_id is null;

update hostel.hostel_requests
set school_id = students.school_id
from public.students
where hostel_requests.student_id = students.id
  and hostel_requests.school_id is null;

update hostel.hostel_allocations
set school_id = students.school_id
from public.students
where hostel_allocations.student_id = students.id
  and hostel_allocations.school_id is null;

alter table hostel.hostels
  alter column hostel_code set not null;

alter table hostel.hostel_rooms
  alter column school_id set not null;

alter table hostel.hostel_requests
  alter column school_id set not null;

alter table hostel.hostel_allocations
  alter column school_id set not null;

create unique index if not exists hostels_school_hostel_code_key
  on hostel.hostels (school_id, lower(hostel_code));

create index if not exists hostels_school_active_idx
  on hostel.hostels (school_id, is_active);

create unique index if not exists hostel_rooms_hostel_room_number_key
  on hostel.hostel_rooms (hostel_id, lower(room_number));

create index if not exists hostel_rooms_school_hostel_active_idx
  on hostel.hostel_rooms (school_id, hostel_id, is_active);

create index if not exists hostel_requests_school_student_status_idx
  on hostel.hostel_requests (school_id, student_id, status);

create index if not exists hostel_requests_school_hostel_status_idx
  on hostel.hostel_requests (school_id, hostel_id, status);

create index if not exists hostel_requests_school_room_status_idx
  on hostel.hostel_requests (school_id, preferred_room_id, status);

create unique index if not exists hostel_allocations_active_student_key
  on hostel.hostel_allocations (student_id)
  where is_active = true and allocation_status = 'active';

create index if not exists hostel_allocations_school_hostel_room_status_idx
  on hostel.hostel_allocations (school_id, hostel_id, hostel_room_id, allocation_status);

create index if not exists hostel_allocations_school_student_status_idx
  on hostel.hostel_allocations (school_id, student_id, allocation_status);

create or replace function hostel.recalculate_hostel_room_occupancy(
  p_school_id uuid,
  p_room_id uuid default null
)
returns void
language sql
as $$
  update hostel.hostel_rooms as room
  set occupied_beds = coalesce(active_allocations.active_count, 0)
  from (
    select scope.id
    from hostel.hostel_rooms scope
    where scope.school_id = p_school_id
      and (p_room_id is null or scope.id = p_room_id)
  ) as scoped_rooms
  left join (
    select hostel_room_id, count(*)::integer as active_count
    from hostel.hostel_allocations
    where school_id = p_school_id
      and hostel_room_id is not null
      and is_active = true
      and allocation_status = 'active'
      and (p_room_id is null or hostel_room_id = p_room_id)
    group by hostel_room_id
  ) as active_allocations
    on active_allocations.hostel_room_id = scoped_rooms.id
  where room.id = scoped_rooms.id;
$$;

create or replace function hostel.sync_room_occupancy_on_allocation_change()
returns trigger
language plpgsql
as $$
declare
  v_school_id uuid;
  v_new_room_id uuid;
  v_old_room_id uuid;
begin
  v_school_id := coalesce(new.school_id, old.school_id);
  v_new_room_id := new.hostel_room_id;
  v_old_room_id := old.hostel_room_id;

  if v_school_id is not null and v_old_room_id is not null then
    perform hostel.recalculate_hostel_room_occupancy(v_school_id, v_old_room_id);
  end if;

  if v_school_id is not null and v_new_room_id is not null and v_new_room_id is distinct from v_old_room_id then
    perform hostel.recalculate_hostel_room_occupancy(v_school_id, v_new_room_id);
  end if;

  return coalesce(new, old);
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_hostels'
  ) then
    create trigger set_updated_at_hostels
    before update on hostel.hostels
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_hostel_rooms'
  ) then
    create trigger set_updated_at_hostel_rooms
    before update on hostel.hostel_rooms
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_hostel_requests'
  ) then
    create trigger set_updated_at_hostel_requests
    before update on hostel.hostel_requests
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_hostel_allocations'
  ) then
    create trigger set_updated_at_hostel_allocations
    before update on hostel.hostel_allocations
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'recalculate_occupancy_after_hostel_allocation_change'
  ) then
    create trigger recalculate_occupancy_after_hostel_allocation_change
    after insert or update or delete on hostel.hostel_allocations
    for each row
    execute function hostel.sync_room_occupancy_on_allocation_change();
  end if;
end $$;

alter table hostel.hostels enable row level security;
alter table hostel.hostel_rooms enable row level security;
alter table hostel.hostel_requests enable row level security;
alter table hostel.hostel_allocations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostels' and policyname = 'hostels_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostel_rooms' and policyname = 'hostel_rooms_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostel_requests' and policyname = 'hostel_requests_select_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostel_requests' and policyname = 'hostel_requests_manage_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostel_allocations' and policyname = 'hostel_allocations_select_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'hostel' and tablename = 'hostel_allocations' and policyname = 'hostel_allocations_manage_scope'
  ) then
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
  end if;
end $$;

grant usage on schema hostel to authenticated;

grant select, insert, update, delete on hostel.hostels to authenticated;
grant select, insert, update, delete on hostel.hostel_rooms to authenticated;
grant select, insert, update, delete on hostel.hostel_requests to authenticated;
grant select, insert, update, delete on hostel.hostel_allocations to authenticated;

grant execute on function hostel.recalculate_hostel_room_occupancy(uuid, uuid) to authenticated;
grant execute on function hostel.sync_room_occupancy_on_allocation_change() to authenticated;

commit;
