# Database Optimization And Identity Roadmap

## Optimization report

### Current indexing strengths
- Most primary tables already have explicit indexes on IDs and common filters.
- Attendance, inventory, seating, and student tables include useful single-column indexes for direct lookups.

### Slow-query risks
- Reporting flows that combine attendance, timetable, and staff identity data will pay a penalty because identity records are split across multiple tables.
- Student reporting across `students`, `attendance_students`, and `edupay_students` will keep needing parallel queries or fuzzy reconciliation.
- Single-column indexes exist widely, but there are few composite indexes for common reporting filters such as:
  - `(school_id, is_active)`
  - `(school_id, batch_id)`
  - `(school_id, exam_date)`
  - `(school_id, date, staff_member_id)`
  - `(school_id, date, student_id)`

### Indexing recommendations
1. Add composite indexes on high-frequency scoped filters:
   - `students (school_id, batch_id, is_active)`
   - `teachers (school_id, is_active)`
   - `attendance_staff (school_id, is_active)`
   - `student_attendance (school_id, date, student_id)`
   - `staff_attendance (school_id, date, staff_member_id)`
   - `seating_plans (school_id, exam_id, room_id)`
2. Add unique constraints where the business logic assumes uniqueness:
   - `teachers (school_id, email)` if business allows
   - `attendance_staff (school_id, staff_id)`
   - `invigilators (school_id, staff_id)`
3. Review text-heavy reporting fields that may not need indexes.

### Transaction safety recommendations
1. Keep schema changes outside app startup.
2. Wrap data migrations in explicit Alembic transactions when PostgreSQL supports it.
3. Use phased migrations for big backfills:
   - add nullable column
   - backfill
   - add indexes/constraints
   - only then tighten nullability

## Identity normalization analysis

### Duplicate identity systems today
- Authentication identity: `users`
- Teaching identity: `teachers`
- Exam/non-teaching identity: `invigilators`
- Attendance identity: `attendance_staff`
- Academic student identity: `students`
- Attendance student identity: `attendance_students`
- Fee identity: `edupay_students`

### Canonical identity recommendation
- Short-term canonical auth/person anchor: `users`
- Future-safe canonical people layer: introduce a dedicated `persons` table

### Future normalized architecture
1. `persons`
   - canonical human identity
   - name, email, phone, status
2. `users`
   - login credentials
   - links to `persons.id`
3. `teachers`
   - operational teaching profile
   - links to `persons.id`
4. `attendance_staff`
   - attendance-specific staff profile
   - links to `persons.id`
5. `invigilators`
   - exam-duty profile
   - links to `persons.id`
6. `students`
   - canonical academic student
7. attendance/fee modules
   - reference canonical `students.id`, not cloned student rows

## Compatibility strategy
- Do not delete legacy tables immediately.
- Add nullable bridge columns first:
  - `teachers.user_id` or `teachers.person_id`
  - `attendance_staff.user_id` or `attendance_staff.person_id`
  - `invigilators.user_id` or `invigilators.person_id`
  - `attendance_students.student_id` bridge if missing
  - `edupay_students.student_id` bridge if missing
- Backfill these links from email and controlled manual review.
- Update reads first, writes second, cleanup last.

## Migration roadmap

### Phase 1
- Add bridge columns and indexes.
- Keep all legacy reads working.

### Phase 2
- Backfill stable ID-based relationships.
- Add application-level dual-write where needed.

### Phase 3
- Shift reports and APIs to canonical IDs.
- Deprioritize name-based joins.

### Phase 4
- Retire duplicate identity storage only after:
  - report parity
  - backfill verification
  - export validation
  - admin workflow validation

## Scalability concerns
- Identity duplication will become the biggest long-term reporting bottleneck.
- Monolithic model ownership will slow safe schema evolution.
- Attendance and fee modules will diverge further unless student identity is unified.
- Composite indexing and partition strategy may eventually be needed for high-volume attendance history.
