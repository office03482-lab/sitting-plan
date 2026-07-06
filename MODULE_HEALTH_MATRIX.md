# MODULE HEALTH MATRIX — Dr. Girish App

**Audit Date:** 2026-07-06
**Phase:** 1.6 Service Role Grant Verification

## Critical Finding

**`service_role` does NOT bypass schema or table GRANT checks.** Missing `GRANT USAGE ON SCHEMA` causes PostgreSQL 42501 "permission denied" errors, even when using the `service_role` key. This finding from migration `20260531_024_inventory_finance_permissions.sql` (header explanation) supercedes the previous assumption that `service_role` bypasses grants.

## Schema Grant Status Summary

| Schema | Tables | Has service_role GRANT USAGE? | Grant Source |
|--------|--------|------------------------------|--------------|
| `public` | schools, profiles, students, staff_members, rooms, batches, subjects, audit_logs | YES (default PG grant to PUBLIC) | PostgreSQL default |
| `academic` | guardians, student_guardians, staff_subject_assignments | YES | migration 032 (20260611) |
| `scheduling` | timetable_entries, timetable_entry_batches | NO | **MISSING** |
| `exam` | exams, exam_registrations, seating_plans, seating_assignments, room_desks, room_seats, invigilator_assignments | NO | **MISSING** |
| `attendance` | settings, holidays, leave_requests, student_attendance, staff_attendance, notifications | NO | **MISSING** |
| `inventory` | suppliers, material_categories, material_items, stock_in_entries, stock_out_entries, student_issue_entries | YES | migration 024 (20260531) |
| `finance` | fee_structures, fee_assignments, payments | YES | migration 024 (20260531) |
| `hostel` | hostels, hostel_rooms, hostel_requests, hostel_allocations | YES | migration 031 (20260610) |
| `reporting` | generated_reports | NO | **MISSING** |
| `workflow` | (various) | YES | migration 029 (20260609) |
| `online_tests` | (various) | YES | migration 034 (20260613) |
| `lms` | (via public views) | YES | migration 038 (20260613) |
| `analytics` | (various) | YES | migration 036 (20260613) |
| `ai` | (various) | YES | migrations 043/045/047 (20260614) |
| `warehouse` | (warehouse tables) | YES | migration 049 (20260614) |

## Module Health Classification

| Status | Meaning |
|--------|---------|
| HEALTHY | All criteria met + runtime success evidence |
| DEGRADED | Verified partial failure (e.g., missing grants on some tables, frontend issues) |
| BROKEN | Verified blocking failure (e.g., no GRANT USAGE on the schema -> 42501) |
| UNKNOWN | Insufficient evidence |

---

## MODULE HEALTH MATRIX (Corrected for Phase 1.6)

