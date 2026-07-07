# LOGOUT PENDING REQUEST TRACE

## Active Requests at Logout Time

After application data is loaded, these requests may be in-flight when logout is clicked:

| Request | Typical Duration | In-Flight at Logout? | After Fix Behavior |
|---------|-----------------|---------------------|-------------------|
| Heartbeat (every 60s) | ~200-500ms | Maybe (depends on timing) | Effect cleanup sets `active=false`; in-flight promise's `.finally()` schedules no new heartbeat |
| Dashboard (infrequent, 60s cooldown) | ~200-1000ms | Maybe (if recently navigated) | No abort mechanism; promise resolves but state update guarded by `dashboardMountedRef` |
| Registration (only once) | 15-83s worst case | No (completed long ago) | N/A |
| Other module data | varies | Maybe | No abort mechanism |

## Request Lifecycle After Logout

### Heartbeat
```
Before logout:
  setTimeout → heartbeat POST → promise.then(() → scheduleNext)

At logout (setAuthStatus('UNAUTHENTICATED')):
  Effect re-runs → cleanup: active = false → effect body returns early

If heartbeat was already in-flight:
  heartbeat completes → .catch(() => {}).finally(() → scheduleNext())
  → scheduleNext checks `if (!active) return;` → returns → NO SCHEDULE
```

**Verdict**: Heartbeat is properly stopped on logout. No late heartbeat can restart the loop.

### Dashboard Requests
```
Before logout:
  loadStatistics fired → Axios GET → in-flight

At logout (redirectToLogin → page reloads):
  Page reload → all in-flight XHR/Fetch are aborted by browser

If still on SPA (before page reload):
  Request completes → loadStatistics catch handler runs
  → checks `if (!dashboardMountedRef.current) return;` → dashboardMountedRef is true until
     the component unmounts (which happens on redirect → page reload)
```

**Verdict**: Dashboard requests that complete AFTER state is cleared but BEFORE page reload could try to update state. The `dashboardMountedRef` flag prevents state updates after unmount, but there's a brief window between state-clear and reload where a late response could call `setStats()` on an unmounted component. React will warn but not crash.

### Axios Response Interceptor
```
At logout:
  localStorage is cleared (tokens, session key, user)
  
If a response interceptor runs:
  It reads token from localStorage → null
  It reads session key from localStorage → null
  No harm — interceptor doesn't retry on auth failure (no 401 retry)
```

**Verdict**: No danger from Axios interceptors after logout.

## Known Gap

There is no **AbortController-based cancellation** for pending Axios requests. When logout fires:
- In-flight requests continue until completion or timeout
- Their response handlers may attempt to update React state after unmount
- React 18+ ignores state updates on unmounted components (no crash, just console warning)

This is a minor cosmetic issue. Implementing full request cancellation would require:
1. Creating a per-component/session AbortController
2. Passing `signal` to all Axios requests
3. Calling `controller.abort()` on logout

This is a larger refactor that exceeds the "minimal fix" scope. The current behavior is safe (no crashes, no state corruption).
