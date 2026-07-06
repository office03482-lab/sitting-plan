# AUTH_ARCHITECTURE_VERIFICATION.md

## Comprehensive Auth Architecture Trace

Generated: 2026-07-06

---

## 1. CLIENT SURFACE -> LOGIN METHOD -> TOKEN ISSUER -> TOKEN TYPE -> BACKEND VALIDATION PATH -> PRINCIPAL SOURCE -> SESSION REGISTRATION

### PATH A: Primary Web Login (ACTIVE - Primary Path)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Client Surface** | `Login.tsx` calls `signIn(identifier, password)` from AuthContext | `Login.tsx:71` |
| **Identifier Resolution** | If identifier is NOT an email, calls `apiService.resolveLoginIdentifier(trimmedIdentifier)` -> `GET /api/account-security/resolve-login` to convert username to email | `AuthProvider.tsx:902-904` |
| **Login Method** | `supabase.auth.signInWithPassword({ email: loginEmail, password })` - DIRECT Supabase Auth call, NOT to backend | `AuthProvider.tsx:905-908` |
| **Token Issuer** | **Supabase Auth** (GoTrue API) | `AuthProvider.tsx:905` |
| **Token Type** | Supabase JWT (ES256 or HS256, signed by Supabase) | `supabase.ts:14` creates client with anon key |
| **Token Storage** | Written to localStorage keys `auth_token`, `token`, `access_token`, `refresh_token` via `useAuthStore.hydrate()` | `store/auth.ts:188-218` |
| **Axios Authorization** | `Authorization: Bearer <token>` - reads from localStorage, no token type check | `api.ts:222-237` |
| **Backend Validation** | `get_authenticated_user()` -> `decode_token()` -> 3-step fallback: 1) local HS256, 2) Supabase JWT secret, 3) Supabase Auth API | `middleware/auth.py:536-650`, `utils/auth.py:79-193` |
| **Principal Resolution** | `_resolve_request_principal()`: 1) Try SQLAlchemy `User` by `sub` (integer), 2) Try by email, **3) Fall back to `_fetch_supabase_principal()`** which queries Supabase `profiles` + `school_memberships` + `role_permissions` | `middleware/auth.py:357-457` |
| **User Object** | If SQLAlchemy `User` found -> use it. If not -> `_build_synthetic_user_from_supabase()` creates synthetic User(id=0) | `middleware/auth.py:334-354` |
| **Session Registration** | Frontend calls `POST /api/account-security/sessions/register` with `Authorization: Bearer <Supabase access_token>`, registers in Supabase `active_sessions` table | `AuthProvider.tsx:395-487` |
| **Status** | **ACTIVE** - This is the primary authentication path |

### PATH B: Backend OTP Login (DEAD - Backend routes exist, no frontend UI)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Client Surface** | No login page exposes OTP. `api.ts` has `sendOTP()` and `verifyOTP()` methods but they are **never called** from any UI | `api.ts:312-318` |
| **Backend Routes** | `POST /api/auth/send-otp` and `POST /api/auth/verify-otp` exist, querying SQLAlchemy `User` model | `routes/auth.py:651-818` |
| **Token Issuer** | **Backend** (local JWT via `issue_auth_tokens()`) | `routes/auth.py:802` |
| **Token Type** | HS256 JWT signed with `settings.jwt_secret` | `utils/auth.py:40-58` |
| **Frontend OTP reference** | Only 1 hit: `FeeManagement.tsx:2259` - just a label "OTP-ready parent summary preview" | grep result |
| **Status** | **DEAD** - Backend endpoints exist, frontend API methods exist, but no UI flow invokes them in production |

### PATH C: Backend Password Login (DEAD - Legacy backend route, NOT called by frontend)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Client Surface** | **None** - Login.tsx never calls this endpoint | `Login.tsx` |
| **Backend Route** | `POST /api/auth/login-password` - verifies against SQLAlchemy `User.password_hash` using `verify_password()` | `routes/auth.py:821-918` |
| **Token Issuer** | **Backend** (local JWT via `issue_auth_tokens()`) | `routes/auth.py:904` |
| **Token Type** | HS256 JWT signed with `settings.jwt_secret` | `utils/auth.py:40-58` |
| **Frontend call** | **ZERO** - Frontend calls `supabase.auth.signInWithPassword()`, not `/api/auth/login-password` | `AuthProvider.tsx:905` |
| **Status** | **DEAD** - Full backend implementation, but frontend never uses it. Only `api.ts:320-323` has `logout()` which calls `POST /api/auth/logout` |

