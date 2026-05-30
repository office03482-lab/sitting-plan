# DATABASE AUDIT REPORT

## Dr. Girish App - School ERP System

**Audit Date:** 2026-05-29
**Status:** Complete

---

## 1. MODEL INVENTORY

| # | Model | Table | Has school_id? | Has UUID PK? | Status |
|---|-------|-------|----------------|-------------|--------|
| 1 | User | users | NO (global) | NO (Integer) | OK |
| 2 | Token | tokens | N/A | NO (Integer) | OK |
| 3 | AuthThrottle | auth_throttles | N/A | NO (Integer) | OK |
| 4 | AuthSecurityEvent | auth_security_events | N/A | NO (Integer) | OK |
| 5 | School | schools | N/A | NO (Integer) | OK |
| 6 | Student | students | YES | NO (Integer) | OK |
| 7 | Hostel | hostels | YES | NO (Integer) | OK |
| 8 | HostelRoom | hostel_rooms | NO | NO (Integer) | FIXED |
| 9 | StudentHostelRequest | student_hostel_requests | YES | NO (Integer) | OK |
| 10 | Room | rooms | YES | NO (Integer) | OK |
| 11 | Desk | desks | NO (via Room) | NO (Integer) | OK |
| 12 | Seat | seats | NO (via Desk) | NO (Integer) | OK |
| 13 | Exam | exams | YES | NO (Integer) | OK |
| 14 | SeatingPlan | seating_plans | YES | NO (Integer) | FIXED |
| 15 | ActivityLog | activity_logs | NO | NO (Integer) | WARN |
| 16 | Teacher | teachers | YES | NO (Integer) | OK |
| 17 | TimetableEntry | timetable_entries | YES | NO (Integer) | OK |
| 18 | Settings | settings | YES | NO (Integer) | OK |
| 19 | BatchTable | batches | YES | NO (Integer) | OK |
| 20 | Invigilator | invigilators | YES | NO (Integer) | OK |
| 21 | RoomInvigilator | room_invigilators | YES | NO (Integer) | OK |
| 22 | Supplier | suppliers | YES | NO (Integer) | OK |
| 23 | InventorySubject | inventory_subjects | YES | NO (Integer) | OK |
| 24 | InventorySet | inventory_sets | YES | NO (Integer) | OK |
| 25 | InventoryVolume | inventory_volumes | YES | NO (Integer) | OK |
| 26 | MaterialItem | material_items | YES | NO (Integer) | OK |
| 27 | StockInEntry | stock_in_entries | YES | NO (Integer) | OK |
| 28 | StockOutEntry | stock_out_entries | YES | NO (Integer) | OK |
| 29 | StudentIssueEntry | student_issue_entries | YES | NO (Integer) | OK |
| 30 | EduPayParent | edupay_parents | YES | NO (Integer) | OK |
| 31 | EduPayStudent | edupay_students | YES | NO (Integer) | OK |
| 32 | EduPayFeeStructure | edupay_fee_structures | YES | NO (Integer) | OK |
| 33 | EduPayFeeAssignment | edupay_fee_assignments | YES | NO (Integer) | OK |
| 34 | EduPayPayment | edupay_payments | YES | NO (Integer) | OK |
| 35 | AttendanceStudent | attendance_students | YES | NO (Integer) | OK |
| 36 | AttendanceStaff | attendance_staff | YES | NO (Integer) | OK |
| 37 | AttendanceSubject | attendance_subjects | YES | NO (Integer) | OK |
| 38 | AttendanceSetting | attendance_settings | YES | NO (Integer) | OK |
| 39 | AttendanceHoliday | attendance_holidays | YES | NO (Integer) | OK |
| 40 | AttendanceNotification | attendance_notifications | YES | NO (Integer) | OK |
| 41 | AttendanceLeave | attendance_leaves | YES | NO (Integer) | OK |
| 42 | StudentAttendance | student_attendance | YES | NO (Integer) | OK |
| 43 | StaffAttendance | staff_attendance | YES | NO (Integer) | OK |

