# EXTERNAL_STUDENT_ARCHITECTURE_DESIGN

Date: 2026-06-22
Status: Architecture design only
Scope: No code changes, no migrations, no schema changes
Input basis: `EXTERNAL_STUDENT_ARCHITECTURE_AUDIT.md`

## Executive Summary

The current platform models learner identity like this:

`Profile -> School Membership -> School -> Student`

That works for ERP-native school users, but it cannot support `external_student` because external learners must not require:

- school membership
- school enrollment
- school record

The safest redesign is not to replace the current school-user model.

The safest redesign is to introduce a two-lane identity architecture:

- school-context lane for existing ERP actors
- learner-direct lane for external students

Under that model:

- `school_student` continues working exactly as today
- `external_student` becomes a first-class identity type with direct product entitlements
- school ERP workflows remain school-scoped
- external learner workflows remain non-school-scoped unless explicitly attached later

## Current State

From the audit, the current system assumes:

1. a user authenticates as a `profile`
2. the app resolves an active `school_membership`
3. the membership supplies role, permissions, and `school_id`
4. student "own scope" resolves through a school-owned `students` row

This creates several hard assumptions:

- authentication expects an active school membership
- backend route context often requires `school_id`
- student access is derived from school-owned student records
- LMS, Online Tests, AI Tutor, Study Planner, Reports, and Analytics are school-centered

## Target State

The target identity model should be:

`Profile -> Identity Type -> Access Context -> Product Entitlements`

Supported identity types:

- `school_student`
- `external_student`
- `parent`
- `teacher`
- `staff`
- `school_admin`
- `platform_admin`

This design keeps `profile` as the universal identity anchor, but stops assuming every identity must become active through school membership.

## Design Principles

1. Preserve all existing ERP behavior for school users.
2. Do not overload `school_memberships` for schoolless learners.
3. Separate identity from school membership.
4. Separate learner entitlement from school enrollment.
5. Keep school analytics/reporting school-scoped.
6. Introduce external learner capabilities through parallel services, not invasive rewrites.
7. Make all dual-mode behavior explicit instead of relying on implicit fallbacks.

## 1. Identity Architecture

## Current State

Identity is effectively membership-first:

- `profile` is the auth identity
- `school_membership` activates the user in the app
- role and permissions flow from membership
- learner context resolves to a school `student` row

## Target State

Identity should be decomposed into four layers:

1. Identity Layer
- `profile`
- login credentials
- account status
- universal contact and security data

2. Identity Classification Layer
- identity type
- primary operating mode
- supported personas

3. Context Layer
- school context for ERP actors
- external learner context for schoolless learners

4. Entitlement Layer
- what products/features the identity may use
- independent from whether the identity belongs to a school

## Recommended Model

### A. Universal Identity

Keep `profiles` as the universal identity record for all humans in the platform.

Every user has:

- one auth account
- one profile
- one or more identity modes

### B. Identity Type Registry

Introduce a dedicated identity typing model rather than inferring type solely from school membership role.

Recommended concept:

- one primary identity type
- optional secondary identity capabilities where needed

Examples:

- a normal ERP learner: `school_student`
- a direct-to-platform learner: `external_student`
- a parent with school access: `parent`
- a teacher with school access: `teacher`

### C. Context Separation

Two explicit context families should exist:

1. School Context
- anchored by `school_membership`
- provides `school_id`, role, school permissions, scope metadata

2. External Learner Context
- anchored by learner profile identity
- provides learner id, entitlement state, product access, subscription state
- does not require `school_id`

### D. Student Separation

The word "student" must stop meaning only one thing.

Future domain distinction:

- `school_student`: a school-owned academic record
- `external_student`: a platform-owned learner identity

That distinction is critical because the current system treats student identity as school-owned data.

## Recommended Tables

These are architecture recommendations only. They are not implementation instructions.

### Identity Tables

- `identity_types`
  - purpose: canonical list of identity categories
  - examples: `school_student`, `external_student`, `parent`, `teacher`, `staff`, `school_admin`, `platform_admin`

- `profile_identities`
  - purpose: bind a `profile` to one or more identity types
  - stores:
    - `profile_id`
    - `identity_type`
    - `is_primary`
    - `status`
    - lifecycle timestamps

### External Learner Tables

- `external_learners`
  - purpose: platform-owned learner record independent of school
  - stores:
    - `profile_id`
    - learner status
    - onboarding state
    - learning preferences
    - optional grade/goal metadata

- `external_learner_entitlements`
  - purpose: feature/product access for external learners
  - stores:
    - `external_learner_id`
    - product key
    - status
    - valid from / to
    - source type
    - source reference

