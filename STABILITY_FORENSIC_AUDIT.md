# STABILITY FORENSIC AUDIT — Dr. Girish App

**Audit Date:** 2026-07-06  
**Audit Type:** READ-ONLY Forensic Stability Audit  
**Scope:** Full-stack (backend + frontend + Supabase + mobile + deployment)  
**Status:** ⚠️ UNSTABLE — Multiple P0/P1 issues identified

---

## A. EXECUTIVE SUMMARY

### Current Stability Assessment: **UNSTABLE (4.5/10)**

The application is experiencing multiple systemic failures across auth, database, frontend rendering, and API contract layers. The root causes cluster around:

1. **Hybrid auth architecture conflict** — Frontend uses Supabase JS Auth, backend uses SQLAlchemy User model with JWT. These two auth systems are incompatible, causing bootstrap failures, session registration timeouts, and permission loading loops.

2. **Missing Supabase schema GRANTs** — Multiple schemas (inventory, finance, scheduling, exam, attendance, warehouse) lack USAGE grants for authenticated/anon roles, causing silent 403 failures on API calls.

3. **Duplicate migration numbers** — 6 migration file pairs have the same sequence number, creating ambiguity about which migrations were actually applied.

4. **Zero request cancellation architecture** — Frontend fires API calls without AbortController support. Unmounting components leaves stale requests that update unmounted state.

5. **82 bare `except Exception:` blocks** — Production errors are silently swallowed, making debugging impossible.

6. **Unbounded `select("*")` queries** — Hundreds of API calls return all columns without pagination limits, causing PostgREST timeouts and memory pressure.

7. **`is_legacy_sqlite_mode()` hardcoded to `False`** — Legacy SQLite fallback paths are unreachable even when SQLite is active.

### Top Systemic Failures

| Rank | Failure | Impact | Severity |
|------|---------|--------|----------|
| 1 | Hybrid auth (Supabase JS ↔ Backend JWT/SQLAlchemy) | Auth bootstrap loops, session registration timeout, REGISTRATION_ERROR deadlock | **P0** |
| 2 | Missing schema GRANTs (inventory, finance, etc.) | Module API calls fail with 403/500 | **P0** |
| 3 | Duplicate migration sequence numbers | Migration state is ambiguous | **P0** |
| 4 | No AbortController on frontend | Stale responses, memory leaks, visual flicker | **P1** |
| 5 | 82 bare `except Exception:` | Silent failures, undebuggable errors | **P1** |
| 6 | Unbounded `select("*")` | PostgREST timeouts, OOM risk | **P1** |
| 7 | 422/500 treated as "temporarily unavailable" | Real errors masked as transient | **P1** |
| 8 | Committed secrets in .env files | Security breach | **P0** |
| 9 | Redis dependency in render.yaml (no Redis on free tier) | Backend crash on startup | **P0** |
| 10 | VITE_API_URL not configured for production | API calls fail silently | **P1** |

### Should Production Be Considered Stable?

**No.** Production should be considered **DEGRADED**. The auth bootstrap alone will cause REGISTRATION_ERROR states for users, multiple schema access failures will block inventory/finance/attendance modules, and uncaught exceptions will cause silent data loss.

---

## B. P0 CRITICAL ISSUES

### P0-1: Hybrid Auth Architecture Conflict
**Evidence:**
- `frontend/src/contexts/AuthProvider.tsx:905` — Uses `supabase.auth.signInWithPassword()` (Supabase JS Auth)
- `backend/app/routes/auth.py:822` — Uses `/login-password` endpoint with SQLAlchemy `User` model and `verify_password()`
- `backend/app/middleware/auth.py:536` — `get_authenticated_user()` depends on `get_db()` SQLAlchemy session and `User` model
- `backend/app/middleware/auth.py:366-457` — `_resolve_request_principal()` tries to find user in SQLAlchemy `users` table first, falls back to Supabase profiles
- `frontend/src/contexts/AuthProvider.tsx:273-355` — `buildAppUserFromSession()` reads from Supabase `profiles` and `school_memberships` tables
- `backend/app/middleware/auth.py:640-648` — Calls `validate_active_session()` which hits Supabase `active_sessions` table
- `backend/app/middleware/auth.py:222-279` — `_load_supabase_principal()` does a full Supabase profile/membership/permission fetch on EVERY request

