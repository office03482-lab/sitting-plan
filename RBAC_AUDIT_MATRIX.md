# Aspire Academy ERP RBAC Audit

## Audit Snapshot

This RBAC architecture is based on the current codebase and normalized into a production-grade target model.

Observed in code today:

- Canonical Supabase RBAC tables already exist: `roles`, `permissions`, `role_permissions`, `school_memberships`.
- Newer modules already use permission keys cleanly: online tests, LMS, live classes, study planner, AI tutor, doubt solver, teacher AI, parent intelligence, predictions, BI, finance monetization, AI command center.
- Older ERP modules are mixed:
  - some use broad role checks,
  - some rely on legacy `admin`/`teacher` frontend routing,
  - some do not yet have a full per-action permission split.

Key evidence:

- Supabase RBAC foundation: [supabase/migrations/20260513_001_core_foundation.sql](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/supabase/migrations/20260513_001_core_foundation.sql)
- Role-permission mapping layer: [supabase/migrations/20260513_003_rbac_extensions.sql](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/supabase/migrations/20260513_003_rbac_extensions.sql)
- Backend permission middleware: [backend/app/middleware/auth.py](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/backend/app/middleware/auth.py)
- Frontend route gating: [frontend/src/App.tsx](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/App.tsx)
- Frontend role/permission resolution: [frontend/src/contexts/AuthProvider.tsx](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/contexts/AuthProvider.tsx)
- Sidebar/module exposure: [frontend/src/components/Layout.tsx](/abs/path/c:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/Layout.tsx)

Current human roles found directly or indirectly in implementation:

- `platform_admin`
- `school_admin`
- `teacher`
- `student`
- `parent`
- `store_manager`
- `staff`
- `viewer`
- legacy `admin`

Production target below expands that into the full Aspire Academy role catalog you requested.

## Canonical Roles

Recommended human roles:

1. `SUPER_ADMIN`
2. `PLATFORM_ADMIN`
3. `SCHOOL_ADMIN`
4. `ACADEMIC_HEAD`
5. `PRINCIPAL`
6. `EXAM_CONTROLLER`
7. `HOSTEL_WARDEN`
8. `INVENTORY_MANAGER`
9. `ACCOUNTANT`
10. `TEACHER`
11. `CLASS_TEACHER`
12. `ONLINE_TEST_MANAGER`
13. `LMS_MANAGER`
14. `COUNSELLOR`
15. `RECEPTIONIST`
16. `PARENT`
17. `STUDENT`

Optional non-human/system roles to keep separate from admin panel assignments:

- `SERVICE_ROLE`
- `AUDITOR`
- `READ_ONLY_ANALYST`

## Scope Model

Every permission should be evaluated with a scope, not just an action:

- `self`: own record only
- `linked`: parent-linked students only
- `assigned`: assigned classes/courses/tests/hostel blocks only
- `class`: advisory class only
- `school`: full tenant
- `platform`: all tenants

Recommended scope by role:

- `SUPER_ADMIN`: platform
- `PLATFORM_ADMIN`: platform
- `SCHOOL_ADMIN`: school
- `ACADEMIC_HEAD`: school academic scope
- `PRINCIPAL`: school oversight scope
- `EXAM_CONTROLLER`: school exam scope
- `HOSTEL_WARDEN`: hostel + resident scope
- `INVENTORY_MANAGER`: inventory + stock scope
- `ACCOUNTANT`: finance + fee scope
- `TEACHER`: assigned
- `CLASS_TEACHER`: class + assigned
- `ONLINE_TEST_MANAGER`: school assessment scope
- `LMS_MANAGER`: school LMS scope
- `COUNSELLOR`: student support scope
- `RECEPTIONIST`: front-office scope
- `PARENT`: linked
- `STUDENT`: self

## Permission Taxonomy

Production permission naming should be normalized as:

- `{module}.view`
- `{module}.create`
- `{module}.edit`
- `{module}.delete`
- `{module}.export`
- `{module}.approve`
- `{module}.publish`
- `{module}.analytics`
- `{module}.ai`

Example:

- `students.view`
- `students.edit`
- `online_tests.publish`
- `lms.analytics`
- `study_planner.ai`
- `predictions.analytics`

## Matrix Legend

Each cell below expands to the requested actions.

- `F` = View, Create, Edit, Delete, Export, Approve, Publish, Analytics, AI
- `M` = View, Create, Edit, Delete, Export, Analytics, AI
- `O` = View, Create, Edit, Export, Analytics, AI
- `P` = View, Create, Edit, Export, Publish, Analytics, AI
- `A` = View, Edit, Export, Approve, Analytics
- `V` = View, Export, Analytics
- `VS` = View only within self/linked scope, plus own analytics
- `S` = Self-service: View, Create, Edit own items, Export own data, Analytics, AI
- `T` = Test attempt flow: View, Create attempt, Edit/save attempt, Export own result, Analytics, AI
- `J` = Join/use session only: View, Join, limited export/history
- `-` = No access

## Complete RBAC Matrix

