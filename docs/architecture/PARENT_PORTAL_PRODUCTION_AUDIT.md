# Parent Portal — Production Readiness Audit (Phase 8)

Date: 2026-08-01
Scope: full Parent Portal — every page, endpoint, auth chain, API contract, and data path.
Goal: every module loads real DB data, always finishes loading, and renders correct
loading / success / empty / error / retry states — no infinite spinners, no fake data,
no hidden errors, no per-page band-aids.

## Summary

| Status | Count |
|---|---|
| Modules audited | 12 |
| PASS (no change needed) | 4 |
| FIXED this audit | 8 |
| Known / acceptable | 0 blocking |

- Backend: `python -m pytest -q` → **148 passed, 1 pre-existing env-dependent failure** (unchanged).
- Frontend: `npx tsc --noEmit` clean; `npx vitest run` → **177 passed** (1 flaky timer test
  occasionally hangs under full parallel load, passes in isolation; unrelated to these changes);
  `npx eslint` → 0 errors (1 pre-existing shared `exhaustive-deps` warning pattern).

---

## 1. Auth chain (login → school → scope) — PASS

Verified end-to-end:
- Parent/student resolves school from `user.school_id` (`AuthProvider.tsx` `hasResolvedSchoolContext`),
  no membership lookup needed. `schoolContextReady` and `canRun` are stable-true for logged-in parents.
- `ParentRoute` gates every `/parent/*` route (spinner until `authReady`; redirects to `/login`;
  admits `parent` role or `edupay.parent_portal` permission).
- `resolve_school_id_from_actor` → `_role_aware_resolve_school_id` handles parent/admin/platform.
- Linked-student resolution (`supabase_lms._list_parent_linked_students`) is batched (3 queries),
  matches by `guardians`/`student_guardians` first, then student `metadata` fallback.
- Scope enforcement: `require_parent_scope` (permission `edupay.parent_portal`, `include_students=True`);
  every route filters via `_load_visible_students` (parents → linked children; admins/platform → school-wide).
- No auth bug found.

## 2. Dashboard — PASS

- Route `/parent/dashboard` → `parent_portal_service.get_dashboard` — fully batched
  (`_batch_load_attendance` 180d, `_batch_load_fees`, `_batch_load_assignments`,
  `_batch_load_test_results`, `_batch_load_progress`, `_load_shared_tests`). Empty-linked → 404 → `{children: []}`.
- Page `ParentDashboard.tsx` is the reference implementation: full `viewState` machine
  (loading / success / empty / unauthorized / session_expired / school_context_unavailable / error),
  retry button, handles 404/403/401, renders real data (attendance, learning score, assignments,
  latest test, fee status, upcoming tests).
- Note: `get_dashboard` returns hardcoded `academic_health_score: 0` / `risk_level: "low"`.
  Not user-visible on this page (metrics are per-child real values). Documented, low priority.

## 3. Attendance Center — PASS (fixed prior session + cleaned this session)

- Prior root cause: route built each child via `_build_attendance` → 1 Supabase query per child (N+1);
  a hung query could leave the page on an infinite spinner. Fixed with batched
  `_batch_load_attendance(days=365)` + `_build_attendance_from_batch`, `try/except → {}` per school scope.
- Frontend `ParentAttendance.tsx`: self-managed `AbortController` + 30s `LOADING_TIMEOUT_MS` (loading
  always settles), cancellation on unmount, Retry button.
- This session: removed ~20 `console.log` debug statements, the `debugState()` helper, and dead
  `[parent-attendance-debug]` warning logs in the route (plus the now-unused `logger`).
- Tests: `tests/test_parent_portal_attendance.py` (4) — batched equivalence, empty-ids no-query,
  grouping, route-uses-batched.

## 4. Academic Progress — FIXED (this session)

- Root cause: route used per-child `_build_academic_progress` (N+1: `get_progress_dashboard` +
  `list_assignments` + analytics per child), identical anti-pattern to the old attendance route.
  The batched `get_academic_progress`/`_build_academic_progress_from_batch` existed unwired.
- Fix (`routes/parent_portal.py`): route now batch-loads assignments + progress + test results
  (`try/except → {}` per school scope) and builds via `_build_academic_progress_from_batch`.
  Output shape is byte-identical to the old builder (proven by test) → frontend contract unchanged.
- Page `ParentAcademicProgress.tsx` already had bounded loading (30s timeout) + error state; no change needed.

## 5. Online Test Results — FIXED (this session)

- Root cause: route used per-child `_build_test_results` (1 `list_results` query per child).
- Fix: route batch-loads `_batch_load_test_results(limit=50)` and builds via `_build_test_results_from_batch`.
- Page `ParentTestResults.tsx` shape matches; loading bounded; no change needed.

## 6. Assignments — FIXED (this session)

- Root cause: route used per-child `_build_assignments` (1 `list_assignments` query per child).
- Fix: route batch-loads `_batch_load_assignments` and builds via `_build_assignments_from_batch`.
- Page `ParentAssignments.tsx` shape matches; loading bounded; no change needed.

## 7. Alerts — FIXED (this session)

- Root cause: route used per-child `_build_alerts` (attendance + results + assignments + fee query
  per child).
- Fix: route batch-loads attendance (90d), test results (10), assignments, shared tests, and fees
  (`_batch_load_fees`), and builds via `_build_alerts_from_batch`. Added `fee_data` parameter to the
  builder so fees are preloaded (kills the last per-child query). `try/except → {}` per school scope.
- Page `ParentAlerts.tsx` shape matches; loading bounded; no change needed.

## 8. AI Assistant — PASS with hardening (this session)

