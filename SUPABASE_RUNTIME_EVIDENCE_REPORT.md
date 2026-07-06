# SUPABASE RUNTIME EVIDENCE REPORT

**Audit Date:** 2026-07-06

---

## CLASSIFICATION KEY

| Label | Meaning |
|-------|---------|
| **CONFIRMED** | Verified by runtime evidence (logs, dashboard, SQL) |
| **REPOSITORY-CONFIRMED** | Verified from code/migration analysis (no runtime access) |
| **STRONGLY INDICATED** | Multiple independent code paths suggest this issue exists |
| **HYPOTHESIS** | Plausible but unverified — requires runtime data |
| **NOT VERIFIED** | No evidence available in this audit scope |
| **DISPROVED** | Evidence shows the claim is incorrect |

---

## 1. DATABASE HEALTH

| Metric | Status | Evidence | Classification |
|--------|--------|----------|----------------|
| Connection count | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| CPU / Memory | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Disk I/O | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| WAL size | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Locks | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Long-running transactions | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Slow queries | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Statement timeout | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |
| Connection pool saturation | NOT VERIFIED | No runtime dashboard access | **NOT VERIFIED** |

**Conclusion:** No runtime database metrics are available from the repository. Supabase project dashboard access is required.

---

## 2. PostgREST / API HEALTH

| Metric | Status | Evidence | Classification |
|--------|--------|----------|----------------|
| API error rate (4xx vs 5xx) | NOT VERIFIED | No runtime logs captured | **NOT VERIFIED** |
| Schema cache errors | HYPOTHESIS | `supabase_migrations.schema_migrations` relation error documented in `P0_PARENT_PORTAL_MODULE_LOADING_FIX_REPORT.md:195` — 42P01 error suggests schema cache or migration tracking table is missing | **REPOSITORY-CONFIRMED** |
| 403 errors from missing grants | DISPROVED | Backend uses `service_role` key for ALL database access via `supabase_admin.py`. `service_role` bypasses RLS and schema `GRANT USAGE`. Missing `GRANT USAGE ON SCHEMA` does NOT block backend queries. | **DISPROVED** |
| 401 errors from auth | HYPOTHESIS | Auth bootstrap complexity suggests potential auth failures | **HYPOTHESIS** |

---

## 3. AUTH HEALTH

| Area | Status | Evidence | Classification |
|------|--------|----------|----------------|
| Supabase Auth API reachable | NOT VERIFIED | No runtime test | **NOT VERIFIED** |
| JWT validation | REPOSITORY-CONFIRMED | Backend `middleware/auth.py` has 3-step JWT decode fallback (local JWT_SECRET → SUPABASE_JWT_SECRET → Supabase Auth REST API). Falls back gracefully. | **REPOSITORY-CONFIRMED** |
| Session registration working | HYPOTHESIS | `AuthProvider.tsx` retries session registration 3x with timeouts up to 18s. Unknown if backend `active_sessions` table is reachable. | **HYPOTHESIS** |
| Token refresh working | HYPOTHESIS | Debounce mechanism in place. Unknown if Supabase Auth API responds correctly. | **HYPOTHESIS** |

---

## 4. KNOWN HEALTH ISSUES FROM REPOSITORY EVIDENCE

### 4.1 `supabase_migrations.schema_migrations` Relation Error (42P01)
- **Evidence:** `P0_PARENT_PORTAL_MODULE_LOADING_FIX_REPORT.md:195`
- **Classification:** **REPOSITORY-CONFIRMED**
- **Impact:** The Supabase internal migration tracking table is missing. This signals a corrupted or partial migration state. This does NOT block runtime operations but means migration state is unknown.

### 4.2 Dual Migration Systems (Alembic + SQL)
- **Evidence:** Alembic in `backend/alembic/` (2 revisions) + 79 SQL files in `supabase/migrations/`
- **Classification:** **REPOSITORY-CONFIRMED**
- **Impact:** Schema state is ambiguous. Unknown which system's state is authoritative.

### 4.3 No Migration Step in Production Deployment
- **Evidence:** `render.yaml` start command is `gunicorn ...` with no `alembic upgrade head`
- **Classification:** **REPOSITORY-CONFIRMED**
- **Impact:** Production database may not have the latest schema changes applied.

### 4.4 Migration Version Collision
- **Evidence:** `20260611_032` has TWO files (academic_schema_service_role_grants + hostel_request_vacated_state)
- **Classification:** **REPOSITORY-CONFIRMED**
- **Impact:** One of these two migrations may not have been applied, or they may have been applied in indeterminate order.

---

## 5. RUNTIME EVIDENCE REQUIRED

To properly diagnose "unhealthy" status, the following Supabase Dashboard data is needed:

1. **Project Dashboard → Database → Health** — CPU, Memory, Disk, Connection count
2. **Project Dashboard → Database → Queries** — Slow query log, long-running transactions
3. **Project Dashboard → API → Logs** — 4xx/5xx rate, error distribution
4. **Project Dashboard → Auth → Logs** — Login success/failure rate, token refresh errors
5. **`supabase_migrations.schema_migrations` query** — `SELECT * FROM supabase_migrations.schema_migrations;`
6. **`SELECT count(*) FROM pg_stat_activity;`** — Connection pool utilization
7. **`SELECT * FROM pg_stat_user_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');`** — Table-level health
8. **Supabase Edge Function / Logflare logs** — Any function execution errors

---

## 6. CORRECTED POSITION

The previous audit incorrectly attributed module BROKEN status to missing schema GRANTs. The backend's use of `service_role` key via `get_supabase_admin_client()` (in `supabase_admin.py`) means:

- **Schema USAGE grants are irrelevant** for backend access
- **RLS policies are irrelevant** for backend access (service_role bypasses RLS)
- **Missing GRANTs only affect** raw SQL editor queries or direct frontend Supabase client calls (which the app architecture does not use)

The actual runtime health concerns are:
1. `supabase_migrations.schema_migrations` table missing — migration state uncertainty
2. Auth bootstrap latency from 3 Supabase queries + 1-3 session registration POSTs per login
3. No production migration step in deployment pipeline
4. Dual migration system confusion (Alembic vs SQL files)
5. Migration version collision at `20260611_032`

---

**Recommendation:** To progress beyond HYPOTHESIS and NOT VERIFIED classifications, request Supabase Project Dashboard access or run SQL diagnostics against the production database.
