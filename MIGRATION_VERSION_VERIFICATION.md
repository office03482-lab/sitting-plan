# MIGRATION VERSION VERIFICATION

**Audit Date:** 2026-07-06

---

## IDENTIFICATION SCHEME

This repo uses **Supabase CLI-style naming**: `{YYYYMMDD}_{NNN}_{description}.sql`

The **full version identifier** is `YYYYMMDD_NNN` (date + sequence number). Supabase CLI uses this full prefix as the migration version key, stored in `supabase_migrations.schema_migrations`.

---

## ALLEGED DUPLICATE ANALYSIS

### Instance 1: `20260602_028` vs `20260608_028`

| Property | File 1 | File 2 |
|----------|--------|--------|
| Full version | `20260602_028` | `20260608_028` |
| Date | 2026-06-02 | 2026-06-08 |
| Sequence | 028 | 028 |
| Description | seating_plan_type_all_in_one | bulk_action_requests |

**Classification: NAMING CONFUSION ONLY** — Different dates produce different full version identifiers. Supabase CLI sorts by full string, so `20260602_028` applies first, then `20260608_028`. No collision.

### Instance 2: `20260617_056` vs `20260618_056`

| Property | File 1 | File 2 |
|----------|--------|--------|
| Full version | `20260617_056` | `20260618_056` |
| Date | 2026-06-17 | 2026-06-18 |
| Sequence | 056 | 056 |
| Description | inventory_report_indexes | lms_online_tests_sprint1 |

**Classification: NAMING CONFUSION ONLY**

### Instance 3: `20260617_057` vs `20260619_057`

**Classification: NAMING CONFUSION ONLY**

### Instance 4: `20260617_058` vs `20260619_058`

**Classification: NAMING CONFUSION ONLY**

### Instance 5: `20260617_059` vs `20260619_059`

**Classification: NAMING CONFUSION ONLY**

### Instance 6: `20260619_060` vs `20260620_060`

| Property | File 1 | File 2 |
|----------|--------|--------|
| Full version | `20260619_060` | `20260620_060` |
| Date | 2026-06-19 | 2026-06-20 |
| Sequence | 060 | 060 |
| Description | move_sessions_to_public | move_generated_credentials_to_public |

**Classification: NAMING CONFUSION ONLY**

---

## TRUE VERSION COLLISION (1 instance)

### `20260611_032` — TWO FILES, SAME FULL VERSION

| File | Full Version | Content |
|------|-------------|---------|
| `20260611_032_academic_schema_service_role_grants.sql` | `20260611_032` | GRANT USAGE + GRANT ALL + ALTER DEFAULT PRIVILEGES for service_role on `academic` schema |
| `20260611_032_hostel_request_vacated_state.sql` | `20260611_032` | ALTER TABLE hostel.hostel_requests ADD COLUMN vacated_at, vacated_by_profile_id |

**Classification: TRUE VERSION COLLISION — NEEDS RUNTIME HISTORY CHECK**

Both files share the exact same version identifier `20260611_032`. If Supabase CLI applied them, the behavior depends on the CLI version and whether the second file was treated as an update to the first or silently skipped. This MUST be verified against the actual `supabase_migrations.schema_migrations` table.

---

## UP/DOWN PAIRS (3 instances — NOT PROBLEMS)

| Version | Up File | Down File | Convention |
|---------|---------|-----------|------------|
| `20260622_063` | subscription_entitlement_phase0.sql | subscription_entitlement_phase0_down.sql | Standard reversible migration pair |
| `20260622_064` | ai_credit_engine_hardening.sql | ai_credit_engine_hardening_down.sql | Standard reversible migration pair |
| `20260622_065` | billing_payment_infrastructure.sql | billing_payment_infrastructure_down.sql | Standard reversible migration pair |

**Classification: NOT A PROBLEM** — These are intentional paired migrations.

---

## UNVERSIONED FILE (1 instance)

| File | Problem |
|------|---------|
| `test_rpc.sql` | No timestamp/sequence prefix. Contains `CREATE OR REPLACE FUNCTION public.edupay_get_dashboard(...)`. Undefined application order. |

**Classification: ORDERING RISK**

---

## MIGRATION TOOLING ANALYSIS

| Tool | Present? | Config File | Revisions | Production Use |
|------|----------|-------------|-----------|----------------|
| **Alembic** | ✅ | `backend/alembic.ini` | 2 Python revisions | `docker-compose.dev.yml` runs `alembic upgrade head` at startup |
| **Supabase CLI** | ❌ | No `supabase/config.toml` | N/A | Not configured |
| **Raw SQL** | ✅ | `supabase/migrations/` | 79 SQL files | Unknown — no automation found |

**Key finding:** The project has TWO independent migration systems, but only Alembic has an automated run step. The SQL files appear to be Supabase CLI-style exports that were manually generated but the CLI was never initialized for this project.

---

## MIGRATION RISK SUMMARY

| Issue | Risk | Requires |
|-------|------|----------|
| `20260611_032` version collision | **HIGH** | Runtime check of `supabase_migrations.schema_migrations` |
| Dual migration systems | **MEDIUM** | Choose one authoritative system |
| No production migration step | **HIGH** | Add `alembic upgrade head` to Render start command |
| `test_rpc.sql` unversioned | **LOW** | Rename with proper prefix |
| Sequence number reuse (028,056-060) | **LOW** | Cosmetic — full version is unique |

## HARD REQUIREMENT

Do NOT rename any applied migration files. The actual applied state is unknown without querying `supabase_migrations.schema_migrations`. Renaming could break the migration chain if files have already been recorded in the database.
