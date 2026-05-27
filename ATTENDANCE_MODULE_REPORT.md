# Attendance Module Report

## Scope
This report covers the current attendance module implementation across:

- `frontend/src/pages/AttendanceManagement.tsx`
- `frontend/src/services/api.ts`
- `backend/app/attendance/native/router.py`
- `backend/app/attendance/native/service.py`
- `backend/app/services/supabase_attendance.py`
- `backend/app/routes/attendance.py`
- `supabase/migrations/20260527_022_attendance_student_records_effective_batch_filter.sql`

The active runtime path is primarily the native attendance router:

- `backend/app/attendance/native/router.py`

## Module Areas

### 1. Mark Student Attendance
Main frontend logic:

- `AttendanceManagement.tsx`

Main backend endpoints:

- `GET /api/attendance/student-marking`
- `POST /api/attendance/student-marking`
- `GET /api/attendance/integrated-students`

Current behavior:

- Class and batch are separated in the UI.
- Full student roster is now intended to load via `integrated-students`.
- Native backend integrated-students route limit was raised from `200` to `10000`.
- Subject/timetable context is resolved separately from the selected class/batch.

Important frontend data sources:

- `students`
- `selectedBatchRosterStudents`
- `studentMarking`
- `buildFallbackStudentMarking()`

### 2. Student Records
Main frontend endpoint:

- `GET /api/attendance/student-records`

Main backend logic:

- `list_student_records()` in `supabase_attendance.py`

Current behavior:

- Batch filter request is sent as `batch_name` only.
- Frontend table now trusts backend-filtered response instead of re-filtering heavily.
- Debug info is temporarily shown on screen:
  - response count
  - rendered count
  - request key

Recent backend fixes:

- Raw batch label fallback matching for custom labels like `DROPPER - 1`
- RPC-empty-with-batch-filters fallback continuation
- Fallback matching now checks:
  - `batch_name`
  - canonical `class | section`

### 3. Student Dashboard
Dashboard purpose:

- Show selected-day attendance summary for selected class/batch

Main frontend loader:

- `loadTodayStudentDashboard()`

Current behavior:

- Uses `dashboard_date` for daily summary
- Uses effective dashboard selection:
  - explicit dashboard class/batch if chosen
  - otherwise falls back to current Mark Student selection

Debug info shown:

- dashboard response count
- dashboard request key

### 4. Student Calendar
Calendar purpose:

- Show month-wise shaded attendance days

Main frontend loader:

- `loadStudentCalendarRecords()`

Current behavior:

- Uses separate `calendar_date`
- Month picker drives calendar month only
- Mark Student date now syncs month selection
- Calendar grid is kept visible and should not disappear just because dashboard selectors are blank

Debug info shown:

- calendar response count
- calendar request key

## Backend Architecture

### Native Router
Key file:

- `backend/app/attendance/native/router.py`

Important routes:

- `GET /integrated-students`
- `GET /student-marking`
- `POST /student-marking`
- `GET /student-records`
- `DELETE /student-records/{record_id}`
- `DELETE /student-records`

### Native Service
Key file:

- `backend/app/attendance/native/service.py`

Purpose:

- Thin orchestration layer
- Delegates actual logic to `supabase_attendance.py`

### Supabase Attendance Service
Key file:

- `backend/app/services/supabase_attendance.py`

This file currently contains most of the real attendance logic:

- integrated student loading
- batch resolution
- student record RPC + fallback logic
- student record deletion
- dashboard data support
- timetable batch/class resolution

## Frontend Architecture

### Main Page
Key file:

- `frontend/src/pages/AttendanceManagement.tsx`

This file currently contains:

- Mark Student Attendance UI
- Student Records UI
- Student Dashboard UI
- Student Calendar UI
- Staff attendance
- Reports
- debug state

This is the largest coupling point in the module and the main maintenance hotspot.

### API Layer
Key file:

- `frontend/src/services/api.ts`

Important attendance methods:

- `listIntegratedStudents()`
- `listStudentAttendanceRecords()`
- `saveStudentAttendance()`
- `deleteStudentAttendanceRecord()`
- `deleteAllStudentAttendanceRecords()`

## Important Fixes Applied

### Student Records

- Batch request changed to `batch_name`-driven request
- Empty date params removed from requests to avoid `422`
- Frontend hidden re-filtering reduced
- Backend batch fallback matching improved for custom batch labels

### Dashboard / Calendar

- `dashboard_date` separated from `calendar_date`
- Dashboard and calendar hydration split
- Dashboard now supports fallback to current Mark Student selection
- Calendar kept visible instead of strict hide behavior

### Mark Student Attendance

- Integrated student limit raised
- Native router `integrated-students` limit raised to `10000`
- Full roster loading improved for large schools

### Delete All Student Records

- Delete candidate lookup is now chunked
- Cache clear added after delete

## Current Debug State

Temporary on-screen debug blocks are intentionally enabled in the student module:

- Student Records debug
- Student Dashboard debug

These are useful for checking:

- request keys
- response counts
- rendered counts

They should be removed after final stabilization.

## Known Risk Areas

### 1. Large Monolithic Frontend File
`AttendanceManagement.tsx` is very large and contains many interdependent states.

Risk:

- one change can affect unrelated attendance flows
- TDZ/state-order bugs are easy to introduce

Recommended next step:

- split student attendance into dedicated view-model/hooks/components

### 2. Mixed Fallback Logic
The backend has both:

- RPC path
- fallback path

Risk:

- behavior can differ between RPC success and RPC fallback

Recommended next step:

- standardize all student record filtering around one authoritative server-side resolver

### 3. Custom Batch Labels
Custom labels like:

- `DROPPER - 1`

still require careful canonical matching.

Recommended next step:

- persist stable batch identifiers end-to-end wherever possible instead of relying on label parsing

## Recommended Refactor Plan

### Phase 1

- move Student Records into its own hook/component
- move Student Dashboard + Calendar into their own hook/component
- remove debug blocks only after behavior is stable

### Phase 2

- introduce stable `batch_id` based filtering for student records and dashboard
- reduce dependence on label parsing

### Phase 3

- split `AttendanceManagement.tsx` into:
  - MarkStudentAttendance
  - StudentRecordsPanel
  - StudentDashboardPanel
  - StudentCalendarPanel

## Operational Notes

After backend logic changes:

1. restart backend
2. hard refresh frontend

Because current behavior is influenced by:

- backend process memory
- frontend cache
- in-memory attendance record cache

## Summary
The attendance module is functional but still tightly coupled in the frontend. The biggest improvements already made are:

- batch-name-aware student records
- larger student roster loading
- split dashboard vs calendar dates
- safer backend delete logic

The next best engineering step is structural refactoring, especially breaking `AttendanceManagement.tsx` into smaller ownership-based units.
