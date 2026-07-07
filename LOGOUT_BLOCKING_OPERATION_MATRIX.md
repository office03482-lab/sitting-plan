# LOGOUT BLOCKING OPERATION MATRIX

## Classification of Each Logout Operation

| Operation | Duration | After Fix Classification | Before Fix Classification | Notes |
|-----------|----------|------------------------|--------------------------|-------|
| getStoredActiveSessionKey() | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Need key for remote cleanup |
| localStorage.removeItem(key) | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Prevents stale key reuse after login |
| clearPersistedAuthArtifacts() | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Clears tokens/user from storage |
| logoutStore() | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Clears zustand store |
| setSession(null) | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | React state cleanup |
| setAuthStatus('UNAUTHENTICATED') | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Triggers guard re-evaluation |
| redirectToLogin() | ~0ms | MUST AWAIT BEFORE LOGOUT UI | MUST AWAIT BEFORE LOGOUT UI | Page reload to login |
| logoutCurrentSecuritySession(K1) | 100ms–120s | CAN RUN AFTER LOCAL LOGOUT | MUST AWAIT BEFORE LOGOUT UI (BEFORE FIX) | Best-effort remote cleanup |
| supabase.auth.signOut() | 200ms–∞ | CAN RUN AFTER LOCAL LOGOUT | MUST AWAIT BEFORE LOGOUT UI (BEFORE FIX) | Best-effort remote cleanup |
| Heartbeat cleanup (via React effect) | ~0ms | SHOULD RUN BEST-EFFORT | SHOULD RUN BEST-EFFORT | Auto-cleaned on state change |
| Pending dashboard requests | varies | SHOULD BE CANCELED | NOT HANDLED | No AbortController in current Axios instance |

## What was Blocking Logout UI (Before Fix)

```
BLOCKING CHAIN (Before Fix):
  Logout click
    → await logoutCurrentSecuritySession(K1)    ← BLOCKS up to 120s
    → await supabase.auth.signOut()              ← BLOCKS up to ∞
    → finally: local cleanup + redirect          ← DELAYED until both complete
```

Both remote operations were **awaited sequentially** before local cleanup could run. If either hung, the UI stayed on the dashboard for the full timeout duration.

## What Blocks Logout UI Now (After Fix)

```
BLOCKING CHAIN (After Fix):
  Logout click
    → all local cleanup (sync, ~0ms)
    → redirectToLogin() (sync, ~0ms)
    → [background] remote cleanup (non-blocking)
```

Nothing blocks the UI. All local operations are synchronous (state updates + localStorage + redirect).

## Recommendations (Implemented)

| Change | Status | Rationale |
|--------|--------|-----------|
| Move local cleanup before remote cleanup | ✅ DONE | UI should update instantly |
| Make remote cleanup fire-and-forget | ✅ DONE | Best-effort, not security-critical for UI responsiveness |
| .catch() on both remote operations | ✅ DONE | Prevents unhandled promise rejections |