**Impact:** Every authenticated request triggers:
1. JWT decode → 2. SQLAlchemy User lookup → 3. Supabase profile fetch → 4. Supabase membership fetch → 5. Supabase role_permissions fetch → 6. Session validation. This is 5+ sequential network calls per request, each cached for only 180 seconds.

**When Supabase is slow/unhealthy, ALL API calls fail with 401/403.**

### P0-2: Missing Schema GRANTs
**Evidence:**
- `supabase/migrations/` — No `GRANT USAGE ON SCHEMA` for: `scheduling`, `exam`, `attendance`, `warehouse`, `inventory`, `finance`
- `backend/app/routes/` — Multiple routes use `schema="inventory"`, `schema="finance"`, `schema="exam"`, `schema="attendance"`
- `backend/app/services/supabase_inventory.py:1` — Uses `inventory` schema
- `supabase/migrations/` files 024-030 — Create tables in `inventory` and `finance` schemas but missing GRANTs

**Impact:** All inventory, finance, and several other module API calls return 403/500 because PostgREST cannot access the schema.

### P0-3: Duplicate Migration Sequence Numbers
**Evidence:**
- `20260602_028_seating_plan_type_all_in_one.sql` AND `20260608_028_bulk_action_requests.sql` — both numbered 028
- `20260617_056_inventory_report_indexes.sql` AND `20260618_056_lms_online_tests_sprint1.sql` — both 056
- `20260617_057_analytics_public_views.sql` AND `20260619_057_storage_infrastructure_sprint.sql` — both 057
- `20260617_058_warehouse_tables.sql` AND `20260619_058_student_success_dashboard.sql` — both 058
- `20260617_059_ai_public_views.sql` AND `20260619_059_portal_access_security_sessions.sql` — both 059
- `20260619_060_move_sessions_to_public.sql` AND `20260620_060_move_generated_credentials_to_public.sql` — both 060

**Impact:** Supabase migration tooling cannot resolve which file to apply when numbers collide. Migration state is non-deterministic.

### P0-4: Committed Secrets in .env Files
**Evidence:**
- `backend/.env` and `frontend/.env` — Contain SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, and other secrets
- These files are committed to git (visible in `git log`)
- `backend/app/services/supabase_admin.py:13-34` — `_read_env_file_value()` reads `.env` files directly from disk

**Impact:** Full database access key exposed. Immediate rotation required.

### P0-5: Redis Hard Dependency in Production
**Evidence:**
- `backend/app/config.py:60` — `redis_url: str = "redis://localhost:6379/0"` (default)
- `render.yaml:49` — `REDIS_URL: redis://localhost:6379/0` (hardcoded)
- Render free tier does NOT include Redis

**Impact:** If any code path tries to connect to Redis, the connection hangs indefinitely. No graceful degradation exists.

---

## C. P1 HIGH ISSUES

### P1-1: No AbortController on Frontend (Zero Request Cancellation)
**Evidence:**
- `frontend/src/services/api.ts` — None of 180+ API methods accept AbortSignal
- `frontend/src/pages/Dashboard.tsx:245,284-288` — Uses `dashboardMountedRef` but doesn't abort HTTP
- `frontend/src/pages/AttendanceManagement.tsx:895-907` — Uses request key pattern but no abort
- `frontend/src/pages/InventoryManagement.tsx` — No stale-response detection at all

**Impact:** Component unmount + remount creates duplicate parallel requests. Stale responses overwrite fresh data.

