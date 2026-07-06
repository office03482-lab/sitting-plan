# AUTH REQUEST LOOP AUDIT — Dr. Girish App

**Audit Date:** 2026-07-06

---

## 1. AUTH STATE MACHINE

```
Browser Load
    │
    ▼
AuthProvider.mount
    │
    ▼
supabase.auth.getSession()
    │
    ├── Error → clearAuthState() → UNAUTHENTICATED
    │
    ▼ (Session found or null)
syncSession(session, { bootstrapProfile: true, origin: 'INITIAL_SESSION' })
    │
    ├── null/empty session → clearAuthState() → UNAUTHENTICATED
    │
    ▼ (Session exists)
    │
    ├── silentTokenRefresh path (if token expired + user exists)
    │   → supabase.auth.refreshSession()
    │   → hydrate store (token only)
    │   → AUTHENTICATED
    │   ← RETURN early
    │
    ├── same fingerprint path (if same session, same user)
    │   → AUTHENTICATED (if user exists)
    │   ← RETURN early
    │
    ├── fast path (if user exists with school context)
    │   → hydrate store
    │   → registerPortalSession()  ← NETWORK CALL
    │   → AUTHENTICATED
    │   ← RETURN early
    │
    └── full bootstrap path
        → supabase.auth.refreshSession() (if token expired)
        → buildAppUserFromSession()       ← 3 Supabase queries
            ├── profiles(s).select().eq('id', userId).single()
            ├── school_memberships.select(roles).eq('profile_id', userId)
            └── role_permissions.select(permissions).eq('role_id', roleId)
        → registerPortalSession()         ← POST /account-security/sessions/register
            ├── Retry 3x with delays [350ms, 900ms]
            ├── Timeouts [8s, 12s, 18s]
            └── AbortController per attempt
        → hydrate store (token + user)
        → AUTHENTICATED
```

## 2. AUTH REQUEST PATTERNS ON BOOT

| Step | Network Calls | Tables Queried | Auth Required | Cache TTL |
|------|--------------|----------------|---------------|-----------|
| `supabase.auth.getSession()` | 1 (Supabase Auth API) | — | Supabase token | — |
| `buildAppUserFromSession()` | 3 | `profiles`, `school_memberships`, `role_permissions` | Supabase anon key (RLS) | None |
| `registerPortalSession()` | 1-3 (with retries) | `active_sessions` | Backend JWT | None |
| `_resolve_request_principal()` (per API call) | 1 JWT decode + 0-5 | `users` (SQLAlchemy), `profiles`, `school_memberships`, `role_permissions` | Backend JWT | 180s principal cache |
| `heartbeatSecuritySession()` (every 60s) | 1 | `active_sessions` | Backend JWT | None |

## 3. IDENTIFIED AUTH LOOPS

### Loop #1: REGISTRATION_ERROR → retrySessionRegistration → REGISTRATION_ERROR (P0)
**Trigger:** Session registration fails (timeout or backend error)  
**Flow:**  
1. `syncSession()` calls `registerPortalSession()`  
2. Retries 3 times with 8-18s timeouts  
3. If all fail → `REGISTRATION_ERROR` state  
4. `RegistrationError` component renders with retry button  
5. User clicks retry → `retrySessionRegistration()`  
6. Calls `registerPortalSession()` again  
7. If same failure → `REGISTRATION_ERROR` again  
**Impact:** User is stuck in a loop. Never reaches AUTHENTICATED.  
**Evidence:** `AuthProvider.tsx:395-487` (retry logic), `AuthProvider.tsx:955-981` (retrySessionRegistration)

### Loop #2: TOKEN_REFRESHED → syncSession → bootstrap → TOKEN_REFRESHED (P1)
**Trigger:** Token refresh event  
**Flow:**  
1. `supabase.auth.onAuthStateChange('TOKEN_REFRESHED')` fires  
2. Debounced 400ms → calls `syncSession(nextSession, { silentTokenRefresh: true })`  
3. `syncSession` calls `buildAppUserFromSession()` (3 queries)  
4. If any Supabase query returns a new session → another TOKEN_REFRESHED event  
5. Debounce prevents immediate cascade, but refresh storm happens every 15 minutes  
**Evidence:** `AuthProvider.tsx:843-861`, token TTL = 15 min (`config.py:92`)

### Loop #3: Permission Re-evaluation → Dashboard Re-fetch (P1)
**Trigger:** Any state change that triggers permission re-evaluation  
**Flow:**  
1. `Dashboard.tsx:188-195` — `canViewEduPay = hasPermission('edupay')` etc.  
2. These re-evaluate on EVERY render  
3. `Dashboard.tsx:282` — Effect dependency includes these booleans  
4. Any state change → permission booleans may change → full dashboard re-fetch (5-8 API calls)  
**Evidence:** `Dashboard.tsx:188-195,282`

### Loop #4: Session Heartbeat (P2, but high volume)
**Trigger:** Every 60 seconds while authenticated  
**Flow:**  
1. `AuthProvider.tsx:1070-1082` — `setInterval` every 60s  
2. Calls `apiService.heartbeatSecuritySession(sessionKey)`  
3. This POSTs to backend regardless of user activity  
4. With 100 active users = 100 requests/minute  
**Evidence:** `AuthProvider.tsx:1070-1082`

### Loop #5: Auth Subscription Re-attach on StrictMode (P2)
**Trigger:** React StrictMode double-mounts components  
**Flow:**  
1. `AuthProvider.tsx:536-540` — `authSubscriptionAttachedRef` prevents double subscription  
2. BUT the cleanup function (line 869-876) sets `authSubscriptionAttachedRef.current = false`  
3. If StrictMode calls cleanup + re-init → subscription is recreated  
4. `bootstrapInitialSession()` runs twice → two parallel `syncSession()` calls  
**Evidence:** `AuthProvider.tsx:536-540,869-876`

## 4. DUPLICATE AUTH SOURCES

| Component | Auth Source | Token Storage | Session Management | Risk |
|-----------|------------|---------------|-------------------|------|
| `AuthProvider` (Context) | `supabase.auth` | `localStorage` via `useAuthStore` | `onAuthStateChange` listener | Primary |
| `useAuthStore` (Zustand) | `localStorage` | `auth_token`, `access_token`, `refresh_token`, `user` keys | Manual hydrate | Divergence possible |
| `PlatformAdminRoute` | `useAuthStore` directly | Zustand store | — | Skips context checks |
| `backend/middleware/auth.py` | JWT from Authorization header | — | Token decode + principal fetch | Independent validation |

**Divergence Risk:** `PlatformAdminRoute.tsx:12-14` uses `useAuthStore` directly, bypassing `AuthProvider` context. If Zustand store and Context have different states, Platform Admin routes behave differently.

## 5. AUTH REQUEST COUNT PER PAGE LOAD

| Phase | Minimum Requests | Maximum Requests | Tables Hit |
|-------|-----------------|------------------|------------|
| Initial auth bootstrap | 4 | 12 | profiles, school_memberships, role_permissions, active_sessions |
| Dashboard load | 5 | 8 | students, teachers, rooms, timetable, attendance |
| Admin Office | 3 | 6 | schools, profiles, memberships |
| Attendance (initial) | 6 | 10 | attendance_records, staff_attendance, holidays, leaves, notifications |
| Inventory (initial) | 6 | 9 | materials, suppliers, stock_in, stock_out, subjects, sets, volumes |

**Worst-case total:** ~45 Supabase requests for a single page load after fresh login.
