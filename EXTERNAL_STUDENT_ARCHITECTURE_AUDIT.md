# EXTERNAL STUDENT ARCHITECTURE AUDIT

Date: 2026-06-22
Status: Architecture audit only
Scope: No code changes, no migrations, no schema changes

## Executive Summary

The current platform is not ready to introduce `external_student` as a first-class actor without targeted architectural work.

The main reason is structural, not UI-related:

- Authentication bootstrap assumes every active user has a `school_memberships` row.
- Most backend route resolution assumes a valid `school_id` is always present in actor context.
- Student "own scope" is implemented as a school-scoped lookup from `profile_id` to a `students` row.
- Parent, LMS, Online Tests, AI, Study Planner, Reports, and Analytics all derive learner context from school-owned student records.

Introducing `external_student` safely is possible, but it must be done by separating:

- global learner identity
- school membership identity
- school-owned student records
- learner-facing product access

Doing that incrementally can preserve all existing `school_student`, `teacher`, `parent`, `staff`, and `admin` workflows.

## Audit Method

This audit reviewed the current frontend auth bootstrap plus backend route and service assumptions across:

- Authentication
- Profiles
- Memberships
- LMS
- Online Tests
- AI
- Study Planner
- Subscriptions
- Reports
- Analytics

Primary code anchors reviewed:

- `frontend/src/contexts/AuthProvider.tsx`
- `backend/app/services/supabase_context.py`
- `backend/app/services/scope_engine.py`
- `backend/app/routes/auth.py`
- `backend/app/routes/lms.py`
- `backend/app/routes/online_tests.py`
- `backend/app/services/supabase_ai_tutor.py`
- `backend/app/services/supabase_study_planner.py`
- `backend/app/services/parent_portal_service.py`
- `backend/app/services/supabase_parent_intelligence.py`
- `backend/app/services/supabase_bi.py`
- `backend/app/services/supabase_monetization.py`

## Status Matrix

| Subsystem | Status | Why |
| --- | --- | --- |
| Authentication | FAIL | Active session bootstrap requires school membership and school context. |
| Profiles | PARTIAL | `profiles` can represent identity, but runtime usage assumes school-backed role context. |
| Memberships | FAIL | Authorization and active context are membership-centric today. |
| LMS | FAIL | Student access resolves through school-owned student rows. |
| Online Tests | FAIL | Test access, attempts, and visibility are school-scoped. |
| AI | PARTIAL | AI features exist, but learner-facing AI depends on school-scoped LMS/tests/analytics context. |
| Study Planner | FAIL | Planner logic derives student context from school and student records. |
| Subscriptions | PARTIAL | Commerce foundations exist, but ownership and entitlement flow are still school/student-school centric. |
| Reports | FAIL | Reporting/export model is school-scoped and not designed for external learner ownership. |
| Analytics | FAIL | Student analytics and warehouse facts are built around `school_id` and school-owned students. |

## Key Cross-Cutting Findings

### 1. Authentication currently requires school membership

The frontend auth bootstrap loads `profiles` plus `school_memberships`, selects an active membership, and throws when none exists.

Observed behavior:

- membership list is loaded from `school_memberships`
- active school is chosen from primary/default/first membership
- missing membership throws `No active school membership found for this user.`

Impact:

- a valid authenticated `external_student` with no school membership cannot enter the app
- the app user shape currently expects `school_id`, `membership_id`, and membership-derived permissions

Relevant anchor:

- `frontend/src/contexts/AuthProvider.tsx`

### 2. Backend route context assumes `school_id`

The backend school context resolver raises `403` when a valid `school_id` is not present in actor claims or request context.

Observed behavior:

- `resolve_school_id_from_actor(...)` attempts actor claim extraction
- falls back to explicit request parameter
- raises `Valid UUID school_id missing from context` if absent

Impact:

- routes using this dependency will fail immediately for a non-school actor
- introducing `external_student` cannot be done by permissions alone

Relevant anchor:

- `backend/app/services/supabase_context.py`

### 3. Scope engine "own scope" is still school-scoped for students

The scope engine correctly distinguishes platform/school/assigned/own, but the student "own" implementation resolves through school membership context.

Observed behavior:

- default scope maps `student` and `parent` to `own`
- `_resolve_student_ids(school_id, actor, user)` calls `_get_student_by_profile_id(school_id, profile_id)`
- parent scope resolves linked students inside the same school

Impact:

- `external_student` cannot use existing own-scope logic without either:
  - a synthetic school membership, or
  - a new non-school learner context path

Relevant anchor:

- `backend/app/services/scope_engine.py`

### 4. Student identity is not just `profile`; it is a school-owned student row

Across learner-facing services, "student context" means:

- a `profile_id`
- plus a resolved `students` row
- plus a `school_id`

This pattern appears across LMS, Online Tests, AI Tutor, Study Planner, Parent Portal, and Analytics.

Impact:

- any feature expecting a `students` row will fail or silently return empty data for an external learner

### 5. Parent workflows are school-local, not global family-local

Parent resolution uses school-scoped child linking.

