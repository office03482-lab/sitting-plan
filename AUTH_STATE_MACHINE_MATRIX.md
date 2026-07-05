# Auth State Machine Matrix

## State Definitions

| State | `authStatus` | `authReady` | `sessionRegistrationReady` | Description |
|-------|-------------|-------------|---------------------------|-------------|
| `IDLE` | `IDLE` | `false` | `false` | Initial bootstrap, no session check done |
| `INITIALIZING` | `INITIALIZING` | `false` | `false` | Auth initialization in progress |
| `SIGNED_OUT` | `UNAUTHENTICATED` | `false` | `false` | No valid session, user is on login page |
| `AUTHENTICATING` | `INITIALIZING` | `false` | `false` | Supabase sign-in in progress |
| `AUTHENTICATED_REGISTERING` | `AUTHENTICATED` | `true` | `false` | Supabase auth OK, session registration in-flight |
| `AUTHENTICATED_READY` | `AUTHENTICATED` | `true` | `true` | Full auth chain complete, modules can load |
| `REGISTRATION_ERROR` | `REGISTRATION_ERROR` | `true` | `false` | Supabase auth OK but session registration failed |
| `BOOTSTRAP_FAILED` | `UNAUTHENTICATED` | `false` | `false` | Profile/membership bootstrap failed (true auth failure) |

## State Transitions

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
                    v                                                  │
┌─────────┐   init  ┌──────────────┐                                  │
│   IDLE  │────────→│INITIALIZING  │                                  │
└─────────┘         └──────┬───────┘                                  │
                           │                                          │
              ┌────────────┼────────────┐                             │
              v            v            v                              │
        ┌──────────┐ ┌────────────┐ ┌──────────┐                      │
        │SIGNED_OUT│ │AUTHENTICAT-│ │BOOTSTRAP_│                      │
        │ (no ses) │ │ED_REGISTER │ │ FAILED   │                      │
        └────┬─────┘ └─────┬──────┘ └──────────┘                      │
             │             │                                          │
             │    ┌────────┼────────┐                                 │
             │    v        v        v                                 │
             │ ┌────────┐ ┌──────────────┐ ┌──────────────────┐       │
             │ │AUTHENT-│ │AUTHENTICATED_│ │REGISTRATION_ERROR│       │
             │ │ICATED  │ │   READY      │ │                 │       │
             │ │REGISTER│ └──────┬───────┘ └───────┬──────────┘       │
             │ └───┬────┘       │                  │                  │
             │     │            │                  │                  │
             │     │            v                  │                  │
             │     │     ┌─────────────┐           │                  │
             │     └────→│  SIGNED_OUT │←──────────┘                  │
             │           │ (sign out)  │                              │
             │           └─────────────┘                              │
             │                    │                                    │
             └────────────────────┘                                    │
                              (re-login)                              │
                              ────────────────────────────────────────┘
```

## Transition Triggers

| From | To | Trigger | Code Path |
|------|----|---------|-----------|
| IDLE | INITIALIZING | Component mount | `bootstrapInitialSession()` (line 771) |
| INITIALIZING | SIGNED_OUT | No Supabase session | `clearAuthState()` (line 558) |
| INITIALIZING | AUTHENTICATED_REGISTERING | Supabase session found + profile bootstrap complete | `syncSession()` success (line 718-735) |
| INITIALIZING | BOOTSTRAP_FAILED | Profile/membership query failed | `syncSession()` catch (line 741, profile error branch) |
| AUTHENTICATED_REGISTERING | AUTHENTICATED_READY | Session registration succeeds | `registerPortalSession()` → `setSessionRegistrationReady(true)` (line 726) |
| AUTHENTICATED_REGISTERING | REGISTRATION_ERROR | Session registration timeout/failure | `registerPortalSession()` catch → `setAuthStatus('REGISTRATION_ERROR')` (line ~920) |
| REGISTRATION_ERROR | AUTHENTICATED_REGISTERING | Retry clicked | `retrySessionRegistration()` (line ~898) |
| REGISTRATION_ERROR | SIGNED_OUT | Sign Out clicked | `signOut()` (line ~928) |
| AUTHENTICATED_READY | SIGNED_OUT | Manual sign out | `signOut()` (line ~928) |
| AUTHENTICATED_READY | SIGNED_OUT | Supabase SIGNED_OUT event | `onAuthStateChange('SIGNED_OUT')` (line ~799) |
| AUTHENTICATED_READY | INITIALIZING | Token refresh with bootstrap | `syncSession()` with `bootstrapProfile: true` on `TOKEN_REFRESHED` (line ~817) |

## Guard Logic

### `authReady` (used by all page components)
```
authReady = (authStatus === 'AUTHENTICATED' || authStatus === 'REGISTRATION_ERROR')
            && schoolContextReady
            && !!session
```

### `ProtectedRoute` rendering logic
```
if (loading || !initialized) → LoadingSpinner
if (!user) → Navigate to /login
if (requiresSchoolContext && !schoolContextReady) → SchoolContextError
if (!canAccess) → Navigate to default route
else → render children
```

### `App.tsx` top-level routing
```
if (authStatus === 'REGISTRATION_ERROR') → RegistrationError component
else → Router with Login / ProtectedRoute / AppShell
```

### `PlatformAdminRoute`
```
if (authLoading || !authInitialized) → LoadingSpinner
if (!user) → Navigate to /login
if (role_key !== 'platform_admin') → Navigate to default
else → render children
```
