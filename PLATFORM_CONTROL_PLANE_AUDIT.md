# Platform Control Plane Audit

Date: 2026-06-22

## Scope

This document is architecture-only.

No implementation is included.

This audit explicitly avoids changing:
- ERP business workflows
- Attendance
- Timetable
- LMS
- Online Tests
- Parent Portal
- Scope Engine
- Tenant Isolation

## Goal

Determine what already exists for platform administration, and what is missing to support a dedicated Platform Control Plane for:
- multi-school SaaS
- school onboarding
- school lifecycle management
- subscription management

## Executive Summary

The codebase already contains a **small platform-admin layer**, but it is not yet a true control plane.

What exists today:
- platform-only UI guard and navigation
- platform dashboard
- workflow approval queue for destructive bulk actions
- platform audit-log viewer
- platform analytics and platform BI dashboards
- multi-school identity foundations in `public.schools`, `public.profiles`, `public.school_memberships`, and `platform_admin` role handling
- finance/monetization foundations for end-user subscriptions and revenue

What does **not** exist today:
- school CRUD or lifecycle APIs
- school status model beyond `schools.is_active`
- school overview grid
- school health service
- SaaS plan catalog for Starter / Standard / Premium / Enterprise
- school-level subscription records
- usage-limit policy model
- usage enforcement on student / teacher / parent / admin creation flows
- platform-wide search across schools, students, teachers, parents, admins
- school lifecycle audit taxonomy

Bottom line:
- the current platform area is `PARTIAL` as a control plane foundation
- it is strong enough to extend
- it is not yet sufficient to operate a 100+ school SaaS

## Existing Platform Admin Functionality

### Existing Routes

#### Platform Administration

- `GET /api/platform/dashboard-summary`
  - platform dashboard summary
  - counts schools, active users, workflow status buckets, recent workflow events

- `GET /api/platform/workflow/{request_id}`
  - detailed workflow request inspection
  - reads `workflow.bulk_action_requests` and `workflow.bulk_action_events`

- `GET /api/platform/audit-logs`
  - platform-wide audit log search/filter page
  - filters by `action`, `module_key`, text search

#### Workflow Approval Foundation

- `POST /api/bulk-action-requests`
  - create bulk action request

- `GET /api/bulk-action-requests`
  - list workflow requests for a school

- `POST /api/bulk-action-requests/{request_id}/approve`
  - platform-admin approval

- `POST /api/bulk-action-requests/{request_id}/reject`
  - platform-admin rejection

#### Existing Cross-School Platform Read APIs

- `GET /api/analytics/platform`
  - platform analytics for online tests

- `GET /api/bi/platform`
  - platform BI snapshot

- `GET /api/bi/reports`
  - includes platform reports for platform admins

- `GET /api/bi/reports/export?dashboard_key=platform`
  - platform BI export path

- `GET /api/revenue/dashboard?global_view=true`
  - platform-level revenue aggregation path

- `GET /api/subscriptions?school_scope=true`
  - exposes finance subscriptions, but this is not a school SaaS subscription layer

### Existing UI

Current platform-admin UI already exists in the frontend:

- `PlatformAdminRoute`
  - hard-gates pages to `role_key === 'platform_admin'`

- `Platform Dashboard`
  - `frontend/src/pages/PlatformDashboard.tsx`
  - shows workflow counts, schools count, active users, recent workflow events, and platform online-test analytics

- `Platform Workflow Queue`
  - `frontend/src/pages/PlatformWorkflowQueue.tsx`
  - lists pending/approved/rejected/executed workflow requests
  - allows approve/reject

- `Platform Audit Logs`
  - `frontend/src/pages/PlatformAuditLogs.tsx`
  - searchable platform audit trail

- Layout/Nav hooks
  - `Platform Administration` section already exists in the main navigation

### Existing Services

Current service foundations that are relevant:

- `backend/app/routes/platform.py`
  - current platform admin route surface

- `backend/app/services/bulk_action_requests.py`
  - workflow queue foundation
  - platform-admin approval/rejection logic
  - workflow event logging

- `backend/app/services/supabase_bi.py`
  - existing platform BI snapshots
  - already computes tenant-level metrics like `tenant_growth`, `active_users`, `churn_risk`

- `backend/app/services/supabase_analytics.py`
  - existing platform analytics for online tests

- `backend/app/services/supabase_monetization.py`
  - finance products, orders, subscriptions, coupons
  - useful as a pattern, but not yet a school-control-plane subscription model

- `backend/app/services/supabase_metrics.py`
  - school summary metrics helper foundation

- `backend/app/services/supabase_storage.py`
  - all upload paths are prefixed with `school_id`
  - useful basis for school storage accounting

## Existing Schema Foundations

### Tenant and Identity Foundation

#### `public.schools`

Current columns are minimal:
- `id`
- `school_code`
- `slug`
- `name`
- `legal_name`
- timezone/contact fields
- `metadata`
- `is_active`
- timestamps