| # | Module | Frontend Route | Page Component | Backend Router | Status | Key Issue |
|---|--------|---------------|----------------|----------------|--------|-----------|
| 1 | **Dashboard/Overview** | `/overview` | `Dashboard.tsx` (1078 lines) | `routes/dashboard.py` | **BROKEN** | Fallback path queries `attendance` schema (`notifications`, `holidays`) via `_fallback_dashboard()` line 110-111 -- NO GRANT USAGE on `attendance`. 422/500 masked as transient, no AbortController. |
| 2 | **Students** | `/students` | `StudentManagement.tsx` | `routes/students.py` (1561 lines) | **DEGRADED** | Type mismatch (name/full_name, batch/batch_id), legacy SQLite paths unreachable. Schema: `public` only -- not grant-blocked. |
| 3 | **Teachers** | `/teachers` | `TeacherManagement.tsx` | `routes/teachers.py` | **DEGRADED** | Permission cascade re-fetch, bare except patterns. Schema: `public` only -- not grant-blocked. |
| 4 | **Batches** | `/batches` | `BatchManagement.tsx` | `routes/batches.py` | **HEALTHY** | Route/frontend/DB all verified. Schema: `public` only -- not grant-blocked. |
| 5 | **Rooms** | `/rooms` | `RoomConfiguration.tsx` | `routes/rooms.py` | **HEALTHY** | Route/frontend/DB all verified. Schema: `public` only -- not grant-blocked. |
| 6 | **Exams** | (via Seating) | -- | `routes/exams.py` | **BROKEN** | Uses `exam` schema (`exams`, `exam_registrations`) via `supabase_exams.py` `.schema("exam")` -- NO GRANT USAGE on `exam`. PREVIOUSLY marked HEALTHY based on incorrect "service_role bypasses grants" assumption. |
| 7 | **Seating Planner** | `/seating/generate` | `SeatingGeneration.tsx` | `routes/seating.py` | **BROKEN** | Uses `exam` schema (`seating_plans`, `seating_assignments`, `room_desks`, `room_seats`) via `supabase_seating.py` `.schema("exam")` -- NO GRANT USAGE on `exam`. PREVIOUSLY marked HEALTHY. |
| 8 | **Seating Plans** | `/seating/plans` | `SeatingPlanManagement.tsx` | `routes/seating.py` | **BROKEN** | Same schema dependency as Seating Planner -- `exam` schema missing grants. PREVIOUSLY marked HEALTHY. |
| 9 | **Attendance** | `/attendance-management` | `AttendanceManagement.tsx` (2197 lines) | `routes/attendance.py` (1323 lines) | **BROKEN** | Uses `attendance` schema for ALL core tables (`student_attendance`, `staff_attendance`, `settings`, `holidays`, `notifications`, `leave_requests`) via `supabase_attendance.py` `.schema("attendance")`. Also uses `scheduling` schema for timetable lookups (lines 835-1212). **BOTH schemas missing grants.** 16 bare `except Exception`, 3-5 sequential re-fetches per mutation. Was CORRECTED from BROKEN to DEGRADED in Phase 1.5 -- that correction is NOW REVERTED based on Phase 1.6 finding. |
| 10 | **Timetable** | `/timetable` | `TimetableManagement.tsx` | `routes/timetable.py` (851 lines) | **BROKEN** | Uses `scheduling` schema (`timetable_entries`) via `supabase_timetable.py` line 18: `TIMETABLE_SCHEMA = "scheduling"`. `get_timetable_table_query()` at line 63 calls `client.schema("scheduling").table("timetable_entries")`. NO GRANT USAGE on `scheduling` -> 42501. Legacy SQLAlchemy conflict detection path. PREVIOUSLY marked DEGRADED. |
| 11 | **Inventory** | `/inventory` | `InventoryManagement.tsx` (3368 lines) | `routes/inventory.py` (861 lines) | **DEGRADED** | Schema: `inventory` -- grants REPAIRED in migration 024. Two competing hash useEffects, 9-request refresh cascade, no pagination. |
| 12 | **EduPay/Fees** | `/edupay` | `FeeManagement.tsx` | `routes/edupay.py` | **DEGRADED** | Schema: `finance` -- grants REPAIRED in migration 024. Duplicate API methods (`getParentIntelligenceDashboard`/`getParentPortalDashboard`). |
| 13 | **Hostel** | `/hostels` | `HostelManagement.tsx` | `routes/hostels.py` | **HEALTHY*** | Schema: `hostel` -- grants verified (migration 031). Route/frontend/DB all verified. ***Conditional:** If the `20260611_032_hostel_request_vacated_state.sql` migration was SKIPPED (collision with same-number grant file), then `hostel.hostel_requests` is missing `vacated_at`, `vacated_by_profile_id` columns -> **BROKEN**. Verify both 032 files were applied. |
| 14 | **Invigilators** | `/invigilators` | `InvigilatorManagement.tsx` | `routes/invigilators.py` | **BROKEN** | Uses `exam` schema (`invigilator_assignments`) via `supabase_invigilators.py` line 110: `.schema("exam").table("invigilator_assignments")`. NO GRANT USAGE on `exam`. PREVIOUSLY marked HEALTHY. |
| 15 | **Reports** | `/reports` | `Reports.tsx` | `routes/reports.py` | **BROKEN** | Uses `exam` schema (schema="exam" at lines 170, 211, 280, 312) AND `reporting` schema (`generated_reports` via `supabase_bi.py` `REPORTING_SCHEMA = "reporting"`). **BOTH schemas missing grants.** PREVIOUSLY marked HEALTHY based on "service_role bypasses" assumption. |
| 16 | **Admin Office** | `/admin-office` | `AdminOffice.tsx` | `routes/admin_office.py` | **BROKEN** | Scope engine (`scope_engine.py` line 160) queries `scheduling.timetable_entries` for batch resolution. Admin routes that trigger this scope resolution will fail with 42501. Also uses `exam` schema indirectly through seating/exam routes. |
| 17 | **Online Tests** | `/online-tests` | `OnlineTests.tsx` | `routes/online_tests.py` (1059 lines) | **HEALTHY** | Schema: `online_tests` -- grants verified in migration 034. |
| 18 | **LMS** | `/courses`, `/my-learning`, `/assignments` | `Courses.tsx`, `MyLearning.tsx`, `LmsAssignments.tsx` | `routes/lms.py` | **BROKEN** | Uses `attendance` schema (`student_attendance`) via `supabase_lms.py` line 36 `_attendance_table()` and line 1408 call. Also scope engine (`scope_engine.py`) uses `scheduling.timetable_entries`. **BOTH `attendance` and `scheduling` schemas missing grants.** PREVIOUSLY marked HEALTHY (after Phase 1.5 correction). |
| 19 | **Live Classes** | `/live-classes` | `LiveClasses.tsx` | `routes/live_classes.py` | **BROKEN** | Uses `scheduling` schema via `supabase_live_classes.py` line 18: `SCHEDULING_SCHEMA = "scheduling"` and `_scheduling_table()` (line 37-38). Also imports from `supabase_timetable.py` which uses `scheduling` schema. NO GRANT USAGE on `scheduling`. PREVIOUSLY marked HEALTHY. |
| 20 | **Study Planner** | `/ai-study-assistant` | `AiStudyAssistantPage.tsx` | `routes/study_planner.py` | **BROKEN** | Uses `attendance` schema (`student_attendance` at line 266) and `scheduling` schema (`timetable_entries` at line 331) via `supabase_study_planner.py`. **BOTH schemas missing grants.** PREVIOUSLY marked HEALTHY. |
| 21 | **Parent Portal** | `/parent/dashboard` | `ParentDashboard.tsx` | `routes/parent_portal.py` | **BROKEN** | Scope engine used for permission resolution queries `scheduling.timetable_entries`. Also imports from LMS and attendance services that access `attendance` schema. Duplicate API methods. PREVIOUSLY marked DEGRADED. |
| 22 | **AI Tutor** | `/ai-study-assistant` | (redirected) | `routes/ai_tutor.py` | **BROKEN** | `_attendance_signal()` at line 270 queries `attendance.student_attendance` via `.schema("attendance").table("student_attendance")` (line 275-276). NO GRANT USAGE on `attendance`. PREVIOUSLY marked HEALTHY. |
| 23 | **Teacher AI** | `/teacher-ai` | `TeacherAiAssistantPage.tsx` | `routes/teacher_ai.py` | **BROKEN** | Uses `attendance` schema (`holidays`) via `supabase_teacher_ai.py` line 31: `ATTENDANCE_SCHEMA = "attendance"` and line 121: `_schema_table(ATTENDANCE_SCHEMA, "holidays")`. Also uses `reporting` schema for `generated_reports`. NO GRANT USAGE on `attendance` or `reporting`. PREVIOUSLY marked HEALTHY. |
| 24 | **Platform Admin** | `/platform/*` | 15 platform pages | `routes/platform.py` | **BROKEN** | `platform_control_plane.py` line 725 queries `attendance.student_attendance` and `attendance.staff_attendance` via `schema="attendance"`. NO GRANT USAGE on `attendance`. Also `PlatformAdminRoute` uses Zustand vs Context, 4 unbounded `select("*")` queries. PREVIOUSLY marked DEGRADED. |

