# PGRST205 ROOT CAUSE ANALYSIS

## Exact Failure Location

| Property | Value |
|----------|-------|
| **File** | `backend/app/services/school_self_service.py:528` |
| **Function** | `get_public_school_branding()` |
| **Query** | `_public_table("school_self_service_profiles").select("school_id,branding,domain_settings")` |
| **HTTP Route** | `GET /api/school-self-service/public-branding` |
| **Frontend Trigger** | `frontend/src/components/Layout.tsx:97` — `getPublicSchoolBranding()` on every page load |
| **Observed At** | `GET /bi/reports/export` page (and any page using Layout component) |

## Production Relation State

| Table | Schema Cache | Runtime Evidence |
|-------|-------------|-----------------|
| `school_self_service_profiles` | **NOT FOUND** — 404 PGRST205 | `GET /rest/v1/school_self_service_profiles` returns 404 |
| `school_brand_assets` | **NOT FOUND** — 404 PGRST205 | `GET /rest/v1/school_brand_assets` returns 404 |
| `school_backup_requests` | **NOT FOUND** — 404 PGRST205 | `GET /rest/v1/school_backup_requests` returns 404 |
| `schools` (control) | **EXISTS** | `GET /rest/v1/schools` returns 200 (1 row) |

## Migration Evidence

| Property | Value |
|----------|-------|
| Migration file | `supabase/migrations/20260703_068_school_self_service_branding.sql` |
| Version | 068 (unique — no collision) |
| Date | 2026-07-03 |
| Creates | 3 tables, 2 indexes, 3 triggers |
| Migration applied? | **NO** — confirmed via PostgREST (all 3 tables missing) |
| Automation | **NONE** — all migrations are manual (confirmed Phase 1.8) |
| Prior applied migrations | 069 was applied manually by user (reporting fix) |
| Why wasn't 068 applied? | 068 existed before 069. User applied 069 first because it was identified in Phase 1.8 as the reporting fix. Migration 068 was never called out. |

## Root Cause Classification

```
PRIMARY: 1. MISSING PRODUCTION MIGRATION
```

Detailed: Migration `20260703_068_school_self_service_branding.sql` was created during Phase 6 development but was NEVER run against the production Supabase database. The migration creates 3 tables that the school-self-service backend code depends on. Since no CI/CD or automation applies `supabase/migrations/*.sql` files, every migration requires manual execution via Supabase Dashboard SQL Editor. Migration 069 (reporting fix) was applied manually, but 068 (school self-service branding) was skipped.

**Eliminated root causes:**

| Cause | Status | Reason |
|-------|--------|--------|
| Stale backend table reference | ❌ | Backend code is correct — it references the right table name in the right schema |
| Wrong schema | ❌ | Table is in `public` schema, which is exposed via PostgREST |
| Table renamed | ❌ | No ALTER TABLE RENAME in any migration |
| Table dropped | ❌ | Was never created, so couldn't be dropped |
| PostgREST cache stale | ❌ | Table genuinely doesn't exist — cache reload won't help |
| Migration collision/skip | ❌ | Version 068 is unique; no collision at version 068 |
| Dead fallback path | ❌ | Code is active runtime code in Layout.tsx, not a fallback |

## Impact

- Every page using `Layout.tsx` fails to load school branding
- The `GET /api/school-self-service/*` endpoints all return HTTP 500 with PGRST205
- Only reproducible: apply migration 068 or suppress the error (latter not recommended)
- Affected users: school_admin users viewing any dashboard page

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|-----------|
| Data loss during table creation | LOW | `CREATE TABLE IF NOT EXISTS` — idempotent, zero data at risk |
| FK constraint failure | LOW | `schools` table exists (1 row), `profiles` table exists |
| Trigger function missing | LOW | `public.set_updated_at()` is used in other triggers — confirmed working |
| Missing GRANTs for service_role | LOW | Public schema tables are accessible to service_role by default (tested: `audit_logs` INSERT returned 409 FK error, NOT 42501) |
