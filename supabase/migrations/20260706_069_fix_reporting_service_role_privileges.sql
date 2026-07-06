-- Migration: Fix missing service_role privileges on reporting schema
-- Version: 20260706_069
-- Date: 2026-07-06
-- 
-- Problem: service_role lacks USAGE on schema reporting and INSERT/SELECT
-- on reporting.generated_reports, causing 42501 when backend calls
-- export_dashboard_payload().
--
-- Pre-requisites: None (idempotent, additive only)
-- Rollback: REVOKE USAGE ON SCHEMA reporting FROM service_role;
--           REVOKE INSERT, SELECT ON reporting.generated_reports FROM service_role;

BEGIN;

GRANT USAGE ON SCHEMA reporting TO service_role;
GRANT INSERT, SELECT ON TABLE reporting.generated_reports TO service_role;

COMMIT;