What this means:
- good tenant identity foundation
- not enough lifecycle metadata for a control plane

#### `public.profiles`

Useful for:
- cross-school actor identity
- default school
- profile-level metadata

#### `public.school_memberships`

Useful for:
- school membership
- role assignment
- active/suspended membership status

Limitation:
- membership lifecycle is not the same as school lifecycle

### Audit Foundation

#### `public.audit_logs`

Already exists and is platform-readable.

This is the best place to keep the required control-plane audit trail for:
- school created
- school activated
- school suspended
- school archived
- plan changed
- usage limit changed

No separate audit table is strictly required if action naming is standardized.

### Workflow Foundation

#### `workflow.bulk_action_requests`
#### `workflow.bulk_action_events`

Already exists and already supports platform-admin review workflows.

Useful reuse:
- approval patterns
- event history patterns
- platform-admin queue concepts

Limitation:
- current workflow schema is designed for destructive school-scoped operations, not school lifecycle management

### BI / Health Foundation

#### `public.warehouse_fact_platform_usage`

Already stores platform-wide snapshot rows and school-scoped usage rows.

Existing derived metrics include:
- `tenant_growth`
- `active_users`
- `churn_risk`
- LMS usage rows
- AI usage events

This is a strong foundation for school health and platform overview dashboards.

Limitation:
- does not yet model school status, plan, quota usage, storage usage, or subscription status

### Monetization Foundation

#### `finance.products`
#### `finance.orders`
#### `finance.subscriptions`
#### `finance.coupons`

What exists:
- end-user commerce catalog
- recurring subscription model
- plan names currently `Basic`, `Premium`, `Enterprise`

Why this is only partial:
- it is aimed at monetized learning products and user subscriptions
- it is not a school SaaS subscription registry
- it does not model school limits for students, teachers, storage, AI credits

### Storage Foundation

Uploads already use paths like:
- `{school_id}/{category}/...`

This is important because it means school storage usage is technically derivable.

Limitation:
- there is no school storage aggregation table or cached storage counter today

## What Is Missing

### 1. School Management

Missing entirely:
- create school API
- activate school API
- suspend school API
- archive school API
- soft delete school API
- school detail API
- school list/search API

### 2. School Lifecycle Model

Current `public.schools.is_active` is not enough.

Missing concepts:
- `draft`
- `active`
- `suspended`
- `archived`
- `deleted`
- reason fields
- lifecycle timestamps

### 3. School Overview Dataset

The requested overview fields are not available in one place today:
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

Some of these can be derived now:
- school name
- created date
- student count
- teacher count
- some activity metrics

Missing or fragmented today:
- plan
- subscription status
- parent count as a platform-ready aggregate
- storage usage
- lifecycle status
- normalized last activity

### 4. School Health Service

Requested health metrics:
- users
- attendance activity
- LMS activity
- online test activity
- last login
- storage consumption

Current state:
- partial foundations exist through BI, audit logs, and school-scoped modules
- no single school-health service or snapshot exists

### 5. SaaS Plan Management

Requested SaaS plans:
- Starter
- Standard
- Premium
- Enterprise

Missing entirely:
- school SaaS plan catalog
- plan-to-limit mapping
- school current-plan assignment
- plan change history

### 6. Usage Enforcement

Missing entirely:
- current usage / allowed usage / remaining usage API
- centralized enforcement service
- hard block when limits exceeded

### 7. Platform Search

Missing entirely:
- cross-school school search
- cross-school student search
- cross-school teacher search
- cross-school parent search
- cross-school admin search

### 8. Platform Audit Taxonomy

Audit table exists, but required control-plane actions do not yet exist as standardized actions:
- `platform.school.created`
- `platform.school.activated`
- `platform.school.suspended`
- `platform.school.archived`
- `platform.school.soft_deleted`
- `platform.school.plan_changed`
- `platform.school.usage_limit_changed`

## User Creation Paths That Will Need Plan-Limit Enforcement

These are the main creation paths found in the codebase:

### Student Creation Paths

- `POST /students`
- `POST /students/import`
- student creation side effects in seating flows
- EduPay student creation paths where relevant

### Teacher / Staff Creation Paths

- `POST /teachers`
- `POST /staff/import`
- direct `staff_members` insertion paths

### Parent Creation Paths

- `POST /api/parent-links/students/{student_id}`
- `POST /api/parent-links/import`

### Admin / Role User Creation Paths

- `POST /auth/users`

### Portal Account Creation Paths

- student/parent/staff account generation in `account_security`
- these may create profile/membership/account objects depending on current state

Important architectural note:
- enforcement should be added as a thin preflight layer around these entrypoints
- it should not rewrite module business logic

## Required Schema Changes

Recommended approach:
- keep stable ERP module schemas intact
- add a **new platform control-plane schema** plus a small, backward-compatible extension to `public.schools`

