# REQUEST STORM VERIFICATION REPORT

**Audit Cross-Check Date:** 2026-07-06  
**Codebase State:** As of git HEAD  
**Scope:** Frontend request patterns on fresh page load, re-render behavior, debounce/dedup analysis  

---

## 1. DASHBOARD PERMISSION RE-FETCH (Previously Loop #3)

### Code Location
`Dashboard.tsx`, lines 185-203 (permission booleans) and line 278-282 (useEffect).

### Finding: PARTIALLY OVERSTATED — Effect does NOT re-run on every render

**What the code does:**
`canViewAdminOffice`, `canViewTimetable`, `canViewAttendance`, `canViewInventory`, `canViewEduPay`, `canViewAccessControl`, `canViewSettings`, and `showDetailedDashboard` are raw `const` declarations in the component body (lines 188-196). They re-evaluate on every render.

The effect at line 278-282 has dependencies `[canViewEduPay, canViewInventory, showDetailedDashboard, canRunDashboardRequests]`.

**Analysis of React rules:**
1. These ARE raw `const` declarations (not `useMemo` or `useCallback`). They *re-evaluate* on every render.
2. `hasPermission` is a selector from `useAuthStore`. It returns a stable function reference (Zustand ensures this). The function body reads `state.user.permissions` and computes a boolean.
3. React's `useEffect` dependency comparison uses **`Object.is`** for primitive values. If `canViewEduPay` was `true` on the previous render and is still `true` on this render, `Object.is(true, true)` passes — the effect **does NOT re-run**.
4. For a user whose permissions array has not changed, `hasPermission('edupay')` returns the same boolean value every time. Since `isAdmin` is also stable, `canViewEduPay` is stable.

**When WOULD the effect re-run?**
- Only when `canRunDashboardRequests` changes (auth state change) — which is appropriate.
- Only when `showDetailedDashboard` changes — appropriate.
- Only when permissions ACTUALLY change (user re-fetch or role update) — which should trigger a re-fetch.
- On initial mount — runs once.

**Verdict:** The previous audit claimed "any state change -> permission booleans may change -> full dashboard re-fetch (5-8 API calls)". This is **incorrect** for React behavior. Primitive booleans that don't change value do NOT re-trigger effects. The booleans only change when the underlying permissions change, which is the correct time to re-fetch.

---

## 2. TOKEN REFRESH STORM (Previously Loop #2)

### Code Location
`AuthProvider.tsx`, lines 843-861 (TOKEN_REFRESHED handler), lines 629-649 (silent token refresh fast path).

### Finding: MOSTLY MITIGATED — Debounce + early return prevents storm

**What the code does:**

The `TOKEN_REFRESHED` handler (lines 843-861):
- Updates the in-memory token store immediately (`setToken`, `setRefreshToken`).
- **Debounces** the `syncSession` call by 400ms via `tokenRefreshDebounceRef`.
- If a second `TOKEN_REFRESHED` event arrives within 400ms, the previous timeout is cleared and restarted.
- Passes `silentTokenRefresh: true` to `syncSession`.

The silent token refresh fast path (lines 629-649):
- If the user has a resolved school context, it **only updates local state** (Zustand hydrate + setSession).
- Returns early — **no Supabase queries** (no `buildAppUserFromSession`, no `registerPortalSession`).
- Does NOT trigger `onAuthStateChange` recursively.

**Analysis:**
- **Debounce** prevents cascading rapid events.
- **No Supabase queries** in the fast path means no secondary TOKEN_REFRESHED events from PostgREST responses.
- The 15-minute token refresh cycle thus produces exactly **one backend call** every 15 minutes (the refresh itself via Supabase SDK), with zero additional PostgREST queries.

**Remaining risk:** If a user does NOT have a resolved school context (rare after initial bootstrap), the fast path is skipped and the full bootstrap could run (3 PostgREST queries). But this is not a recurring storm.

**Verdict:** The debounce and silent refresh path effectively mitigate a token refresh storm.

---

## 3. REGISTRATION ERROR LOOP (Previously Loop #1)

### Code Location
`AuthProvider.tsx`, lines 395-487 (ensurePortalSessionRegistered), lines 955-981 (retrySessionRegistration).