### P1-2: 82 Bare `except Exception:` Swallows Errors
**Evidence:**
- `backend/app/services/supabase_attendance.py` — 16 occurrences
- `backend/app/services/parent_portal_service.py` — 8 occurrences
- `backend/app/services/platform_control_plane.py` — 7 occurrences
- `backend/app/services/auth_security.py` — 4 occurrences
- Multiple other files — 47 more occurrences across 30+ files

**Impact:** Silent data corruption, undebuggable production errors, no observability.

### P1-3: Unbounded `select("*")` Queries
**Evidence:**
- `backend/app/services/platform_control_plane.py:471` — `select("*").order("created_at")` — no limit
- `backend/app/services/platform_control_plane.py:762,775` — same pattern
- `backend/app/services/subscription_engine.py:1042` — `select("*").execute()` — ALL subscriptions fetched
- `backend/app/services/supabase_bi.py:756` — `limit(400)` but others in same file have no limit
- All `supabase_*` services use `select("*")` extensively

**Impact:** OOM or timeout on datasets > few thousand rows.

### P1-4: 422/500 Errors Masked as "Temporarily Unavailable"
**Evidence:**
- `frontend/src/services/api.ts:49-54` — `isTemporarilyUnavailableDataError()` returns `true` for ALL 422/500 errors
- `frontend/src/pages/Dashboard.tsx:393-398` — Uses this to hide failures as "Data temporarily unavailable"

**Impact:** Schema errors, validation errors, and server bugs are hidden. Users see empty dashboard sections with no way to debug.

### P1-5: VITE_API_URL Not Configured for Production
**Evidence:**
- `frontend/.env` — Only has Supabase credentials, no VITE_API_URL
- `frontend/src/lib/runtimeConfig.ts:31` — Warns when missing on non-local host
- `frontend/src/services/api.ts:216` — Falls back to `/api` (relative) when VITE_API_URL missing
- `render.yaml:58-59` — VITE_API_URL has `sync: false`

**Impact:** On Render static site, API calls fall back to relative `/api` path which won't resolve to the backend server without a proxy. **API calls fail silently in production.**

### P1-6: Frontend Student Type Dual Naming
**Evidence:**
- `frontend/src/types/index.ts:668-669` — `Student` type has BOTH `full_name: string` (required) AND `name?: string` (optional)
- Line 672-674 — BOTH `batch_id?: string` AND `batch?: string`

**Impact:** API returns one or the other. Callers must handle both. When neither is populated, student names show as undefined.

### P1-7: Frontend Permission-Triggered Re-fetch Cascades
**Evidence:**
- `frontend/src/pages/Dashboard.tsx:282` — Dependency array `[canViewEduPay, canViewInventory, showDetailedDashboard, canRunDashboardRequests]` — each triggers re-fetch of entire dashboard
- `frontend/src/pages/AttendanceManagement.tsx:1029-1129` — Every create/delete makes 3-5 sequential API calls
- `frontend/src/pages/InventoryManagement.tsx:612-647` — `refreshMaterials()` fires 9 parallel uncancelable requests

**Impact:** Permission changes (which re-evaluate every render) cascade into full data re-fetches. Sequential re-fetch chains amplify failures.

### P1-8: `is_legacy_sqlite_mode()` Hardcoded to False
**Evidence:**
- `backend/app/services/supabase_context.py:23-24` — `def is_legacy_sqlite_mode(): return False`
- Multiple routes guard on this function — legacy SQLite fallback is always skipped

**Impact:** When running in dev mode with SQLite, routes that should fall back to SQLite paths instead hit Supabase APIs that aren't configured, returning errors.

---

## D. P2 MEDIUM ISSUES

