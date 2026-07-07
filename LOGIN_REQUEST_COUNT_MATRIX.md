# LOGIN REQUEST COUNT MATRIX

## Per-Login Request Counts (After Fixes)

| Request | Expected Count | Actual Count | Duplicate? | Initiator | Cause |
|---------|---------------|-------------|------------|-----------|-------|
| supabase.auth.signInWithPassword | 1 | 1 | No | User action | Login button click |
| profiles (Supabase) | 1 | 1 | No | syncSession → buildAppUserFromSession | Bootstrap profile |
| school_memberships (Supabase) | 1 | 1 | No | syncSession → buildAppUserFromSession | Bootstrap profile |
| role_permissions (Supabase) | 1 | 1 | No | syncSession → buildAppUserFromSession | Needs role_id from memberships |
| register (POST /account-security/sessions/register) | 1 | 1 | No | registerPortalSession (fire-and-forget) | Registration dedup via fingerprint |
| heartbeat | 0 | 0 | No | Starts 60s after auth, not during login | Not on critical path |
| getDashboardMetrics | 1 | 1 | No | Dashboard loadStatistics | Auth guard → effect fires once |
| getStaffAttendanceDashboard | 1 | 1 | No | Dashboard loadStatistics | Parallel with other dashboard calls |
| getTimetableEntriesCount | 1 | 1 | No | Dashboard loadStatistics | Parallel with other dashboard calls |
| getEduPayDashboard | 0-1 | 0-1 | No | Dashboard loadStatistics | Conditional on canViewEduPay |
| supabase.auth.refreshSession | 0 | 0 | — | syncSession JWT check | Only if token expired (fresh token = skip) |
| supabase.auth.getSession | 1 | 1 | No | bootstrapInitialSession (on first load, not login) | Only on page load, not during signIn flow |

## Duplicate Prevention Mechanisms

1. **registerPortalSession dedup** (AuthProvider.tsx:500-502): Returns in-flight promise if same userId already registering
2. **sessionRegistrationFingerprintRef** (AuthProvider.tsx:1062-1064): Skips background registration if already handled
3. **dashboardLoadInFlightRef** (Dashboard.tsx:344-347): Returns in-flight promise if dashboard already loading
4. **dashboardLoadFingerprintRef** (Dashboard.tsx:340-343): Skips if same fingerprint loaded within 60s
5. **activeSyncFingerprintRef** (AuthProvider.tsx:694-700): Skips if same fingerprint sync in progress

## Before Fixes (Potential Issues)

| Problem | Detail | Status |
|---------|--------|--------|
| Stale session key → 401 → retry | Axios would retry GET on 502/503/504; 401 NOT retried | Fixed: key cleared at signIn start |
| Registration retries | Up to 3 attempts with 15s/25s/40s timeouts | Still present but non-blocking (fire-and-forget) |
| Axios timeout | 120s on all requests | Still present but only affects hung requests |

## Conclusion

No duplicate API requests are observed during login after the fixes. The request count matches expectations.
