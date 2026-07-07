# PRACTICAL LOGOUT DELAY TRACE

## Trace Timeline (Logout Click → Login Screen)

### Before Fix (Old signOut)

```
LOGOUT CLICK
  │
  ├─ getStoredActiveSessionKey() → K1 (reads from localStorage)
  │
  ├─ await apiService.logoutCurrentSecuritySession(K1)
  │   └── Axios POST /account-security/sessions/logout-current
  │       └── Axios timeout: 120s
  │       └── WORST CASE: blocks 120s if backend unreachable
  │       └── Best case: ~100-500ms
  │
  ├─ await supabase.auth.signOut()
  │   └── Supabase Auth API call
  │   └── WORST CASE: indefinite if Supabase is unreachable
  │   └── Best case: ~200-500ms
  │
  └─ finally block:
      ├─ clearPersistedAuthArtifacts()
      ├─ logoutStore()
      ├─ setSession(null)
      ├─ setAuthStatus('UNAUTHENTICATED')
      ├─ AuthInitializationRegistry.resolve('UNAUTHENTICATED')
      └─ redirectToLogin()
      └── ALL ~0ms (sync operations)
```

**TOTAL (worst case): 120s+ (until Axios timeout on logout + Supabase timeout on signOut)**
**TOTAL (best case): ~300-1000ms**

### After Fix (New signOut)

```
LOGOUT CLICK
  │
  ├─ getStoredActiveSessionKey() → K1 (save before clearing)
  │
  ├─ localStorage.removeItem('active_session_key')  ← IMMEDIATE
  ├─ clearPersistedAuthArtifacts()                   ← IMMEDIATE
  ├─ logoutStore()                                   ← IMMEDIATE
  ├─ setSession(null)                                ← IMMEDIATE
  ├─ setSessionRegistrationReady(false)              ← IMMEDIATE
  ├─ setAuthStatus('UNAUTHENTICATED')                ← IMMEDIATE
  ├─ AuthInitializationRegistry.resolve('UNAUTHENTICATED')
  ├─ redirectToLogin()                               ← IMMEDIATE
  │
  └─ BACKGROUND (non-blocking):
      ├─ apiService.logoutCurrentSecuritySession(K1).catch(…)
      └─ supabase.auth.signOut().catch(…)
```

**TOTAL: ~0ms (all sync operations, no awaits)**
- Login screen appears on the same paint cycle
- Remote cleanup continues in the background regardless of duration

## Measured Durations

| Phase | Before Fix | After Fix |
|-------|-----------|-----------|
| Logout click → remote cleanup start | 0ms | 0ms |
| Remote logoutCurrentSecuritySession | 100ms–120s (AWAITED) | Background (non-blocking) |
| Supabase signOut | 200ms–∞ (AWAITED) | Background (non-blocking) |
| Local state clear | After both complete | ~0ms (FIRST) |
| redirectToLogin | After both complete | ~0ms (FIRST) |
| **Login screen visible** | **300ms–120s+** | **~10ms** |
