# Tenant Isolation Audit

Date: 2026-06-22

## Scope

This audit focused on tenant-isolation hardening only.

Included:
- Supabase service-role usage review
- Priority-path hardening for `resolve_login_email`, `account-security`, and `analytics`
- Route/service review for students, attendance, timetable, LMS, online tests, reports, and exports
- Automated tenant-isolation regression tests

Excluded:
- UI redesign
- new SaaS features
- schema redesign
- business workflow changes

## Executive Summary

The codebase is not yet fully SaaS-safe in the strict sense because the backend still uses the Supabase service-role client broadly, which bypasses RLS and leaves tenant isolation dependent on application code.

This sprint hardened the highest-risk global lookup path and tightened analytics reference lookups:
- `resolve_login_email` no longer performs global username discovery across all tenants
- tenant-scoped analytics helpers now reapply `school_id` on batch and subject lookups
- analytics profile lookups are constrained to active memberships in the requesting school

Current status:
- critical unauthenticated global username lookup: `PASS`
- module-level isolation across the ERP: mostly `PARTIAL`

## Service-Role Audit

Status: `PARTIAL`

Findings:
- `get_supabase_admin_client()` / `create_supabase_admin_client()` are still used widely across routes and services.
- Because service-role bypasses RLS, tenant isolation is only as strong as explicit `school_id` filters and scope-engine checks in application code.
- This is acceptable for controlled backend operations, but it is not equivalent to database-enforced tenant isolation.

Priority conclusion:
- No single service-role removal was feasible in this sprint without changing architecture.
- The hardening work therefore focused on removing global lookup paths and strengthening code-level scoping where leakage risk was highest.

## Priority Paths

### `resolve_login_email`

Status: `PASS`

Before:
- username login resolution loaded `profiles` globally and matched across all tenants
- duplicate usernames across schools could expose account existence or route to the wrong tenant email

After:
- exact email login remains allowed
- username resolution now requires school context
- username resolution is scoped through active `school_memberships` for the target school before loading `profiles`

Residual risk:
- first-time username login without school context now requires login email instead of global discovery

### `account-security`

Status: `PARTIAL`

What is hardened:
- global username lookup path removed
- route now forwards explicit `school_id` for username resolution

What remains:
- service-role client is still used throughout portal access and account-security helpers
- overview, history, sessions, credential exports, and permission management still depend on application-level school filtering rather than RLS

### `analytics`

Status: `PARTIAL`

What is hardened:
- batch lookups now require `school_id`
- subject lookups now reapply `school_id`
- profile lookups now require active membership in the same school when school-scoped analytics are generated

What remains:
- platform analytics is intentionally cross-school and must stay tightly permission-gated
- analytics still uses service-role queries throughout

### `reports`

Status: `PARTIAL`

What exists:
- report routes already resolve school context from actor/seating-plan context
- report exports already apply school-specific filters in the Supabase fetch path

What remains:
- report generation still relies on service-role reads with application-level `school_id` enforcement

### `exports`

Status: `PARTIAL`

What exists:
- export routes reviewed in seating and attendance flows already pass school-scoped data through route/service boundaries

What remains:
- export safety still depends on code-level filtering rather than RLS
- large export surfaces should continue to be treated as sensitive because they aggregate more data in one request

## Module Status

### Students

Status: `PARTIAL`

Reason:
- route-level school resolution and scope filtering are in place
- service-layer reads still depend on explicit `school_id` propagation and service-role access

### Attendance

Status: `PARTIAL`

Reason:
- school context is consistently propagated in the reviewed report/export paths
- module still relies on service-role plus route/service filters

### Timetable

Status: `PARTIAL`

Reason:
- existing scope-engine enforcement is present for assigned teacher access and exports
- backend still depends on application-level scoping and service-role reads

### LMS

Status: `PARTIAL`

Reason:
- route-level own/assigned/school enforcement exists
- tenant isolation still depends on school-bound service calls and scope filters rather than database isolation

### Online Tests

Status: `PARTIAL`

Reason:
- route-level own/assigned/school/platform flows are explicit
- platform-global analytics is intentionally available for platform admins
- module still depends on service-role plus application scoping

### Reports

Status: `PARTIAL`

Reason:
- reviewed seating-report routes are school-bound
- exports and report builders remain application-enforced

### Exports

Status: `PARTIAL`

Reason:
- reviewed export paths are school-scoped
- service-role access still means export isolation is only code-enforced

### Analytics

Status: `PARTIAL`

Reason:
- helper lookups hardened in this sprint
- platform analytics remains intentionally cross-school
- broader analytics still runs on service-role queries

### Account Security

Status: `PARTIAL`

Reason:
- highest-risk global lookup removed
- broader account-security surfaces still rely on service-role and explicit filtering

## Automated Verification

New regression suite added:
- `backend/tests/test_tenant_isolation_hardening.py`

Result:
- `PASS` (`9 passed`)

Coverage added:
- username login resolution requires school context
- username login resolution is scoped through active school memberships
- analytics batch lookup is scoped by `school_id`
- account-security route forwards tenant context
- school admins cannot request another school’s analytics
- students route uses actor school context
- LMS route uses actor school context
- attendance report route uses actor school context
- seating report export uses actor school context

## Verification Notes

Additional command results:
- `python -m compileall app`: `PASS`

Existing stabilization suites currently still show failures in unrelated pre-existing test scaffolding:
- `backend/tests/test_online_tests_stabilization.py`
- `backend/tests/test_timetable_stabilization.py`

Observed failure pattern:
- tests use placeholder school IDs like `school-1`
- current scope and Supabase-backed helpers expect UUID-like school IDs and hit real Supabase-backed code paths in those tests

These failures were not introduced by the new hardening changes in this sprint, but they do mean the broader legacy test harness still needs cleanup.

## Final Assessment

Tenant isolation is stronger than before this sprint, but the platform remains `PARTIAL` overall for production-grade multi-school SaaS hardening.

Why:
- the most dangerous global lookup path has been removed
- critical analytics helper lookups are now tenant-scoped
- automated regression coverage now exists for key tenant-boundary paths
- however, the architecture still depends broadly on service-role access plus application filtering instead of database-enforced tenant boundaries

Recommended next hardening steps:
1. Continue eliminating ID-only helper lookups in service-role services where `school_id` can be reapplied.
2. Add tenant-isolation regression tests for parent portal, reports-all-rooms, LMS progress, and online-test platform-admin edge cases.
3. Reduce service-role usage on read paths where actor-bound Supabase clients or stricter repository boundaries are feasible.
