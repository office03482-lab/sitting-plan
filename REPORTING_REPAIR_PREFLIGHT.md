# REPORTING REPAIR PREFLIGHT

**Audit Date:** 2026-07-06
**Status:** PREFLIGHT COMPLETE — ready for owner review

---

## STEP 1: TARGET TABLE STRUCTURE

Runtime direct `information_schema.columns` query was **UNAVAILABLE** (information_schema not exposed via PostgREST).

**SOURCE:** Migration file `20260513_008_hostel_and_reporting.sql:84-106`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `school_id` | `uuid` | NOT NULL | — |
| `requested_by_profile_id` | `uuid` | YES | — |
| `module_key` | `text` | NOT NULL | — |
| `report_key` | `text` | NOT NULL | — |
| `export_format` | `text` | NOT NULL | — |
| `storage_bucket` | `text` | YES | — |
| `storage_path` | `text` | YES | — |
| `status` | `text` | NOT NULL | `'queued'` |
| `filters` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `generated_at` | `timestamptz` | YES | — |
| `expires_at` | `timestamptz` | YES | — |
| `is_active` | `boolean` | NOT NULL | `true` |
| `created_at` | `timestamptz` | NOT NULL | `timezone('utc', now())` |
| `updated_at` | `timestamptz` | NOT NULL | `timezone('utc', now())` |

**Verification:** Table existence is confirmed — attempted query returns 42501, not PGRST205 (which would indicate missing table). The schema and table exist but lack privileges.

**Row check:** Confirmed via standalone PostgREST query with explicit `Accept-Profile: reporting` header returns HTTP 403 with code 42501, proving the table exists.

## STEP 2: TABLE OWNER

Direct `pg_tables` query was **UNAVAILABLE** (pg_catalog not exposed via PostgREST).

**Expected from migration analysis:**
- Migration `20260513_008` executes `CREATE TABLE IF NOT EXISTS reporting.generated_reports (...)` with no `AUTHORIZATION` clause
- The owner is the role that executed the migration
- In Supabase projects without CLI, tables are typically owned by `postgres` (when created via local migration) or `supabase_admin` (when created via Dashboard SQL Editor)

**Recommendation:** The actual owner should be verified via `SELECT tableowner FROM pg_tables WHERE schemaname='reporting' AND tablename='generated_reports'` in the Supabase Dashboard SQL Editor before executing repair.

## STEP 3: SCHEMA OWNER

Direct `pg_namespace` query was **UNAVAILABLE**.

**Expected:** Similar to table owner — either `postgres` or `supabase_admin` depending on how the migration was applied.

## STEP 4: CURRENT service_role PRIVILEGES

**RUNTIME-CONFIRMED via PostgREST direct query:**

| Privilege | Value | Method |
|-----------|-------|--------|
| `has_schema_privilege('service_role', 'reporting', 'USAGE')` | **❌ FALSE** | Inferred from 42501 error code |
| `has_table_privilege('service_role', 'reporting.generated_reports', 'SELECT')` | **❌ FALSE** | Cannot reach table (schema USAGE denied) |
| `has_table_privilege('service_role', 'reporting.generated_reports', 'INSERT')` | **❌ FALSE** | Cannot reach table (schema USAGE denied) |
| `has_table_privilege('service_role', 'reporting.generated_reports', 'UPDATE')` | **❌ FALSE** | Cannot reach table (schema USAGE denied) |
| `has_table_privilege('service_role', 'reporting.generated_reports', 'DELETE')` | **❌ FALSE** | Cannot reach table (schema USAGE denied) |

**Raw error:**
```json
{"code":"42501","message":"permission denied for schema reporting"}
```

## SUMMARY

| Check | Result |
|-------|--------|
| Schema `reporting` exists | ✅ CONFIRMED |
| Table `reporting.generated_reports` exists | ✅ CONFIRMED (42501 ≠ PGRST205) |
| Table column structure known | ✅ From migration SQL |
| Table owner known | ❌ Requires Dashboard SQL Editor query |
| Schema owner known | ❌ Requires Dashboard SQL Editor query |
| service_role has schema USAGE | ❌ FALSE — this is the blocking issue |
| service_role has table privileges | ❌ FALSE (blocked by missing USAGE) |

## RECOMMENDATION

Since immediate schema USAGE + table INSERT are the confirmed missing privileges, the minimal repair can proceed even without exact owner knowledge. The GRANT statements are independent of ownership. Only `ALTER DEFAULT PRIVILEGES` (which is optional) depends on owner knowledge.
