# LOGOUT EXECUTION CHAIN

## Chain: Logout Button → Login Screen

### 1. Logout Button Click
- **File**: `Dashboard.tsx:702-706` (also line 738-742, signOut button)
- **Code**: `onClick={async () => { await signOut(); navigate('/login'); }}`

### 2. AuthProvider.signOut()
- **File**: `AuthProvider.tsx:962-982`
- **Before Fix**:
  ```
  getStoredActiveSessionKey()
    → logoutCurrentSecuritySession(K1) ← AWAITED (up to 120s)
    → supabase.auth.signOut() ← AWAITED (indefinite)
    → clearPersistedAuthArtifacts()
    → logoutStore()
    → setSession(null)
    → setAuthStatus('UNAUTHENTICATED')
    → redirectToLogin()
  ```
- **After Fix**:
  ```
  getStoredActiveSessionKey() → save K1
    → localStorage.removeItem('active_session_key') ← IMMEDIATE
    → clearPersistedAuthArtifacts()
    → logoutStore()
    → setSession(null)
    → setSessionRegistrationReady(false)
    → setAuthStatus('UNAUTHENTICATED')
    → redirectToLogin()
    → [BACKGROUND] logoutCurrentSecuritySession(K1).catch(…)
    → [BACKGROUND] supabase.auth.signOut().catch(…)
  ```

### 3. Backend Request (logoutCurrentSecuritySession)
- **Method**: `apiService.logoutCurrentSecuritySession` (api.ts:594-596)
- **Endpoint**: `POST /account-security/sessions/logout-current`
- **Body**: `{ session_key: string }`
- **Timeout**: 120s (Axios default)
- **After Fix**: Fire-and-forget, error caught by `.catch(() => {})`

### 4. Supabase Auth signOut
- **Method**: `supabase.auth.signOut()` (Supabase JS SDK)
- **Effect**: Revokes refresh token, clears Supabase session
- **After Fix**: Fire-and-forget, error caught by `.catch(() => {})`

### 5. State Cleanup (local)
- **clearPersistedAuthArtifacts()**: Removes auth_token, token, access_token, refresh_token, user, active_session_key from localStorage/sessionStorage
- **logoutStore()**: Clears zustand store (user → null, token → null, is_authenticated → false)
- **setSession(null)**: Clears Supabase session from React state
- **setAuthStatus('UNAUTHENTICATED')**: Marks auth as unauthenticated
- **AuthInitializationRegistry.resolve('UNAUTHENTICATED')**: Completes any pending initialization
- **redirectToLogin()**: `window.location.replace('/login')`

### 6. Navigation to Login
- **Mechanism**: `redirectToLogin()` uses `window.location.replace('/login')`
- **This is a full page redirect**, not React Router navigation
- The page reloads at `/login`, which triggers a fresh bootstrap flow

## Key Observations

1. **The `navigate('/login')` after `signOut()` in Dashboard.tsx is REACHED but irrelevant** — `redirectToLogin()` already fired `window.location.replace('/login')` which causes a page reload, effectively unmounting the entire React app. The `navigate()` call never executes in practice.

2. **Supabase SIGNED_OUT event** — After `supabase.auth.signOut()` completes, the `onAuthStateChange` listener fires with `SIGNED_OUT`. The handler calls `clearAuthState({ redirectToLogin: true })`. This is harmless (re-clears already-clear state) and the `redirectToLogin` call is also harmless (page reload).

3. **Background heartbeat** — When `setAuthStatus('UNAUTHENTICATED')` fires, the heartbeat effect re-runs and returns early (guard: `authStatus !== 'AUTHENTICATED'`). The cleanup function runs setting `active = false`, preventing any scheduled heartbeat from executing.
