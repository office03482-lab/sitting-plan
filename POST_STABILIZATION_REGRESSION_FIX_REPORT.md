# POST STABILIZATION REGRESSION FIX REPORT

## 1. Exact Local Startup Root Cause

The reproducible local startup failure I could confirm was in `frontend/package.json`:

- `dev:local` was hard-pinned to `127.0.0.1:5173`
- on this machine, `5173` was already occupied
- Vite failed before the app could render, so the local app appeared not to open

This was an environment-triggered runtime failure, not a TypeScript/build failure. I changed `dev:local` to `vite --host 127.0.0.1` so Vite can start on the default port or fall forward cleanly when needed.

## 2. Exact Wrong Route Root Cause

The regression came from the recent startup stabilization patch in:

- `frontend/src/contexts/AuthProvider.tsx`
- function: `getDefaultRouteForUser()`

It explicitly redirected `platform_admin` to `/platform/dashboard`, which violated the required product contract.

Fix applied:

- introduced a single `DEFAULT_HOME_ROUTE = "/overview"`
- mapped both `platform_admin` and `school_admin` default login landing to `/overview`
- reused that constant in `App.tsx`, `Layout.tsx`, and `PlatformAdminRoute.tsx`

## 3. Exact Parent Infinite Loading Root Cause

The parent dashboard spinner had a real finite-state bug in:

- `frontend/src/pages/ParentDashboard.tsx`

Before fix:

- component state started with `loading = true`
- `useEffect()` returned early while `canRun` was false
- `canRun` depended on `authReady`
- recent auth patch had changed `authReady` to also wait for `sessionRegistrationReady`
- while that gate was false, the page never called `loadDashboard()`
- and since the page-level loading flag never transitioned, the spinner never terminated

There was a second contributing cause:

- parent no-child responses can come back as `404 No linked students found for this parent`
- the old UI treated that as generic error instead of an explicit empty state

## 4. Whether Auth Bootstrap Deadlock Existed

Yes, there was a user-visible readiness deadlock/stall pattern.

It was not a hard circular import problem, but it was a runtime gating deadlock:

- parent page waited for `authReady`
- `authReady` waited for `sessionRegistrationReady`
- page-local loading state stayed `true` while request flow never began

Fix applied:

- `authReady` now reflects authenticated + school-context-ready session state again
- session registration still exists and remains bounded
- parent dashboard now has explicit finite terminal states instead of one forever-spinner path

## 5. Whether GET Retry Loop Existed

No infinite GET retry loop was confirmed.

Audit result:

- retry path in `frontend/src/services/api.ts` remains bounded
- safe methods only: `GET`
- bounded retry count: max 2 retries
- final rejection still reaches UI

So:

- GET retry loop existed = `NO`
- GET retries are bounded = `YES`

## 6. Files Changed

- `frontend/package.json`
- `frontend/src/contexts/AuthProvider.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/components/PlatformAdminRoute.tsx`
- `frontend/src/pages/ParentDashboard.tsx`

## 7. Functions Changed

- `getDefaultRouteForUser()` in `frontend/src/contexts/AuthProvider.tsx`
- auth context value assembly in `frontend/src/contexts/AuthProvider.tsx`
- session registration timeout/retry block in `ensurePortalSessionRegistered()` in `frontend/src/contexts/AuthProvider.tsx`
- `AppShell()` routing in `frontend/src/App.tsx`
- `ParentDashboard()` state machine in `frontend/src/pages/ParentDashboard.tsx`

## 8. Before / After Flow

### Before

Login success
-> `getDefaultRouteForUser(platform_admin)`
-> `/platform/dashboard`

Parent dashboard
-> mount
-> `loading = true`
-> `canRun = false`
-> effect exits
-> no fetch
-> no state transition
-> infinite spinner

### After

Login success
-> `DEFAULT_HOME_ROUTE`
-> `/overview`

Parent dashboard
-> mount
-> auth/session/school-context gate evaluated
-> one of:
   - `loading`
   - `success`
   - `empty`
   - `unauthorized`
   - `session_expired`
   - `school_context_unavailable`
   - `error`

No infinite loading path remains in the dashboard flow.

## 9. Automated Test Results

- `python -m compileall app` = PASS
- `pytest` = PASS (`93 passed`)
- `npm run build` = PASS

## 10. Runtime Test Results

### Local runtime validation

- `npm run dev:local` = PASS after fix
- Vite served locally and returned HTTP `200`

### Local backend runtime validation

- Python import smoke test for `app.main` = PASS
- direct local `uvicorn` HTTP `/health` validation was inconclusive in this shell environment
- because of that, I am **not** claiming a full browser-verified local backend runtime PASS

### Browser/live validation

- live browser automation was not available in this turn
- I am **not** claiming live browser PASS for platform-admin login, school-admin login, or parent portal render

## 11. Remaining Risks

- Parent finite-state fix was applied directly to `ParentDashboard`. Other parent pages still use the older `loading=true` + early-return pattern and may deserve the same hardening if similar reports appear there.
- Local backend HTTP startup could not be fully verified from this environment even though imports, compile, and pytest passed.
- Live route behavior is now aligned in code with `/overview`, but I did not claim live browser verification without automation.

## Regression Matrix

| Symptom | Root Cause | File | Function / Hook | Fix |
|---|---|---|---|---|
| Local app does not open | `dev:local` hard-pinned to occupied port `5173` | `frontend/package.json` | npm script `dev:local` | removed fixed port binding |
| Platform Admin lands on wrong page | explicit redirect to `/platform/dashboard` | `frontend/src/contexts/AuthProvider.tsx` | `getDefaultRouteForUser()` | unified to `DEFAULT_HOME_ROUTE = "/overview"` |
| Parent portal infinite loading | page started with `loading=true` and returned early when `canRun` was false | `frontend/src/pages/ParentDashboard.tsx` | mount effect + `loadDashboard()` | added finite state model and terminal states |
| Auth bootstrap stall | `authReady` incorrectly depended on `sessionRegistrationReady` | `frontend/src/contexts/AuthProvider.tsx` | auth context value | removed registration from `authReady` gate |
| Session registration could hang per attempt | fetch had no explicit timeout | `frontend/src/contexts/AuthProvider.tsx` | `ensurePortalSessionRegistered()` | added `AbortController` timeout + bounded attempts |

## Final Verdict

- LOCAL APP OPENS = PASS
- PLATFORM ADMIN DEFAULTS TO OVERVIEW = PASS
- SCHOOL ADMIN DEFAULTS TO OVERVIEW = PASS
- PARENT PORTAL TERMINATES LOADING = PASS
- GET RETRIES ARE BOUNDED = PASS
- AUTH BOOTSTRAP HAS NO DEADLOCK = PASS
- REGRESSION FIX READY = NO

`NO` is intentional because live browser verification was not available, and local backend `/health` HTTP runtime could not be fully confirmed from this shell environment. The code-level regressions are fixed and automated validation is green, but I am separating that from full runtime sign-off as requested.
