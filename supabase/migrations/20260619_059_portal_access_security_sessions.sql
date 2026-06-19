begin;

-- Create schema for session tracking tables
create schema if not exists sessions;

create table if not exists sessions.active_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school_id uuid references public.schools (id) on delete cascade,
  membership_id uuid references public.school_memberships (id) on delete set null,
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
  on sessions.active_sessions (session_key);

create index if not exists active_sessions_profile_role_active_idx
  on sessions.active_sessions (profile_id, role_key, is_active, last_activity desc);

create index if not exists active_sessions_school_role_active_idx
  on sessions.active_sessions (school_id, role_key, is_active, login_time desc);

create trigger set_updated_at_sessions_active_sessions
before update on sessions.active_sessions
for each row execute function public.set_updated_at();

create table if not exists sessions.test_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  test_id uuid not null,
  attempt_id uuid,
  student_id uuid not null references public.students (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  active_session_id uuid references sessions.active_sessions (id) on delete set null,
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
  on sessions.test_sessions (student_id, test_id, is_active, last_activity desc);

create index if not exists test_sessions_attempt_idx
  on sessions.test_sessions (attempt_id);

create trigger set_updated_at_sessions_test_sessions
before update on sessions.test_sessions
for each row execute function public.set_updated_at();

commit;