### Finding: NOT INFINITE — Bounded retries + user-gated

**What the code does:**

`ensurePortalSessionRegistered` (internal retry loop, lines 406-484):
```
for (attempt = 0; attempt <= 2; attempt++) {  // max 3 attempts
  timeout = [8s, 12s, 18s][attempt]
  delay_before_retry = [350ms, 900ms][attempt]
  try {
    POST /account-security/sessions/register (with AbortController)
    return sessionKey on success
  } catch (error) {
    if code === 'session_limit_exceeded' -> throw immediately (NO retry)
    if AbortError/other -> delay, then retry
  }
}
throw lastError  // all 3 attempts failed
```

`retrySessionRegistration` (user-initiated, lines 955-981):
- Called ONLY when user clicks a button in the RegistrationError UI.
- Resets state to INITIALIZING, calls `registerPortalSession(session)`, then either transitions to AUTHENTICATED or back to REGISTRATION_ERROR.
- No `useEffect` or automatic trigger calls this function.

**Analysis:**
- Internal retry: **bounded at 3 attempts**.
- User retry: **manual, gated by user click**. Not automatic.
- If the backend is permanently down, user stays stuck, but requires explicit manual retry each time.

**Verdict:** The previous audit's claim of an "infinite loop" is **incorrect**. The retry loop is bounded and user-gated.

---

## 4. HEARTBEAT (60s Interval)

### Code Location
`AuthProvider.tsx`, lines 1070-1082.

### Finding: PROPERLY MANAGED — Not a bug

**What the code does:**
```ts
useEffect(() => {
  if (authStatus !== 'AUTHENTICATED' || !storeUser?.id) return;  // gated
  const sessionKey = getStoredActiveSessionKey();
  if (!sessionKey) return;                                        // gated
  const intervalId = setInterval(() => {
    apiService.heartbeatSecuritySession(sessionKey).catch(() => {});
  }, 60000);
  return () => clearInterval(intervalId);                         // cleanup
}, [authStatus, storeUser?.id]);
```

**Analysis:**
- **Gated by auth state**: Only runs when authenticated.
- **Gated by session key**: Only runs if session is registered.
- **Cleaned up on unmount**: `clearInterval` in the cleanup function.
- **Dependency array**: Only re-runs when authStatus or userId changes — previous interval is always cleaned up first.

**Verdict:** Properly managed. The 60-second interval is industry standard for session liveness. Not a bug.

---

## 5. PROVIDER SUBSCRIPTION RE-ATTACH ON STRICTMODE (Previously Loop #5)

### Code Location
`AuthProvider.tsx`, lines 379, 536-540, 869-876.

### Finding: SUBSCRIPTION IS PROPERLY GUARDED — No duplicate subscription

**What the code does:**

Guard at effect entry (lines 536-540):
```ts
if (authSubscriptionAttachedRef.current) return;
authSubscriptionAttachedRef.current = true;
```

Cleanup (lines 869-876):
```ts
return () => {
  isMounted = false;
  clearTimeout(tokenRefreshDebounceRef.current);
  subscription.unsubscribe();
  authSubscriptionAttachedRef.current = false;  // reset for StrictMode re-mount
};
```

**StrictMode double-mount sequence:**
1. Mount #1: guard passes, subscription created, bootstrapInitialSession() starts (async).
2. Cleanup #1: subscription unsubscribed, guard reset to false.
3. Mount #2: guard passes (was reset), new subscription created, bootstrapInitialSession() starts again.
4. First bootstrap resolves — but `isMounted` is false, so state updates are skipped.

**Analysis:**
- **Subscription**: Exactly one at any time. The guard correctly prevents duplicate subscriptions within a single mount.
- **The guard reset in cleanup is CORRECT** — it allows StrictMode to properly re-mount. Without the reset, the second mount would skip subscription creation entirely.
- **Wasted request**: The first `getSession()` in the first (unmounted) bootstrap is wasted but resolves without side effects.
- **`isMounted` flag**: Prevents the first bootstrap's state updates from corrupting the second bootstrap's state.

