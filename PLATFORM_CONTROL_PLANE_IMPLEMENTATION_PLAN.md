# Platform Control Plane Implementation Plan

Date: 2026-06-22

## Objective

Build a dedicated Platform Control Plane for multi-school SaaS operations without redesigning or destabilizing existing ERP modules.

## Non-Goals

Do not:
- redesign ERP modules
- rewrite Attendance, Timetable, LMS, Online Tests, Parent Portal
- change Scope Engine behavior
- alter Tenant Isolation architecture

The control plane should be additive and isolated.

## Design Principles

1. Add a separate platform-control-plane layer instead of expanding school modules.
2. Keep lifecycle, plans, quotas, and global search under platform-admin-only routes and pages.
3. Reuse existing platform dashboard, workflow, audit-log, BI, and warehouse foundations.
4. Enforce limits through thin preflight checks on creation entrypoints, not workflow redesign.
5. Use `public.audit_logs` as the canonical audit sink for all control-plane actions.

## Target Architecture

### Backend

Add new platform-focused services:
- `platform_school_registry.py`
- `platform_school_health.py`
- `platform_plan_management.py`
- `platform_usage_enforcement.py`
- `platform_global_search.py`

Add new route surface:
- `backend/app/routes/platform_schools.py`
- optionally keep under existing `/api/platform/*` namespace

### Database

Use:
- small extension to `public.schools`
- new `platform` schema for control-plane tables

### Frontend

Extend existing Platform Administration area with:
- school overview page
- school detail page
- create school form
- plan management page
- global search page

## Proposed Schema Plan

### Phase 1 Schema

#### Extend `public.schools`

Add:
- `status`
- `activated_at`
- `suspended_at`
- `archived_at`
- `deleted_at`
- `last_activity_at`

### Phase 2 Schema

#### `platform.plan_catalog`

Columns:
- `id`
- `plan_code`
- `plan_name`
- `student_limit`
- `teacher_limit`
- `storage_limit_bytes`
- `ai_credit_limit`
- `is_active`
- `metadata`

Seed rows:
- Starter
- Standard
- Premium
- Enterprise

#### `platform.school_subscriptions`

Columns:
- `id`
- `school_id`
- `plan_id`
- `subscription_status`
- `starts_at`
- `ends_at`
- `renewal_at`
- `billing_provider`
- `external_subscription_id`
- `metadata`

#### `platform.school_usage_snapshots`

Columns:
- `id`
- `school_id`
- `snapshot_at`
- `students_used`
- `teachers_used`
- `parents_used`
- `admins_used`
- `storage_bytes_used`
- `ai_credits_used`
- `attendance_activity_count`
- `lms_activity_count`
- `online_test_activity_count`
- `last_login_at`
- `last_activity_at`
- `metadata`

#### `platform.school_lifecycle_events`

Columns:
- `id`
- `school_id`
- `event_type`
- `previous_status`
- `next_status`
- `changed_by_profile_id`
- `reason`
- `payload`
- `created_at`

#### Optional `platform.school_limit_overrides`

Use only if enterprise exceptions are needed.

## Proposed API Plan

### Phase 1: Read-Only Control Plane

- `GET /api/platform/schools`
- `GET /api/platform/schools/{school_id}`
- `GET /api/platform/schools/{school_id}/health`
- `GET /api/platform/schools/{school_id}/usage`
- `GET /api/platform/search`

Goal:
- expose overview, details, health, usage, and search first

### Phase 2: School Lifecycle Operations

- `POST /api/platform/schools`
- `POST /api/platform/schools/{school_id}/activate`
- `POST /api/platform/schools/{school_id}/suspend`
- `POST /api/platform/schools/{school_id}/archive`
- `POST /api/platform/schools/{school_id}/delete`

Goal:
- enable onboarding and lifecycle management

### Phase 3: Plan and Subscription Management

- `GET /api/platform/plans`
- `PUT /api/platform/schools/{school_id}/subscription`
- `PUT /api/platform/schools/{school_id}/limits`
- `GET /api/platform/schools/{school_id}/audit`

Goal:
- make the control plane financially operational

## Proposed UI Plan

### New Pages

#### 1. Platform Schools

Purpose:
- overview table for all schools

Columns:
- school name
- status
- plan
- student count
- teacher count
- parent count
- storage usage
- last activity
- created date
- subscription status

Actions:
- view
- activate
- suspend
- archive
- soft delete

#### 2. Platform School Detail

Sections:
- identity
- lifecycle
- subscription
- usage
- health
- audit timeline

#### 3. Create School

Fields:
- school code
- slug
- name
- legal name
- timezone
- country
- contact email
- contact phone
- initial plan

#### 4. Plan Management

Purpose:
- manage Starter / Standard / Premium / Enterprise catalog

