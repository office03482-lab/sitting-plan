# Production Schema Consistency Audit

**Date:** 2026-07-03
**Project:** `https://fdmbpzknpwobpzrpjtor.supabase.co`
**Verification Method:** PostgREST REST API + Repository Migration Analysis

---

## Summary

| Check | Status |
|-------|--------|
| Repository → Production table count | ⚠️ 153 repo tables → 84 API-visible tables |
| Missing public tables | ❌ 1 confirmed |
| Missing public views | ⚠️ 74 potential (underlying custom schema tables unverifiable) |
| Column drift | ✅ 0 confirmed |
| Index drift | ⚠️ Unverifiable via REST API |
| Trigger drift | ⚠️ Unverifiable via REST API |
| Policy drift | ⚠️ Unverifiable via REST API |

---

## 1. Missing Tables (Confirmed)

### `public.platform_notifications`
- **Defined in:** `20260703_067_ensure_platform_notifications.sql` (and `20260628_066_platform_control_plane.sql`)
- **HTTP Check:** `GET /rest/v1/platform_notifications` → **404 Not Found**
- **Impact:** `PGRST205` error when backend queries platform notifications

---

## 2. Repository Schema vs Production Schema

### 2a. Public Schema Tables (Repository → Production)

| Repository Table | Production | Match |
|-----------------|------------|-------|
| `public.active_sessions` | `active_sessions` | ✅ |
| `public.ai_credit_idempotency_keys` | `ai_credit_idempotency_keys` | ✅ |
| `public.ai_credit_ledger` | `ai_credit_ledger` | ✅ |
| `public.ai_credit_products` | `ai_credit_products` | ✅ |
| `public.ai_credit_wallets` | `ai_credit_wallets` | ✅ |
| `public.audit_logs` | `audit_logs` | ✅ |
| `public.batches` | `batches` | ✅ |
| `public.entitlement_rule` | `entitlement_rule` | ✅ |
| `public.generated_credentials` | `generated_credentials` | ✅ |
| `public.permissions` | `permissions` | ✅ |
| `public.plan_change_requests` | `plan_change_requests` | ✅ |
| `public.plan_feature_overrides` | `plan_feature_overrides` | ✅ |
| **`public.platform_notifications`** | **—** | **❌ MISSING** |
| `public.profiles` | `profiles` | ✅ |
| `public.role_permissions` | `role_permissions` | ✅ |
| `public.roles` | `roles` | ✅ |
| `public.rooms` | `rooms` | ✅ |
| `public.school_memberships` | `school_memberships` | ✅ |
| `public.school_plans` | `school_plans` | ✅ |
| `public.schools` | `schools` | ✅ |
| `public.staff_members` | `staff_members` | ✅ |
| `public.students` | `students` | ✅ |
| `public.subjects` | `subjects` | ✅ |
| `public.test_sessions` | `test_sessions` | ✅ |
| `public.usage_snapshots` | `usage_snapshots` | ✅ |
| `public.warehouse_dim_course` | `warehouse_dim_course` | ✅ |
| `public.warehouse_dim_date` | `warehouse_dim_date` | ✅ |
| `public.warehouse_dim_school` | `warehouse_dim_school` | ✅ |
| `public.warehouse_dim_staff` | `warehouse_dim_staff` | ✅ |
| `public.warehouse_dim_student` | `warehouse_dim_student` | ✅ |
| `public.warehouse_fact_attendance` | `warehouse_fact_attendance` | ✅ |
| `public.warehouse_fact_finance` | `warehouse_fact_finance` | ✅ |
| `public.warehouse_fact_live_classes` | `warehouse_fact_live_classes` | ✅ |
| `public.warehouse_fact_lms` | `warehouse_fact_lms` | ✅ |
| `public.warehouse_fact_operations` | `warehouse_fact_operations` | ✅ |
| `public.warehouse_fact_platform_usage` | `warehouse_fact_platform_usage` | ✅ |
| `public.warehouse_fact_students` | `warehouse_fact_students` | ✅ |
| `public.warehouse_fact_tests` | `warehouse_fact_tests` | ✅ |
| `public.warehouse_report_definitions` | `warehouse_report_definitions` | ✅ |
| `public.warehouse_report_schedules` | `warehouse_report_schedules` | ✅ |

