# MIGRATION DRIFT REPORT — Dr. Girish App

**Audit Date:** 2026-07-06

---

## 1. MIGRATION FILE INVENTORY

| Metric | Count |
|--------|-------|
| Total migration files | 77 (numbered) + 1 (test_rpc.sql) |
| Unique sequence numbers | 68 (001-068) |
| Duplicate sequence pairs | 6 (028, 056, 057, 058, 059, 060) |
| Rollback (_down) files | 3 (063_down, 064_down, 065_down) |
| Undated files | 1 (test_rpc.sql) |

---

## 2. MIGRATION DUPLICATE DETAIL

| Sequence | Total Files | Files |
|----------|-------------|-------|
| 028 | 2 | `20260602_028_seating_plan_type_all_in_one.sql` + `20260608_028_bulk_action_requests.sql` |
| 056 | 2 | `20260617_056_inventory_report_indexes.sql` + `20260618_056_lms_online_tests_sprint1.sql` |
| 057 | 2 | `20260617_057_analytics_public_views.sql` + `20260619_057_storage_infrastructure_sprint.sql` |
| 058 | 2 | `20260617_058_warehouse_tables.sql` + `20260619_058_student_success_dashboard.sql` |
| 059 | 2 | `20260617_059_ai_public_views.sql` + `20260619_059_portal_access_security_sessions.sql` |
| 060 | 2 | `20260619_060_move_sessions_to_public.sql` + `20260620_060_move_generated_credentials_to_public.sql` |

**Impact:** Supabase migration tooling (and manual review) cannot determine the correct order when two files share the same sequence number.

---

## 3. SCHEMA vs BACKEND CODE DRIFT

### Tables Referenced in Backend Code — Created in Migrations ✅

| Backend Reference | Migration | Status |
|-------------------|-----------|--------|
| `users` (SQLAlchemy model) | NOT in Supabase migrations (legacy SQLAlchemy) | ❌ **LEGACY** |
| `schools` | 001_core_foundation | ✅ |
| `profiles` | 001_core_foundation | ✅ |
| `school_memberships` | 001_core_foundation | ✅ |
| `roles` | 003_rbac_extensions | ✅ |
| `permissions` | 003_rbac_extensions | ✅ |
| `role_permissions` | 003_rbac_extensions | ✅ |
| `students` | 004_academic_and_timetable | ✅ |
| `teachers` | 004_academic_and_timetable | ✅ |
| `rooms` | 005_exam_and_seating | ✅ |
| `seating_plans` | 005_exam_and_seating | ✅ |
| `exams` | 005_exam_and_seating | ✅ |
| `attendance_records` | 006_attendance | ✅ |
| `inventory_*` | 007_inventory_and_fees | ✅ |
| `fee_structures` | 007_inventory_and_fees | ✅ |
| `hostel_*` | 008_hostel_and_reporting | ✅ |
| `online_tests` | 033_online_tests_schema | ✅ |
| `lms_courses` | 037_lms_schema | ✅ |
| `active_sessions` | 060_move_sessions_to_public | ✅ |

### Tables Referenced in Backend — NOT Found in Any Migration ❌

| Backend Reference | File | Impact |
|-------------------|------|--------|
| `User` (SQLAlchemy model `users` table) | `backend/app/models/__init__.py` | This is a SQLAlchemy ORM model — no Supabase migration needed. But `middleware/auth.py:373,381` queries this table. If Supabase is the database, this table doesn't exist in Supabase. | **P0** |

### Column-Level Drift

| Column | Type in Backend | Type in Migration | Status |
|--------|----------------|-------------------|--------|
| `students.id` | integer (SQLAlchemy) | UUID (Supabase) | ❌ **MISMATCH** |
| `rooms.id` | integer (SQLAlchemy) | UUID (Supabase) | ❌ **MISMATCH** |
| `exams.id` | integer (SQLAlchemy) | UUID (Supabase) | ❌ **MISMATCH** |
| `school_id` | integer (SQLAlchemy User model) | UUID (Supabase schools table) | ❌ **MISMATCH** |
| `issue_date` | timestamp | `entry_date` in migrations | ❌ **COLUMN NAME MISMATCH** |

---

## 4. MISSING ELEMENTS

### Schemas Referenced in Backend Code But Missing GRANTs
| Schema | Backend Files Using It | GRANT Status |
|--------|----------------------|--------------|
| `attendance` | `services/supabase_attendance.py` | ❌ No USAGE grant |
| `inventory` | `services/supabase_inventory.py` | ❌ No USAGE grant |
| `finance` | `services/supabase_edupay.py` | ❌ No USAGE grant |
| `exam` | `routes/rooms.py`, `routes/seating.py` | ❌ No USAGE grant |
| `scheduling` | `routes/timetable.py` | ❌ No USAGE grant |
| `warehouse` | `services/supabase_bi.py` | ❌ No USAGE grant |

### Functions/RPCs Referenced But Missing from Migrations
| RPC/Function | Backend Reference | Migration Status |
|--------------|-------------------|------------------|
| `get_dashboard_metrics()` | `dashboard.py` | ❓ UNKNOWN — not traced |
| Various attendance RPCs | `services/supabase_attendance.py` | Need verification |

---

## 5. INDEX HEALTH

### Indexes Present in Migrations
- Migration 014-015 — Attendance report indexes
- Migration 016 — Batch current class optimizations
- Migration 024 — Inventory finance permissions
- Migration 025 — Dashboard performance indexes
- Migration 054 — Inventory performance indexes
- Migration 056 — Inventory report indexes

### Likely Missing Indexes (from query patterns)
- `seating_plans(school_id, exam_id)` — frequent join filter
- `attendance_records(student_id, date)` — daily lookup
- `school_memberships(profile_id, school_id)` — auth bootstrap
- `role_permissions(role_id)` — permission loading
- `active_sessions(profile_id)` — session validation
