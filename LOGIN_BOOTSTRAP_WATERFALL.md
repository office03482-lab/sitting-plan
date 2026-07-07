# LOGIN BOOTSTRAP WATERFALL

## Current Order (After Fix 1)

```
signInWithPassword()
  │
  ▼
syncSession(SIGNED_IN)
  │
  ├─ JWT check (instant)
  │
  ├─ buildAppUserFromSession():
  │   ├─ profiles ──┐  (PARALLEL — FIX 1)
  │   ├─ memberships ┤
  │   │              │
  │   └─ permissions ←┘  (sequential after memberships, needs role_id)
  │
  ├─ registerPortalSession (fire-and-forget, non-blocking)
  │
  ├─ hydrate zustand store (sync)
  │
  └─ finalizeInitialization(AUTHENTICATED)
```

## Sequential vs Parallel Analysis

| Operation | Depends On | Currently Starts After | Could Start Earlier? | Safe to Parallelize? |
|-----------|-----------|----------------------|---------------------|---------------------|
| signInWithPassword | nothing | click | same | N/A |
| profiles query | userId (from session) | JWT check | same | YES — currently parallel with memberships (FIX 1) |
| memberships query | userId (from session) | JWT check | same | YES — currently parallel with profiles (FIX 1) |
| role_permissions | activeMembership.role_id | memberships complete | after memberships | NO — data dependency |
| registerPortalSession | access_token | profile build complete | right after JWT check | YES — only needs access_token, doesn't need profile data |
| hydrate | appUser | profile build complete | same | N/A |
| finalizeInitialization | hydrate | hydrate complete | same | N/A |

## Remaining Sequential Bottleneck

The only unavoidable sequential dependency in `buildAppUserFromSession` is:

```
memberships → role_permissions
```

Permissions query needs `activeMembership.role_id`, which is derived from the memberships result. This cannot be parallelized.

**BUT**: `registerPortalSession` could start EARLIER — it only needs `access_token`, not the profile data. Currently it's called after the profile build completes inside `syncSession`. It could be moved right after the JWT check.

However, this is a FIRE-AND-FORGET call with up to 83s timeout. Starting it earlier doesn't help the critical path (it's already non-blocking). The only effect would be cosmetic — registration might complete sooner, but the dashboard data loads without waiting for it.

## Recommendation

The remaining waterfall is minimal. The profile+memberships parallelism (FIX 1) covers the main opportunity. No further waterfall restructuring is warranted.