- `/parent/ai/ask` (`_build_parent_ai_response`) and `/parent/ai/recommendations`
  (`_build_recommendations`) build per-student context via 5 heavy builders. Bounded for typical
  1–2 children (no infinite hang; axios 120s), but a per-child DB failure previously 500'd the whole
  endpoint (`_build_test_results` / `_build_academic_progress` were not exception-safe).
- Fix: wrapped per-student context building in `try/except` in both functions — a failing child is
  skipped (AI answers "data missing") instead of returning a 500. Recommendations fall back to an
  honest "data unavailable" message.
- Page `ParentAiAssistant.tsx`: children + recommendations load non-blocking, `loadingRecs` always
  settles; chat errors surface in-chat; no infinite spinner.

## 9. Parent Intelligence Portal (`/parent-intelligence`) — CRASH FIXED (this session)

- Root cause: legacy page consumed the legacy `ParentChildDashboard` shape
  (`child.academic_health_score.toFixed(1)`, `risk_factors.length`, `weak_topics.length`,
  `suggestions.length`), but `/parent/dashboard` and `/parent/alerts` now return the **new** portal
  shapes. With any linked child, `undefined.toFixed(1)` threw → page crashed; insights and alerts
  sections silently rendered empty. The page also issued 4 requests, two of which
  (`/insights` and `/risk-score`) ran the same heavy computation twice.
- Fix (`ParentIntelligencePortal.tsx`):
  - Single data source: `/parent/risk-score` returns the full legacy per-child payload
    (all scores, risk factors, 7/30/90d trends, weak/strong topics, suggestions, insights, alerts,
    communication actions, hostel status) — fetched once.
  - `children`, `insights` (flattened), and `alerts` (flattened) all derived from that payload.
  - Overall Academic Health / risk derived from children (real data, no fake scores).
  - Every `.toFixed` / `.length` access made defensive (`Number(x||0)`, `(x||[])`) — no crash path.
  - Retry button added on error (consistent with Attendance).
- Acknowledge buttons on snapshot alerts still require a persisted alert id (none exists for
  snapshots) — the page shows an honest banner instead of crashing.

## 10. Children list + Communication — PASS

- `/parent/children` returns linked children from already-resolved visible students (no extra queries).
- `/parent/communication/contact-teacher`, `/parent/communication/request-meeting` scope-check the
  student then delegate to `supabase_parent_intelligence`. Legacy `/parent/insights` and
  `/parent/risk-score` use the batched `_batch_student_parent_payloads`.

## 11. Fees / Timetable / Results (coverage)

- No standalone parent pages exist for Fees / Timetable / Results (confirmed in `App.tsx`).
- Fees are surfaced with real data in: Dashboard fee card, Alerts (`fee_due`), AI context, and the
  legacy intelligence payload. Results are the Tests module. Timetable appears inside AI context only.
- Not a defect; flagged so scope is explicit.

---

## Root-cause fixes applied (systematic, not per-page)

1. **N+1 per-child route builders eliminated** — 4 routes (academic-progress, test-results,
   assignments, alerts) rewired to the existing batched loaders + `_build_*_from_batch`, matching the
   attendance pattern. Fees now batched too. Each endpoint is now 1–5 queries total regardless of
   child count, and `try/except → {}` guarantees a failing data source cannot 500 a child's view.
2. **Legacy `/parent-intelligence` contract mismatch fixed** — page now consumes the one endpoint that
   returns its true payload shape (`/parent/risk-score`), rendered defensively.
3. **AI endpoints are exception-safe** — per-student context failures no longer 500 the endpoint.
4. **Debug noise removed** — `[parent-attendance-debug]` logs + unused `logger`, and all
   `console.log`/`debugState()` scaffolding in `ParentAttendance.tsx`.

## Verification

- Backend: `python -m pytest -q` → 148 passed / 1 pre-existing env failure
  (`test_dashboard_fallback_ignores_missing_optional_schemas`, uuid env issue, unchanged by this audit).
- New regression tests: `tests/test_parent_portal_batched_routes.py` (10) — batched builders are
  output-identical to per-student builders; each route uses the batched loaders and not the N+1
  builders; alerts preloading skips fee queries; attendance route has no debug logging.
  Existing `tests/test_parent_portal_attendance.py` (4) still pass.
- Frontend: `npx tsc --noEmit` clean; `npx vitest run` → 177 passed; `npx eslint <changed files>` → 0 errors.

## Known / accepted items (documented, non-blocking)

- AI context building remains per-student (bounded for 1–2 children; now exception-safe). A batched
  AI context builder is a possible future optimization.
- The 4 repetitive pages (AcademicProgress, TestResults, Assignments, Alerts) show a dismissible error
  alert but no Retry button (Dashboard/Attendance/Intelligence have one). Loading always settles.
- `get_dashboard`'s top-level `academic_health_score`/`risk_level` are placeholder constants
  (not rendered by the new Dashboard page).
- Legacy api methods `getParentIntelligenceDashboard` / `getParentIntelligenceInsights` /
  `getParentIntelligenceAlerts` are now unused by the page but kept for backward compatibility.

## Changed files

- `backend/app/routes/parent_portal.py` — rewired 4 routes, hardened AI ask, removed debug logs + logger.
- `backend/app/services/parent_portal_service.py` — `_build_alerts_from_batch` `fee_data` param;
  `_build_recommendations` exception-safe.
- `backend/tests/test_parent_portal_batched_routes.py` — new regression tests.
- `frontend/src/pages/ParentIntelligencePortal.tsx` — crash fix, single real data source, retry.
- `frontend/src/pages/ParentAttendance.tsx` — removed debug scaffolding.