#### 5. Platform Search

Purpose:
- one global search box across:
  - schools
  - students
  - teachers
  - parents
  - admins

### Existing Pages to Extend, Not Replace

- Platform Dashboard
  - add links/cards into schools and search

- Platform Audit Logs
  - reuse for school-lifecycle and plan-change filtering

## Usage Enforcement Plan

### Enforcement Policy

Block creation when:
- `students_used >= student_limit`
- `teachers_used >= teacher_limit`
- `storage_bytes_used >= storage_limit_bytes`
- `ai_credits_used >= ai_credit_limit`

### Enforcement Hooks

Inject preflight checks into these creation entrypoints:

- students create/import
- teachers create
- staff import/create
- parent link create/import when a new parent account/profile is created
- role-user create
- portal account generation paths when they create a new profile/membership/account object

### Enforcement Service

Add one shared service:
- `platform_usage_enforcement.py`

Responsibilities:
- resolve active plan
- apply override limits
- compute current usage
- return:
  - current usage
  - allowed usage
  - remaining usage
  - block/allow decision

Important:
- this should run before writes
- it should not change downstream business workflows

## Health Metrics Plan

### Source Strategy

Use a derived snapshot service instead of querying every module live for every page load.

### Inputs

- users:
  - `school_memberships`

- attendance activity:
  - attendance tables or attendance BI snapshots

- LMS activity:
  - LMS progress / BI snapshots

- online test activity:
  - online test analytics / BI snapshots

- last login:
  - session/account-security/auth-security signals aggregated into latest school login

- storage consumption:
  - aggregate storage objects by `school_id` path prefix

### Output

Persist school-level snapshots in:
- `platform.school_usage_snapshots`

Refresh policy:
- scheduled refresh
- optional manual refresh from control plane

## Global Search Plan

### MVP Strategy

Build federated search first:
- query schools
- query students
- query staff/teachers
- query guardians/parents
- query admin users / memberships

Return typed result groups with:
- result type
- school id
- school name
- entity id
- display label
- status
- secondary details

### Future Optimization

If performance becomes a problem:
- add a denormalized `platform.global_search_index`

## Audit Plan

All control-plane actions must insert into `public.audit_logs`.

Recommended action keys:
- `platform.school.created`
- `platform.school.activated`
- `platform.school.suspended`
- `platform.school.archived`
- `platform.school.soft_deleted`
- `platform.school.subscription_changed`
- `platform.school.plan_changed`
- `platform.school.usage_limit_changed`
- `platform.school.search.executed`
- `platform.school.health.refreshed`

Recommended `module_key`:
- `platform_control_plane`

## Recommended Delivery Phases

### Phase 1: Foundation

Deliver:
- schema for plans, school subscriptions, usage snapshots, lifecycle events
- read-only schools list/detail APIs
- read-only Platform Schools page

Outcome:
- platform admin can see schools and current state

### Phase 2: Lifecycle

Deliver:
- create school
- activate/suspend/archive/soft-delete school
- school detail lifecycle actions
- audit wiring

Outcome:
- platform admin can manage school lifecycle

### Phase 3: Plans and Usage

Deliver:
- plan catalog
- school subscription assignment
- usage and remaining-limit views
- limit override handling

Outcome:
- platform admin can manage school commercial state

### Phase 4: Enforcement

Deliver:
- creation-path preflight checks
- quota blocking responses
- clear admin-facing diagnostics

Outcome:
- plan limits become enforceable

### Phase 5: Global Search and Health

Deliver:
- platform search
- school health dashboard
- school audit detail

Outcome:
- platform admin gets true operational visibility

## Key Risks

### 1. Reusing Finance Subscriptions Directly

Risk:
- current finance subscriptions are user/product oriented, not school SaaS oriented

Decision:
- create a separate school SaaS subscription table

### 2. Storage Usage Accuracy

Risk:
- exact storage usage is not currently materialized

Decision:
- compute and cache it in usage snapshots

### 3. Parent Count Semantics

Risk:
- parent entities and parent login/accounts are not the same thing

Decision:
- define parent count explicitly as unique active guardian entities linked to the school

### 4. Enforcement Drift

Risk:
- if plan checks are scattered, some creation paths will bypass limits

Decision:
- centralize checks in one usage-enforcement service

## Final Recommendation

Build the Platform Control Plane as a **new additive management layer**, not as an expansion of the stable ERP modules.

That means:
- extend `public.schools` only for lifecycle metadata
- introduce a dedicated `platform` schema for plan/subscription/usage/lifecycle state
- reuse existing platform pages, audit logs, BI snapshots, and workflow patterns
- place quota enforcement at route-entry preflight points

This is the safest path to multi-school SaaS readiness without destabilizing the ERP core.
