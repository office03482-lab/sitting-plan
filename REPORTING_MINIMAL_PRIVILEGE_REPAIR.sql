-- REPORTING SCHEMA MINIMAL PRIVILEGE REPAIR
-- Phase 1.8 — Production Preflight Verified
-- Date: 2026-07-06
--
-- PURPOSE: Grant ONLY the missing privileges for service_role
-- on the reporting schema.
--
-- SCOPE: Only reporting.generated_reports.
-- No other schemas affected.
--
-- VERIFICATION:
--   Pre-check:  SELECT has_schema_privilege('service_role','reporting','USAGE');
--               Returns false before executing this script.
--   Post-check: Same query should return true.
--
-- PRINCIPLES:
--   - Forward-only (no REVOKE)
--   - Additive only
--   - Least privilege (only INSERT + SELECT)
--   - No anon/authenticated grants
--   - No RLS changes
--   - No ownership changes
--   - Idempotent

BEGIN;

-- === STEP 1: Schema USAGE ===
-- Without this, ALL table operations fail with 42501
GRANT USAGE ON SCHEMA reporting TO service_role;

-- === STEP 2: Table privileges ===
-- Backend operation: INSERT into reporting.generated_reports
--   (via export_dashboard_payload in supabase_bi.py:955)
-- PostgREST INSERT returns the created row, requiring SELECT on the table
GRANT INSERT, SELECT ON TABLE reporting.generated_reports TO service_role;

COMMIT;

-- === OPTIONAL: Default privileges ===
-- Only uncomment after verifying actual object creator via:
--   SELECT tableowner FROM pg_tables
--   WHERE schemaname='reporting' AND tablename='generated_reports';
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE <ACTUAL_OWNER>
-- IN SCHEMA reporting
-- GRANT INSERT, SELECT ON TABLES TO service_role;
--
-- Not included in current repair because:
-- 1. Exact owner is runtime-unverified
-- 2. No future reporting tables are planned
-- 3. Can be added later when owner is confirmed

-- === POST-EXECUTION VERIFICATION ===
-- Run these after commit:
--   SELECT has_schema_privilege('service_role', 'reporting', 'USAGE') AS schema_usage;
--   SELECT has_table_privilege('service_role', 'reporting.generated_reports', 'INSERT') AS can_insert;
--   SELECT has_table_privilege('service_role', 'reporting.generated_reports', 'SELECT') AS can_select;
--
-- Then retest via PostgREST:
--   curl -H "Authorization: Bearer <service_role_key>"
--        -H "Accept-Profile: reporting"
--        -H "Content-Profile: reporting"
--        "https://<project>.supabase.co/rest/v1/generated_reports?select=id&limit=1"
--
-- Expected: HTTP 200 with [] (empty array) instead of HTTP 403 with 42501