---

## 2. ISSUES FOUND

### I1: Missing school_id on SeatingPlan
**Severity:** HIGH
**Fix:** Added `school_id` column and `school` relationship

### I2: Missing school_id on HostelRoom
**Severity:** LOW (indirect via Hostel)
**Status:** Will be fixed in UUID migration

### I3: All models use Integer PKs
**Severity:** HIGH
**Status:** UUID migration planned (see migration plan below)

### I4: Missing FK indexes
**Severity:** MEDIUM
**Status:** Identified for performance fix

| Model | FK Column(s) | Missing Index |
|-------|-------------|---------------|
| Desk | room_id | YES |
| Seat | desk_id, student_id | YES |
| SeatingPlan | exam_id, room_id | NOW HAS INDEX |
| ActivityLog | user_id | YES |
| Teacher | school_id | YES |
| TimetableEntry | teacher_id, room_id | YES |
| Student | school_id, batch_id | YES |

### I5: Data Duplication
**Severity:** MEDIUM
**Tables:** `attendance_students` duplicates `students`; `attendance_staff` duplicates `teachers`/`users`; `edupay_students` duplicates `students`
**Status:** Architectural debt - will be consolidated in v2.0

### I6: No cascade deletes on Token records
**Severity:** LOW
**Status:** Acceptable (audit trail)

### I7: Batch enum is dead code
**Severity:** LOW
**Status:** Dynamic batch system (`BatchTable`) replaces the static enum

---

## 3. MISSING INDEXES (DETAILED)

```sql
-- Critical indexes for performance
CREATE INDEX ix_students_school_id ON students(school_id);
CREATE INDEX ix_students_batch_id ON students(batch_id);
CREATE INDEX ix_desks_room_id ON desks(room_id);
CREATE INDEX ix_seats_desk_id ON seats(desk_id);
CREATE INDEX ix_seats_student_id ON seats(student_id);
CREATE INDEX ix_exams_school_id ON exams(school_id);
CREATE INDEX ix_teachers_school_id ON teachers(school_id);
CREATE INDEX ix_timetable_entries_teacher_id ON timetable_entries(teacher_id);
CREATE INDEX ix_timetable_entries_room_id ON timetable_entries(room_id);
CREATE INDEX ix_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX ix_hostel_rooms_hostel_id ON hostel_rooms(hostel_id);
```

---

## 4. UUID MIGRATION PLAN

### Phase 1: Add UUID columns alongside integers
```python
# Add to each model:
uuid_id = Column(UUID(as_uuid=True), default=uuid.uuid4, unique=True, index=True)
school_uuid = Column(UUID(as_uuid=True), ForeignKey("schools.uuid_id"), index=True)
```

### Phase 2: Migrate foreign keys
- Replace integer FKs with UUID FKs
- Update all relationships

### Phase 3: Switch primary keys
- Make UUID the primary key
- Drop integer PK columns

### Phase 4: Update API
- Change all Pydantic schemas from `int | str` to `str` (UUID)
- Update frontend types

---

## 5. RLS POLICIES (SUPABASE)

Current state: 23 Supabase migration files exist but no RLS policies verified.
Required RLS policies for multi-school tenant isolation:

```sql
-- For every school-scoped table:
CREATE POLICY tenant_isolation ON {table}
  USING (school_id = current_setting('app.current_school_id')::uuid);
```

---

## 6. DATABASE SCORES

| Category | Score | Notes |
|----------|-------|-------|
| Schema Design | 7/10 | Good separation, but integer IDs |
| Tenant Isolation | 6/10 | school_id on most but not all tables |
| Indexes | 5/10 | Many FKs missing indexes |
| Constraints | 7/10 | Good FK usage, missing some cascades |
| Migrations | 8/10 | Alembic + Supabase SQL migrations |
| Data Duplication | 4/10 | AttendanceStudent/EduPayStudent duplication |
| Overall | 6.2/10 | Needs UUID migration and index optimization |
