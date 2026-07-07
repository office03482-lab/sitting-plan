# LOGIN ACTIVE SESSION ORDER TRACE

## Trace: Stale-Key Clear at signIn Start

```
signIn start
  │
  ├─ localStorage.removeItem('active_session_key') ← CLEARS STALE KEY
  │
  ├─ supabase.auth.signInWithPassword(…) → returns session
  │
  ├─ syncSession(SIGNED_IN) → buildAppUserFromSession → hydrate → finalizeInitialization('AUTHENTICATED')
  │   │
  │   └─ registerPortalSession (fire-and-forget):
  │       │
  │       ├─ ensurePortalSessionRegistered():
  │       │   ├─ getStoredActiveSessionKey() → null (was cleared)
  │       │   ├─ generateActiveSessionKey() → fresh key K1
  │       │   ├─ POST /register (raw fetch, 15s timeout)
  │       │   │   │
  │       │   │   └─ on success:
  │       │   │       └─ localStorage.setItem('active_session_key', K1)
  │       │   │
  │       │   └─ on failure: key NOT persisted, error handled
  │       │
  │       └─ .then() → setSessionRegistrationReady(true)
  │
  ├─ Dashboard mounts
  │   ├─ canRunDashboardRequests = true (authReady ∧ sessionReady ∧ schoolContextReady ∧ session)
  │   │
  │   └─ Axios request interceptor:
  │       ├─ getStoredActiveSessionKey() → null (registration not yet complete)
  │       └─ NO X-Active-Session header added
  │           └─ Backend sees no session key → no active-session check → no 401
  │
  └─ Registration completes → K1 persisted → subsequent requests include X-Active-Session
```

## Answers to Key Questions

### 1. Can business requests start before mandatory registration succeeds?
**YES.** Registration is fire-and-forget and does NOT block `authReady` or `canRunDashboardRequests`. Business requests (dashboard) start immediately after finalizeInitialization, regardless of registration state.

### 2. Does backend allow missing X-Active-Session?
**YES.** Backend `validate_active_session` has an early return: if `X-Active-Session` header is absent, it skips validation entirely (no 401). The 401 only fires when the key is present but not in `active_sessions`.

### 3. Does dashboard receive 401 before fresh key exists?
**NO** (after fix). Since the stale key was cleared and the fresh key is NOT persisted until registration succeeds, the Axios interceptor sends no `X-Active-Session` header. The backend skips validation → no 401.

### 4. Is registration blocking authReady?
**NO.** `finalizeInitialization('AUTHENTICATED')` is called immediately after the profile build, BEFORE registration completes. The `.then()` and `.catch()` on the registration promise do NOT affect `authReady`.

### 5. Is registration fire-and-forget but still indirectly blocking data?
**NO.** The stale-key fix eliminated the only indirect blocker (401 from stale key). With no stale key sent, registration's success/failure has no impact on dashboard data loading.

## Registration Failure Behavior (Edge Case)

If registration fails (timeout, network error):
- `sessionRegistrationReady` → false
- `sessionRegistrationError` → error message
- `authReady` → still true (authStatus remains AUTHENTICATED)
- Dashboard data → already loaded (or loading) without X-Active-Session header → success
- Subsequent requests → no X-Active-Session header → backend skips validation → success

Result: Registration failure does NOT affect first usable data.
