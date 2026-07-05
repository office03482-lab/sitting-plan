# P0 Runtime Request Explosion Fix Report

## Root Cause

The parent dashboard loading path made **~20+ Supabase PostgREST queries per linked student** in a sequential loop. For a parent with 3 children, a single dashboard load generated **60+ queries**. Combined with:

1. **Analytics writes on reads**: `get_student_analytics()` wrote to `analytics_student_performance` and `analytics_topic_performance` on every cache miss via PATCH/INSERT
2. **`edupay_fee_assignments` 404 errors**: The table `edupay_fee_assignments` does not exist in Supabase (only in legacy SQLite/Alembic), producing an exception per student per dashboard load
3. **N+1 guardian resolution**: `_list_parent_linked_students()` queried `academic.guardians` individually for each guardian row (one SELECT per guardian)

## Changes Made

### 1. N+1: `_list_parent_linked_students()` — supabase_lms.py:433-470

**Before**: Queried `academic.guardians` with `SELECT id` (all rows), then per guardian ran `SELECT id, profile_id, email ... LIMIT 1` (N+1).

**After**: Single query `SELECT id, profile_id, email` — no per-row loop.

**Impact**: Guardian resolution reduced from `1 + N` queries to `1` query.

### 2. N+1: `_student_parent_payload()` — supabase_parent_intelligence.py

**Before**: Called per student in a list comprehension, each making ~9 queries (attendance, live attendance, test results, analytics, progress, assignments, study plans, hostel, discipline).

**After**: Added `_batch_student_parent_payloads()` that pre-loads attendance, live attendance, test results, study plans, discipline records, and hostel requests for **all students at once** using `in_()` filters, then passes pre-grouped data to each student's payload builder.

**Impact**: Per-student queries reduced from `N × (num_data_sources)` to `1 × (num_data_sources)` — domain-linear to constant in number of students for these data sources. Analytics, progress, assignments still called per student but with writes removed (see below) and bounded by their own caches.

### 3. `edupay_fee_assignments` 404 — parent_portal_service.py:191-218

**Before**: Queried only `public.edupay_fee_assignments` (does not exist in Supabase), producing per-student exceptions.

**After**: Fallback chain tries:
- `public.edupay_fee_assignments` (legacy, may exist in some environments)
- `finance.fee_assignments`
- `edupay.fee_assignments`
- `public.fee_assignments`
- `public.student_fees`

If all fail, returns `{"status": "unavailable", ...}` gracefully.

**Impact**: No more per-student 404 exceptions. Fee widget degrades gracefully when table is absent.

### 4. Analytics writes in GET path — supabase_analytics.py:598-733

**Before**: `get_student_analytics()` wrote PATCH/INSERT to `analytics_student_performance`, `analytics_topic_performance`, and `audit_logs` on every cache miss.

**After**: Writes removed from `get_student_analytics()`. New function `persist_student_analytics()` created for explicit callers. Only called from the explicit analytics API route (`/api/analytics/student/{id}`), not from dashboard read paths.

**Impact**: Dashboard reads no longer trigger analytics writes. Each `get_student_analytics()` call saves 2-3 database mutations.

### 5. Retry layer audit (frontend)

`api.ts`: Retry is bounded (max 2 retries), only for GET, only on 502/503/504. No amplification for 404/AbortError. No changes needed.

### 6. Auth bootstrap audit (frontend)

`buildAppUserFromSession()` only loads profiles, school_memberships, role_permissions (3 queries). No dashboard data is loaded during auth bootstrap. Already separated from dashboard data loading. No changes needed.

## Verification

- `python -m compileall`: 0 errors
- `pytest`: 93/93 passed
- `tsc --noEmit`: 0 errors
- `vitest run`: 14/14 passed

## Files Modified

| File | Change |
|------|--------|
| `backend/app/services/supabase_lms.py:433-470` | Fixed N+1 guardian query |
| `backend/app/services/supabase_parent_intelligence.py:491-660` | Added batch data loading, batch parent payload builder |
| `backend/app/services/supabase_parent_intelligence.py:754-863` | Updated 4 callers to use batch version |
| `backend/app/services/parent_portal_service.py:191-218` | Added fee table fallback chain |
| `backend/app/services/supabase_analytics.py:598-733` | Removed writes from `get_student_analytics()`, added `persist_student_analytics()` |
| `backend/app/routes/analytics.py:107-109` | Call `persist_student_analytics` on explicit analytics access |
| `backend/app/routes/parent_portal.py:326-344` | Updated legacy routes to use batch version |

## Next Steps

1. Deploy to staging and verify request count reduction in Supabase logs
2. Monitor `analytics_*` tables for stale data (analytics writes now only happen on explicit analytics endpoint access, not on dashboard reads)
3. Add background job for periodic analytics recomputation if needed
4. Confirm `fee_assignments` table name in production Supabase and remove fallback chain entries that are never hit