Observed behavior:

- linked children are loaded with `school_id`
- parent dashboards and AI consume only those school-linked students

Impact:

- this is not directly a blocker for `external_student`, but it confirms the current family model is also school-scoped
- future mixed school/external family scenarios would need explicit modeling

## Subsystem Findings

## 1. Authentication

Status: FAIL

Current assumptions:

- every active user has an active `school_memberships` row
- app session requires school context before normal navigation can proceed
- frontend user object is built from membership-backed role and school data

What breaks without `school_id`:

- session bootstrap in the frontend
- any backend dependency on `resolve_school_id_from_actor`
- any route expecting membership-derived permissions

Safe conclusion:

- `external_student` cannot be introduced through auth configuration only
- auth must support a non-membership actor mode before anything else

## 2. Profiles

Status: PARTIAL

What already works:

- `profiles` appears to be the platform-wide identity record
- profile-level auth identity exists independently from a specific module

What does not work yet:

- runtime access still assumes profile -> school membership -> role -> school context
- student role behavior generally expects the profile to also resolve to a school-owned student row

Safe conclusion:

- profiles can remain the core identity layer
- they are not sufficient on their own for `external_student` under current runtime assumptions

## 3. Memberships

Status: FAIL

Current assumptions:

- school-role users are provisioned through `school_memberships`
- active school context comes from membership
- permissions and role behavior are membership-centric

What breaks without school membership:

- active role resolution
- school selection
- permission derivation
- many create/update user flows

Safe conclusion:

- `external_student` should not be forced into `school_memberships` if the requirement is "without school membership"
- a parallel access model is required

## 4. LMS

Status: FAIL

Current assumptions:

- LMS routes depend heavily on `resolve_school_id_from_actor`
- student LMS views resolve the current learner using `_get_student_by_profile_id(school_id, profile_id)`
- parent LMS views resolve linked students within a school

What breaks without `school_id`:

- course listing
- progress dashboard
- assignments visibility
- revision tracker
- success dashboard

Services that assume student record exists:

- LMS route handlers and downstream service calls that pass `student=...`

Safe conclusion:

- LMS currently supports school students, not global learners

## 5. Online Tests

Status: FAIL

Current assumptions:

- routes are school-scoped
- learner test visibility is derived from school, batch, and student ownership
- student and parent flows both resolve through school-owned student data

What breaks without `school_id`:

- test listing
- test attempts
- result views
- student-scoped test visibility
- parent child result access

Services that assume student record exists:

- online test flows that resolve student id from profile id inside a school

Safe conclusion:

- Online Tests needs a separate learner entitlement/context model for external learners

## 6. AI

Status: PARTIAL

What already exists:

- AI Tutor and related AI pathways are modularized as services
- role-aware behavior exists for student, parent, and staff personas

Current assumptions:

- learner-facing AI builds context from LMS, assignments, tests, attendance, recommendations, and analytics
- those sources are all school-scoped
- tutor history rows are written with `school_id`

What breaks without `school_id`:

- context assembly for student tutoring
- attendance/test/LMS grounded responses
- parent linked-child AI views

Why this is PARTIAL instead of FAIL:

- the AI service layer is separable in principle
- but the current student-facing implementation is still tightly coupled to school-owned data

Safe conclusion:

- AI can support `external_student` later, but only after learner context is decoupled from school ownership

## 7. Study Planner

Status: FAIL

Current assumptions:

- planner functions take `school_id`
- learner resolution uses `_get_student_by_profile_id(school_id, profile_id)`
- recommendations and plans consume school analytics, LMS progress, assignments, and test data

What breaks without `school_id`:

- student daily/weekly plan generation
- student recommendations
- parent planner views
- any planner flow that requires a school snapshot

Services that assume student record exists:

- planner payload builders and goal creation logic

Safe conclusion:

- Study Planner is currently a school-student feature, not a global learner feature

## 8. Subscriptions

Status: PARTIAL

What already exists:

- monetization/catalog/order/subscription foundations
- school-scoped product and subscription filtering
- some profile-aware purchase handling

Current assumptions:

- many flows resolve products and subscriptions by `school_id`
- profile-to-student resolution uses `students` filtered by `school_id`
- entitlement semantics are still oriented around school ownership

What breaks without `school_id`:

- student resolution in school-based purchase flows
- school-specific catalog or coupon ownership assumptions

Why this is PARTIAL:

- the commerce layer is the closest existing foundation for external consumer support
- but it is not yet modeled for a schoolless external learner lifecycle

Safe conclusion:

- external subscriptions are feasible, but need separate ownership and entitlement rules

## 9. Reports

Status: FAIL

Current assumptions:

- reports are school-scoped
- saved reports, exports, and dashboards filter by `school_id`
- report content is drawn from school warehouse facts

What breaks without `school_id`:

- learner-specific reporting where the learner is not school-owned
- any attempt to reuse school reports for an external student persona

Safe conclusion:

- reports should remain school reporting
- external learner reporting would need its own reporting surface or explicit hybrid rules

