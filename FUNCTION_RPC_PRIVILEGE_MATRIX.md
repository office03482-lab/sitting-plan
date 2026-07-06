# FUNCTION/RPC PRIVILEGE MATRIX

**Audit Date:** 2026-07-06

---

## SCOPE

Examines functions defined in migration files for the four affected schemas (scheduling, exam, attendance, reporting) and checks runtime availability.

## METHOD

1. Extracted function definitions from migration SQL files
2. Verified runtime existence via PostgREST RPC calls
3. Classified by backend usage pattern

---

## FUNCTIONS DEFINED IN MIGRATIONS

### `scheduling` schema

No functions defined in migration files. The schema only contains tables.

### `exam` schema

No standalone functions defined. The schema uses trigger functions from `public` schema (`set_updated_at`).

### `attendance` schema

No standalone functions defined. Uses trigger functions from `public`.

### `reporting` schema

No functions defined in migration files.

---

## PUBLIC SCHEMA FUNCTIONS (USED BY ALL SCHEMAS)

| Function | Defined In | Runtime Exists? | RLS Policy Usage | Backend .rpc() Usage |
|----------|-----------|-----------------|------------------|---------------------|
| `set_updated_at()` | Migration 001 | ❌ NOT FOUND | Trigger (no RPC needed) | None |
| `is_platform_admin()` | Migration 003 | ✅ EXISTS | RLS policy + backend | Backend middleware |
| `same_school()` | Migration 001 | ❌ NOT FOUND | RLS policy | None |
| `same_school_membership()` | Migration 001 | ❌ NOT FOUND | RLS policy | None |
| `get_school_id_for_profile()` | Unknown | ❌ NOT FOUND | — | Backend |
| `resolve_login_identifier()` | Unknown | ❌ NOT FOUND | — | Backend auth |

---

## KEY INSIGHT: RLS POLICY FUNCTIONS vs RPC FUNCTIONS

PostgreSQL has two distinct execution contexts:

### 1. RLS Policy Functions (NO PostgREST EXECUTE grant needed)

Functions used inside `CREATE POLICY ... USING (...)` — these run as part of the table query and execute with the privileges of the table owner or with `SECURITY DEFINER`. They do NOT require explicit `GRANT EXECUTE` on the function for the querying role.

Examples:
- `same_school()`
- `same_school_membership()`
- `is_platform_admin()` (when called from RLS policy)

These NOT being found in the schema cache does NOT mean they don't exist in the database. RLS policy functions are not automatically exposed via PostgREST's RPC endpoint — they only need to be defined in the database and referenced by policies.

### 2. RPC Functions (DO need EXECUTE grant)

Functions called explicitly via `client.rpc('function_name', {...})` — these must be callable by the service_role role through PostgREST.

No backend code in this project calls `.rpc()` on the `reporting`, `scheduling`, `exam`, or `attendance` schemas. Backend code uses `.schema(name).table(name)` patterns instead.

---

## BACKEND .rpc() USAGE

Searching for `.rpc(` in backend Python code:

| File | RPC Name | Schema | Needs EXECUTE? |
|------|----------|--------|----------------|
| `services/supabase_analytics.py` | `get_dashboard_metrics` | public | ✅ (function may not exist) |
| `services/supabase_account_security.py` | `resolve_login_identifier` | public | ✅ |

No RPC calls target the `scheduling`, `exam`, `attendance`, or `reporting` schemas.

---

## CONCLUSION

**No function/RPC EXECUTE privileges are needed** on the affected schemas (scheduling, exam, attendance, reporting) because:

1. No functions are defined in those schemas
2. Backend code uses `.schema().table()` patterns, not `.rpc()` on those schemas
3. RLS policy functions live in the `public` schema and run in the RLS evaluation context, not via PostgREST RPC

The repair SQL needs only schema-level USAGE and table-level SELECT/INSERT/UPDATE/DELETE for the `reporting` schema.
