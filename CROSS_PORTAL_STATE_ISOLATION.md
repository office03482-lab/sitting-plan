# Cross-Portal State Isolation

## Problem

When a user switches portals (e.g., School ERP → Student Portal) or logs out, residual state from the previous portal must not leak into the new context.

## Isolation Guarantees

| Concern | Resolution |
|---|---|
| **Active session key** | Cleared on portal switch/logout. Next bootstrap re-resolves. |
| **Stale heartbeat** | School ERP heartbeat interval is cancelled on portal exit. Student/Parent portals never start one. |
| **Late response leakage** | In-flight API responses from previous portal are discarded. Components unmount on route change. |
| **School context** | Re-resolved per portal bootstrap. Student's school_id from `students` table, parent's from `guardians`, staff's from `memberships`. |
| **Permissions cache** | School ERP permissions are not cached into student/parent sessions. Student/parent have no permissions object. |
| **Zustand stores** | Portal-specific stores reset on unmount. Global auth store is re-populated per bootstrap. |

## Implementation

- **Logout**: `signOut()` → clear supabase session → clear intent cookie → redirect to login.
- **Portal switch**: Selector UI calls `signOut()` then navigates to `/login?intent=<new_intent>`.
- **Bootstrap guard**: Middleware and bootstrap function treat each navigation as fresh — no optimistic reuse of stale principal data.