### 1. Governance And Leadership

| Module | SUPER_ADMIN | PLATFORM_ADMIN | SCHOOL_ADMIN | PRINCIPAL | ACADEMIC_HEAD |
|---|---|---|---|---|---|
| Students | F | F | F | A | O |
| Staff | F | F | F | A | V |
| Attendance | F | F | F | A | O |
| Timetable | F | F | F | A | P |
| Seating Plan | F | F | F | A | O |
| Exams | F | F | F | A | O |
| Online Tests | F | F | F | A | P |
| LMS | F | F | F | A | P |
| Hostel | F | F | F | V | V |
| Inventory | F | F | F | V | - |
| Reports | F | F | F | V | V |
| Finance | F | F | F | V | - |
| Parent Portal | F | F | F | V | V |
| AI Study Planner | F | F | F | V | O |
| AI Command Center | F | F | A | V | A |
| Parent Intelligence Portal | F | F | F | V | V |
| Future Risk Forecast | F | F | F | V | V |
| Data Warehouse Dashboard | F | F | V | V | V |
| Platform Dashboard | F | F | - | - | - |
| Live Classes | F | F | F | V | P |

### 2. Academic Operations

| Module | EXAM_CONTROLLER | ONLINE_TEST_MANAGER | LMS_MANAGER | TEACHER | CLASS_TEACHER |
|---|---|---|---|---|---|
| Students | V | V | V | V | O |
| Staff | V | V | V | V | V |
| Attendance | V | V | V | O | O |
| Timetable | O | V | V | V | V |
| Seating Plan | F | V | - | V | V |
| Exams | F | V | - | V | V |
| Online Tests | V | F | V | O | O |
| LMS | - | V | F | O | O |
| Hostel | - | - | - | - | V |
| Inventory | - | - | - | - | - |
| Reports | F | V | V | V | V |
| Finance | - | - | - | - | - |
| Parent Portal | - | - | - | - | V |
| AI Study Planner | V | V | O | O | O |
| AI Command Center | - | - | - | - | - |
| Parent Intelligence Portal | - | - | - | V | O |
| Future Risk Forecast | V | V | V | V | O |
| Data Warehouse Dashboard | V | V | V | V | V |
| Platform Dashboard | - | - | - | - | - |
| Live Classes | V | V | P | O | O |

### 3. Operations And Support

| Module | HOSTEL_WARDEN | INVENTORY_MANAGER | ACCOUNTANT | COUNSELLOR | RECEPTIONIST |
|---|---|---|---|---|---|
| Students | V | V | V | V | O |
| Staff | V | V | V | V | V |
| Attendance | V | - | - | V | V |
| Timetable | - | - | - | V | V |
| Seating Plan | - | - | - | - | - |
| Exams | - | - | - | V | - |
| Online Tests | - | - | - | V | - |
| LMS | - | - | - | V | - |
| Hostel | F | - | - | V | V |
| Inventory | V | F | V | - | - |
| Reports | V | V | V | V | V |
| Finance | - | V | F | - | O |
| Parent Portal | - | - | V | - | V |
| AI Study Planner | V | - | - | O | - |
| AI Command Center | - | - | - | - | - |
| Parent Intelligence Portal | V | - | - | O | - |
| Future Risk Forecast | V | V | V | O | - |
| Data Warehouse Dashboard | V | V | V | V | - |
| Platform Dashboard | - | - | - | - | - |
| Live Classes | - | - | - | V | - |

### 4. End Users

| Module | PARENT | STUDENT |
|---|---|---|
| Students | VS | VS |
| Staff | - | - |
| Attendance | VS | VS |
| Timetable | VS | VS |
| Seating Plan | - | VS |
| Exams | VS | VS |
| Online Tests | VS | T |
| LMS | VS | S |
| Hostel | VS | VS |
| Inventory | - | - |
| Reports | VS | VS |
| Finance | S | VS |
| Parent Portal | S | - |
| AI Study Planner | VS | S |
| AI Command Center | - | - |
| Parent Intelligence Portal | S | - |
| Future Risk Forecast | VS | VS |
| Data Warehouse Dashboard | - | - |
| Platform Dashboard | - | - |
| Live Classes | J | S |

## Role Notes

### STUDENT

Can:

- view own attendance, timetable, seat allotment, results, LMS progress, hostel status
- attempt online tests
- join live classes
- use AI study planner and student-facing AI help

Cannot:

- edit attendance records
- publish tests or LMS content
- access finance admin, inventory, staff, platform, warehouse, or command-center modules

### PARENT

Can:

- view linked student attendance, timetable, exam schedules, results, LMS progress, hostel status
- view and pay fee data for linked students
- access parent portal and parent intelligence insights
- view predictive risk and planner outputs for linked students

Cannot:

- modify academic master data
- publish content
- access platform, inventory, warehouse, or internal staff tools

### TEACHER

Can:

- mark student attendance
- view own timetable and assigned class context
- create/edit assigned online tests
- upload/manage assigned LMS content
- host live classes
- use teacher-facing AI and class-level insights where assigned