### PATH D: Backend Refresh Token (SEMI-ACTIVE - Used for refresh, not initial login)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Client call** | `supabase.auth.refreshSession()` - uses Supabase's own refresh mechanism | `AuthProvider.tsx:712` |
| **Backend Route** | `POST /api/auth/refresh` - validates against SQLAlchemy `Token` table | `routes/auth.py:1183-1217` |
| **Token Type** | Backend-issued refresh token (not used by frontend) | `routes/auth.py:1183` |
| **Status** | **SEMI-ACTIVE** - Backend route exists but frontend uses Supabase's built-in refresh for Supabase tokens |

### PATH E: Supabase Token Refresh (ACTIVE - Used during session sync)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Frontend call** | `supabase.auth.refreshSession()` called when access token is expired | `AuthProvider.tsx:712` |
| **Token Type** | Refreshed Supabase JWT | |
| **Status** | **ACTIVE** - Part of primary auth path |

### PATH F: Force Password Change (ACTIVE - Niche flow)

| Step | Detail | Source Evidence |
|------|--------|----------------|
| **Client Surface** | `ForcePasswordChange.tsx` - calls `supabase.auth.signInWithPassword()` to re-authenticate after password reset | `ForcePasswordChange.tsx:85` |
| **Status** | **ACTIVE** - Niche flow |

---

## 2. TOKEN VALIDATION CHAIN (Backend decode_token fallback order)

Reference: `backend/app/utils/auth.py` lines 79-193

```
decode_token(token)
  |
  +-- Step 1: Try local HS256 secret
  |     jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
  |     -> SUCCESS: return payload (local HS256 JWT)
  |     -> FAIL: continue
  |
  +-- Step 2: Try Supabase JWT secret
  |     for alg in ["HS256", "ES256"]:
  |       jwt.decode(token, settings.supabase_jwt_secret, alg, verify_aud=False, verify_iss=False)
  |     -> SUCCESS: return payload (Supabase JWT)
  |     -> FAIL: continue
  |
  +-- Step 3: Call Supabase Auth REST API
        GET {supabase_url}/auth/v1/user
        Headers: apikey={anon_or_service_key}, Authorization: Bearer {token}
        -> SUCCESS: build synthetic payload from response
        -> FAIL: return None (401)
```

**Key Finding:** `SUPABASE_JWT_SECRET` is the JWT secret used by Supabase to sign tokens. The backend can decode Supabase JWTs IF `settings.supabase_jwt_secret` is configured (Step 2). If not configured, Step 3 falls back to calling the Supabase Auth REST API. `JWT_SECRET` is the backend's own local signing key.

---

## 3. PRINCIPAL RESOLUTION PRIORITY (Backend middleware)

Reference: `backend/app/middleware/auth.py` lines 357-457 (`_resolve_request_principal`)

```
_resolve_request_principal(request, payload, db)
  |
  +-- Check request.state.resolved_auth_principal (cached)
  |
  +-- Try 1: Extract user_id from payload["sub"] - attempt integer cast
  |     -> db.query(User).filter(User.id == user_id).first()
  |     -> Handles ProgrammingError if "users" table doesn't exist
  |
  +-- Try 2: If no user found, query by email from payload["email"]
  |     -> db.query(User).filter(func.lower(User.email) == token_email).first()
  |
  +-- FALLBACK: If still no user -> _fetch_supabase_principal(payload)
  |     -> Queries Supabase:
  |       1. profiles table (by id or email)
  |       2. school_memberships (by profile_id, is_active=true, status='active')
  |       3. role_permissions (by role_id)
  |     -> If found: _build_synthetic_user_from_supabase(principal)
  |       -> Creates User(id=0, role=UserRole.VIEWER, ...)
  |       -> Sets synthetic attributes: profile_id, membership_id, school_id, role_key
  |
  +-- If STILL no user -> raise HTTPException(401, "Authenticated user not found")
```

**PRIORITY ORDER:** Local SQLAlchemy User (by id -> by email) -> Supabase principal (fallback)

