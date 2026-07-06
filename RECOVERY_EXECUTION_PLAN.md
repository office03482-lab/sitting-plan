# RECOVERY EXECUTION PLAN — Dr. Girish App (CORRECTED)

**Audit Date:** 2026-07-06
**Target:** Stable production deployment
**Estimated Effort:** 2-3 weeks (team of 1-2 developers)

---

## PHASE 1.5 VERIFICATION SUMMARY

The Phase 1.5 audit corrected several assumptions. Key corrections:
- **No secrets were ever committed** to git (DISPROVED)
- **Redis is dead config** — never used (DISPROVED as dependency)
- **Schema GRANTs are NOT blocking** — backend uses `service_role` key which bypasses grants
- **Auth hybrid is architectural debt** — not a blocking P0; systems coexist safely
- **Only 1 true migration collision** exists (`20260611_032`) — rest are naming confusion
- **No modules are BROKEN** — 23 HEALTHY, 9 DEGRADED, 0 BROKEN
- **Inventory/Finance grants were already repaired** in migration 024
- **Request storm claims were overestimated** — actual count is ~6 Supabase queries + 4-5 API calls per page load

---

## DEPENDENCY-AWARE RECOVERY ORDER

```
Phase 0: Diagnose Migration State (Day 1)
Phase 1: Fix Migration Collision (Day 1)
Phase 2: Production Deployment Pipeline (Days 1-2)
Phase 3: JWT Secret Validation (Days 2-3)
Phase 4: High-Impact Frontend Fixes (Days 3-7)
Phase 5: Error Handling Improvement (Days 7-10)
Phase 6: Legacy Code Cleanup (Days 10-14)
Phase 7: Testing & CI/CD (Days 14-17)
Phase 8: Security Hardening (Days 17-21)
```

---

## PHASE 0: DIAGNOSE MIGRATION STATE (Day 1)

### R1: Investigate `supabase_migrations.schema_migrations` Missing Relation
**Evidence:** `P0_PARENT_PORTAL_MODULE_LOADING_FIX_REPORT.md:195` — 42P01 error documented
**Action:** Run read-only SQL diagnostics:
```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'supabase_migrations'
  AND table_name = 'schema_migrations'
);
```
**If table exists:**
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
```
**If table does not exist:**
- Option A: Initialize migration tracking via Supabase CLI
- Option B: Switch fully to Alembic and deprecate SQL migrations
- Option C: Create a forward migration to recreate tracking table (last resort)
**Risk if skipped:** Migration state is permanently unknown

---

## PHASE 1: FIX MIGRATION COLLISION (Day 1)

### R6: Fix `20260611_032` Version Collision
**Evidence:** Two files share the exact same version identifier `20260611_032`:
1. `academic_schema_service_role_grants.sql` — GRANTs for `academic` schema
2. `hostel_request_vacated_state.sql` — ALTER TABLE for `hostel.hostel_requests`

**Pre-check:** Query whether `hostel.hostel_requests.vacated_at` column exists:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'hostel' AND table_name = 'hostel_requests'
AND column_name = 'vacated_at';
```

**Action:** Create forward-fixing migration `20260706_069_fix_032_collision_hostel_vacated_state.sql`:
```sql
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

**Do NOT rename** `20260611_032_hostel_request_vacated_state.sql` — it may already have been applied.
**Rollback:** The DO block is idempotent — safe to re-run.

---

## PHASE 2: PRODUCTION DEPLOYMENT PIPELINE (Days 1-2)

### R2: Add Migration Step to Render Start Command
**Files:** `render.yaml`
**Current:**
```yaml
startCommand: gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --workers 3
```
**Proposed:**
```yaml
startCommand: alembic upgrade head && gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --workers 3
```
**Pre-check:** Verify `DATABASE_URL` env var is set in Render dashboard
**Risk if skipped:** Production schema may drift from migration files
**Rollback:** Revert the startCommand

---

## PHASE 3: JWT SECRET VALIDATION (Days 2-3)

### R3: Verify JWT Secret in Production
**Evidence:** `config.py:225` has deterministic dev fallback:
```python
jwt_secret: str = Field(default=f"dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret")
```
**Action:**
1. Check `JWT_SECRET` env var in Render dashboard
2. If `sync: false` and value IS SET → no action needed
3. If using dev fallback → generate strong secret and set via Render dashboard
4. **Plan maintenance window** — changing JWT_SECRET invalidates all existing tokens
**Rollback:** Restore previous JWT_SECRET in Render dashboard

---

## PHASE 4: HIGH-IMPACT FRONTEND FIXES (Days 3-7)

### R4: Fix Inventory Duplicate Hash UseEffects
**Files:** `frontend/src/pages/InventoryManagement.tsx:350-427`
**Action:** Remove one of the two competing `parse(location.hash)` useEffect blocks
**Pre-check:** Read both effects to confirm they do identical work
**Test:** Verify tab navigation in inventory (materials, stock-in, stock-out, suppliers)
**Rollback:** Restore the removed useEffect

### Fix Student Type Mismatch
**Files:** `frontend/src/types/index.ts:668-669`
**Action:** Remove `name` field or add mapper for `full_name` → `name`
**Impact:** Student names display as blank/undefined in lists

### Fix `isTemporarilyUnavailableDataError` Masking
**Files:** `frontend/src/services/api.ts:49-54`
**Action:** Narrow the function to only catch transient errors (network timeout, 503), not all 422/500
**Risk if skipped:** Real bugs are silently masked as "temporarily unavailable"

---

## PHASE 5: ERROR HANDLING IMPROVEMENT (Days 7-10)

### R5: Fix Top 20 Bare `except Exception`
**Strategy:** Progressive, not mass-edit
**Targets (in order of priority):**
1. Request handlers in `routes/attendance.py`, `routes/inventory.py`
2. Service methods with side effects (write operations)
3. Utility functions (lowest priority)
**Pattern:**
```python
# Before
except Exception:
    return JSONResponse(status_code=500, content={"detail": "Internal error"})

