# FINAL RUNTIME DEPENDENCY AUDIT

## Scope

Audited every remaining import of:

- `User`
- `SessionLocal`
- `Base`

Classification labels used in this report:

- `Runtime Executed`: reachable from FastAPI startup or a real request path
- `Lazy Imported`: imported inside a function/body and only resolved when that branch runs
- `Type Hint Only`: imported only to satisfy annotations/signatures; not called as a class or used in ORM queries directly
- `Unused Import`: imported but not referenced
- `Dead Import`: only reachable from standalone scripts or migration tooling, not from the FastAPI app request/startup graph

## Totals

- Total imports audited: `44`
- Runtime executed: `5`
- Lazy imported: `0`
- Type hint only: `32`
- Unused imports: `0`
- Dead imports: `7`

## Import Classification

### `User` imports

Total: `35`

#### Runtime Executed

- [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:17)
  - Real request path executes `User(...)` in:
    - `_build_synthetic_user_from_supabase()`
    - `get_authenticated_user()` OPTIONS preflight branch

#### Type Hint Only

- [backend/app/attendance/native/router.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/attendance/native/router.py:10)
- [backend/app/routes/account_security.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/account_security.py:12)
- [backend/app/routes/ai_agents.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/ai_agents.py:8)
- [backend/app/routes/ai_assistants.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/ai_assistants.py:8)
- [backend/app/routes/ai_tutor.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/ai_tutor.py:10)
- [backend/app/routes/analytics.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/analytics.py:8)
- [backend/app/routes/attendance.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/attendance.py:19)
- [backend/app/routes/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/auth.py:10)
- [backend/app/routes/bi.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/bi.py:10)
- [backend/app/routes/billing.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/billing.py:9)
- [backend/app/routes/bulk_action_requests.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/bulk_action_requests.py:8)
- [backend/app/routes/credits.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/credits.py:8)
- [backend/app/routes/doubts.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/doubts.py:10)
- [backend/app/routes/entitlement.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/entitlement.py:8)
- [backend/app/routes/live_classes.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/live_classes.py:8)
- [backend/app/routes/lms.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/lms.py:8)
- [backend/app/routes/online_tests.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/online_tests.py:9)
- [backend/app/routes/parent_links.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/parent_links.py:9)
- [backend/app/routes/parent_portal.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/parent_portal.py:11)
- [backend/app/routes/platform.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/platform.py:9)
- [backend/app/routes/predictions.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/predictions.py:8)
- [backend/app/routes/reports.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/reports.py:14)
- [backend/app/routes/staff.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/staff.py:10)
- [backend/app/routes/students.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/students.py:16)
- [backend/app/routes/study_planner.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/study_planner.py:8)
- [backend/app/routes/teacher_ai.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/teacher_ai.py:8)
- [backend/app/routes/timetable.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/timetable.py:21)
- [backend/app/routes/uploads.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/routes/uploads.py:8)
- [backend/app/services/bulk_action_requests.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/bulk_action_requests.py:10)
- [backend/app/services/entitlement_engine.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/entitlement_engine.py:18)
- [backend/app/services/route_retrofit.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/route_retrofit.py:12)
- [backend/app/services/scope_engine.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/scope_engine.py:8)

Reason:
- In these files `User` is used in annotations, dependency signatures, or helper signatures.
- The symbol `User` is not instantiated, queried, or used for class-level ORM operations inside these modules.

#### Dead Imports

- [backend/setup_db_script.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/setup_db_script.py:9)
- [backend/scripts/final_go_closure_validation.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/scripts/final_go_closure_validation.py:13)

Reason:
- Standalone script entrypoints only.
- Not reachable from the FastAPI request/startup graph.

### `SessionLocal` imports

Total: `6`

#### Runtime Executed

- [backend/app/main.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/main.py:13)
  - Executed by `/readyz`
- [backend/app/attendance/schema_checks.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/attendance/schema_checks.py:3)
  - Executed during production startup and `/readyz`
- [backend/app/services/timetable_schema_checks.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/timetable_schema_checks.py:5)
  - Executed during production startup and `/readyz`

#### Dead Imports

- [backend/populate_sample_data.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/populate_sample_data.py:13)
- [backend/setup_db_script.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/setup_db_script.py:8)
- [backend/scripts/final_go_closure_validation.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/scripts/final_go_closure_validation.py:11)

### `Base` imports

Total: `3`

#### Runtime Executed

- [backend/app/models/__init__.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/models/__init__.py:9)
  - Executed when ORM model classes are declared

#### Dead Imports

- [backend/alembic/env.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/alembic/env.py:9)
- [backend/migrate_batches.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/migrate_batches.py:11)

## Call Graph

### Request path that still executes legacy `User` ORM class code

1. HTTP request to a protected route
2. FastAPI dependency resolution
3. `app.main` router dependency: `Depends(get_authenticated_user)`
4. [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:526) `get_authenticated_user()`
5. [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:350) `_resolve_request_principal()`
6. [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:253) `_fetch_supabase_principal()`
7. [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:337) `_build_synthetic_user_from_supabase()`
8. `User(...)` constructor executes
9. Synthetic `User` instance is passed into downstream route/service dependencies

### OPTIONS / preflight path

1. HTTP `OPTIONS` request to a protected route
2. `get_authenticated_user()`
3. Immediate `User(...)` constructor for the preflight sentinel user

### Request/startup path that executes `SessionLocal`

1. Production startup
2. `app.main.lifespan()`
3. `verify_attendance_schema()` and `verify_timetable_schema()`
4. `SessionLocal()`
5. Metadata checks only against `information_schema` / `pg_proc`

And:

1. HTTP `GET /readyz`
2. `app.main.readiness_check()`
3. `SessionLocal()`
4. `SELECT 1`
5. Optional schema checks above

## Request-Path Verification

### Can a request path execute `User` ORM?

Yes.

Confirmed runtime execution points:

- [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:338) `synthetic_user = User(...)`
- [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:528) preflight `return User(...)`

### Can a request path execute `SessionLocal` users query?

No.

Reachable `SessionLocal` usage from the app request/startup graph is limited to:

- `/readyz` health check
- production startup schema verification

Observed queries there:

- `SELECT 1`
- `information_schema.tables`
- `pg_proc`

No request/startup path was found that combines `SessionLocal()` with `db.query(User)` or a `users` table query.

### Can a request path execute the `users` table?

Not via query paths audited in the live FastAPI app.

Repo-wide request-path findings:

- `query(User)` in `backend/app`: not found
- `db.query(User)` in `backend/app`: not found
- `session.query(User)` in `backend/app`: not found
- `FROM users` in `backend/app`: not found

Still present outside request path:

- [backend/app/models/__init__.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/models/__init__.py:76) `__tablename__ = "users"`
- standalone scripts under `backend/`

## Practical Interpretation

- The legacy `users` table is no longer queried by the live FastAPI request path audited here.
- `SessionLocal` is still live, but only for readiness/schema checks, not for legacy user lookup.
- The legacy `User` ORM class itself is still executed at runtime because auth middleware constructs synthetic `User` instances for authenticated and preflight requests.

## Final Verdict

Runtime Legacy Risk = YES

Reason:
- A real production request can still execute legacy `User` ORM code in [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:338) and [backend/app/middleware/auth.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py:528).
- No real production request path audited here still queries the legacy `users` table.