- `external_learner_subscriptions`
  - purpose: recurring plan ownership for direct learners
  - stores:
    - `external_learner_id`
    - plan id
    - billing status
    - renewal data

### External Learning Tables

- `external_course_enrollments`
  - purpose: LMS course access for external learners

- `external_test_attempts`
  - purpose: online test participation independent of school student rows

- `external_study_goals`
  - purpose: planner goals for external learners

- `external_ai_sessions`
  - purpose: AI tutor interactions without school context

### Analytics Tables

- `external_learning_events`
  - purpose: usage and progress event stream for external learners

- `external_learner_metrics`
  - purpose: derived analytics for learner progress and engagement

## Recommended Services

- `identity_service`
  - resolves profile identity types
  - determines default operating mode

- `access_context_service`
  - returns either school context or external learner context

- `external_learner_service`
  - onboarding
  - learner status
  - preferences

- `external_entitlement_service`
  - feature gates for LMS, tests, AI, planner

- `external_lms_service`
  - course enrollment and progress for external learners

- `external_tests_service`
  - test catalog, attempts, and results for external learners

- `external_ai_service`
  - AI tutor context assembly for schoolless learners

- `external_planner_service`
  - planner generation for external learners

- `external_analytics_service`
  - progress, activity, and subscription engagement metrics

## Recommended APIs

These APIs describe the target contract surface, not implementation tasks.

### Identity and Session

- `GET /api/identity/me`
  - returns profile identity types and active context options

- `POST /api/identity/context/select`
  - selects active context when a profile can operate in more than one mode

- `GET /api/identity/context`
  - returns resolved active context

### External Learner Onboarding

- `POST /api/external-students/signup`
- `POST /api/external-students/onboarding/complete`
- `GET /api/external-students/me`

### Entitlements

- `GET /api/external-students/entitlements`
- `POST /api/external-students/subscriptions/checkout`
- `GET /api/external-students/subscriptions/me`

### LMS

- `GET /api/external-lms/courses`
- `GET /api/external-lms/progress`
- `POST /api/external-lms/enrollments`

### Online Tests

- `GET /api/external-tests/catalog`
- `POST /api/external-tests/attempts`
- `GET /api/external-tests/results`

### AI Tutor

- `POST /api/external-ai/chat`
- `POST /api/external-ai/explain`
- `POST /api/external-ai/practice`

### Study Planner

- `GET /api/external-study-planner/today`
- `GET /api/external-study-planner/week`
- `POST /api/external-study-planner/goals`

## 2. Authentication Flow

## Current State

Current login behavior assumes:

- user authenticates
- profile loads
- school memberships load
- active school membership is required

This is why `external_student` currently fails.

## Target Authentication Flow

### School Users

No workflow change.

School user flow remains:

1. authenticate
2. load profile
3. resolve school memberships
4. select active school context
5. build membership-backed session

### External Students

New external learner flow:

1. authenticate or self-sign up
2. load profile
3. resolve identity type as `external_student`
4. build external learner context directly
5. evaluate entitlements
6. route to learner experience without requiring school membership

### Mixed-Mode Profiles

If a future user can hold both school and external learner identities, authentication should return available contexts, then require an explicit context selection.

That prevents hidden ambiguity and preserves clean authorization.

## Session Design

Session should contain:

- `profile_id`
- `identity_type`
- `context_type`
- `context_id`
- `school_id` when school context is active
- entitlement summary
- permission summary

This is better than assuming `school_id` is always present.

## 3. Authorization Flow

## Current State

Authorization today is mostly:

- membership role
- permission set
- scope engine
- school context

That is correct for ERP users, but not enough for schoolless learners.

## Target Authorization Flow

Authorization should become context-aware:

1. identify active context
2. choose the relevant authorization mode
3. evaluate access using:
   - role permissions for school contexts
   - entitlements plus learner ownership for external contexts

### School Context Authorization

Keep exactly as today:

- `school_membership`
- permission catalog
- scope engine
- school tenant isolation

### External Learner Authorization

Use a separate rule set:

- identity type must be `external_student`
- learner can access only their own learner resources
- product access depends on entitlements
- no school scope resolution should be attempted

### Recommended Authorization Modes

- `membership_rbac`
- `external_self_access`
- `platform_admin`

### Scope Design

Current scope engine should remain for school actors.

External learners should use a simpler ownership model:

- self only
- no assigned scope
- no school scope
- no platform scope except platform-admin operations

## 4. Entitlement Model

## Current State

