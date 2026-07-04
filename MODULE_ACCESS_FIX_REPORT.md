# MODULE_ACCESS_FIX_REPORT

## Root Cause

School-scoped protected routes could mount without school context. After mounting, many pages intentionally refused to fire API calls until:

- `authReady`
- `sessionReady`
- `schoolContextReady`
- `session`

were all present.

That behavior is safe by itself, but because the route guard did not block missing-school-context access, users could land on pages that never advanced into a finite module state.

## Exact File Changed

- [frontend/src/components/ProtectedRoute.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/ProtectedRoute.tsx)

## Fix

Added a route-level finite state for missing school context:

- platform routes are exempt
- `/force-password-change` is exempt
- all other protected routes now render a clear context-required screen when school context is unavailable

## Before

- protected route allowed page mount
- page saw `canRunRequests === false`
- request effect exited early
- some modules appeared blank or never completed loading

## After

- protected route stops school-scoped page mount when school context is missing
- user gets an explicit finite state instead of a broken module
- platform-only routes still open normally without tenant school context

## Files Modified

- [frontend/src/components/ProtectedRoute.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/ProtectedRoute.tsx)

## Validation

- `python -m compileall app` PASS
- `pytest` PASS
- `npm run build` PASS
- actual browser route-click verification: UNVERIFIED

## PASS / FAIL

- Shared route/context regression fix: PASS
- Automated validation: PASS
- Live browser verification: UNVERIFIED