### CORRECTIONS FROM PHASE 1.6 VERIFICATION

| Module | Previous Status | Corrected Status | Reason for Correction |
|--------|----------------|-------------------|----------------------|
| Exams | HEALTHY | BROKEN | `exam` schema has NO GRANT USAGE for service_role. Previous assumption that "service_role bypasses grants" was WRONG. |
| Seating Planner | HEALTHY | BROKEN | Same as Exams -- `exam` schema missing grants. |
| Seating Plans | HEALTHY | BROKEN | Same as Exams -- `exam` schema missing grants. |
| Invigilators | HEALTHY | BROKEN | Same as Exams -- `exam` schema missing grants. |
| Attendance | DEGRADED | BROKEN | `attendance` AND `scheduling` schemas missing grants. Phase 1.5 correction (BROKEN->DEGRADED) was based on wrong "service_role bypasses" assumption. **NOW REVERTED to BROKEN.** |
| Timetable | DEGRADED | BROKEN | `scheduling` schema missing grants. Phase 1.5 status was based on wrong assumption. |
| Reports | HEALTHY | BROKEN | `exam` AND `reporting` schemas missing grants. Previous status based on wrong assumption. |
| Admin Office | HEALTHY | BROKEN | Scope engine queries `scheduling` schema. Exam routes under admin use `exam` schema. |
| Dashboard | DEGRADED | BROKEN | Fallback path queries `attendance` schema directly. |
| Live Classes | HEALTHY | BROKEN | Uses `scheduling` schema which has no grants. |
| Study Planner | HEALTHY | BROKEN | Uses `attendance` AND `scheduling` schemas -- both missing grants. |
| Parent Portal | DEGRADED | BROKEN | Scope engine + LMS/attendance dependencies access `scheduling` and `attendance` schemas. |
| LMS | HEALTHY | BROKEN | Uses `attendance` schema directly. Scope engine uses `scheduling`. |
| AI Tutor | HEALTHY | BROKEN | `_attendance_signal()` queries `attendance` schema. |
| Teacher AI | HEALTHY | BROKEN | Uses `attendance` AND `reporting` schemas. |
| Platform Admin | DEGRADED | BROKEN | `platform_control_plane.py` queries `attendance` schema. |