Feature access for ERP users is mainly permission-based and membership-based.
Subscription foundations exist, but learner access is not cleanly separated from school ownership.

## Target Entitlement Model

Permissions and entitlements should be different things:

- permissions control what ERP roles may do
- entitlements control what direct learners may consume

### School Users

Continue using:

- permissions
- scope metadata
- school policy

### External Students

Use explicit entitlement checks for:

- LMS
- Online Tests
- AI Tutor
- Study Planner
- subscription plan access

### Recommended Entitlement Dimensions

- product key
- access status
- plan tier
- feature limits
- usage limits
- expiration

### Example Product Keys

- `external.lms`
- `external.tests`
- `external.ai_tutor`
- `external.study_planner`
- `external.bundle.premium`

## 5. LMS Impact

## Current State

LMS currently assumes:

- school-scoped course visibility
- learner identity from school student row
- progress tied to school context

## Target Impact

LMS should support two operating modes:

1. school LMS mode
- unchanged

2. external LMS mode
- course access based on entitlements
- enrollments tied to external learner identity
- progress stored outside school-student assumptions

### Design Direction

- do not retrofit every current LMS method to accept schoolless learners
- create an external LMS surface beside the school LMS surface
- share reusable content logic where possible

### Must Stay Unchanged

- teacher workflows
- school classroom/course workflows
- school dashboards

## 6. Online Tests Impact

## Current State

Online Tests currently assumes:

- school-scoped test catalog
- student visibility by school, batch, or student row
- attempts and results anchored to school student identity

## Target Impact

External student testing should be modeled separately:

- direct learner test catalog
- external learner attempts
- external learner results
- optional shared content bank, but separate ownership context

### Design Direction

- preserve school testing flows unchanged
- reuse question/test authoring assets where feasible
- isolate attempt and result ownership for direct learners

### Must Stay Unchanged

- school exams and classroom tests
- parent school-linked visibility
- teacher/school admin school-scoped reporting

## 7. AI Impact

## Current State

AI Tutor currently builds learner context from school data sources:

- LMS
- assignments
- tests
- attendance
- school analytics
- planner recommendations

## Target Impact

AI should support two context builders:

1. school learner context builder
- unchanged

2. external learner context builder
- no school attendance dependency
- no school-student lookup
- context from external progress, subscriptions, goals, practice history, and assessments

### Design Direction

- preserve current AI tutor behavior for school users
- introduce an external AI context model that only reads external learner data
- keep AI session storage separated by context type

## 8. Analytics Impact

## Current State

Analytics are mostly school warehouse oriented.
Facts and dimensions are keyed around `school_id`, school students, and school operations.

## Target Impact

Analytics should split into:

1. School Analytics
- unchanged
- school KPI, ERP reporting, academic operations

2. External Learner Analytics
- learner engagement
- content completion
- test performance
- AI usage
- subscription retention

### Design Direction

- do not force external learner events into school warehouse facts
- create a parallel external analytics pipeline
- only merge at platform reporting level if explicitly required

## 9. Reporting Impact

## Current State

Reporting is designed for schools, not direct learners.

## Target Impact

Reporting should separate:

- school operational reporting
- external learner reporting
- platform product reporting

### School Reports

Remain unchanged:

- attendance reports
- student performance reports
- school exports
- school BI dashboards

### External Learner Reports

New reporting class:

- personal progress summary
- course completion summary
- practice/test performance
- AI learning activity summary
- subscription usage summary

### Platform Reports

Future platform reporting can aggregate:

- active external learners
- plan conversion
- retention
- product engagement

## 10. Subscription Impact

## Current State

Monetization exists, but it still leans on school and school-student assumptions in several paths.

## Target Impact

Subscriptions must support two ownership models:

1. School-owned plan
- school access, quotas, ERP features

2. External learner-owned subscription
- learner access, learner product bundle, learner limits

### Recommended Subscription Design

- school subscriptions remain separate from external learner subscriptions
- pricing plans for external learners should map to entitlements, not school permissions
- billing events must identify owner type explicitly

### Ownership Types

- `school`
- `external_learner`

### Benefits

- avoids mixing school quotas with consumer subscriptions
- keeps billing logic explicit
- supports future direct-to-consumer growth cleanly

## Recommended Services by Domain

### Identity Domain

- identity type resolver
- context selector
- session context serializer

### Access Domain

- school membership RBAC service
- external entitlement evaluator
- unified access gate facade

### Learning Domain

- school LMS facade
- external LMS facade
- school tests facade
- external tests facade

### AI Domain

- school AI context service
- external AI context service

### Analytics Domain

- school warehouse service
- external learner analytics service
- platform rollup service