## 10. Analytics

Status: FAIL

Current assumptions:

- warehouse refreshes are built per school
- dimensions and fact tables are keyed by `school_id`
- student analytics depend on school-owned students
- platform-level metrics aggregate schools, not schoolless learners

What breaks without `school_id`:

- student analytics lookup
- school refresh pipelines
- learner KPIs derived from school warehouse facts

Tables and models that assume school ownership:

- warehouse dimensions keyed by `school_id`
- warehouse fact tables keyed by `school_id`
- student-based analytics tables and derived facts

Safe conclusion:

- external learner analytics must be modeled separately instead of being squeezed into school warehouse assumptions

## Assumptions That Require School Membership

- active app access requires a selected school membership
- user permissions are derived from membership-backed role context
- student "own scope" is implemented as school-specific student resolution
- parent access is limited to school-linked children
- many background aggregations treat the school as the top-level ownership boundary
- learner-facing AI and planner features consume school-owned academic context

## Routes That Break Without `school_id`

The highest-risk pattern is any route that depends on:

- `resolve_school_id_from_actor`
- school-filtered service queries
- `_get_student_by_profile_id(school_id, profile_id)`

Confirmed major areas:

- LMS routes
- Online Tests routes
- Parent Portal routes and services
- Study Planner routes and services
- AI Tutor and related learner-context services
- reports/analytics endpoints
- many account-security and user-management flows

## Services That Assume Student Records Exist

- LMS student access paths
- Online Tests student attempt/result paths
- AI Tutor learner-context assembly
- Study Planner payload generation and goal creation
- Parent Portal and Parent Intelligence child data aggregation
- analytics services that compute student dashboards and warehouse facts
- monetization flows that resolve profile to school student

## Tables and Models That Assume School Ownership

This audit did not change schema, but the current runtime clearly assumes school ownership across:

- `school_memberships`
- `students`
- `staff_members`
- school-scoped LMS tables
- school-scoped Online Tests tables
- school-scoped attendance and academic activity tables
- school-scoped warehouse/reporting tables
- school-scoped audit/event records in several services
- school-scoped commerce/product/subscription rows in current monetization flow

## Risk Summary

If `external_student` is introduced without an explicit architecture split, the likely outcomes are:

- failed login/session bootstrap for schoolless users
- 403s from missing `school_id`
- empty dashboards from missing student rows
- accidental overloading of school-based roles to represent non-school actors
- hidden regressions in LMS/tests/AI/planner because current services assume school ownership

## Recommended Phased Implementation Strategy

## Phase 1. Identity Decoupling

Goal:

- allow an authenticated profile to exist in the app without mandatory school membership

Required direction:

- separate global identity bootstrap from school-context bootstrap
- support an actor mode that does not require `school_id` at login time
- keep existing membership flow unchanged for school users

Guardrail:

- do not change existing school-role behavior

## Phase 2. External Learner Domain Model

Goal:

- define `external_student` as a distinct actor type rather than a special case of `school_student`

Required direction:

- introduce a future domain model for external learner ownership, entitlements, and lifecycle
- keep `school_student` semantics unchanged

Guardrail:

- do not overload `school_memberships` to represent schoolless learners

## Phase 3. Non-School Context Resolution

Goal:

- create a parallel context path for learner-facing routes that do not need school ownership

Required direction:

- keep `resolve_school_id_from_actor` for school modules
- add a separate learner context resolver for external-only surfaces
- explicitly choose which routes remain school-only and which can support external learners

Guardrail:

- avoid retrofitting every route to support both models at once

## Phase 4. Capability Segmentation

Goal:

- decide which features can support external students safely

Recommended sequence:

1. authentication and profile entry
2. subscriptions and entitlements
3. external-only LMS/test content access
4. external learner AI/study planner
5. reporting/analytics for external learner journeys

Guardrail:

- school dashboards and school reports should remain school-owned unless explicitly redesigned

## Phase 5. Subscription and Entitlement Model

Goal:

- support paid external learners without relying on school student records

Required direction:

- separate school plan ownership from learner subscription ownership
- define entitlement checks that do not require `school_id`

Guardrail:

- do not mix external learner entitlements into school quotas without an explicit commercial rule set

## Phase 6. Analytics and Reporting Split

Goal:

- avoid polluting school BI with schoolless learner data

Required direction:

- keep school warehouse facts school-scoped
- create future external learner analytics and consumer reporting separately
- only add unified platform reporting after both models are explicit

Guardrail:

- do not force external learner events into school-scoped warehouse tables

## Final Conclusion

The platform can support `external_student`, but not safely with the current runtime assumptions.

Today:

- school users are modeled correctly around school membership
- learner-facing experiences are built on top of school-owned student records
- reports and analytics are school-centric

Therefore the current architecture is:

- good for `school_student`
- not ready for `external_student` without a deliberate identity/context split

Final rating:

- overall readiness for introducing `external_student` without affecting existing school workflows: FAIL

Recommended next step:

- approve an architecture phase that separates global learner identity from school membership before any schema or route implementation begins