---

## 20260611_032 Collision Analysis

### The Problem
Two migration files share the same sequence number `032`:
1. `20260611_032_academic_schema_service_role_grants.sql` -- GRANT USAGE on `academic` schema
2. `20260611_032_hostel_request_vacated_state.sql` -- ALTER TABLE on `hostel.hostel_requests`

### If BOTH files were applied (regardless of order)
- `academic` schema has service_role grants -> Live Classes, AI Tutor, Study Planner, BI can query `academic` tables
- `hostel.hostel_requests` has `vacated_at` and `vacated_by_profile_id` columns + updated status check constraint (includes `'vacated'`)
- No problem.

### If ONLY the academic grants file was applied
- `academic` schema grants work
- `hostel.hostel_requests` is MISSING `vacated_at` and `vacated_by_profile_id` columns -> Hostel `vacate` operations fail
- `hostel.hostel_requests` status check constraint does NOT include `'vacated'` -> setting status to 'vacated' fails

### If ONLY the hostel ALTER TABLE was applied
- `hostel.hostel_requests` has vacated columns
- `academic` schema queries fail for service_role -> Live Classes that use `academic` tables (via `_academic_table()`) fail with 42501

### Impact on Modules
- **academic grants missing** -> Modules using `academic` schema: Live Classes, AI Tutor, Study Planner, BI. However, these modules already have OTHER missing grants (scheduling, attendance) so they are already BROKEN.
- **hostel ALTER TABLE missing** -> Module 13 (Hostel) specifically. Current status: HEALTHY* -- **conditional** on both 032 files being applied.

---

## DETAILED MODULE TRACES

### 1. Dashboard (BROKEN -- escalated from DEGRADED)
```
Frontend Trace:
  /overview -> Dashboard.tsx:line 1-1078
  -> loadStatistics(): fires 5-8 parallel API calls
  -> Some succeed (public schema queries), some fail
  -> Backend: /api/dashboard/metrics -> routes/dashboard.py
  -> get_dashboard_metrics() -> get_dashboard_metrics_rpc() (RPC)
  -> If RPC fails -> _fallback_dashboard()
  -> In _fallback_dashboard():
       count_active_rows("students")              -> public OK
       fetch_all("notifications", schema="attendance") -> 42501 BLOCKED
       fetch_all("holidays", schema="attendance")      -> 42501 BLOCKED
       fetch_all("hostels", schema="hostel")           -> OK (grants exist)
  -> Error masked as isTemporarilyUnavailableDataError
```

