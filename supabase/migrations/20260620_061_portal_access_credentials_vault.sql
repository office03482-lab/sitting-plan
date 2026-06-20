begin;

create table if not exists public.generated_credentials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  role_key text not null,
  entity_name text,
  username text not null,
  login_email text,
  temporary_password text not null,
  created_by uuid references public.profiles (id) on delete set null,
  viewed boolean not null default false,
  expires_at timestamptz not null default timezone('utc', now()) + interval '7 days',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists generated_credentials_school_profile_created_idx
  on public.generated_credentials (school_id, profile_id, created_at desc);

create index if not exists generated_credentials_school_created_by_idx
  on public.generated_credentials (school_id, created_by, created_at desc);

create index if not exists generated_credentials_expires_at_idx
  on public.generated_credentials (expires_at);

create trigger set_updated_at_generated_credentials
before update on public.generated_credentials
for each row execute function public.set_updated_at();

commit;