Cannot:

- delete students or staff master records
- access finance administration
- access platform administration

## Mandatory Roles For Aspire Academy

These roles should exist in every production deployment:

1. `SUPER_ADMIN`
2. `PLATFORM_ADMIN`
3. `SCHOOL_ADMIN`
4. `TEACHER`
5. `STUDENT`
6. `PARENT`
7. `ACCOUNTANT`
8. `EXAM_CONTROLLER`

Strongly recommended for day-1 if hostel, inventory, LMS, or online tests are active:

1. `CLASS_TEACHER`
2. `ONLINE_TEST_MANAGER`
3. `LMS_MANAGER`
4. `HOSTEL_WARDEN`
5. `INVENTORY_MANAGER`
6. `RECEPTIONIST`

## Roles That Can Be Merged Initially

Safe merges for early rollout:

1. `PRINCIPAL` + `ACADEMIC_HEAD`
2. `TEACHER` + `CLASS_TEACHER`
3. `ONLINE_TEST_MANAGER` + `LMS_MANAGER`
4. `HOSTEL_WARDEN` + `COUNSELLOR` if hostel is small
5. `ACCOUNTANT` + `RECEPTIONIST` only in very small schools
6. `SUPER_ADMIN` + `PLATFORM_ADMIN` if this is a single-owner deployment

Do not merge unless absolutely necessary:

1. `SCHOOL_ADMIN` with `ACCOUNTANT`
2. `SCHOOL_ADMIN` with `INVENTORY_MANAGER`
3. `PLATFORM_ADMIN` with ordinary school roles

## Modules Hidden From Students

Students should not see these modules in navigation:

1. Staff
2. Inventory
3. Reports admin workspace
4. Finance admin workspace
5. Parent Portal
6. AI Command Center
7. Parent Intelligence Portal
8. Data Warehouse Dashboard
9. Platform Dashboard
10. Role & Security / Access Control

Students may see restricted self-only views of:

1. Students
2. Seating Plan
3. Exams
4. Reports
5. Finance

## Modules Hidden From Parents

Parents should not see these modules in navigation:

1. Staff
2. Attendance admin workspace
3. Timetable admin workspace
4. Seating generation and plan management
5. Inventory
6. Reports admin workspace
7. AI Command Center
8. Data Warehouse Dashboard
9. Platform Dashboard
10. Role & Security / Access Control

Parents may see linked-student-only views of:

1. Students
2. Attendance
3. Timetable
4. Exams
5. Online Tests
6. LMS
7. Hostel
8. Finance
9. Study Planner
10. Parent Intelligence
11. Future Risk Forecast
12. Live Classes

## Recommended Fresh Deployment Defaults

Default role-permission setup for a new school:

1. `PLATFORM_ADMIN`
   - full platform access
2. `SCHOOL_ADMIN`
   - full school access except platform dashboard
3. `ACCOUNTANT`
   - finance full, reports view/export, no student/staff deletion
4. `EXAM_CONTROLLER`
   - exams, seating, reports
5. `TEACHER`
   - attendance mark, timetable view, LMS assigned manage, online test assigned manage, live classes
6. `CLASS_TEACHER`
   - teacher bundle plus class-level student oversight and parent-intelligence view
7. `STUDENT`
   - self-service only
8. `PARENT`
   - linked-student only

Fresh deployment hardening rules:

1. Default all non-admin roles to deny-by-default.
2. Require explicit assignment for `approve`, `publish`, and `delete`.
3. Separate finance deletion from finance editing.
4. Separate school-level reporting from platform-level reporting.
5. Keep platform routes completely isolated from school admins.
6. Require audit logging for all `delete`, `approve`, `publish`, and bulk actions.
7. Require second-level approval for bulk delete and AI-triggered operational actions.

## Recommended Implementation Upgrades

To align the current app with this target RBAC model:

1. Replace legacy `admin` route assumptions with canonical `role_key` plus permission checks everywhere.
2. Split older ERP modules into action-level permissions:
   - `students.*`
   - `staff.*`
   - `attendance.*`
   - `timetable.*`
   - `seating_plan.*`
   - `exams.*`
   - `hostel.*`
   - `inventory.*`
   - `reports.*`
   - `finance.*`
3. Add scope-aware guards for `self`, `linked`, `assigned`, `class`, `school`, and `platform`.
4. Move hostel and inventory off broad role checks and onto permission keys.
5. Keep frontend menu visibility and backend enforcement driven from the same permission catalog.

## Best-Fit Mapping From Current Roles

For migration from the current codebase:

- legacy `admin` -> `SCHOOL_ADMIN` or `PLATFORM_ADMIN` based on membership scope
- `teacher` -> `TEACHER`
- `store_manager` -> `INVENTORY_MANAGER`
- `student` -> `STUDENT`
- `parent` -> `PARENT`
- `staff` -> `RECEPTIONIST` or `COUNSELLOR` or general school staff custom role
- `viewer` -> `READ_ONLY_ANALYST` or a reduced read-only school role

