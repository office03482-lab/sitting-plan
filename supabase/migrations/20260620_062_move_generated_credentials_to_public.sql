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

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'security' and table_name = 'generated_credentials'
  ) then
    insert into public.generated_credentials (
      id,
      school_id,
      profile_id,
      entity_type,
      entity_id,
      role_key,
      entity_name,
      username,
      login_email,
      temporary_password,
      created_by,
      viewed,
      expires_at,
      created_at,
      updated_at
    )
    select
      id,
      school_id,
      profile_id,
      entity_type,
      entity_id,
      role_key,
      entity_name,
      username,
      login_email,
      temporary_password,
      created_by,
      viewed,
      expires_at,
      created_at,
      updated_at
    from security.generated_credentials
    on conflict (id) do update
    set
      school_id = excluded.school_id,
      profile_id = excluded.profile_id,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id,
      role_key = excluded.role_key,
      entity_name = excluded.entity_name,
      username = excluded.username,
      login_email = excluded.login_email,
      temporary_password = excluded.temporary_password,
      created_by = excluded.created_by,
      viewed = excluded.viewed,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;

    drop table security.generated_credentials;
  end if;
end $$;

create index if not exists generated_credentials_school_profile_created_idx
  on public.generated_credentials (school_id, profile_id, created_at desc);

create index if not exists generated_credentials_school_created_by_idx
  on public.generated_credentials (school_id, created_by, created_at desc);

create index if not exists generated_credentials_expires_at_idx
  on public.generated_credentials (expires_at);

drop trigger if exists set_updated_at_generated_credentials on public.generated_credentials;
create trigger set_updated_at_generated_credentials
before update on public.generated_credentials
for each row execute function public.set_updated_at();

commit;