**Is SQLAlchemy User lookup REQUIRED?** **NO.** It is the FIRST attempted path, but:
- If `users` table doesn't exist -> catches `ProgrammingError` and continues
- If user not found by id -> tries email
- If not found by email either -> falls through to Supabase principal
- Supabase principal is a FULL replacement (synthetic User with id=0)

---

## 4. buildAppUserFromSession() - What it queries

Reference: `AuthProvider.tsx` lines 273-355

```typescript
async function buildAppUserFromSession(session: Session): Promise<User> {
  const userId = session.user.id;

  // QUERY 1: Supabase 'profiles' table
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, display_name, is_active, default_school_id, metadata')
    .eq('id', userId)
    .single();

  // QUERY 2: Supabase 'school_memberships' table (with joined 'roles')
  const { data: memberships } = await supabase
    .from('school_memberships')
    .select('id, school_id, role_id, status, is_primary, is_active, roles(role_key, role_name, is_system)')
    .eq('profile_id', userId)
    .eq('is_active', true)
    .eq('status', 'active');

  // QUERY 3: Supabase 'role_permissions' table (via fetchRolePermissions)
  const permissions = await supabase
    .from('role_permissions')
    .select('permissions(permission_key)')
    .eq('role_id', activeMembership.role_id);
}
```

**IMPORTANT:** `buildAppUserFromSession()` queries Supabase tables directly, NOT the local SQLAlchemy database. The local `users` table is never consulted for building the frontend User object.

---

## 5. registerPortalSession() / ensurePortalSessionRegistered() - What it POSTs

Reference: `AuthProvider.tsx` lines 395-512

```
POST {runtimeConfig.apiUrl}/api/account-security/sessions/register

Headers:
  Authorization: Bearer {access_token}       // Supabase access_token
  Content-Type: application/json
  X-Device-Id: {device_id}

Body:
{
  "session_key": "sess-{random}-{timestamp}",
  "device_id": "device-{random}-{timestamp}",
  "device_name": "{platform} device",
  "browser": "Google Chrome",
  "force_takeover": true/false
}
```

Retry pattern: 3 attempts with delays [350ms, 900ms] and timeouts [8s, 12s, 18s].

**What happens on the backend (`register_active_session` in `supabase_account_security.py:2256`):**
1. Checks Supabase `active_sessions` table for existing sessions for this profile_id
2. If same session_key exists -> updates last_activity
3. If session limit reached -> 409 Conflict with `session_limit_exceeded` code
4. If force_takeover -> deactivates existing sessions
5. Inserts new row into `active_sessions`
6. Updates profile metadata with `portal_access.last_login`

---

## 6. Axios Interceptor - Authorization Header

Reference: `api.ts` lines 220-264

```typescript
this.api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem('auth_token')
    || localStorage.getItem('token')
    || localStorage.getItem('access_token');
  // ...
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  headers['X-Active-Session'] = getStoredActiveSessionKey();
  headers['X-Device-Id'] = getStoredDeviceId();
});
```

**Key finding:** The Axios interceptor reads ANY token from localStorage (auth_token, token, or access_token). It does NOT distinguish between a Supabase JWT or a local backend JWT. Whatever token is stored in localStorage (by `useAuthStore.hydrate()`) gets sent as the Bearer token.

---

## 7. Parent Portal & Mobile App Login Flows

**Parent Portal:** There is NO separate parent login flow. Parents authenticate through the same Supabase Auth mechanism. They are identified by:
- `user.role_key === 'parent'` OR
- `user.permissions.includes('edupay.parent_portal')` (see `AuthProvider.tsx:232`)

The parent-specific pages (ParentDashboard, ParentAttendance, etc.) are all protected by the same `ProtectedRoute` with permissions like `parent_intelligence.view` or `edupay.parent_portal`. The API calls go through the same `api.ts` Axios instance with the same Supabase access_token.

**Mobile App:** The `mobile/` directory exists but contains Flutter code (pubspec.yaml, analysis_options.yaml, lib/). No mobile-specific authentication login flows were found in the frontend TypeScript code. The mobile app likely uses the same Supabase Auth endpoints.

---

## 8. OTP Routes Status

| Route | Backend | Frontend API Method | Frontend UI | Status |
|-------|---------|-------------------|-------------|--------|
| `POST /api/auth/send-otp` | Implemented (`auth.py:651`) | `api.ts:312` | No UI calls it | **DEAD** |
| `POST /api/auth/verify-otp` | Implemented (`auth.py:761`) | `api.ts:316` | No UI calls it | **DEAD** |

