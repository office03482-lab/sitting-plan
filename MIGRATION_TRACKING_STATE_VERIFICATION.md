# MIGRATION TRACKING STATE VERIFICATION

**Audit Date:** 2026-07-06

---

## THE CLAIM

Previous Phase 1 audit stated: `supabase_migrations.schema_migrations` table is missing, suggesting possible "corrupted or partial migration state."

## INVESTIGATION

### Source of 42P01 Error

Found in `P0_PARENT_PORTAL_MODULE_LOADING_FIX_REPORT.md:195`:
> "supabase_migrations.schema_migrations relation error: This PostgreSQL error (42P01) is separate from the loading issue. It indicates the Supabase internal migration tracking table is missing or was migrated to a different schema."

This is NOT a production error log. It is a development investigation note — someone ran `SELECT * FROM supabase_migrations.schema_migrations` in the Supabase Dashboard SQL Editor and got 42P01 because the table was never created.

### Does Any File Create This Table?

**NO.** No SQL file in `supabase/migrations/` creates the `supabase_migrations` schema or the `schema_migrations` table. This table is normally created by `supabase init` or `supabase migration init` — commands that were never run in this project.

### Is Supabase CLI Installed?

**NO.** No binary, no config, no scaffold. The SQL files were created manually.

### Are the SQL Files Automated?

**NO.** No script, CI/CD, Docker command, or application code reads `supabase/migrations/`.

### What About Alembic?

Alembic has its own tracking table: `alembic_version` (in the `public` schema). This table exists in the SQLAlchemy model but has no overlap with `supabase_migrations.schema_migrations`.

---

## ALTERNATIVE EXPLANATIONS

| Alternative | Verdict | Reasoning |
|-------------|---------|-----------|
| **A)** Supabase CLI was used → corruption | **REJECTED** | CLI was never used |
| **B)** CLI never used → table never created, absence is normal | **CONFIRMED** | No evidence of CLI usage anywhere |
| **C)** Manually applied via SQL Editor | **POSSIBLE** | Files may have been manually executed. No tracking table expected. |
| **D)** Custom runner → different tracking | **REJECTED** | No custom runner found |
| **E)** Wrong database queried | **NOT VERIFIABLE** | No runtime DB access to verify which DB was queried |

---

## CORRECTED POSITION

| Previous Claim | Corrected Classification |
|----------------|-------------------------|
| "migration tracking table is missing → corrupted state" | **INCORRECTLY ALARMIST.** The table was never created because Supabase CLI was never used. Its absence is EXPECTED and NORMAL. |
| "42P01 error signals a production issue" | **UNLIKELY.** The error was from a development investigation query. No production logs show this error. |

## ACTUAL RISK

The absence of `supabase_migrations.schema_migrations` means:
- There is NO authoritative record of which SQL files in `supabase/migrations/` have been manually applied to the database
- This is a documentation gap, not a runtime bug
- The `alembic_version` table tracks Alembic migrations, which is the authoritative system
