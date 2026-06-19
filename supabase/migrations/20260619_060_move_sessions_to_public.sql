begin;

-- Drop objects in sessions schema and move to public
drop table if exists sessions.test_sessions;
drop table if exists sessions.active_sessions;
drop schema if exists sessions;

-- Public schema tables (public is always exposed in Supabase API)
create table if not exists public.active_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  profile_id uuid not null,
  school_id uuid,
  membership_id uuid,
  role_key text not null,
  device_id text not null,
  device_name text,
  browser text,
  ip_address text,
  session_key text not null,
  session_scope text not null default 'portal',
  login_time timestamptz not null default timezone('utc', now()),
  last_activity timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  ended_at timestamptz,
  ended_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists active_sessions_session_key_key
  on public.active_sessions (session_key);

create index if not exists active_sessions_profile_role_active_idx
  on public.active_sessions (profile_id, role_key, is_active, last_activity desc);

create index if not exists active_sessions_school_role_active_idx
  on public.active_sessions (school_id, role_key, is_active, login_time desc);

create trigger set_updated_at_active_sessions
before update on public.active_sessions
for each row execute function public.set_updated_at();

create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  test_id uuid not null,
  attempt_id uuid,
  student_id uuid not null,
  profile_id uuid not null,
  active_session_id uuid references public.active_sessions (id) on delete set null,
  device_id text,
  session_key text,
  is_active boolean not null default true,
  started_at timestamptz not null default timezone('utc', now()),
  last_activity timestamptz not null default timezone('utc', now()),
  terminated_at timestamptz,
  terminated_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists test_sessions_student_test_active_idx
  on public.test_sessions (student_id, test_id, is_active, last_activity desc);

create index if not exists test_sessions_attempt_idx
  on public.test_sessions (attempt_id);

create trigger set_updated_at_test_sessions
before update on public.test_sessions
for each row execute function public.set_updated_at();

commit;
