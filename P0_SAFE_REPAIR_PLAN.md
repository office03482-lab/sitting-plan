# P0 SAFE REPAIR PLAN

**Audit Date:** 2026-07-06
**Based on:** Verified Phase 1.5 findings

---

## VERIFIED P0 INVENTORY

After complete verification, **NO blocking P0 issues exist** that prevent the application from running.

The following were **DISPROVED** as P0:
- ~~Hybrid auth conflict~~ → P2 architectural debt
- ~~Missing schema grants~~ → service_role bypasses grants
- ~~Duplicate migrations~~ → Only 1 real collision
- ~~Committed secrets~~ → No secrets ever in git
- ~~Redis hard dependency~~ → Dead config

---

## REAL ISSUES (Ranked by actual impact)

| ID | Issue | Severity | Type | Blocks Production? |
|----|-------|----------|------|-------------------|
| R1 | `supabase_migrations.schema_migrations` relation error | **P1** | Database | ❓ Unknown migration state |
| R2 | No migration step in Render start command | **P1** | Deployment | ✅ Production may have stale schema |
| R3 | JWT dev secret deterministic (config.py:225) | **P1** | Security | ❓ Only if production doesn't override |
| R4 | Inventory double hash useEffects cause 9-request cascade | **P1** | Frontend | ❌ Degrades UX but doesn't block |
| R5 | 82 bare `except Exception` in services | **P1** | Backend | ❌ Masks errors but doesn't block |
| R6 | Migration version collision at `20260611_032` | **P2** | Database | ❓ One migration may be missing |

---

## SAFE FIRST REPAIR

**Name:** Investigate `supabase_migrations.schema_migrations` missing relation

**Why first:** Without knowing the actual migration state, every other database change carries unknown risk. This is the single highest-uncertainty item.

---

## FULL REPAIR PLAN (Forward-Only, Non-Destructive)

### Step 1: Diagnose Migration State

**Evidence:** `P0_PARENT_PORTAL_MODULE_LOADING_FIX_REPORT.md:195` documents a `42P01` error for `supabase_migrations.schema_migrations`.

**Pre-check:** Run (read-only):
```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'supabase_migrations' 
  AND table_name = 'schema_migrations'
);
```

**If table exists (but has wrong structure):**
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
```

**If table does not exist (42P01 confirmed):**
Options:
1. Re-initialize via Supabase CLI: `supabase migration list` (outside this repo's scope)
2. Create a forward migration to recreate the tracking table
3. Accept the gap and switch fully to Alembic

**Do NOT:** Create `supabase_migrations` schema manually or guess the applied migrations.

---

### Step 2: Fix Render Deployment Migration Gap

**Files:** `render.yaml`

**Change:** Add `alembic upgrade head` to the start command.

**Current:**
```yaml
startCommand: gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --workers 3
```

**Proposed:**
```yaml
startCommand: alembic upgrade head && gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --workers 3
```

**Pre-check:** Ensure production `DATABASE_URL` is set in Render dashboard.

**Rollback:** Revert the start command to original.

---

### Step 3: Fix `20260611_032` Migration Collision

**Do NOT rename already-applied migration files.**

**Action:** Create a forward-fixing SQL migration (e.g., `20260706_069_fix_032_collision_hostel_vacated_state.sql`) that:
1. Checks if `hostel.hostel_requests.vacated_at` column exists
2. If NOT, runs the missing ALTER TABLE

**SQL:**
```sql
-- Forward-fix: Apply the missing hostel vacated state migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'hostel' 
    AND table_name = 'hostel_requests' 
    AND column_name = 'vacated_at'
  ) THEN
    ALTER TABLE hostel.hostel_requests 
      ADD COLUMN vacated_at TIMESTAMPTZ,
      ADD COLUMN vacated_by_profile_id UUID REFERENCES public.profiles(id);
  END IF;
END $$;
```

**Pre-check:** Run the DO block as a read-only check first (just the SELECT part).

---

### Step 4: Fix JWT Dev Secret (If Production Uses Default)

**Pre-check:** Check if `JWT_SECRET` env var is set in Render dashboard. If `sync: false` and actually set → no action needed.

**If production uses dev default:**
- Set a strong `JWT_SECRET` in Render dashboard
- Note: Changing JWT_SECRET invalidates ALL existing sessions/users JWT tokens
- Plan a maintenance window for this change

**Rollback:** Revert the env var in Render dashboard.

---

### Step 5: Fix Inventory Hash UseEffects

**Files:** `frontend/src/pages/InventoryManagement.tsx:350-427`

**Pre-check:** Read the two `useEffect` blocks that parse `location.hash`. Verify they do identical work.

**Fix:** Remove the duplicate `useEffect`. Consolidate into a single `useEffect` with proper cleanup.

**Test:** Verify hash-based navigation still works (navigating between inventory tabs).

**Rollback:** Restore the original useEffect blocks.

---

### Step 6: Fix Bare `except Exception` Pattern

**Strategy:** Do NOT mass-edit all 82 occurrences at once. Apply a progressive pattern:

1. Add `logger.exception(...)` to bare exceptions in critical paths first (auth, attendance, inventory)
2. Focus on the top 20 riskiest (those in request handlers, not helper functions)
3. Each change: replace `except Exception:` with `except Exception as e: logger.exception("...")`

**Files:** All `backend/app/services/supabase_*.py` files.

**Pre-check:** Identify which 20 are in request-handling paths vs utility functions.

---

## DO NOT (Hard Constraints)

| Action | Reason |
|--------|--------|
| Rename applied migration files | Breaks migration chain if already recorded in DB |
| Create GRANT USAGE ON SCHEMA for missing schemas | Unnecessary — service_role bypasses grants. Only create if changing to RLS-based auth. |
| Remove SQLAlchemy User model / legacy auth | Dead code but removal carries risk of breaking some path not yet discovered |
| Mass-edit 180 API methods | Too high change surface. Fix specific callers with AbortController instead. |
| Rotate secrets automatically | No evidence of exposure. Rotate during a planned maintenance window. |
| Disable RLS | Not needed — backend uses service_role which already bypasses RLS. Should actually enable RLS for anon key access. |

---

## DEPLOYMENT ORDER

```
Step 1: Diagnose migration state (read-only SQL)
  ↓ (if missing migration tracking)
Step 2: Forward-fix migration for 032 collision
  ↓
Step 3: Fix Render start command (add alembic upgrade head)
  ↓
Step 4: Fix JWT dev secret (if needed, with maintenance window)
  ↓
Step 5: Fix Inventory hash useEffects
  ↓
Step 6: Fix bare except (progressive)
```

## SUCCESS CRITERIA

- [ ] `supabase_migrations.schema_migrations` table exists and is queryable
- [ ] All expected migrations are recorded in the table
- [ ] Render start command includes migration step
- [ ] No 42P01 errors in logs
- [ ] JWT secret is a strong, non-deterministic value in production
- [ ] Inventory tab navigation works without duplicate hash parsing
- [ ] Backend error logs show specific exception messages, not blank "Internal Server Error"
