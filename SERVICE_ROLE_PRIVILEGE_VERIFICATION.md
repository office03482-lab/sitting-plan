# SERVICE_ROLE PRIVILEGE VERIFICATION

**Audit Date:** 2026-07-06

---

## PRIMARY EVIDENCE

### Evidence #1: Migration `20260531_024` Header Comment (IRREFUTABLE)

File: `supabase/migrations/20260531_024_inventory_finance_permissions.sql`, lines 1-4:

```sql
-- Grant schema and table permissions for inventory and finance schemas.
-- These were omitted from the original schema-creation migrations, causing
-- "permission denied for schema inventory" (PostgreSQL 42501) when the
-- backend (service_role key) or authenticated users try to access them.
```

**This is a first-person testimony by the project's own engineers.** It explicitly states:
1. Grants were **omitted** from the original migrations
2. The `service_role key` produced **PostgreSQL 42501** ("permission denied for schema inventory")
3. This migration was created to **fix** that error

### Evidence #2: GRANT Statements Target service_role Explicitly

Same migration, lines 9-10:
```sql
grant usage on schema inventory  to anon, authenticated, service_role;
grant usage on schema finance    to anon, authenticated, service_role;
```

Lines 13-32: GRANT ALL on ALL TABLES in schema inventory/finance explicitly includes `service_role`.
Lines 45-52: ALTER DEFAULT PRIVILEGES explicitly includes `service_role`.

If `service_role` bypassed GRANT checks, these statements would be redundant. The project's engineers would not grant privileges that are not needed.

### Evidence #3: Four Other Migrations Follow Same Pattern

| Migration | Schema | target Role(s) |
|-----------|--------|----------------|
| `029` | workflow | service_role |
| `031` | hostel | service_role |
| `032` | academic | service_role |
| `034` | online_tests | service_role |

All explicitly GRANT to `service_role`. None would exist if bypass were true.

### Evidence #4: Four Schemas Have NO Grants (Still Vulnerable)

| Schema | Created In | GRANTs for ANY role? | Queried by service_role? |
|--------|-----------|---------------------|--------------------------|
| `scheduling` | Migration 004 | **NONE** | YES (supabase_attendance.py, scope_engine.py) |
| `exam` | Migration 005 | **NONE** | YES (supabase_exams.py, supabase_seating.py, supabase_invigilators.py, reports.py) |
| `attendance` | Migration 006 | **NONE** | YES (supabase_attendance.py, platform_control_plane.py, supabase_ai_tutor.py, supabase_lms.py) |
| `reporting` | Migration 008 | **NONE** | NO (no backend code queries it) |

### Evidence #5: Backend Error Handling Anticipates Permission Denied

File: `backend/app/routes/students.py`, lines 111-112:
```python
if "permission denied" in lower_detail or "not allowed" in lower_detail:
    return "Supabase permission denied during bulk import"
```

The backend code explicitly handles "permission denied" errors from Supabase — proving they are a real, expected failure mode.

---

## PostgreSQL ROLE SEMANTICS

### The service_role JWT Does Not Bypass GRANTs

PostgreSQL access control has two independent layers:

| Layer | Bypassed by service_role? | Evidence |
|-------|--------------------------|----------|
| **GRANT USAGE ON SCHEMA** | **NO** | Migration 024: 42501 error for missing schema USAGE |
| **GRANT SELECT/INSERT/UPDATE/DELETE ON TABLE** | **NO** | Migration 024: GRANT ALL on tables for service_role |
| **Row-Level Security (RLS)** | **YES** | Standard Supabase architecture: `BYPASSRLS` attribute on service_role role |
| **Sequence privileges** | **NO** | Migration 032_grants: GRANT ALL on sequences to service_role |
| **Function EXECUTE** | **NO** | Migration 032_grants: GRANT EXECUTE on functions to service_role |

### How PostgREST Resolves the Role

1. Kong API gateway receives `Authorization: Bearer <service_role_jwt>`
2. Kong decodes JWT, extracts `role: "service_role"` claim
3. Kong forwards to PostgREST with role information
4. PostgREST executes `SET ROLE service_role` in the database session
5. The `service_role` role has `BYPASSRLS` attribute (bypasses RLS)
6. But `service_role` still needs schema USAGE and table GRANTs like any non-superuser role

### The `supabase-py` Client

The Python client (v2.15.3) sends the raw key as `Authorization: Bearer <key>`. It has:
- **No** mechanism to set `X-Role` headers
- **No** `postgrest_role` option in `ClientOptions`
- **No** role override capability

The database role is determined **ENTIRELY** by the JWT's `role` claim, decoded server-side by PostgREST.

---

## CORRECTED POSITION

| Previous Claim (Phase 1.5) | Corrected |
|----------------------------|-----------|
| "service_role bypasses ALL RLS and schema GRANT checks" | **FALSE.** service_role bypasses RLS (BYPASSRLS) but does NOT bypass GRANT checks |
| "Missing schema GRANTs are NOT a blocking issue" | **FALSE.** Missing GRANTs cause 42501 errors for service_role, as proven by migration 024 |
| "Only 4 schemas missing grants" | **CORRECT.** scheduling, exam, attendance, reporting have no grants. However, only 3 are actively queried (reporting is unused) |
| "Inventory/Finance grants were repaired" | **CORRECT.** Migration 024 added grants. Inventory and Finance modules should work. |