### 9. Attendance (BROKEN -- reverted from DEGRADED)
```
Frontend Trace:
  /attendance-management -> AttendanceManagement.tsx
  -> apiService.listAttendanceOverview(), listStudentAttendance(), etc.
  -> Backend: routes/attendance.py -> services/supabase_attendance.py (3907 lines)
  -> ALL core queries use: .schema("attendance") -> NO GRANT USAGE -> 42501
  -> Timetable lookups also use: .schema("scheduling") -> also NO GRANT USAGE
  -> 16 bare `except Exception` swallow 42501 -> silent empty results
```

### 10. Timetable (BROKEN -- escalated from DEGRADED)
```
Backend Trace:
  routes/timetable.py -> services/supabase_timetable.py
  -> TIMETABLE_SCHEMA = "scheduling" (line 18)
  -> get_timetable_table_query() -> client.schema("scheduling").table("timetable_entries")
  -> .select("id").limit(1).execute()  -> 42501
  -> validate_timetable_schema_resolution() -> RuntimeError("Supabase/PostgREST could not resolve timetable table")
```

### 13. Hostel (HEALTHY* -- conditional)
```
Backend Trace:
  routes/hostels.py -> services/supabase_hostels.py & supabase_hostel_requests.py
  -> HOSTEL_SCHEMA = "hostel" (line 10)
  -> client.schema("hostel").table(...)
  -> GRANT USAGE on hostel exists (migration 031)

  Conditional issue:
  -> hostel_requests table: mig 032 should add vacated_at, vacated_by_profile_id
  -> If mig 032 NOT applied -> vacate operation fails
  -> hostel.hostel_requests status check does NOT include 'vacated'
```

### 18. LMS (BROKEN -- escalated from HEALTHY)
```
Backend Trace:
  routes/lms.py -> services/supabase_lms.py (1783 lines)
  -> _attendance_table() at line 35-36:
       return _client().schema("attendance").table(name)
  -> Called at line 1408: _attendance_table("student_attendance")
  -> NO GRANT USAGE on attendance -> 42501
  -> Also scope_engine._resolve_teacher_batches() uses scheduling schema
```

### 22. AI Tutor (BROKEN -- escalated from HEALTHY)
```
Backend Trace:
  routes/ai_tutor.py -> services/supabase_ai_tutor.py
  -> _attendance_signal() at line 270 queries:
       _client().schema("attendance").table("student_attendance")
  -> NO GRANT USAGE on attendance -> 42501
```

---

## Schemas Requiring GRANT USAGE Fix

Four schemas need `GRANT USAGE ON SCHEMA ... TO service_role` (plus table-level grants):

1. **scheduling** -- Affects: Timetable, Attendance, Live Classes, Study Planner, Admin Office (scope engine), Parent Portal, LMS
2. **exam** -- Affects: Exams, Seating Planner, Seating Plans, Invigilators, Reports, Admin Office
3. **attendance** -- Affects: Attendance, Dashboard, LMS, AI Tutor, Teacher AI, Study Planner, Parent Portal, Platform Admin
4. **reporting** -- Affects: Reports, Teacher AI, BI

Recommended fix migration:
```sql
-- Fix all four missing schemas
grant usage on schema scheduling to service_role;
grant usage on schema exam to service_role;
grant usage on schema attendance to service_role;
grant usage on schema reporting to service_role;

-- Grant table privileges
grant all privileges on all tables in schema scheduling to service_role;
grant all privileges on all tables in schema exam to service_role;
grant all privileges on all tables in schema attendance to service_role;
grant all privileges on all tables in schema reporting to service_role;

grant all privileges on all sequences in schema scheduling to service_role;
grant all privileges on all sequences in schema exam to service_role;
grant all privileges on all sequences in schema attendance to service_role;
grant all privileges on all sequences in schema reporting to service_role;

-- Default privileges for future objects
alter default privileges in schema scheduling grant all on tables to service_role;
alter default privileges in schema exam grant all on tables to service_role;
alter default privileges in schema attendance grant all on tables to service_role;
alter default privileges in schema reporting grant all on tables to service_role;
```
