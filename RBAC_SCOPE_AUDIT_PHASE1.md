## Scope Engine Audit Phase 1

Date: 2026-06-21
Scope: Sprint A `Attendance`, Sprint B `Timetable`

| Module | File | Function | Permission | Scope Applied | Current Behavior | Expected Behavior | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Attendance | `backend/app/attendance/native/router.py` | `get_overview` | `attendance.overview` | `school/platform` unrestricted, narrower scopes still permission-gated | Overview now requires attendance overview permission and authenticated scope context | Read overview only when permission exists; no direct school override from frontend | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_integrated_overview_route` | `attendance.overview` | `school/platform` unrestricted, narrower scopes still permission-gated | Same scope dependency as overview | Integrated overview must respect backend permission and scope context | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_students_route` | `attendance.student` | `own`, `assigned`, `school`, `platform` | Student list is filtered to actor-linked students or assigned teacher batches unless school-wide | User must not browse all students outside allowed scope | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_integrated_students_route` | `attendance.student` | `own`, `assigned`, `school`, `platform` | Integrated student list is filtered by scope | Same as above for integrated list | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_staff_route` | `attendance.staff` | `own/assigned` filtered, `school/platform` unrestricted | Staff list is filtered to own staff record or department unless school-wide | User must not browse unrelated staff | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_integrated_staff_route` | `attendance.staff` | `own/assigned` filtered, `school/platform` unrestricted | Integrated staff list is filtered by scope | Same as above for integrated staff list | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_settings_route` | `attendance.overview` | `school/platform` only | Narrow scopes are blocked from attendance settings | Settings must stay school-admin level | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `update_settings_route` | `attendance.overview` | `school/platform` only | Narrow scopes are blocked from attendance settings updates | Settings mutation must stay school-admin level | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_batch_current_class_route` | `attendance.student` | `assigned` batch enforcement, `own` denied, `school/platform` unrestricted | Teacher-assigned scope can only resolve batches on their timetable | Actor must not inspect unrelated class context | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_batch_day_classes_route` | `attendance.student` | `assigned` batch enforcement, `own` denied, `school/platform` unrestricted | Day-class lookup is batch-scoped for assigned users | Actor must not inspect unrelated class schedules from attendance | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_student_marking_route` | `attendance.student` | `assigned` batch enforcement, `own` denied, `school/platform` unrestricted | Marking screen load is restricted to assigned batches | Actor must not open marking for unrelated classes | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `save_student_marking_route` | `attendance.student` | `assigned` batch enforcement via submitted student IDs, `own` denied, `school/platform` unrestricted | Save path validates submitted students against assigned batches | Frontend cannot post attendance for unrelated batches | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_student_records_route` | `attendance.student` | `own`, `assigned`, `school`, `platform` | Student records are filtered by linked students or assigned teacher batches | Actor must not read unrelated attendance history | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_student_dashboard_route` | `attendance.student` | `own`, `assigned`, `school`, `platform` | Restricted scopes aggregate only filtered records; school-wide uses existing service summary | Dashboard totals must reflect only the actor’s allowed slice | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_student_calendar_route` | `attendance.student` | `own`, `assigned`, `school`, `platform` | Restricted scopes aggregate only filtered records; school-wide uses existing service calendar | Calendar must reflect only allowed students/batches | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `delete_student_record_route` | `attendance.student` | `school/platform` only | Narrow scopes are blocked from destructive delete | Destructive student attendance deletion must remain school-wide | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `delete_all_student_records_route` | `attendance.student` | `school/platform` only | Narrow scopes are blocked from bulk delete | Bulk destructive attendance deletion must remain school-wide | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_staff_records_route` | `attendance.staff` | `own/assigned` filtered, `school/platform` unrestricted | Staff attendance records are filtered to own record or department unless school-wide | Actor must not read unrelated staff attendance history | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_staff_dashboard_route` | `attendance.staff` | `school/platform` only | Narrow scopes are blocked from staff dashboard summary | Staff-wide analytics must remain school-wide | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `get_staff_marking_route` | `attendance.staff` | `assigned` department enforcement, `school/platform` unrestricted | Non-school-wide scope can only load its own department | Actor must not mark/view unrelated staff groups | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `save_staff_marking_route` | `attendance.staff` | `school/platform` only | Narrow scopes are blocked from staff attendance writes | Staff attendance mutation must remain school-wide for now | PASS |
| Attendance | `backend/app/attendance/native/router.py` | `list_leaves_route` | `attendance.leaves` | permission and actor context enforced | Leaves route now receives backend scope context before service execution | Leaves access must not rely on frontend-only assumptions | PASS |
| Timetable | `backend/app/routes/timetable.py` | `list_timetable_entries` | `timetable.view` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Restricted scope can only read rows for the actor’s staff member record | Actor must not browse the full school timetable | PASS |
| Timetable | `backend/app/routes/timetable.py` | `get_timetable_entries_count` | `timetable.view` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Count is derived from filtered rows | Count must reflect visible scope only | PASS |
| Timetable | `backend/app/routes/timetable.py` | `export_timetable` | `timetable.view` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Export is limited to actor-owned timetable rows unless school-wide | Export must not leak unrelated timetable rows | PASS |
| Timetable | `backend/app/routes/timetable.py` | `get_timetable_entry` | `timetable.view` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Single-entry read validates teacher ownership before returning | Entry read must not bypass filtered list rules | PASS |
| Timetable | `backend/app/routes/timetable.py` | `create_timetable_entry` | `timetable.manage` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Restricted scope can only create entries for its own teacher ID | Actor must not create timetable rows for other teachers | PASS |
| Timetable | `backend/app/routes/timetable.py` | `update_timetable_entry` | `timetable.manage` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Existing entry ownership and next teacher assignment are both validated | Actor must not reassign or mutate unrelated timetable rows | PASS |
| Timetable | `backend/app/routes/timetable.py` | `delete_timetable_entry` | `timetable.manage` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Delete validates entry ownership before mutation | Actor must not delete unrelated timetable rows | PASS |
| Timetable | `backend/app/routes/timetable.py` | `delete_all_timetable_entries` | `timetable.manage` | `school/platform` only | Narrow scopes are blocked from bulk delete | Bulk timetable destruction must remain school-wide | PASS |
| Timetable | `backend/app/routes/timetable.py` | `check_conflict` | `timetable.manage` | `assigned/own` teacher enforcement, `school/platform` unrestricted | Conflict validation only accepts the actor’s teacher ID unless school-wide | Actor must not probe another teacher’s schedule | PASS |
| Timetable | `backend/app/routes/timetable.py` | `upload_timetable_excel` | `timetable.manage` | `school/platform` only | Bulk import is blocked for narrow scopes | High-risk bulk import must remain school-wide | PASS |

### Pending rollout

| Module | State |
| --- | --- |
| Student Directory | Pending phase after attendance/timetable |
| LMS | Pending phase after attendance/timetable |
| Online Tests | Pending phase after attendance/timetable |
| Parent Portal | Pending phase after attendance/timetable |
| Reports | Pending phase after attendance/timetable |