Only 1 OTP reference in frontend: `FeeManagement.tsx:2259` - just a static label "OTP-ready parent summary preview".

---

## 9. runtimeConfig.ts Settings

Reference: `runtimeConfig.ts` lines 8-13

```typescript
export const runtimeConfig = {
  supabaseUrl: rawSupabaseUrl,          // from VITE_SUPABASE_URL
  supabaseAnonKey: rawSupabaseAnonKey,  // from VITE_SUPABASE_ANON_KEY
  apiUrl: rawApiUrl,                     // from VITE_API_URL
  apiProxyTarget: rawApiProxyTarget,     // from VITE_API_PROXY_TARGET
};
```

No JWT-related settings are exposed in runtimeConfig. The Supabase client is created from these values.

---

## 10. SUMMARY: ACTIVE vs DEAD AUTH PATHS

| Path | Active/Dead | Description |
|------|-------------|-------------|
| **Login.tsx -> supabase.auth.signInWithPassword()** | **ACTIVE** | Primary path. Calls Supabase Auth directly. |
| **Backend /login-password** | **DEAD** | Fully implemented but frontend never calls it. |
| **Backend OTP flow** | **DEAD** | Routes exist, API methods exist, no frontend UI. |
| **Backend /refresh** | **SEMI-ACTIVE** | Route exists, frontend uses Supabase's own refresh. |
| **Session registration** | **ACTIVE** | Posts to `/api/account-security/sessions/register` with Supabase token. |
| **Parent portal** | **ACTIVE** | Same Supabase Auth, permission-gated routing. |
| **Force password change** | **ACTIVE** | Niche flow, re-authenticates via Supabase. |

---

## 11. IS SQLALCHEMY USER TABLE REQUIRED?

**NO.** The SQLAlchemy `users` table is **not required** for authentication to succeed in the primary path.

### Evidence:

1. **Frontend login flow:** `signIn()` -> `supabase.auth.signInWithPassword()` -> `buildAppUserFromSession()` queries Supabase `profiles`/`school_memberships`/`role_permissions` tables directly. The local `users` table is never consulted.

2. **Backend token validation:** `_resolve_request_principal()` tries the local `users` table FIRST, but if it fails (table missing, user not found), it **falls through** to `_fetch_supabase_principal()` which queries Supabase tables and builds a synthetic `User(id=0)`.

3. **Session registration:** Operates entirely on Supabase's `active_sessions` table.

4. **What WOULD break if `users` table is missing:**
   - `POST /api/auth/login-password` (dead path)
   - `POST /api/auth/send-otp` (dead path)
   - `POST /api/auth/verify-otp` (dead path)
   - `POST /api/auth/refresh` (semi-active, but frontend uses Supabase refresh)
   - `POST /api/auth/logout` (semi-active, frontend calls `supabase.auth.signOut()` instead)
   - Auth audit event logging (AuthSecurityEvent table references users.id)

5. **Bottom line:** The system is designed to work **with or without** the local `users` table. The SQLAlchemy User is a **convenience/preference**, not a **dependency**. The true source of truth for authentication is **Supabase Auth** + **Supabase's `profiles`/`school_memberships`/`role_permissions` tables**.

---

## 12. FILES REFERENCED

| File | Path |
|------|------|
| AuthProvider | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\contexts\AuthProvider.tsx` |
| Login page | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\pages\Login.tsx` |
| API service | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\services\api.ts` |
| Supabase client | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\lib\supabase.ts` |
| Runtime config | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\lib\runtimeConfig.ts` |
| Auth store | `C:\Users\GIRISH\Desktop\SITTING PLAN\frontend\src\store\auth.ts` |
| Backend auth routes | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\routes\auth.py` |
| Backend auth middleware | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\middleware\auth.py` |
| Backend auth utils | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\utils\auth.py` |
| Backend config | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\config.py` |
| SQLAlchemy models | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\models\__init__.py` |
| Supabase admin client | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\services\supabase_admin.py` |
| Account security routes | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\routes\account_security.py` |
| Account security service | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\services\supabase_account_security.py` |
| Principal model | `C:\Users\GIRISH\Desktop\SITTING PLAN\backend\app\principal.py` |
