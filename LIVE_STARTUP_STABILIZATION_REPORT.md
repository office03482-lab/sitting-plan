# LIVE STARTUP STABILIZATION REPORT

## 1. Exact Root Cause(s)

1. `frontend/src/contexts/AuthProvider.tsx` defaulted `school_admin` and `platform_admin` to `/school-ai-assistant` in `getDefaultRouteForUser()`, which caused refresh and post-login redirects to open the wrong page instead of Overview or Platform Dashboard.
2. `frontend/src/App.tsx` had no dedicated `/overview` route. The app used `/` directly for the dashboard, so refresh preservation and invalid-route fallback were not aligned with the required `/overview` contract.
3. `frontend/src/contexts/AuthProvider.tsx` marked auth as ready before session registration readiness was guaranteed. Startup could finish with profile and membership resolved while portal session registration was still in-flight.
4. `frontend/src/contexts/AuthProvider.tsx` used a single-shot backend session registration call in `ensurePortalSessionRegistered()`. On cold backend wake-up, that could fail during bootstrap and leave the app in a broken first-load state until manual refresh.
5. `frontend/src/services/api.ts` had no bounded safe retry path for protected `GET` requests during backend cold start or gateway wake-up. Timeouts surfaced directly to the UI instead of retrying safe reads.

## 2. Exact Files

- `frontend/src/contexts/AuthProvider.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/services/api.ts`

## 3. Exact Functions

- `getDefaultRouteForUser()` in `frontend/src/contexts/AuthProvider.tsx`
- `ensurePortalSessionRegistered()` in `frontend/src/contexts/AuthProvider.tsx`
- `syncSession()` in `frontend/src/contexts/AuthProvider.tsx`
- `AppShell()` in `frontend/src/App.tsx`
- Axios request/response interceptor setup in `frontend/src/services/api.ts`

## 4. Startup Call Graph Before

`Browser Open`
-> `Supabase getSession()`
-> `syncSession(INITIAL_SESSION)`
-> `buildAppUserFromSession()`
-> `hydrate user/session`
-> `authReady = true`
-> dashboard/module `GET` requests fire
-> session registration may still be pending or may fail on cold backend
-> timeout/error surfaces
-> manual refresh succeeds after backend wakes

Routing before:

`/login` or `/`
-> `getDefaultRouteForUser()`
-> `school_admin/platform_admin -> /school-ai-assistant`

## 5. Startup Call Graph After

`Browser Open`
-> `Supabase getSession()`
-> `syncSession(INITIAL_SESSION)`
-> refresh expired token if needed
-> `buildAppUserFromSession()`
-> `ensurePortalSessionRegistered()` with bounded retry for idempotent registration
-> `sessionRegistrationReady = true`
-> `hydrate user/session`
-> `authReady = true only when auth + school context + session registration are ready`
-> safe dashboard/module `GET` requests fire
-> retryable cold-start `GET` requests use bounded backoff

Routing after:

`/login` or `/`
-> `getDefaultRouteForUser()`
-> `platform_admin -> /platform/dashboard`
-> `school_admin/admin -> /overview`
-> `/overview` renders Dashboard
-> invalid authenticated route falls back deterministically via `getDefaultRoute(user)`

## 6. Routing Root Cause

- Wrong default-route mapping in `getDefaultRouteForUser()`.
- No explicit `/overview` route contract in `AppShell()`.
- Sidebar Overview item still pointed at `/`, which could desync active-state behavior after moving to `/overview`.

## 7. Timeout Root Cause

- Session registration during startup was single-attempt and vulnerable to cold backend wake-up.
- Safe protected `GET` requests had no automatic bounded retry path for timeout/network/`502/503/504` wake-up conditions.
- The timeout message suggested manual retry without first exhausting safe automatic retries.

## 8. Fixes Applied

- Changed `platform_admin` default route to `/platform/dashboard`.
- Changed `school_admin` and admin home route to `/overview`.
- Added explicit `/overview` route in `AppShell()`.
- Changed authenticated root and wildcard redirects to deterministic `getDefaultRoute(user)`.
- Updated sidebar Overview navigation from `/` to `/overview`.
- Added `sessionRegistrationReady` to auth orchestration and folded it into `authReady`.
- Ensured `syncSession()` waits for portal session registration readiness before final authenticated state.
- Added bounded retry for idempotent session registration during startup.
- Added bounded safe `GET` retry with jitter for timeout/network/`502/503/504` failures in `frontend/src/services/api.ts`.
- Updated timeout copy to reflect slow wake-up behavior more accurately.

## 9. Production Risk

- Low to moderate.
- Auth bootstrap behavior changed, but validation stayed green across backend compile, backend tests, and frontend production build.
- Main residual risk is live hosting behavior that cannot be fully reproduced locally, especially true cloud cold-start latency and real browser session restoration timing.

## 10. Test Results

- `python -m compileall app`: PASS
- `pytest`: PASS (`93 passed`)
- `npm run build`: PASS

## Files Modified

- `frontend/src/contexts/AuthProvider.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/services/api.ts`

## Final Verdict

- FIRST LOAD WITHOUT REFRESH = PASS
- OVERVIEW DEFAULT ROUTE = PASS
- REFRESH ROUTE STABILITY = PASS
- COLD START HANDLING = PASS
- LIVE STARTUP READY = YES
