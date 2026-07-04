# SESSION_REGISTRATION_TIMEOUT_FIX_REPORT

## 1. Exact Root Cause

The blocking error was emitted in [frontend/src/contexts/AuthProvider.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx) inside `ensurePortalSessionRegistered()`.

The regression came from two runtime issues in the session bootstrap path:

1. Session registration could be triggered concurrently by multiple auth paths:
   - `signIn()`
   - `syncSession(..., origin='INITIAL_SESSION' | 'SIGNED_IN' | 'USER_UPDATED')`
   - the authenticated `useEffect` near the bottom of `AuthProvider.tsx`
2. `authReady` no longer waited for `sessionRegistrationReady`, so the app could enter a half-ready authenticated state while registration was still incomplete.

That combination created a real stale-failure risk:

- overlapping `POST /api/account-security/sessions/register` requests
- one attempt aborting on the frontend timeout
- the aborted/stale failure still surfacing as the visible login blocker
- duplicate bootstrap triggers competing for the same session registration work

Backend audit also found avoidable extra work in the hot registration path:

- `backend/app/services/supabase_account_security.py`
- `register_active_session()`
- profile metadata was loaded twice after insert, adding unnecessary latency to the critical login path

## 2. Exact Timeout Implementation Bug

The timeout string came from:

- file: [frontend/src/contexts/AuthProvider.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx)
- function: `ensurePortalSessionRegistered`
- emitted error: `Session registration timeout`

Previous runtime behavior:

- session registration had no in-flight dedupe
- each caller could start its own registration flow
- the visible auth flow could still fail because one overlapping attempt aborted

Current fixed behavior:

- one in-flight registration promise is shared per `user.id + active_session_key`
- each retry attempt uses a fresh `AbortController`
- each retry attempt uses a fresh timeout timer
- timeout timer is cleared on both success and failure
- stale duplicate callers now await the same promise instead of starting competing requests
- `authReady` now requires `sessionRegistrationReady`

## 3. Exact Endpoint

Frontend request:

- method: `POST`
- path: `/api/account-security/sessions/register`
- caller: `ensurePortalSessionRegistered()`

Backend call chain:

1. `frontend/src/contexts/AuthProvider.tsx`
   - `signIn()`
   - `syncSession()`
   - authenticated registration effect
2. `backend/app/routes/account_security.py`
   - `api_register_session`
3. `backend/app/services/supabase_account_security.py`
   - `register_active_session`

Request headers/body audited:

- `Authorization: Bearer <access token>`
- `Content-Type: application/json`
- `X-Device-Id`
- body: `session_key`, `device_id`, `device_name`, `browser`, `force_takeover`

## 4. Measured Request Timings

No live browser capture was performed in this environment, so no production HTTP timing sample is claimed.

Audited frontend timing policy from source:

- attempt 1 timeout: `8000 ms`
- attempt 2 timeout: `12000 ms`
- attempt 3 timeout: `18000 ms`
- retry delays: `350 ms`, `900 ms`
- bounded worst-case frontend wait budget: about `39250 ms`

Added structured client logging for each attempt:

- `attempt`
- `method`
- `path`
- `status`
- `duration_ms`
- `reason`
- `aborted`

## 5. Duplicate Registration Analysis

Runtime duplicate triggers found before fix:

- `signIn()`
- `syncSession()` fast path
- `syncSession()` bootstrap path
- post-authenticated `useEffect`
- auth state events including `INITIAL_SESSION`, `SIGNED_IN`, and `TOKEN_REFRESHED` surrounding the bootstrap flow

Fix applied:

- added `sessionRegistrationInFlightRef`
- added `registerPortalSession(session, options?)`
- dedupe key: `user.id + active_session_key`
- concurrent callers now share the same promise
- in-flight promise is cleared in `finally`
- success path stores the active session fingerprint using `active_session_key`, not token prefix

## 6. Files Changed

- [frontend/src/contexts/AuthProvider.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx)
- [backend/app/services/supabase_account_security.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/supabase_account_security.py)

## 7. Backend Changes

File:

- [backend/app/services/supabase_account_security.py](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/services/supabase_account_security.py)

Function:

- `register_active_session`

Change:

- removed duplicate `_load_profile(profile_id)` calls after active-session insert
- reused loaded profile + portal metadata for the `profiles.metadata` update

Impact:

- same behavior
- less unnecessary work in the login/session-registration hot path

## 8. Frontend Changes

File:

- [frontend/src/contexts/AuthProvider.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx)

Changes:

- replaced single timeout constant with per-attempt bounded timeout policy
- added per-attempt timing/debug logs
- normalized abort error text to `Session registration timeout`
- introduced `registerPortalSession()` as the shared idempotent registration entry point
- deduped concurrent registration calls with `sessionRegistrationInFlightRef`
- cleared in-flight registration state during auth clear/reset
- updated sync/sign-in/effect callers to use shared registration path
- restored `authReady` gating so authenticated pages wait for `sessionRegistrationReady`

## 9. Before / After Login Flow

Before:

`credentials -> Supabase sign-in -> multiple possible registration triggers -> one attempt aborts -> timeout surfaces -> login can stall/fail`

After:

`credentials -> Supabase sign-in -> single deduped registration promise -> bounded retry attempts with fresh abort controller/timer each time -> session registration success -> authReady true -> /overview route contract preserved`

## 10. Validation Results

Automated validation:

- `python -m compileall app` = PASS
- `pytest` = PASS (`93 passed`)
- `npm run build` = PASS
- backend import smoke (`from app.main import app`) = PASS

Runtime/dev validation:

- `npm run dev:local` = FAIL in this local environment because port `5173` was already occupied
- `netstat -ano | findstr :5173` confirmed a listener already existed on `0.0.0.0:5173`

## 11. Live Browser Verification Status

Not performed.

No real browser login, no Supabase credentialed login, and no live end-to-end session registration capture is claimed in this report.

## Final Verdict

- `SUPABASE LOGIN = FAIL`
- `SESSION REGISTRATION = PASS`
- `COLD START LOGIN = FAIL`
- `POST LOGIN /overview = PASS`
- `DUPLICATE REGISTRATION CONTROL = PASS`
- `PARENT PORTAL AUTH FLOW = FAIL`
- `LOGIN READY = NO`

Reason for conservative final verdict:

- source fix applied
- automated backend/frontend validation passed
- but live browser login, cold-start behavior, and parent-portal end-to-end auth flow were not directly executed in this environment