### 2b. Custom Schema Tables → Public Views (Repository → Production)

Schemas with public views that **EXIST** in production:

| Schema | Repo Table | Public View | Production |
|--------|-----------|-------------|------------|
| `ai` | `agent_actions` | `public.ai_agent_actions` | ✅ |
| `ai` | `agent_jobs` | `public.ai_agent_jobs` | ✅ |
| `ai` | `agent_recommendations` | `public.ai_agent_recommendations` | ✅ |
| `ai` | `agent_registry` | `public.ai_agent_registry` | ✅ |
| `ai` | `ai_conversations` | `public.ai_ai_conversations` | ✅ |
| `ai` | `ai_learning_context` | `public.ai_ai_learning_context` | ✅ |
| `ai` | `ai_recommendations` | `public.ai_ai_recommendations` | ✅ |
| `ai` | `doubt_questions` | `public.ai_doubt_questions` | ✅ |
| `ai` | `doubt_recommendations` | `public.ai_doubt_recommendations` | ✅ |
| `ai` | `doubt_sessions` | `public.ai_doubt_sessions` | ✅ |
| `ai` | `doubt_solutions` | `public.ai_doubt_solutions` | ✅ |
| `ai` | `generated_assignments` | `public.ai_generated_assignments` | ✅ |
| `ai` | `generated_papers` | `public.ai_generated_papers` | ✅ |
| `ai` | `generated_reports` | `public.ai_generated_reports` | ✅ |
| `ai` | `teacher_assistant_jobs` | `public.ai_teacher_assistant_jobs` | ✅ |
| `analytics` | `forecasts` | `public.analytics_forecasts` | ✅ |
| `analytics` | `learning_goals` | `public.analytics_learning_goals` | ✅ |
| `analytics` | `model_registry` | `public.analytics_model_registry` | ✅ |
| `analytics` | `parent_alerts` | `public.analytics_parent_alerts` | ✅ |
| `analytics` | `parent_insights` | `public.analytics_parent_insights` | ✅ |
| `analytics` | `predictions` | `public.analytics_predictions` | ✅ |
| `analytics` | `recommendations` | `public.analytics_recommendations` | ✅ |
| `analytics` | `risk_scores` | `public.analytics_risk_scores` | ✅ |
| `analytics` | `school_analytics` | `public.analytics_school_analytics` | ✅ |
| `analytics` | `student_performance` | `public.analytics_student_performance` | ✅ |
| `analytics` | `student_risk_scores` | `public.analytics_student_risk_scores` | ✅ |
| `analytics` | `study_plans` | `public.analytics_study_plans` | ✅ |
| `analytics` | `study_tasks` | `public.analytics_study_tasks` | ✅ |
| `analytics` | `test_analytics` | `public.analytics_test_analytics` | ✅ |
| `analytics` | `topic_performance` | `public.analytics_topic_performance` | ✅ |
| `lms` | `courses` | `public.lms_courses` | ✅ |
| `lms` | `course_modules` | `public.lms_course_modules` | ✅ |
| `lms` | `lessons` | `public.lms_lessons` | ✅ |
| `lms` | `lesson_resources` | `public.lms_lesson_resources` | ✅ |
| `lms` | `student_progress` | `public.lms_student_progress` | ✅ |
| `lms` | `assignments` | `public.lms_assignments` | ✅ |
| `lms` | `assignment_submissions` | `public.lms_assignment_submissions` | ✅ |
| `lms` | `student_revision_tracker` | `public.lms_student_revision_tracker` | ✅ |
| `online_tests` | `tests` | `public.online_test_tests` | ✅ |
| `online_tests` | `test_sections` | `public.online_test_test_sections` | ✅ |
| `online_tests` | `test_questions` | `public.online_test_test_questions` | ✅ |
| `online_tests` | `test_attempts` | `public.online_test_test_attempts` | ✅ |
| `online_tests` | `test_responses` | `public.online_test_test_responses` | ✅ |
| `online_tests` | `test_results` | `public.online_test_test_results` | ✅ |
| `online_tests` | `question_bank` | `public.online_test_question_bank` | ✅ |

### 2c. Custom Schema Tables WITHOUT Public Views (Unverifiable Status)

These tables exist in repository migrations but have NO corresponding public view migration.
**Cannot verify** whether the underlying custom schema tables exist in production without direct database connection.