**Verdict:** The previous audit's claim that "cleanup creates a duplicate subscription" is **incorrect**. The pattern correctly handles StrictMode double-mount. Production builds (no StrictMode) have no waste at all.

---

## 6. TOTAL REQUEST COUNT PER PAGE LOAD

### Methodology
Count only frontend-initiated network requests. Exclude backend-to-Supabase queries. Count conditional paths only for a typical authenticated admin user.

### Auth Bootstrap (AuthProvider mount)
| # | Request | Destination | Always? |
|---|---------|-------------|---------|
| 1 | `supabase.auth.getSession()` | Supabase Auth API | Yes |
| 2 | `profiles` select by user ID | Supabase PostgREST | Yes (if session) |
| 3 | `school_memberships` select by profile | Supabase PostgREST | Yes (if session) |
| 4 | `role_permissions` select by role | Supabase PostgREST | Yes (if session) |
| 5 | `POST /account-security/sessions/register` | Backend API | Yes (if session) |

**Subtotal (with session): 5 requests** (4 Supabase + 1 Backend)

### Conditional Extra Auth Requests
| Condition | Request | Count |
|-----------|---------|-------|
| JWT expired | `supabase.auth.refreshSession()` | +1 |
| Registration fails and retries | 2 extra POST .../register | +2 (max) |

**Subtotal worst-case: 5 + 1 + 2 = 8**

### Dashboard Page Load (if landing on /)
| # | Request | Destination | Always? |
|---|---------|-------------|---------|
| 6 | `GET /dashboard/metrics` | Backend (consolidated) | Yes |
| 7 | `GET /attendance/staff/dashboard` | Backend | Yes |
| 8 | `GET /timetable/entries/count` | Backend | Yes |
| 9 | `GET /edupay/dashboard` | Backend | Only if `canViewEduPay` is true |

**Subtotal: 3-4 backend requests** (all consolidated — each endpoint may query multiple tables server-side)

### Attendance Page (if navigated to — overview tab only by default)
| # | Request | Destination | When? |
|---|---------|-------------|-------|
| 10 | `GET /attendance/overview` | Backend | On overview tab load only |

Additional tab loads (student/staff/leaves/reports) add 2-5 more requests, but only on explicit tab navigation.

### Supabase vs Backend Distinction

| Type | Count (healthy auth, dashboard) | Examples |
|------|-------------------------------|----------|
| **Supabase SDK direct queries** | 4 | `getSession()`, `profiles`, `school_memberships`, `role_permissions` |
| **Backend API calls (axios)** | 4-5 | `register`, `dashboard/metrics`, `staff/dashboard`, `timetable/count`, `edupay/dashboard` |
| **Total frontend requests** | **8-9** | — |

The previous audit's claim of "~45 Supabase requests for a single page load" likely counted:
- Backend-to-Supabase queries (server-side, not frontend-initiated)
- All attendance tab loads (which are lazy, not simultaneous)
- Retries at maximum

**Actual frontend Supabase PostgREST queries: 3** (profiles, school_memberships, role_permissions).

---

## OVERALL VERDICT

| Claim (Previous Audit) | Status | Explanation |
|------------------------|--------|-------------|
| **Loop #3:** Permission booleans trigger dashboard re-fetch on every render | **INCORRECT** | Primitive booleans that don't change value do NOT re-trigger effects. React uses Object.is. |
| **Loop #2:** Token refresh storm every 15 minutes | **MOSTLY MITIGATED** | 400ms debounce + silent fast path (no PostgREST queries) prevents cascading. |
| **Loop #1:** Infinite registration error loop | **INCORRECT** | Bounded at 3 attempts, gated by explicit user click. No automatic retry. |
| **Loop #4:** Heartbeat high volume | **NOT A BUG** | Properly gated by auth state, cleaned up on unmount. 60s interval is standard. |
| **Loop #5:** StrictMode duplicate subscription | **INCORRECT** | Guard ref + cleanup correctly handles StrictMode. Only one subscription at any time. |
| **~45 Supabase requests per page load** | **OVERESTIMATED** | Actual frontend Supabase calls: 3 PostgREST + 1-2 Auth API = 4-6. Backend API calls: 4-5. |
