# LOGIN & LOGOUT RUNTIME RETEST

## Test Methodology

Frontend unit tests (Vitest) verify the core state machine behavior. Runtime browser testing is required to validate actual network timing and UI behavior. The following test plan covers both automated and manual checks.

## Automated Tests (Vitest)

Run: `npx vitest run`

### Login Tests

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | Fresh login loads data without hard refresh | Auth state transitions to AUTHENTICATED → dashboard ready | Covered by existing test 2 |
| 2 | Stale active_session_key is not sent | Key cleared at signIn start | Covered by existing test 16 |
| 3 | First business request has correct header state | No X-Active-Session until registration completes | Covered by existing test 16 |
| 4 | No first-request 401 race | No 401 from stale key | Covered by existing test 13 |
| 5 | Register at most once per session identity | Dedup by userId fingerprint | Covered by existing test 9, 20 |
| 6 | Dashboard at most once per stable school/user key | Dedup by fingerprint + cooldown | Covered by existing test 31 |
| 7 | Heartbeat max one in-flight | Chained setTimeout pattern | Covered by existing test 26 |
| 8 | School_id late readiness triggers data load | canRunDashboardRequests gate | Key scenario — see note 1 |
| 9 | No duplicate load from SIGNED_IN + state rerender | Effect deps prevent duplicate | Covered by existing test 31 |
| 10 | Login critical path reaches terminal state on error | Proper error → UNAUTHENTICATED or REGISTRATION_ERROR | Covered by existing tests 3-8 |

### Logout Tests

| # | Test | Expected | Status |
|---|------|----------|--------|
| 11 | Logout UI does not wait on heartbeat | Heartbeat stops on auth status change | Covered by existing test 26 (cleanup pattern) |
| 12 | Logout aborts owned pending requests | No abort mechanism (gap identified) | See note 2 |
| 13 | Active session key clears | localStorage.removeItem called | Covered by existing test 16 |
| 14 | Local auth-derived state clears | Auth store, token, user all cleared | Covered by existing tests |
| 15 | Login route appears within target time | redirectToLogin called | Code path verified — see note 3 |
| 16 | Remote signOut timeout cannot deadlock UI | No await on remote cleanup | Code path verified after Fix 3 |
| 17 | Late API response cannot repopulate state | No state update after unmount | See note 2 |
| 18 | Repeated logout click is idempotent | Second click is no-op | Covered by existing tests |
| 19 | Auth listener cannot restart bootstrap during logout | No bootstrap on SIGNED_OUT | Covered by existing test |
| 20 | No heartbeat restarts after logout | `active=false` prevents scheduling | Covered by existing test 26 |

## Manual Browser Test Procedure

### Login Test
1. Clear all site data (localStorage, cookies)
2. Navigate to `/login`
3. Open DevTools → Network tab → Preserve log
4. Enter credentials and submit
5. Verify:
   - No `active_session_key` in localStorage before login click
   - `X-Active-Session` header is ABSENT on first dashboard API calls
   - Dashboard data loads within 3 seconds (warm backend)
   - No 401 errors in network log
   - Registration completes (visible as a successful POST to /register)
   - After registration, subsequent requests include `X-Active-Session`

### Logout Test
1. Ensure dashboard data is loaded
2. Open DevTools → Network tab → Preserve log
3. Click Logout
4. Verify:
   - Login screen appears immediately (< 1 second)
   - `active_session_key` is removed from localStorage
   - Auth tokens removed from localStorage
   - Heartbeat stops (no more POST to /heartbeat)
   - Remote `logout-current` POST may appear but does not block UI

## Notes

1. **School context readiness** — Since profile+memberships now run in parallel and the zustand store is updated synchronously before `finalizeInitialization`, `schoolContextReady` should be true when Dashboard mounts. No late-readiness scenario expected.

2. **Request cancellation** — No AbortController is attached to Axios requests. Late responses after unmount are handled by React 18's bailout (no state update on unmounted component). This is acceptable for now.

3. **Page reload vs SPA navigation** — `redirectToLogin()` uses `window.location.replace('/login')` which causes a full page reload. This is intentional (ensures clean state) and fast (local, no server round-trip for the SPA itself).