# After
except Exception as e:
    logger.exception("Attendance overview failed for school %s", school_id)
    return JSONResponse(status_code=500, content={"detail": "Internal error"})
```
**Pre-check:** List all 82 occurrences, identify top 20 in critical paths
**Rollback:** Revert individual file changes

---

## PHASE 6: LEGACY CODE CLEANUP (Days 10-14)

### Remove Dead Auth Routes (P2)
**Files:** `backend/app/routes/auth.py` (login-password, send-otp, verify-otp sections)
**Action:** Add deprecation warning logs, do NOT remove yet
**Rationale:** Routes are dead (no frontend calls them) but may be used by mobile or external tools

### Clean Up Dead Redis Config
**Files:** `backend/app/config.py:60`, `render.yaml:49`
**Action:** Remove `redis_url` from config (or change to `Optional[str] = None`)
**Impact:** None — Redis is never used

### Add Limit to Unbounded Queries
**Files:** `platform_control_plane.py:471,762,775,934`, `subscription_engine.py:1042`
**Action:** Add `.limit(100)` default to unbounded select("*") queries
**Risk if skipped:** API returns unbounded data on large deployments

---

## PHASE 7: TESTING & CI/CD (Days 14-17)

### Create Basic CI Pipeline
- Python lint (ruff), mypy type checking, ts-check on frontend
- GitHub Actions

### Test Auth Bootstrap Flow
- Login → Bootstrap → Authenticated → API call
- Verify session registration succeeds

### Test Top 10 API Endpoints
- Dashboard metrics, Student CRUD, Attendance overview, Inventory list

---

## PHASE 8: SECURITY HARDENING (Days 17-21)

### Rotate Secrets (Proactive)
- SUPABASE_SERVICE_ROLE_KEY
- GEMINI_API_KEY
- JWT_SECRET
- **Rationale:** Best practice, not because of proven exposure

### Enable RLS for anon key protection
- **Note:** This is a separate initiative. Currently, backend uses service_role which bypasses RLS.
- If frontend ever uses Supabase JS client directly for user queries, RLS is needed.

---

## CORRECTED SUMMARY TABLE

| Phase | Issue | Original Classification | Corrected Classification | Effort |
|-------|-------|------------------------|--------------------------|--------|
| 0 | Migration state unknown | Not flagged | **P1** | 2 hours |
| 1 | Migration 032 collision | P0 (all 6 pairs) | **P2** (only 1 real) | 2 hours |
| 2 | No migration in deploy | Not flagged | **P1** | 1 hour |
| 3 | JWT dev secret deterministic | Not flagged | **P1** | 1 hour |
| 4 | Inventory hash useEffects | P0 (schema grants) | **P1** (2 competing useEffects) | 4 hours |
| 4 | Student type mismatch | P1 | **P2** | 1 hour |
| 4 | Error masking | P2 | **P2** | 2 hours |
| 5 | Bare except Exception | P1 | **P1** (top 20 of 82) | 2-3 days |
| 6 | Dead auth routes | P0 (hybrid auth) | **P2** | 1 day |
| 6 | Dead Redis config | P0 | **P5 (dead)** | 30 min |
| 6 | Unbounded queries | P1 | **P1** (4 queries verified risky) | 1 day |
| 8 | Secret rotation | P0 (claimed exposure) | **P3** (proactive, not reactive) | 1 hour |

---

## SUCCESS CRITERIA

- [ ] `supabase_migrations.schema_migrations` table exists and is queryable
- [ ] `hostel.hostel_requests.vacated_at` column exists
- [ ] Render start command includes `alembic upgrade head`
- [ ] Production JWT_SECRET is a strong non-deterministic value
- [ ] Inventory tab navigation works without duplicate hash effects
- [ ] API error responses include descriptive log entries (not blank 500s)
- [ ] No 42P01 errors in logs
- [ ] Student names display correctly in all lists
- [ ] 422/500 errors are NOT silently masked as transient
