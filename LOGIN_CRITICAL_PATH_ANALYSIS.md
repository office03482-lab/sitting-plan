# LOGIN CRITICAL PATH ANALYSIS

## Critical Path: Login Click → First Usable Data

```
LOGIN CLICK
  → (1) signIn: clear stale session key [~0ms]
  → (2) signIn: supabase.auth.signInWithPassword() [~200-500ms]
  → (3) SIGNED_IN event → syncSession() [~0ms]
  → (4) JWT freshness check [~0ms]
  → (5) buildAppUserFromSession():
        │
        ├→ (5a) profiles query ──────────────────────┐  [~50-200ms]
        ├→ (5b) school_memberships query ─────────────┤  [~50-200ms]
        │         (PARALLEL after FIX 1)               │
        │                                              │
        └→ (5c) role_permissions query (after 5b) ────┘  [~50-200ms]
  → (6) hydrate(zustand) + finalizeInitialization(AUTHENTICATED) [~10ms]
  → (7) signIn: await readyPromise resolves, returns [~0ms]
  → (8) Login: renders <Navigate to={defaultRoute}> [~0ms]
  → (9) Dashboard: mounts, canRunDashboardRequests = true [~0ms]
  → (10) Dashboard: API calls (metrics, attendance, etc.) [~200-1000ms]
  → (11) React re-render with data → visible dashboard [~50ms]
```

## Classification of Each Operation

| # | Operation | Duration | Classification | Notes |
|---|-----------|----------|----------------|-------|
| 1 | Clear stale key | ~0ms | REQUIRED-BLOCKING | Trivial, synchronous |
| 2 | signInWithPassword | 200-500ms | REQUIRED-BLOCKING | Must complete before anything else |
| 3 | SIGNED_IN event dispatch | ~0ms | REQUIRED-BLOCKING | Event loop microtask |
| 4 | JWT freshness check | ~0ms | REQUIRED-BUT-PARALLELIZABLE | Could be skipped on fresh login token |
| 5a | profiles query | 50-200ms | REQUIRED-BLOCKING | Must happen; now parallel with 5b |
| 5b | memberships query | 50-200ms | REQUIRED-BLOCKING | Must happen; now parallel with 5a |
| 5c | role_permissions query | 50-200ms | REQUIRED-BLOCKING | Depends on 5b (needs role_id) |
| 6 | hydrate + finalize | ~10ms | REQUIRED-BLOCKING | Sync state updates |
| 7 | readyPromise resolve | ~0ms | REQUIRED-BLOCKING | Trivial |
| 8 | Login <Navigate> render | ~0ms | REQUIRED-BLOCKING | React Router navigation |
| 9 | Dashboard mount | ~0ms | REQUIRED-BLOCKING | Component lifecycle |
| 10 | Dashboard API calls | 200-1000ms | REQUIRED-BLOCKING | Depends on 6 for schoolContextReady |
| 11 | Render with data | ~50ms | REQUIRED-BLOCKING | Final render |

**Feature: registerPortalSession (fire-and-forget)**

| Operation | Duration | Classification | Notes |
|-----------|----------|----------------|-------|
| registerPortalSession | 15-83s (worst) | NON-CRITICAL | Fire-and-forget, does NOT block authReady or dashboard |

**Feature: Heartbeat**

| Operation | Duration | Classification | Notes |
|-----------|----------|----------------|-------|
| Heartbeat | ~200ms | NON-CRITICAL | Starts 60s after login, never on critical path |

## Summary

- REQUIRED-BLOCKING: 2, 5a, 5b, 5c, 6, 10
- REQUIRED-BUT-PARALLELIZABLE: 4 (minor, already fast)
- NON-CRITICAL: registration, heartbeat

**The critical path bottleneck is the sequential Supabase query chain.** After FIX 1 (parallelized 5a+5b), the remaining bottleneck is 5c (permissions, depends on 5b) and 10 (dashboard API calls, depends on backend). No further significant parallelism is possible without backend changes.
