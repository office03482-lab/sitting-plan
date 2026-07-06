# MIGRATION PARSER VERIFICATION

**Audit Date:** 2026-07-06

---

## SUPABASE CLI STATUS

| Item | Evidence |
|------|----------|
| `supabase.exe` / binary | **NOT FOUND** — not in PATH, not in node_modules, not in any scripts |
| `supabase/config.toml` | **DOES NOT EXIST** |
| `.supabase/` directory | **DOES NOT EXIST** |
| `supabase init` run | **NEVER** — no scaffold files found |
| Any `supabase migration` command in scripts | **NONE FOUND** — zero references in shell scripts, PowerShell, CI/CD, or code |
| Package `supabase` | **CLIENT SDK** (v2.15.3), not CLI — contains zero migration code |

---

## ACTUAL MIGRATION RUNNER

There is NO automated runner for `supabase/migrations/*.sql` files. The only automated migration system is Alembic (`backend/alembic/`).

The SQL files are:
- Manually created schema artifacts
- Applied manually via Supabase Dashboard SQL Editor or `psql`
- Documentation of schema evolution

---

## VERSION PARSING (Based on Supabase CLI Conventions)

Since the CLI is not installed, the parser behavior must be determined from:
1. The naming convention used in the files
2. Evidence from the collision at `20260611_032`

### Convention Analysis

The naming format is: `YYYYMMDD_NNN_description.sql`

The Supabase CLI (per its documented source conventions) parses the version as the **entire prefix before the first underscore AFTER the sequence number**.

This means:
- `20260602_028_seating_plan_type_all_in_one.sql` → version = `20260602_028`
- `20260608_028_bulk_action_requests.sql` → version = `20260608_028`

These are DIFFERENT versions — no collision.

### TRUE Collision Evidence

The file pair at `20260611_032`:
1. `20260611_032_academic_schema_service_role_grants.sql` → version = `20260611_032`
2. `20260611_032_hostel_request_vacated_state.sql` → version = `20260611_032`

Same version = TRUE COLLISION. If Supabase CLI applied these, the behavior depends on whether it skips duplicates or overwrites.

---

## COLLISION CLASSIFICATION

| Pair | Version 1 | Version 2 | Same Version? | Classification |
|------|-----------|-----------|---------------|----------------|
| 028 | `20260602_028` | `20260608_028` | **NO** | NAMING CONFUSION ONLY |
| 032 | `20260611_032` | `20260611_032` | **YES** | **TRUE VERSION COLLISION** |
| 056 | `20260617_056` | `20260618_056` | **NO** | NAMING CONFUSION ONLY |
| 057 | `20260617_057` | `20260619_057` | **NO** | NAMING CONFUSION ONLY |
| 058 | `20260617_058` | `20260619_058` | **NO** | NAMING CONFUSION ONLY |
| 059 | `20260617_059` | `20260619_059` | **NO** | NAMING CONFUSION ONLY |
| 060 | `20260619_060` | `20260620_060` | **NO** | NAMING CONFUSION ONLY |

---

## NOTE ON SAME-DATE COLLISION RISK

If the parser used ONLY the date portion before the first underscore (i.e., `YYYYMMDD`), then:

- `20260611_032_academic_schema_service_role_grants.sql` → `20260611`
- `20260611_032_hostel_request_vacated_state.sql` → `20260611`

Still a collision. But all files on the same date would also collide, including `20260513_001` through `20260513_008` — 8 files on the same date. Since these clearly work, the parser MUST use more than just the date.

**Conclusion: The parser uses `YYYYMMDD_NNN` as the version key.**
