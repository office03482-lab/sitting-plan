# SELF-SERVICE PROFILE MIGRATION TRACE

## Migration That Creates the Table

| Property | Value |
|----------|-------|
| **Filename** | `20260703_068_school_self_service_branding.sql` |
| **Version** | 068 |
| **Date** | 2026-07-03 |
| **SQL Action** | `CREATE TABLE IF NOT EXISTS` for 3 tables, 2 indexes, 3 triggers |
| **Dependencies** | `public.schools` (FK), `public.profiles` (FK), `public.set_updated_at()` function |
| **Version Collision** | **NONE** — only one file with "068" |
| **Down Migration** | **NONE** — no `_down.sql` for this version |

## Components of Migration 068

### Table 1: `public.school_self_service_profiles`
- 15 columns (school_id PK, 7 JSONB config fields, metadata, 2 profile refs, 2 timestamps)
- FK: `school_id → public.schools(id) ON DELETE CASCADE`
- FK: `created_by → public.profiles(id) ON DELETE SET NULL`
- FK: `updated_by → public.profiles(id) ON DELETE SET NULL`
- Trigger: `set_updated_at_school_self_service_profiles` (BEFORE UPDATE)

### Table 2: `public.school_brand_assets`
- 14 columns (id PK, asset_type, file_name, bucket, storage_path, public_url, etc.)
- FK: `school_id → public.schools(id) ON DELETE CASCADE`
- FK: `uploaded_by → public.profiles(id) ON DELETE SET NULL`
- CHECK constraint: `asset_type IN ('logo','banner','favicon','principal_signature','official_seal','report_card_header','certificate_header','background_image','document')`
- Trigger: `set_updated_at_school_brand_assets` (BEFORE UPDATE)

### Table 3: `public.school_backup_requests`
- 11 columns (id PK, request_type, status, requested_by, reviewed_by, download_url, etc.)
- FK: `school_id → public.schools(id) ON DELETE CASCADE`
- FK: `requested_by → public.profiles(id) ON DELETE SET NULL`
- FK: `reviewed_by → public.profiles(id) ON DELETE SET NULL`
- CHECK constraint: `request_type IN ('backup', 'restore')`
- CHECK constraint: `status IN ('requested','processing','download_ready','completed','rejected')`
- Trigger: `set_updated_at_school_backup_requests` (BEFORE UPDATE)

### Indexes
- `school_brand_assets_school_type_idx` ON `school_brand_assets (school_id, asset_type, created_at DESC)`
- `school_backup_requests_school_type_idx` ON `school_backup_requests (school_id, request_type, created_at DESC)`

## Classification

| Question | Answer |
|----------|--------|
| A. Migration creates the table? | **YES** — version 068 |
| B. Creates it in another schema? | **NO** — `public.school_self_service_profiles` |
| C. Renamed? | **NO** — no ALTER TABLE RENAME anywhere in migrations |
| D. Dropped? | **NO** — no DROP TABLE for this name |
| E. Backend references but no migration? | **NO** — migration exists (`20260703_068`) |
| F. Production missed existing migration? | **YES** — this is the root cause |

## Migration Application Check

| Check | Result | Evidence |
|-------|--------|----------|
| Version 068 applied? | **NOT VERIFIED at DB level** | `supabase_migrations.schema_migrations` table does NOT exist in production (confirmed Phase 1.8) |
| Tables exist in production? | **NO** | Runtime `GET /rest/v1/school_self_service_profiles` returns 404 PGRST205 |
| Automation applies migrations? | **NO** | Confirmed Phase 1.8 — no CI/CD, no `supabase db push`, no alembic target for Supabase |
| When can 068 be applied? | **Manual** via Supabase Dashboard SQL Editor | Same procedure as migration 069 (reporting fix) |

## GRANT Analysis

Migration 068 contains **ZERO GRANT statements**. However, this is consistent with other public schema tables:

| Table | In Migration 068? | service_role Access at Runtime |
|-------|------------------|-------------------------------|
| `school_self_service_profiles` | No GRANT | Not testable (table missing) |
| `school_brand_assets` | No GRANT | Not testable (table missing) |
| `school_backup_requests` | No GRANT | Not testable (table missing) |
| `schools` (control) | Created in 001, no GRANT | ✓ SELECT/INSERT work |
| `audit_logs` (control) | Created in migration, no GRANT | ✓ INSERT works (tested: 409 Conflict on FK, not 42501) |

**Conclusion**: Public schema tables in Supabase are accessible to service_role without explicit GRANTs. The INSERT test on `audit_logs` returned 409 (foreign key violation), NOT 42501 (permission denied), confirming service_role has INSERT privilege.