### Recommended Change 1: Extend `public.schools`

Add explicit lifecycle fields:
- `status`
  - enum/check: `draft`, `active`, `suspended`, `archived`, `deleted`
- `activated_at`
- `suspended_at`
- `archived_at`
- `deleted_at`
- `last_activity_at` cache field

Why:
- school lifecycle is core tenant metadata
- this belongs close to the tenant root

### Recommended Change 2: New `platform.plan_catalog`

Suggested fields:
- `id`
- `plan_code`
- `plan_name`
- `student_limit`
- `teacher_limit`
- `storage_limit_bytes`
- `ai_credit_limit`
- `is_active`
- `metadata`

This models:
- Starter
- Standard
- Premium
- Enterprise

### Recommended Change 3: New `platform.school_subscriptions`

Suggested fields:
- `id`
- `school_id`
- `plan_id`
- `subscription_status`
  - `trial`, `active`, `past_due`, `cancelled`, `suspended`, `expired`
- `starts_at`
- `ends_at`
- `renewal_at`
- `billing_provider`
- `external_subscription_id`
- `metadata`

Why not reuse `finance.subscriptions` directly:
- current finance subscriptions are user/product oriented
- school SaaS lifecycle needs a separate control-plane subscription model

### Recommended Change 4: New `platform.school_usage_snapshots`

Suggested fields:
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

This becomes the source for:
- school overview cards
- school health
- usage enforcement dashboards

### Recommended Change 5: New `platform.school_lifecycle_events`

Suggested fields:
- `id`
- `school_id`
- `event_type`
- `previous_status`
- `next_status`
- `changed_by_profile_id`
- `reason`
- `payload`
- `created_at`

This is optional if `public.audit_logs` is sufficient, but useful for fast detail timelines.

### Recommended Change 6: Optional `platform.school_limit_overrides`

Suggested fields:
- `id`
- `school_id`
- `plan_id`
- `student_limit_override`
- `teacher_limit_override`
- `storage_limit_override_bytes`
- `ai_credit_limit_override`
- `reason`
- `updated_by_profile_id`
- timestamps

This allows enterprise exceptions without forking the plan catalog.

## Required APIs

### School Management APIs

- `GET /api/platform/schools`
  - paginated school overview

- `POST /api/platform/schools`
  - create school

- `GET /api/platform/schools/{school_id}`
  - school detail

- `POST /api/platform/schools/{school_id}/activate`
- `POST /api/platform/schools/{school_id}/suspend`
- `POST /api/platform/schools/{school_id}/archive`
- `POST /api/platform/schools/{school_id}/delete`
  - soft delete only

### Plan / Subscription APIs

- `GET /api/platform/plans`
- `POST /api/platform/plans`
  - optional if catalog is editable in product

- `GET /api/platform/schools/{school_id}/subscription`
- `PUT /api/platform/schools/{school_id}/subscription`

- `GET /api/platform/schools/{school_id}/usage`
- `PUT /api/platform/schools/{school_id}/limits`

### Health APIs

- `GET /api/platform/schools/{school_id}/health`
- `POST /api/platform/schools/{school_id}/refresh-health`
  - optional admin-triggered refresh

### Platform Search APIs

- `GET /api/platform/search`
  - query across schools, students, teachers, parents, admins

### Audit APIs

Existing `GET /api/platform/audit-logs` can be reused.

Recommended additions:
- `GET /api/platform/schools/{school_id}/audit`
- `GET /api/platform/schools/{school_id}/lifecycle`

## Required UI Screens

### Extend Existing Platform Area

Do not replace current pages.

Add:
- `Platform Schools`
  - overview table
  - search/filter/sort

- `Platform School Detail`
  - lifecycle panel
  - plan/subscription panel
  - usage panel
  - health panel
  - audit panel

- `Create School`
  - drawer or page

- `Plan Management`
  - Starter / Standard / Premium / Enterprise catalog

- `Platform Search`
  - global search workspace

### Existing Screens That Should Remain

- Platform Dashboard
- Workflow Queue
- Audit Logs

## Architecture Recommendation

Recommended architecture:

1. Keep control-plane code in separate platform-focused routes/services.
2. Reuse existing platform navigation and page guard.
3. Reuse `public.audit_logs` for all control-plane actions.
4. Reuse warehouse/platform usage patterns for overview/health snapshots.
5. Keep plan enforcement as a **preflight policy layer** on creation endpoints.
6. Do not redesign stable ERP module internals.

## Final Assessment

### Existing Components

Status: `PARTIAL`

Why:
- there is already a real platform-admin foundation
- there is no school-management control plane yet

### Missing Components

Status: `FAIL`

Why:
- lifecycle, plans, usage enforcement, and platform search are not implemented

### Required Schema / API / UI Additions

Status: `REQUIRED`

Why:
- the current platform layer is observability-oriented
- a production SaaS control plane needs tenant operations, quota policy, and school lifecycle ownership
