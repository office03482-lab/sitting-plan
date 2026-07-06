# PGRST205 MINIMAL REPAIR PLAN

## Root Cause

Migration `20260703_068_school_self_service_branding.sql` was NEVER applied to production. Three tables are missing:
- `public.school_self_service_profiles`
- `public.school_brand_assets`
- `public.school_backup_requests`

## Repair Strategy

Apply the missing tables via a forward-only migration, then grant least privilege to service_role.

## Proposed Change

### Migration File

Create `supabase/migrations/20260706_070_apply_school_self_service_branding.sql`

This migration contains:
1. `CREATE TABLE IF NOT EXISTS` for all 3 tables (idempotent — safe if tables partially exist)
2. `CREATE INDEX IF NOT EXISTS` for 2 indexes
3. `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` for 3 triggers
4. `GRANT` statements for service_role (least privilege per table operation)

### GRANT Analysis

Based on backend code in `school_self_service.py`:

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `school_self_service_profiles` | ✅ (lines 139, 528) | ✅ (line 150) | ✅ (line 343) | ❌ |
| `school_brand_assets` | ✅ (line 219) | ✅ (line 425) | ❌ | ❌ |
| `school_backup_requests` | ✅ (line 243) | ✅ (lines 480, 501) | ❌ | ❌ |

### SQL to Execute

```sql
-- ===== TABLE 1: school_self_service_profiles =====
CREATE TABLE IF NOT EXISTS public.school_self_service_profiles (
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
CREATE TABLE IF NOT EXISTS public.school_brand_assets (
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
    asset_type in ('logo','banner','favicon','principal_signature','official_seal','report_card_header','certificate_header','background_image','document')
  )
);

-- ===== TABLE 3: school_backup_requests =====
CREATE TABLE IF NOT EXISTS public.school_backup_requests (
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
GRANT SELECT, INSERT, UPDATE ON TABLE public.school_self_service_profiles TO service_role;
GRANT SELECT, INSERT ON TABLE public.school_brand_assets TO service_role;
GRANT SELECT, INSERT ON TABLE public.school_backup_requests TO service_role;
```

### Safety Verifications

| Check | Status | Evidence |
|-------|--------|----------|
| Version collision | ✅ NONE | Only 1 file with "070" |
| FK `schools.id` exists | ✅ CONFIRMED | Runtime: schools table exists (1 row) |
| FK `profiles.id` exists | ✅ CONFIRMED | Runtime: profiles table accessible |
| `set_updated_at()` function exists | ✅ CONFIRMED | Used in multiple existing migrations |
| Table already exists | ✅ No conflict | CREATE IF NOT EXISTS is idempotent |
| service_role default privileges | ✅ WORKS | Tested: INSERT on audit_logs returned 409 (FK error), NOT 42501 |

### Rollback

```sql
DROP TABLE IF EXISTS public.school_backup_requests CASCADE;
DROP TABLE IF EXISTS public.school_brand_assets CASCADE;
DROP TABLE IF EXISTS public.school_self_service_profiles CASCADE;
```

## Regression Risk

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FK constraint failure on existing data | LOW | Data integrity | Tables are new — no existing data |
| Trigger conflict with existing triggers | LOW | Trigger failure | DROP IF EXISTS before CREATE |
| Index name collision | LOW | Build failure | IF NOT EXISTS on indexes |
| service_role privilege escalation | NONE | Security | Only SELECT, INSERT, UPDATE granted — no DELETE, no ALL |
| Frontend branding error handling | LOW | UX | Layout.tsx catch block already handles error (sets null) — no regression |
