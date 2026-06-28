# AUTH FINAL MIGRATION REPORT

## Final Verdict

AUTH FULLY SUPABASE NATIVE = NO

Reason:
- The audited live auth path no longer queries the legacy `users` table.
- The backend still contains legacy `User` ORM definitions and non-request-path references in scripts/bootstrap code, so the codebase is not yet fully Supabase-native end to end.

## Scope Audited

- `backend/app/middleware/auth.py`
- `backend/app/utils/auth.py`
- `backend/app/routes/auth.py`
- `backend/app/services/auth_security.py`
- Repo-wide search for:
  - `db.query(User)`
  - `session.query(User)`
  - `User.email`
  - `User.id`
  - `User.role`
  - `User.permissions`
  - `FROM users`
  - `User(`
  - `query(User)`
  - `relationship("User")`

## Legacy References Found

### Removed From Live Auth Path

- `backend/app/middleware/auth.py`
  - Removed `db.query(User)` by id/email fallback from request principal resolution.
- `backend/app/routes/auth.py`
  - Removed `db.query(User)` from `/send-otp`
  - Removed `db.query(User)` and local user auto-create from `/verify-otp`
  - Removed `db.query(User)` password login lookup from `/login-password`
  - Removed local refresh token validation/user lookup from `/refresh`
  - Removed logout lookup `db.query(User).filter(User.id == token_record.user_id)`
- `backend/app/services/auth_security.py`
  - Removed local JWT issue/refresh/OTP helpers that still depended on `User`, `Token`, and `db.query(User)`

### Still Present Outside Live Auth Request Path

- `backend/app/models/__init__.py`
  - `User` ORM model still defines `__tablename__ = "users"`
  - Relationships and foreign keys still point at `users`
- `backend/app/services/admin_bootstrap.py`
  - Still queries `User`
- `backend/setup_db_script.py`
  - Still queries `User`
- `backend/scripts/final_go_closure_validation.py`
  - Still queries `User`
- `backend/tests/test_auth_security.py`
  - Still assumes local `User`-table auth flow

## Files Modified

- `backend/app/middleware/auth.py`
- `backend/app/routes/auth.py`
- `backend/app/services/auth_security.py`
- `backend/app/services/supabase_admin.py`
- `backend/app/schemas/__init__.py`

## Before / After

### Middleware Principal Resolution

Before:
- JWT `sub` or `email` tried `db.query(User)` against `users`
- Supabase principal resolution was only a fallback

After:
- JWT principal resolves from Supabase only
- Source of truth is now:
  - `profiles`
  - `school_memberships`
  - `roles`
  - `role_permissions`
- Invalid non-UUID `sub` values now fail closed instead of causing a Supabase UUID lookup crash

### Auth Route Flows

Before:
- OTP send/verify used local DB-backed auth flow
- Password login used local `User` password hash lookup
- Refresh/logout used local token lifecycle tied to local user lookup

After:
- OTP send uses Supabase Auth OTP
- OTP verify uses Supabase Auth session verification
- Password login uses Supabase Auth password sign-in
- Refresh uses Supabase Auth session refresh
- Logout uses Supabase Auth sign-out after refresh/session restore
- Login responses are built from Supabase JWT + principal resolution, not from local `users`

### Auth Security Service

Before:
- Contained local JWT issuance, local refresh token validation, OTP storage, and local `User` lookups

After:
- Reduced to throttling/audit helpers only for the active auth flow
- Legacy local-user auth lifecycle helpers removed from runtime use

## Validation

### `python -m compileall app`

PASS

### `pytest auth tests`

FAIL

Command run:
- `pytest tests/test_auth_security.py`

Observed failures:
- Legacy tests still expect local `User`-table password login and local OTP behavior
- Example failures:
  - local JWT test users now get `401` instead of local-role evaluation
  - `/api/auth/login-password` tests expect local DB auth, but the route now requires valid Supabase Auth users
  - `/api/auth/send-otp` tests expect local/debug OTP generation, but the route now delegates to Supabase Auth OTP

## PASS / FAIL Summary

- Live auth middleware no longer references `users` table at request resolution time: PASS
- Live auth routes no longer query `users`: PASS
- Fallback into legacy ORM from audited auth path removed: PASS
- Actor context built from Supabase JWT + principal tables in audited path: PASS
- Full backend purge of legacy `User` artifacts: FAIL
- Requested auth pytest suite: FAIL

## Recommended Next Steps

- Remove or isolate remaining legacy `User` ORM/bootstrap/script code
- Decide whether compatibility shims are still needed for routes expecting `User`-shaped objects
- Replace `tests/test_auth_security.py` with Supabase-native auth tests or add Supabase test doubles/mocks
