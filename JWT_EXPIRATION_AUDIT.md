# JWT Expiration Audit — Login Bootstrap Failure

## Evidence

```
PGRST303
JWT expired
```

This PostgREST error occurs when a Supabase REST API call is made with an expired JWT access token. In this application, such calls happen exclusively from the **frontend** Supabase-js client during profile bootstrap (`supabase.from('profiles').select(...)`, `supabase.from('school_memberships').select(...)`, `supabase.from('role_permissions').select(...)`).

The backend uses the **service role key** (admin client) for all its Supabase calls, so it never gets PGRST303 from its own queries.

---

## Root Cause

**Primary**: Supabase-js auto-refresh fails (refresh token expired or revoked), but Supabase-js still proceeds to make PostgREST calls with the expired access token rather than firing `SIGNED_OUT` first. This is a Supabase-js behavior gap.

**Contributing factors in application code**:

### Bug 1 — `decode_token()` cache returns expired payloads

**File**: `backend/app/utils/auth.py:86-94`

```python
cached = _DECODED_TOKEN_CACHE.get(token_cache_key)
now = time.monotonic()
if cached:
    expires_at, payload = cached
    if now < expires_at:
        return payload  # ❌ Returns without checking JWT exp claim
```

The cache stores decoded JWT payloads with a 300-second (5-minute) TTL. On cache hit, it verifies the **cache** TTL but **never checks the JWT `exp` claim**. This means an expired token is accepted by the backend for up to 5 extra minutes.

**Scenario**:
1. Token A decoded at T=0, cached. Token A expires at T=900 (15-min TTL).
2. At T=1000, token A is expired (exp=900). Cache was refreshed at T=700 (last decode), so cache TTL expires at T=1000.
3. A request arrives at T=950 with expired token A.
4. Cache still valid (T=950 < T=1000) → returns payload without checking `exp`.
5. Backend accepts the expired token, processes the request.
6. Meanwhile, the frontend Supabase-js client's PostgREST calls use the SAME expired token → PGRST303.

**Window**: Up to 300 seconds where an expired token appears valid.

### Bug 2 — Axios has no 401 response interceptor

**File**: `frontend/src/services/api.ts:166-215`

The `ApiService` constructor registers only a **request interceptor**. There is no **response interceptor**.

When an API call returns 401 (because the token in app localStorage is stale/expired):
- No automatic token refresh is attempted
- No request retry occurs
- The error propagates unhandled to the caller

### Bug 3 — App localStorage token diverges from Supabase session token

The app stores tokens redundantly under keys `auth_token`, `token`, `access_token` in localStorage. Supabase-js stores its session under `sb-<url>-auth-token`. These two storage locations can diverge:

1. Supabase-js auto-refreshes the token → updates `sb-<url>-auth-token` immediately.
2. `TOKEN_REFRESHED` event fires → AuthProvider handler has a **400ms debounce**.
3. Axios interceptor reads from `auth_token` (app localStorage) → still the **old** token.
4. During those 400ms, Axios sends the old (possibly expired) token.

If Axios gets a 401, the response is not intercepted (Bug 2), so even after the debounce updates the app storage, the failed request is not retried.

---

## Files

| File | Lines | Role |
|------|-------|------|
| `backend/app/utils/auth.py` | 86-94 | `decode_token()` cache — no `exp` check on hit |
| `frontend/src/services/api.ts` | 166-215 | Axios interceptor — no 401 response handler |
| `frontend/src/contexts/AuthProvider.tsx` | 688-700 | TOKEN_REFRESHED handler with 400ms debounce |
| `frontend/src/store/auth.ts` | 56-125 | `loadInitialAuthState()` — reads from app localStorage |
| `frontend/src/store/auth.ts` | 16-33 | `isJwtActive()` / `decodeJwtExp()` — client-side exp check |
| `backend/app/middleware/auth.py` | 526-640 | `get_authenticated_user()` — calls `decode_token()` |

---

## Verification Results

### 1. Expired token automatically refreshes

| Layer | Result | Details |
|-------|--------|---------|
| Supabase-js | ✅ PASS | `autoRefreshToken: true` (default). Refreshes before PostgREST calls. |
| AuthProvider | ⚠️ PARTIAL | Handles `TOKEN_REFRESHED` but with 400ms debounce (Bug 3). |
| Axios | ❌ FAIL | No response interceptor for 401 retry (Bug 2). |

### 2. Expired token is not reused from cache

| Layer | Result | Details |
|-------|--------|---------|
| Backend `decode_token()` | ❌ FAIL | Cache returns expired payloads without checking `exp` (Bug 1). |

### 3. `decode_token()` cache does not retain invalid payloads

| Check | Result | Details |
|-------|--------|---------|
| Evicts on cache TTL expiry | ✅ | 300-second TTL is respected. |
| Evicts on JWT `exp` | ❌ | **Never checks JWT `exp` on cache hit.** |

### 4. AuthProvider correctly handles TOKEN_REFRESHED events

| Check | Result | Details |
|-------|--------|---------|
| Listens to event | ✅ | `onAuthStateChange` registered. |
| Syncs session | ✅ | Calls `syncSession` with `silentTokenRefresh: true`. |
| Debounce | ⚠️ | 400ms debounce delays app localStorage update, creating a window for stale token use. |

### 5. Supabase session restoration works after page reload

| Check | Result | Details |
|-------|--------|---------|
| `supabase.auth.getSession()` | ✅ | Restores from Supabase-managed localStorage. |
| Auto-refresh on restore | ✅ | Supabase-js refreshes expired token if refresh token is valid. |
| App localStorage sync | ⚠️ | App's `auth_token` is loaded by `loadInitialAuthState()` but may be stale. |

---

## Fixes Required

### Fix 1 (BACKEND) — `decode_token()`: check JWT `exp` on cache hit

**File**: `backend/app/utils/auth.py`

**Problem**: Cached payload returned without verifying JWT `exp` claim.

**Fix**: Add `time.time()` check against `payload.exp` before returning cached entry.

### Fix 2 (FRONTEND) — Axios: add 401 response interceptor with Supabase refresh

**File**: `frontend/src/services/api.ts`

**Problem**: No response interceptor. 401 errors are not retried with a refreshed token.

**Fix**: Add a response interceptor that catches 401 errors, calls `supabase.auth.refreshSession()` to refresh the token, updates app localStorage, and retries the original request.

### Fix 3 (FRONTEND) — Reduce TOKEN_REFRESHED debounce

**File**: `frontend/src/contexts/AuthProvider.tsx`

**Problem**: 400ms debounce delays token sync to app localStorage, creating a window for stale token use.

**Fix**: Reduce debounce from 400ms to 0ms (use `Promise.resolve().then()` microtask or `queueMicrotask`). The token update should be near-instantaneous.

---

## Verdict

| Category | Result |
|----------|--------|
| Root Cause Identified | ✅ **PASS** |
| Bug 1 (decode_token cache) | ❌ **FAIL — fix required** |
| Bug 2 (Axios 401 interceptor) | ❌ **FAIL — fix required** |
| Bug 3 (TOKEN_REFRESHED debounce) | ⚠️ **PARTIAL — fix recommended** |

**Production impact**: Users with expired sessions may experience a bootstrap loop: the page loads, Supabase-js refresh fails, PGRST303 is returned, and the auth state is cleared. The user is redirected to login. Fixing Bug 2 ensures that if a token is stale, the Axios interceptor refreshes it transparently.
