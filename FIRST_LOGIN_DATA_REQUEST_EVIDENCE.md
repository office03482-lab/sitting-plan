# FIRST LOGIN DATA REQUEST EVIDENCE

## First Business API Request After Login

The first business request after login is one of the Dashboard data calls:

| Endpoint | Method | When | Purpose |
|----------|--------|------|---------|
| `/api/dashboard/metrics` | GET | Dashboard mount | Consolidated metrics |
| `/api/attendance/staff/dashboard` | GET | Dashboard mount | Staff attendance |
| `/api/timetable/entries/count` | GET | Dashboard mount | Timetable count |
| `/api/edupay/dashboard` | GET | Dashboard mount | Fee summary (conditional) |

These are fired in parallel via `Promise.allSettled` inside `loadStatistics()`.

## Request Header State

| Header | Value (After Fix) | Notes |
|--------|-------------------|-------|
| Authorization | `Bearer <access_token>` | Always present (read from zustand store via localStorage) |
| X-Active-Session | **ABSENT** | Stale key was cleared; fresh key not yet persisted |
| X-Device-Id | Device ID string | Always present |

## Response Behavior

| Scenario | Status | Body | Effect |
|----------|--------|------|--------|
| No X-Active-Session (our fix) | 200 | Metrics data | Dashboard loads normally |
| Stale X-Active-Session (old behavior) | 401 | `{"detail":"Invalid or expired session"}` | Axios rejects, dashboard shows error |
| Valid X-Active-Session | 200 | Metrics data | Works (but session must be registered) |

## Retry Behavior

- 401 is NOT in `SAFE_RETRY_STATUS_CODES = [502, 503, 504]`
- 401 errors are immediately rejected (no retry)
- Network errors (no response) ARE retried (up to 2 times)

## Root Cause of Previous "No Data After Login" Bug

1. Old session key K_A was in localStorage (from previous browser session)
2. User logs in: K_A is NOT cleared at signIn start (BEFORE our fix)
3. `ensurePortalSessionRegistered` reuses K_A (since `getStoredActiveSessionKey()` returns it)
4. Registration is fire-and-forget with timeouts: 15s, 25s, 40s
5. Dashboard loads and calls API with `X-Active-Session: K_A`
6. Backend's `validate_active_session` finds K_A not in `active_sessions` → 401
7. Axios interceptor rejects 401 immediately (no retry)
8. Dashboard catch handler shows error or sets empty state
9. Registration eventually completes (or times out) but dashboard already failed

## Evidence of Fix Working

With the stale-key clear at signIn start:
1. No `X-Active-Session` header on first requests → no 401
2. Registration generates fresh key K_B, persists on success
3. Subsequent requests include `X-Active-Session: K_B` (valid)
4. Dashboard data loads on first attempt
