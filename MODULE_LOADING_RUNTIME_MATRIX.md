# Module Loading Runtime Behavior Matrix

## Page Component Data-Loading Pattern

All 40+ page components follow this pattern:

```typescript
useEffect(() => {
  if (!canRunRequests) return;    // ← early return when auth isn't ready
  fetchData();
}, [canRunRequests]);
```

## `canRunRequests` Calculation

```
canRunRequests = authReady && sessionReady && schoolContextReady && !!session
```

##authReady Truth Table

| authStatus | sessionRegistrationReady | schoolContextReady | !!session | authReady | canRunRequests |
|-----------|------------------------|-------------------|-----------|-----------|----------------|
| IDLE | false | false | false | false | false |
| INITIALIZING | false | false | false | false | false |
| AUTHENTICATED | false | true | true | true (FIXED) | true (FIXED) |
| AUTHENTICATED | false | false | true | false | false |
| AUTHENTICATED | true | true | true | true | true |
| AUTHENTICATED | true | false | true | false | false |
| REGISTRATION_ERROR | false | true | true | true (FIXED) | true (FIXED) |
| UNAUTHENTICATED | false | false | false | false | false |
| BOOTSTRAP_FAILED | false | false | false | false | false |

**Note**: When `canRunRequests = true` but registration has failed (REGISTRATION_ERROR), the page component's data-loading `useEffect` fires. The API calls will likely fail (501/503), and the component's existing error handling will display errors. This is **correct behavior** — the error is visible, not hidden behind a spinner.

## Module Loading Flow (Fixed)

```
Login → Sign In → Supabase auth → backend register session (POST /api/.../register)
                                    │
                         ┌──────────┼──────────┐
                         v          v          v
                       success   timeout     error
                         │          │          │
                         v          v          v
                    AUTHENTICATED   REGISTRATION_ERROR
                    sessionReady=true              │
                         │                   ┌────┴────┐
                         v                   v         v
                    AppShell         showRetry?   signOut()
                         │              │            │
                         v              v            v
                  modules load      re-run       redirect to
                  data normally    registration   /login
                         │
                         v
                   dashboard / pages
```

## Registration Retry in `retrySessionRegistration()`

```
1. Set authStatus = AUTHENTICATED (enables authReady)
2. Set sessionRegistrationReady = false
3. Set sessionRegistrationError = null
4. Call registerPortalSession()
   ├─ Success → set sessionRegistrationReady = true → modules proceed
   └─ Failure → set authStatus = REGISTRATION_ERROR → RegistrationError screen shown
```

This is **not recursive**. Each retry is an explicit user action ("Retry Session Setup" button).

## What Happens on Registration Timeout (per state machine)

1. User signs in → Supabase returns session
2. `syncSession()` sets authStatus = AUTHENTICATED, schoolContextReady = true
3. `useEffect` (line 961) calls `registerPortalSession()`
4. Backend cold start → first attempt (8s) → abort
5. Retry (12s) → abort
6. Retry (18s) → abort
7. **All 3 attempts fail**: transition to REGISTRATION_ERROR
8. `App.tsx` renders `RegistrationError` component
9. User sees error message with Retry / Sign Out buttons
10. No page component ever mounted → no infinite loading

## Differences from Before Fix

| Scenario | Before | After |
|----------|--------|-------|
| Registration succeeds | Modules load normally | Same |
| Registration times out | authReady = false → infinite spinner in all modules | Shows RegistrationError screen, no spinner |
| Registration fails | authReady = false → infinite spinner | Shows RegistrationError screen |
| Registration fails after valid session | User session destroyed → redirect to /login | Session preserved, shows RegistrationError |
| Cold backend (long startup) | Module loading stuck in spinner | Registration attempts sent until timeout, then error screen |
| Retry registration | N/A (no retry mechanism) | "Retry Session Setup" button available on RegistrationError |
| Concurrent registration calls | Duplicate request sent (race condition) | Deduplicated via sessionRegistrationInFlightRef |
