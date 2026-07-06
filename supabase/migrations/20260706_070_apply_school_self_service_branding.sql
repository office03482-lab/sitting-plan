begin;

-- ======================================================================
-- Migration 070: Apply school self-service branding tables
-- 
-- Root cause: Migration 068 (20260703) was never applied to production.
-- All 3 tables (school_self_service_profiles, school_brand_assets,
-- school_backup_requests) are missing, causing PGRST205 on all
-- school-self-service API endpoints.
-- 
-- Uses CREATE TABLE IF NOT EXISTS for idempotency.
-- Includes least-privilege GRANTs for service_role.
-- ======================================================================

-- ===== TABLE 1: school_self_service_profiles =====
create table if not exists public.school_self_service_profiles (
  school_id uuid primary key references public.schools (id) on delete cascade,
  branding jsonb not null default '{}'::jsonb,
  portal_settings jsonb not null default '{}'::jsonb,
  domain_settings jsonb not null default '{}'::jsonb,
  email_templates jsonb not null default '{}'::jsonb,
  messaging_templates jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ===== TABLE 2: school_brand_assets =====
create table if not exists public.school_brand_assets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  asset_type text not null,
  file_name text not null,
  bucket text not null,
  storage_path text not null,
  public_url text not null,
  content_type text,
  size_bytes bigint not null default 0,
  uploaded_by uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint school_brand_assets_type_check check (
    asset_type in (
      'logo',
      'banner',
      'favicon',
      'principal_signature',
      'official_seal',
      'report_card_header',
      'certificate_header',
      'background_image',
      'document'
    )
  )
);

-- ===== TABLE 3: school_backup_requests =====
create table if not exists public.school_backup_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  request_type text not null,
  status text not null default 'requested',
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  download_url text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint school_backup_requests_type_check check (request_type in ('backup', 'restore')),
  constraint school_backup_requests_status_check check (
    status in ('requested', 'processing', 'download_ready', 'completed', 'rejected')
  )
);

-- ===== INDEXES =====
create index if not exists school_brand_assets_school_type_idx
  on public.school_brand_assets (school_id, asset_type, created_at desc);

create index if not exists school_backup_requests_school_type_idx
  on public.school_backup_requests (school_id, request_type, created_at desc);

-- ===== TRIGGERS =====
drop trigger if exists set_updated_at_school_self_service_profiles on public.school_self_service_profiles;
create trigger set_updated_at_school_self_service_profiles
  before update on public.school_self_service_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_school_brand_assets on public.school_brand_assets;
create trigger set_updated_at_school_brand_assets
  before update on public.school_brand_assets
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_school_backup_requests on public.school_backup_requests;
create trigger set_updated_at_school_backup_requests
  before update on public.school_backup_requests
  for each row execute function public.set_updated_at();

-- ===== SERVICE_ROLE PRIVILEGES (least privilege) =====
grant select, insert, update on table public.school_self_service_profiles to service_role;
grant select, insert on table public.school_brand_assets to service_role;
grant select, insert on table public.school_backup_requests to service_role;

commit;