### Subscription Domain

- school plan service
- external subscription service
- entitlement projection service

## Recommended APIs by Rollout Phase

### Phase 1 APIs

- `GET /api/identity/me`
- `GET /api/identity/context`
- `POST /api/external-students/signup`
- `GET /api/external-students/me`

### Phase 2 APIs

- `GET /api/external-students/entitlements`
- `GET /api/external-lms/courses`
- `GET /api/external-tests/catalog`

### Phase 3 APIs

- `POST /api/external-tests/attempts`
- `POST /api/external-ai/chat`
- `GET /api/external-study-planner/today`

### Phase 4 APIs

- `GET /api/external-students/subscriptions/me`
- `POST /api/external-students/subscriptions/checkout`
- `GET /api/platform/external-analytics/summary`

## Migration Strategy

This is a migration strategy for architecture rollout, not database migration code.

## Strategy Goal

Introduce external learner support without destabilizing existing ERP modules.

## Step 1. Preserve Existing School Flows

Freeze these assumptions for school actors:

- school membership remains required for school personas
- current scope engine remains school-facing
- existing ERP routes remain unchanged until explicit dual-mode support is added

## Step 2. Introduce Identity Typing First

Before enabling any learner features:

- classify identities explicitly
- allow session resolution without mandatory school membership for specific identity types

This is the most important architectural shift.

## Step 3. Add External Context Resolution

Create a new context resolution path for:

- `external_student`

This must not reuse school membership as a fake stand-in.

## Step 4. Add Entitlement-First Product Gates

Enable learner product access based on subscription/entitlement, not school role.

## Step 5. Add External Learning Surfaces

Roll out in this order:

1. LMS catalog and enrollment
2. Online Tests catalog and attempts
3. AI Tutor
4. Study Planner

## Step 6. Add External Analytics and Reporting

Only after external learning data exists should reporting and analytics be added.

## Risk Analysis

## Risk 1. Breaking Existing School Logins

Risk:

- changing auth bootstrap too aggressively could break school users

Mitigation:

- keep school session path intact
- add external learner path as an additive branch

## Risk 2. Overloading School Memberships

Risk:

- using `school_memberships` to represent external students will create long-term confusion and hidden authorization bugs

Mitigation:

- keep school membership strictly for school context

## Risk 3. Cross-Context Data Leakage

Risk:

- shared service methods may accidentally read school data when serving external learners

Mitigation:

- separate context resolvers
- separate external domain services
- explicit ownership checks

## Risk 4. Polluting School Analytics

Risk:

- external learner events mixed into school warehouse facts would corrupt reporting semantics

Mitigation:

- separate analytics pipeline for direct learners

## Risk 5. Subscription Model Confusion

Risk:

- mixing school and external billing semantics may create entitlement drift and audit issues

Mitigation:

- separate owner type and entitlement projection logic

## Risk 6. Shared Content Reuse Complexity

Risk:

- LMS/tests content may be reusable, but ownership, visibility, and progress semantics differ

Mitigation:

- share content assets
- separate enrollment, attempt, and result ownership models

## Implementation Phases

## Phase 1. Identity Foundation

Deliverables:

- identity type model
- dual session context design
- external learner bootstrap path

Success condition:

- an `external_student` can authenticate without school membership

## Phase 2. Entitlement Foundation

Deliverables:

- external entitlement model
- external subscription ownership model
- feature gating by entitlement

Success condition:

- an authenticated external learner can be authorized for paid/free product access

## Phase 3. Product Access

Deliverables:

- external LMS access
- external Online Tests access
- external AI Tutor access
- external Study Planner access

Success condition:

- an external learner can use core learning features without school data dependencies

## Phase 4. Data and Intelligence

Deliverables:

- external learner analytics
- external learner reporting
- platform product dashboards

Success condition:

- the platform can measure external learner engagement and outcomes independently of schools

## Phase 5. Mixed-Mode Identity

Deliverables:

- optional support for a profile that can operate in both school and external contexts
- explicit context switching

Success condition:

- no ambiguity between school and external access behavior

## Final Recommendation

Do not redesign the ERP identity model.

Instead:

- preserve the current school-user lane exactly as-is
- add a parallel external-learner lane with its own context, entitlements, and learning ownership model

The correct architectural target is not:

`Profile -> School Membership -> School -> Student`

The correct target is:

`Profile -> Identity Type -> Access Context -> Entitlements -> Domain Records`

With that structure:

- `school_student` remains stable
- `external_student` becomes possible
- ERP modules stay intact
- direct-to-consumer learning can grow safely without contaminating school workflows