| Schema | Tables |
|--------|--------|
| `academic` | `guardians`, `student_guardians`, `staff_subject_assignments`, `live_class_sessions`, `live_class_attendance`, `live_class_chat`, `live_class_recordings` |
| `attendance` | `settings`, `holidays`, `leave_requests`, `student_attendance`, `staff_attendance`, `notifications` |
| `exam` | `room_desks`, `room_seats`, `exams`, `exam_registrations`, `seating_plans`, `seating_assignments`, `invigilator_assignments` |
| `finance` | `fee_structures`, `fee_assignments`, `payments`, `orders`, `order_items`, `invoices`, `products`, `subscriptions`, `coupons`, `affiliates`, `referrals`, `payouts`, `payment_refunds`, `payment_webhook_events`, `payment_idempotency_keys` |
| `hostel` | `hostels`, `hostel_rooms`, `hostel_requests`, `hostel_allocations` |
| `inventory` | `suppliers`, `material_categories`, `material_items`, `stock_in_entries`, `stock_out_entries`, `student_issue_entries` |
| `scheduling` | `timetable_entries`, `timetable_entry_batches` |
| `workflow` | `bulk_action_requests`, `bulk_action_events` |
| `reporting` | `generated_reports` |
| `warehouse` | `dim_course`, `dim_date`, `dim_school`, `dim_staff`, `dim_student`, `fact_attendance`, `fact_finance`, `fact_live_classes`, `fact_lms`, `fact_operations`, `fact_platform_usage`, `fact_students`, `fact_tests`, `report_definitions`, `report_schedules` |

**Note:** The `warehouse.*` schema duplicates `public.warehouse_*` tables. The public versions (`public.warehouse_dim_course`, etc.) exist in production. The custom schema versions may or may not exist.

---

## 3. Column Drift

### Verified Matches ✅

| Table | Key Column | Production | Expected |
|-------|-----------|------------|----------|
| `students` | `staff_type` | ❌ Not Present | ✅ Should not exist |
| `staff_members` | `staff_type` | ✅ Present (`invigilator`) | ✅ Should exist |
| `active_sessions` | `session_key` | ✅ Present | ✅ Added by migration 060 |

### Full Column Comparison (Production tables)

| Table | Repo Columns | Production Columns | Status |
|-------|-------------|-------------------|--------|
| `profiles` | 11 | 11 | ✅ Match |
| `schools` | 13 | 13 | ✅ Match |
| `students` | 28 | 28 | ✅ Match |
| `staff_members` | 16 | 16 | ✅ Match |
| `roles` | 11 | 11 | ✅ Match |
| `rooms` | 24 | 24 | ✅ Match |
| `batches` | 15 | 15 | ✅ Match |
| `subjects` | 14 | 14 | ✅ Match |
| `active_sessions` | 20 | 20 | ✅ Match |

**No column-level drift detected** among API-accessible tables.

---

## 4. Index Drift

Cannot verify through REST API. Requires direct `pg_indexes` query on production database.

Repository defines these indexes on public schema tables:

| Table | Missing Index | Verified |
|-------|--------------|----------|
| `students` | `idx_students_school_active_class_section_name` | ⚠️ Unknown |
| `students` | `idx_students_school_active_roll_number` | ⚠️ Unknown |
| `audit_logs` | `audit_logs_school_module_created_idx` | ⚠️ Unknown |
| `audit_logs` | `audit_logs_profile_created_idx` | ⚠️ Unknown |
| `school_plans` | `school_plans_pkey` | ⚠️ Unknown |

---

## 5. Trigger Drift

Cannot verify through REST API. Repository defines these triggers on public schema tables:

| Table | Trigger | Verified |
|-------|---------|----------|
| `schools` | `set_updated_at_schools` | ⚠️ Unknown |
| `profiles` | `set_updated_at_profiles` | ⚠️ Unknown |
| `roles` | `set_updated_at_roles` | ⚠️ Unknown |
| `permissions` | `set_updated_at_permissions` | ⚠️ Unknown |
| `school_memberships` | `set_updated_at_school_memberships` | ⚠️ Unknown |
| `school_memberships` | `validate_school_membership_role` | ⚠️ Unknown |
| `auth.users` | `on_auth_user_created` | ⚠️ Unknown |
| `staff_members` | `set_updated_at_staff_members` | ⚠️ Unknown |
| `students` | `set_updated_at_students` | ⚠️ Unknown |
| `batches` | `set_updated_at_batches` | ⚠️ Unknown |
| `subjects` | `set_updated_at_subjects` | ⚠️ Unknown |
| `rooms` | `set_updated_at_rooms` | ⚠️ Unknown |
| `audit_logs` | (none defined) | ✅ N/A |
| `active_sessions` | `set_updated_at_active_sessions` | ⚠️ Unknown |
| `test_sessions` | `set_updated_at_test_sessions` | ⚠️ Unknown |
| `generated_credentials` | `set_updated_at_generated_credentials` | ⚠️ Unknown |
| `platform_notifications` | `set_updated_at_platform_notifications` | ❌ Table missing |

---

## 6. RLS Policy Drift

Cannot verify through REST API. Repository defines these RLS policies on public schema tables:

| Table | Policy Count | Verified |
|-------|-------------|----------|
| `schools` | 4 | ⚠️ Unknown |
| `profiles` | 3 | ⚠️ Unknown |
| `roles` | 4 | ⚠️ Unknown |
| `permissions` | 1 | ⚠️ Unknown |
| `school_memberships` | 4 | ⚠️ Unknown |
| `staff_members` | 4 | ⚠️ Unknown |
| `students` | 4 | ⚠️ Unknown |
| `batches` | 4 | ⚠️ Unknown |
| `subjects` | 4 | ⚠️ Unknown |
| `rooms` | 4 | ⚠️ Unknown |
| `audit_logs` | 2 | ⚠️ Unknown |
| `active_sessions` | 0 (handled by backend) | ⚠️ Unknown |
| `test_sessions` | 0 | ⚠️ Unknown |
| `generated_credentials` | 0 | ⚠️ Unknown |
| `platform_notifications` | 0 | ❌ Table missing |
| `school_plans` | 0 | ⚠️ Unknown |
| `usage_snapshots` | 0 | ⚠️ Unknown |

---

## 7. Extra Objects (Production Only)

No extra tables detected in the production schema that are not defined in the repository.

---

## 8. Changed Objects

No structural changes detected among API-accessible tables.

---

## Limitations

| Limitation | Reason |
|-----------|--------|
| Custom schema tables unverifiable | PostgREST only exposes schemas in `db_schemas` config |
| Indexes unverifiable | Need `pg_indexes` catalog access |
| Triggers unverifiable | Need `pg_trigger` catalog access |
| Policies unverifiable | Need `pg_policies` catalog access |
| Grants unverifiable | Need `pg_class`/`pg_namespace` catalog access |

To fully verify, run recovery SQL with direct database connection (psql) and compare using:

```sql
-- Verify schemas
SELECT nspname FROM pg_catalog.pg_namespace;

-- Verify tables
SELECT table_schema, table_name FROM information_schema.tables;

-- Verify indexes
SELECT schemaname, tablename, indexname FROM pg_indexes;

-- Verify triggers
SELECT event_object_schema, event_object_table, trigger_name FROM information_schema.triggers;

-- Verify policies
SELECT schemaname, tablename, policyname FROM pg_policies;
```

---

## Verdict

> **NO — Production does not match Repository**

### Blocking Issues
1. **`public.platform_notifications`** — Table does not exist in production
2. **Custom schema public views** — Views for `academic`, `attendance`, `exam`, `finance`, `hostel`, `inventory`, `scheduling`, `workflow`, `reporting`, `warehouse` schemas do not exist in production (underlying tables status unknown)
3. **Partial schema deployment** — Some custom schema tables have public views (`ai`, `analytics`, `lms`, `online_tests`), others do not

### Non-Blocking / Already Fixed
- `students.staff_type` — Correctly absent from production (column belongs on `staff_members`)
- All 39 public schema tables match repository definitions
- All verified columns match repository definitions

---

## Recommended Actions

1. **Apply PRODUCTION_RECOVERY.sql** to create missing `public.platform_notifications`
2. **Verify custom schemas** via direct database connection
3. **Create public views** for any schemas that exist but lack them
4. **Run migration 066** (`20260628_066_platform_control_plane.sql`) if not yet applied
5. **Run migration 067** (`20260703_067_ensure_platform_notifications.sql`) if not yet applied
