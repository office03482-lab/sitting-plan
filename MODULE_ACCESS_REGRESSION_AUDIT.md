# MODULE_ACCESS_REGRESSION_AUDIT

## Summary

Recent auth/session patches introduced a shared runtime regression pattern instead of isolated per-module bugs.

Confirmed shared pattern:

1. `frontend/src/contexts/AuthProvider.tsx` now correctly makes `authReady` depend on `sessionRegistrationReady`.
2. Many school-scoped pages still gate API work with:
   - `authReady && sessionReady && schoolContextReady && !!session`
3. `frontend/src/components/ProtectedRoute.tsx` previously allowed those pages to mount even when school context was missing.
4. When a page mounted without school context, many modules never started requests and some remained on their own loading/blank state path.
5. This was especially dangerous for `platform_admin`, because permission bypass made many school-scoped routes reachable even without an active school context.

## Confirmed Root Cause

Exact shared root cause:

- school-scoped routes were not stopped at the guard layer when `schoolContextReady === false`
- child pages mounted anyway
- child modules commonly used `if (!canRunRequests) return;`
- several modules therefore never advanced to success, empty, unauthorized, or error

This is a route-guard/context-readiness regression, not a one-off bug in individual modules.

## Relevant Files Audited

- [frontend/src/contexts/AuthProvider.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx)
- [frontend/src/App.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/App.tsx)
- [frontend/src/components/Layout.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/Layout.tsx)
- [frontend/src/components/PlatformAdminRoute.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/PlatformAdminRoute.tsx)
- [frontend/src/components/ProtectedRoute.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/ProtectedRoute.tsx)
- [frontend/src/services/api.ts](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/services/api.ts)
- [frontend/src/pages/ParentDashboard.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/pages/ParentDashboard.tsx)

Representative affected page pattern found across many modules:

- `StudentManagement`
- `AttendanceManagement`
- `FeeManagement`
- `InventoryManagement`
- `TimetableManagement`
- `AdminOffice`
- `AccessControl`
- LMS / AI / Parent sub-pages

## Shared Failure Pattern

Observed code pattern:

```ts
const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

useEffect(() => {
  if (!canRunRequests) return;
  void loadSomething();
}, [canRunRequests]);
```

If school context is missing, the component does not fetch, and before this fix the route guard still let it mount.

## Fix Applied

In [frontend/src/components/ProtectedRoute.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/ProtectedRoute.tsx):

- platform routes remain allowed without school context
- force-password route remains allowed without school context
- all other protected routes now render a finite context-blocked screen when `schoolContextReady` is missing

That prevents:

- blank module screens
- page-level infinite waiting caused by `canRunRequests === false`
- silent failure for school-scoped routes opened by `platform_admin`

## Regression Diff Conclusion

- `AUTH_READY` dependency itself is not the core bug
- the core bug is that guard readiness and page readiness were no longer aligned
- school-scoped pages needed a route-level school-context stop before mounting

## Validation Status

- `python -m compileall app` PASS
- `pytest` PASS
- `npm run build` PASS
- browser/sidebar click-through: UNVERIFIED in this environment

## Audit Verdict

- `AUTH STATE MACHINE = PASS`
- `ROUTE GUARDS = PASS`
- `SESSION REGISTRATION = PASS`
- `SCHOOL CONTEXT = PASS`
- `PERMISSION MAPPING = UNVERIFIED`
- `API CLIENT = PASS`
- `MODULE LOADING STATES = PASS`
- `ALL AUTHORIZED MODULES OPEN = UNVERIFIED`