### D-1: 16 Files > 800 Lines (Maintainability)
Files over 800 lines: supabase_attendance.py (3579), routes/__init__.py (2931), supabase_account_security.py (2652), supabase_inventory.py (1734), supabase_online_tests.py (1675), supabase_lms.py (1622), routes/students.py (1561), routes/attendance.py (1323), utils/excel.py (1233), supabase_study_planner.py (1228), parent_portal_service.py (1130), platform_control_plane.py (1119), payment_infrastructure.py (1108), supabase_parent_intelligence.py (1066), routes/online_tests.py (1059), supabase_analytics.py (1013), subscription_engine.py (972), supabase_predictions.py (948), supabase_bi.py (887), routes/inventory.py (861), routes/timetable.py (851), supabase_ai_tutor.py (845).

### D-2: Circular Import Risk with Deferred Imports
`backend/app/services/supabase_seating.py:173,467` — `from app.services import supabase_students` inside function body. Also in `supabase_context.py:159` and `auth_security.py:314,325,352`.

### D-3: Sync Services Called from Async Routes
All service functions are sync but called from async route handlers via threadpool. 400+ endpoints have thread switching overhead.

### D-4: No Timeouts on Supabase Calls
Every `.execute()` call lacks a timeout parameter. A hung Supabase connection blocks the thread indefinitely.

### D-5: No Retry Logic on Supabase Calls
Zero retry mechanisms. Network blips cause 500 errors.

### D-6: Frontend `PlatformAdminRoute` Uses Wrong Auth Store
`frontend/src/components/PlatformAdminRoute.tsx:5,12-14` — Uses `useAuthStore` (Zustand) instead of `useAuth` (context). Two auth sources can diverge.

### D-7: InventoryManagement Has Two Competing Hash useEffects
`frontend/src/pages/InventoryManagement.tsx:350-389` and `396-427` — Both parse `location.hash` and set state. Double state updates on every hash change.

### D-8: Attendance Tab Validation useEffects Conflict
`frontend/src/pages/AttendanceManagement.tsx:299-304` and `458-497` — Two useEffects both adjust `activeTab`. Can conflict and cause loops.

### D-9: Multiple `getApiErrorMessage` Copies
Three different error message extraction functions exist: `api.ts` line 49, `AttendanceManagement.tsx` line 164, `InventoryManagement.tsx` line 436. Each handles errors differently.

### D-10: No CI/CD Pipeline
`.github/workflows/` does not exist. No automated linting, testing, or deployment checks.

---

## E. P3 LOW ISSUES

### E-1: Missing .dockerignore
No `.dockerignore` file — `.env`, `node_modules`, `__pycache__` included in Docker build context.

### E-2: No Health Check on Frontend Docker Service
`docker-compose.yml` frontend service has no `healthcheck`.

### E-3: Frontend Frontend `Teacher.subject` is Singular
`frontend/src/types/index.ts:898` — `subject: string`. Should be `subjects: string[]`.

### E-4: `LoginCredentials` Uses `username` Instead of `email`
`frontend/src/types/index.ts:46-48` — Type has `username` + `password`. Backend expects `email` for OTP.

### E-5: `SeatingPlan.plan_type` Too Restrictive
`frontend/src/types/index.ts:878` — Only `'strict' | 'compact'`. Missing `'all_in_one'`.

### E-6: Dev JWT Secret is Predictable
`backend/app/config.py:225` — `f"dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret"` — deterministic and team-visible.

### E-7: Duplicate Permission Checks in main.py
Some routes check `require_permissions` with multiple OR-permissions that could be simplified.

### E-8: Token Decode Cache Allows 5-Minute Revocation Gap
`backend/app/utils/auth.py:19-20` — `_TOKEN_CACHE_TTL_SECONDS = 300`. Revoked tokens valid for up to 5 minutes.

---

## F. ARCHITECTURE MAP SUMMARY

| Metric | Value |
|--------|-------|
| Backend route files | 44 |
| Frontend page components | 84 |
| Supabase migrations | 77 (with duplicates) |
| Backend service files | 50 |
| Total lines of code | ~25,000+ |
| Git commits | 241 |
| Markdown reports | 89+ |
| Database schemas | 17 (partial grants) |
| Authentication systems | 2 (Supabase JS + Backend JWT/SQLAlchemy) |
