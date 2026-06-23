## Scope Engine Audit Phase 2

Date: 2026-06-21
Modules: Student Directory, Parent Portal, LMS, Online Tests, Reports
Status at capture: Pre-change baseline

| Module | File | Function | Current Permission | Current Behavior | Expected Scope Behavior | Pre-Change Status |
| --- | --- | --- | --- | --- | --- | --- |
| Student Directory | `backend/app/routes/students.py` | `download_student_template` | `admin_office.students` via router include | Template download available once module permission is granted | `school/platform` only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `import_students` | `admin_office.students` | Bulk import runs school-wide | `school/platform` only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `create_student` | `admin_office.students` | Create runs school-wide | `school/platform`, optionally assigned editor only if batch-bound | FAIL |
| Student Directory | `backend/app/routes/students.py` | `list_students` | `admin_office.students` | Returns school-wide student list | `own` self only, `assigned` teacher batches only, `school/platform` unrestricted | FAIL |
| Student Directory | `backend/app/routes/students.py` | `get_students_count` | `admin_office.students` | Returns school-wide count | Scope-limited count | FAIL |
| Student Directory | `backend/app/routes/students.py` | `list_hostel_requests` | `admin_office.students` | Returns school-wide hostel requests | Assigned/school/platform only; no self/parent-wide browsing | FAIL |
| Student Directory | `backend/app/routes/students.py` | `create_or_update_hostel_request` | `admin_office.students` | Can create/update by student id without scope check | Self student only, assigned editor only, school/platform unrestricted | FAIL |
| Student Directory | `backend/app/routes/students.py` | `approve_hostel_request` | `admin_office.students` | School-wide approval | Assigned editor or school/platform only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `move_hostel_allocation` | `admin_office.students` | School-wide move | Assigned editor or school/platform only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `reject_hostel_request` | `admin_office.students` | School-wide reject | Assigned editor or school/platform only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `vacate_hostel_allocation` | `admin_office.students` | School-wide vacate | Assigned editor or school/platform only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `transfer_students_to_batch` | `admin_office.students` | School-wide transfer | Assigned editor or school/platform only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `get_student` | `admin_office.students` | Returns any student by id | `own` self only, `assigned` teacher batches only, `school/platform` unrestricted | FAIL |
| Student Directory | `backend/app/routes/students.py` | `bulk_delete_students` | `admin_office.students` | Bulk delete for arbitrary ids | `school/platform` only, optionally assigned editor if all ids in scope | FAIL |
| Student Directory | `backend/app/routes/students.py` | `update_student` | `admin_office.students` | Updates any student | `own` self only where safe, `assigned` teacher batches only, `school/platform` unrestricted | FAIL |
| Student Directory | `backend/app/routes/students.py` | `delete_student` | `admin_office.students` | Deletes any student | `school/platform` only | FAIL |
| Student Directory | `backend/app/routes/students.py` | `delete_all_students` | `admin_office.students` | Platform admin deletes immediately; others create approval request | `platform` immediate delete, `school` approval/school-wide only, no assigned/self delete-all | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_list_children` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked resolution only in service; admin/platform not scoped through portal view | Parent linked children only, school/platform explicit broader access | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_dashboard` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked dashboard only | Parent linked children only, school/platform broader read | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_academic_progress` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked children filtered by optional student id | Parent linked children only, school/platform broader read | PARTIAL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_attendance` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked children filtered by optional student id | Parent linked children only, school/platform broader read | PARTIAL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_test_results` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked children filtered by optional student id | Parent linked children only, school/platform broader read | PARTIAL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_assignments` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked children filtered by optional student id | Parent linked children only, school/platform broader read | PARTIAL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_alerts` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked children filtered by optional student id | Parent linked children only, school/platform broader read | PARTIAL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_ai_ask` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked child context only by service | Parent linked children only, school/platform broader read | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_recommendations` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked child context only by service | Parent linked children only, school/platform broader read | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_parent_insights` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked view only | Parent linked children only, school/platform broader read | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_get_parent_risk_scores` | `parent_intelligence.*` / `edupay.parent_portal` | Parent-linked view only | Parent linked children only, school/platform broader read | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_acknowledge_parent_alert` | `parent_intelligence.*` / `edupay.parent_portal` | Parent profile passed; no explicit route-level child scope check | Parent linked children only, school/platform broader action | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_contact_teacher` | `parent_intelligence.*` / `edupay.parent_portal` | Accepts any student id | Parent linked children only, school/platform broader action | FAIL |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_request_parent_meeting` | `parent_intelligence.*` / `edupay.parent_portal` | Accepts any student id | Parent linked children only, school/platform broader action | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_list_courses` | `lms.view/progress/assignments/manage` or `edupay.parent_portal` | Student self-scoped; teacher/admin broad | Student self only, parent linked children only, teacher assigned data only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_create_course` | `lms.manage` | Teacher/admin create without assigned-scope guard | Teacher editor assigned editing only; school/platform broader | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_get_course` | `lms.view/...` | Student self-scoped; teacher/admin broad | Student self only, parent linked children only, teacher assigned data only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_update_course` | `lms.manage` | Teacher/admin can update any course | Teacher editor assigned editing only; school/platform broader | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_delete_course` | `lms.manage` | Teacher/admin can delete any course | Teacher editor assigned editing only; school/platform broader | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_list_modules` | `lms.view/...` | Broad after permission | Teacher assigned data only unless school/platform | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_create_module` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_update_module` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_delete_module` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_list_lessons` | `lms.view/...` | Broad after permission | Teacher assigned data only unless school/platform | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_create_lesson` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_get_lesson` | `lms.view/...` | Student self-scoped; teacher/admin broad | Student self only, parent linked children only, teacher assigned data only | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_update_lesson` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_delete_lesson` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_get_progress` | `lms.progress/view` or `edupay.parent_portal` | Student self and parent linked children already handled; teacher/admin can target arbitrary child | Student self only, parent linked children only, teacher assigned students only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_update_progress` | `lms.progress/view` | Student self only | Student self only | PASS |
| LMS | `backend/app/routes/lms.py` | `api_list_revision_tracker` | `lms.progress/view` or `edupay.parent_portal` | Student self and parent linked children already handled; teacher/admin can target arbitrary child | Student self only, parent linked children only, teacher assigned students only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_upsert_revision_tracker` | `lms.progress/view` | Student self only | Student self only | PASS |
| LMS | `backend/app/routes/lms.py` | `api_list_assignments` | `lms.assignments/progress/manage` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_create_assignment` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_get_assignment` | `lms.assignments/progress/manage` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| LMS | `backend/app/routes/lms.py` | `api_update_assignment` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_delete_assignment` | `lms.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| LMS | `backend/app/routes/lms.py` | `api_submit_assignment` | `lms.assignments/progress/manage` | Student self only | Student self only | PASS |
| LMS | `backend/app/routes/lms.py` | `api_grade_assignment_submission` | `lms.manage` | Broad after permission | Teacher editor assigned grading only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_tests` | `online_tests.view/attempt/manage/grade/reports` | Student self-scoped by batch; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_get_test` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_update_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_delete_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_test_questions` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_test_question` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_question_bank` | `online_tests.manage` | Broad question bank read | Teacher assigned/editor data only unless school/platform | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_question_bank` | `online_tests.manage` | Broad question bank create | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_import_question_bank` | `online_tests.manage` | Broad question bank import | School/platform or assigned editor only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_generate_ai_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_update_question` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_delete_question` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_publish_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_close_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_duplicate_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_unpublish_test` | `online_tests.manage` | Broad after permission | Teacher editor assigned editing only | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_start_attempt` | `online_tests.attempt` | Student self only | Student self only | PASS |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_attempt` | `online_tests.attempt` | Student self only | Student self only | PASS |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_attempts` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_get_attempt` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_save_attempt` | `online_tests.attempt` | Student self only | Student self only | PASS |
| Online Tests | `backend/app/routes/online_tests.py` | `api_submit_attempt` | `online_tests.attempt` | Student self only | Student self only | PASS |
| Online Tests | `backend/app/routes/online_tests.py` | `api_results_analytics` | `online_tests.reports` | Platform overrides handled; teacher/admin school-wide | Teacher assigned data only unless school/platform | FAIL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_get_result` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_results` | `online_tests.view/...` | Student self-scoped; teacher/admin broad | Student self only, teacher assigned data only, school/platform broader | PARTIAL |
| Reports | `backend/app/routes/reports.py` | `export_pdf` | `admin_office.reports` or seating permissions via router include | Exports any seating plan in school context | Assigned scope unsupported; school/platform only | FAIL |
| Reports | `backend/app/routes/reports.py` | `export_excel` | `admin_office.reports` or seating permissions via router include | Exports any seating plan in school context | Assigned scope unsupported; school/platform only | FAIL |
| Reports | `backend/app/routes/reports.py` | `export_all_rooms_excel` | `admin_office.reports` or seating permissions via router include | Exports all plans for exam in school context | Assigned scope unsupported; school/platform only | FAIL |

### Implementation Note

Phase 2 will use the existing `scope_engine` and existing Portal Access Manager scope metadata only. No schema changes, no UI redesign, and no permission removals.

## Post-Change PASS/FAIL

| Module | Function | Post-Change Status | Notes |
| --- | --- | --- | --- |
| Student Directory | `download_student_template` | PASS | Restricted to school-wide scope only. |
| Student Directory | `import_students` | PASS | Restricted to school-wide scope only. |
| Student Directory | `create_student` | PASS | Supports school-wide and assigned-batch scoped creation. |
| Student Directory | `list_students` | PASS | Filters visible students by own or assigned scope. |
| Student Directory | `get_students_count` | PASS | Returns scope-limited counts for narrow scopes. |
| Student Directory | `list_hostel_requests` | PASS | Own scope blocked; assigned and school scopes filtered to in-scope students. |
| Student Directory | `create_or_update_hostel_request` | PASS | Student target validated against scope. |
| Student Directory | `approve_hostel_request` | PASS | Own scope blocked; target student validated before approval. |
| Student Directory | `move_hostel_allocation` | PASS | Own scope blocked; target student validated before move. |
| Student Directory | `reject_hostel_request` | PASS | Own scope blocked; target student validated before rejection. |
| Student Directory | `vacate_hostel_allocation` | PASS | Own scope blocked; target student validated before vacate. |
| Student Directory | `transfer_students_to_batch` | PASS | Transfer set must stay within assigned or school scope. |
| Student Directory | `get_student` | PASS | Direct student fetch now scope-validated. |
| Student Directory | `bulk_delete_students` | PASS | Bulk delete set must stay within assigned or school scope. |
| Student Directory | `update_student` | PASS | Existing and updated student targets now scope-validated. |
| Student Directory | `delete_student` | PASS | Direct student delete now scope-validated. |
| Student Directory | `delete_all_students` | PASS | Restricted to school-wide scope. |
| Parent Portal | `api_list_children` | PASS | Parent sees linked children only; admin/platform can view school scope. |
| Parent Portal | `api_get_dashboard` | PASS | Dashboard now resolves visible students from scope before aggregation. |
| Parent Portal | `api_get_academic_progress` | PASS | Student selection validated against visible scope. |
| Parent Portal | `api_get_attendance` | PASS | Student selection validated against visible scope. |
| Parent Portal | `api_get_test_results` | PASS | Student selection validated against visible scope. |
| Parent Portal | `api_get_assignments` | PASS | Student selection validated against visible scope. |
| Parent Portal | `api_get_alerts` | PASS | Student selection validated against visible scope. |
| Parent Portal | `api_ai_ask` | PASS | AI prompt construction is now bound to the route-resolved visible student set before chat generation. |
| Parent Portal | `api_get_recommendations` | PASS | Recommendations now derive from scope-visible students. |
| Parent Portal | `api_get_parent_insights` | PASS | Insights now build from scope-visible students. |
| Parent Portal | `api_get_parent_risk_scores` | PASS | Risk payload now builds from scope-visible students. |
| Parent Portal | `api_acknowledge_parent_alert` | PASS | Alert acknowledgement now validates linked child scope and alert ownership before update. |
| Parent Portal | `api_contact_teacher` | PASS | Student target validated against visible scope before logging contact request. |
| Parent Portal | `api_request_parent_meeting` | PASS | Student target validated against visible scope before logging meeting request. |
| LMS | `api_list_courses` | PASS | Teacher and narrow scopes now filter courses by creator or assigned batch. |
| LMS | `api_create_course` | PASS | Create path now checks assigned-batch targeting. |
| LMS | `api_get_course` | PASS | Course read now scope-validated. |
| LMS | `api_update_course` | PASS | Course edit now scope-validated. |
| LMS | `api_delete_course` | PASS | Course delete now scope-validated. |
| LMS | `api_list_modules` | PASS | Module listing now anchored to a scope-valid course. |
| LMS | `api_create_module` | PASS | Module create now anchored to a scope-valid course. |
| LMS | `api_update_module` | PASS | Module edit now anchored to a scope-valid course. |
| LMS | `api_delete_module` | PASS | Module delete now anchored to a scope-valid course. |
| LMS | `api_list_lessons` | PASS | Lesson listing now anchored to a scope-valid course or module. |
| LMS | `api_create_lesson` | PASS | Lesson create now anchored to a scope-valid course. |
| LMS | `api_get_lesson` | PASS | Lesson read now anchored to a scope-valid course. |
| LMS | `api_update_lesson` | PASS | Lesson edit now anchored to a scope-valid course. |
| LMS | `api_delete_lesson` | PASS | Lesson delete now anchored to a scope-valid course. |
| LMS | `api_get_progress` | PASS | Student targets are now validated against own, linked-child, assigned, school, or platform scope. |
| LMS | `api_update_progress` | PASS | Student self-only behavior preserved. |
| LMS | `api_list_revision_tracker` | PASS | Student targets are now validated against own, linked-child, assigned, school, or platform scope. |
| LMS | `api_upsert_revision_tracker` | PASS | Student self-only behavior preserved. |
| LMS | `api_list_assignments` | PASS | Teacher and narrow scopes now filter assignments through course scope. |
| LMS | `api_create_assignment` | PASS | Assignment create now anchored to a scope-valid course. |
| LMS | `api_get_assignment` | PASS | Assignment read now anchored to a scope-valid course. |
| LMS | `api_update_assignment` | PASS | Assignment edit now anchored to a scope-valid course. |
| LMS | `api_delete_assignment` | PASS | Assignment delete now anchored to a scope-valid course. |
| LMS | `api_submit_assignment` | PASS | Student self-only behavior preserved. |
| LMS | `api_grade_assignment_submission` | PASS | Grading now anchored to a scope-valid course and in-scope student. |
| Online Tests | `api_list_tests` | PASS | Teacher and narrow scopes now filter tests by creator or assigned batch. |
| Online Tests | `api_create_test` | PASS | Test creation now validates target batch/class against assigned scope before create. |
| Online Tests | `api_get_test` | PASS | Test read now scope-validated. |
| Online Tests | `api_update_test` | PASS | Test edit now scope-validated. |
| Online Tests | `api_delete_test` | PASS | Test delete now scope-validated. |
| Online Tests | `api_list_test_questions` | PASS | Question listing now anchored to a scope-valid test. |
| Online Tests | `api_create_test_question` | PASS | Question create now anchored to a scope-valid test. |
| Online Tests | `api_list_question_bank` | PASS | Own scope remains blocked and assigned-scope teachers now see only creator-owned bank items. |
| Online Tests | `api_create_question_bank` | PASS | Narrow-scope creation now requires an assigned-profile context; school/platform behavior is preserved. |
| Online Tests | `api_import_question_bank` | PASS | Own scope remains blocked and assigned-scope imports now require an assigned-profile context. |
| Online Tests | `api_generate_ai_test` | PASS | AI-generated tests now validate target batch/class against assigned scope before generation. |
| Online Tests | `api_update_question` | PASS | Question update now resolves the source test and enforces assigned or broader test scope first. |
| Online Tests | `api_delete_question` | PASS | Question delete now resolves the source test and enforces assigned or broader test scope first. |
| Online Tests | `api_publish_test` | PASS | Publish now requires the test to be in scope. |
| Online Tests | `api_close_test` | PASS | Close now requires the test to be in scope. |
| Online Tests | `api_duplicate_test` | PASS | Duplicate now requires the source test to be in scope. |
| Online Tests | `api_unpublish_test` | PASS | Unpublish now requires the test to be in scope. |
| Online Tests | `api_start_attempt` | PASS | Student self-only behavior preserved. |
| Online Tests | `api_create_attempt` | PASS | Student self-only behavior preserved. |
| Online Tests | `api_list_attempts` | PASS | Teacher and narrow scopes now filter attempts through test scope. |
| Online Tests | `api_get_attempt` | PASS | Attempt reads now validate the parent test scope for non-students. |
| Online Tests | `api_save_attempt` | PASS | Student self-only behavior preserved. |
| Online Tests | `api_submit_attempt` | PASS | Student self-only behavior preserved. |
| Online Tests | `api_results_analytics` | PASS | Analytics now split by student, parent, assigned teacher, school admin, and platform admin scope with filtered aggregation. |
| Online Tests | `api_get_result` | PASS | Result reads now validate the parent test scope for non-students. |
| Online Tests | `api_list_results` | PASS | Teacher and narrow scopes now filter results through test scope. |
| Reports | `export_pdf` | PASS | Restricted to school-wide report scope. |
| Reports | `export_excel` | PASS | Restricted to school-wide report scope. |
| Reports | `export_all_rooms_excel` | PASS | Restricted to school-wide report scope. |

## Scope Completion Sprint Audit

Date: 2026-06-22
Modules: Parent Portal, Online Tests
Status at capture: Pre-change baseline for remaining FAIL endpoints

| Module | File | Function | Permission | Current Scope Behavior | Expected Scope Behavior |
| --- | --- | --- | --- | --- | --- |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_ai_ask` | `parent_intelligence.view` / `parent_intelligence.reports` / `edupay.parent_portal` | Route validates selected student, but AI context still delegates to parent-only service resolution and does not explicitly bind the final AI payload to the already-resolved visible-student set. | Parent AI context must contain linked children only for parent scope; no unrelated child, school-wide, or cross-family analytics may enter the prompt. |
| Parent Portal | `backend/app/routes/parent_portal.py` | `api_acknowledge_parent_alert` | `parent_intelligence.view` / `parent_intelligence.reports` / `edupay.parent_portal` | Route forwards directly to alert acknowledgement without verifying alert ownership against the linked-child set. | Parent may acknowledge alerts only for linked children, after verifying alert ownership, student ownership, and parent-child linkage. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_test` | `online_tests.manage` | Teacher editors can still create tests without validating target batch/class against assigned scope. | Teacher editors may create tests only for assigned batches/classes; school admin is school-wide; platform admin is cross-school. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_list_question_bank` | `online_tests.manage` | Question bank access blocks own-scope only, but still exposes school-wide shared bank data to assigned-scope teachers. | Assigned-scope teachers may browse only scope-safe question-bank content; school admin is school-wide; platform admin is cross-school. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_create_question_bank` | `online_tests.manage` | Question bank create relies on manage permission alone with no additional ownership/scope guard. | Teacher editors may create scope-safe question-bank entries only within assigned scope; school/platform remain broader. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_import_question_bank` | `online_tests.manage` | Import blocks own-scope only, but assigned-scope constraints are not fully enforced. | Teacher editors may import only scope-safe question-bank content within assigned scope; school/platform remain broader. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_generate_ai_test` | `online_tests.manage` | AI-generated tests still rely on manage permission alone and do not validate target batch/class before generation. | Teacher editors may generate AI tests only for assigned batches/classes; school/platform remain broader. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_update_question` | `online_tests.manage` | Question update path does not yet validate the parent test against assigned scope. | Teacher editors may update test questions only when the source test is inside assigned scope; school/platform remain broader. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_delete_question` | `online_tests.manage` | Question delete path does not yet validate the parent test against assigned scope. | Teacher editors may delete test questions only when the source test is inside assigned scope; school/platform remain broader. |
| Online Tests | `backend/app/routes/online_tests.py` | `api_results_analytics` | `online_tests.reports` | Test-specific analytics are scoped, but broad analytics without a single test still aggregate beyond student/parent/assigned boundaries. | Student own only; parent linked children only; teacher viewer/editor assigned classes only; school admin school-wide; platform admin cross-school. |

## Scope Completion Sprint Result

Date: 2026-06-22
Modules: Parent Portal, Online Tests
Status at capture: Post-implementation verification

| Module | Endpoint | Permission | Scope Applied | Ownership Checks | Result |
| --- | --- | --- | --- | --- | --- |
| Parent Portal | `api_ai_ask` | `parent_intelligence.view` / `parent_intelligence.reports` / `edupay.parent_portal` | Parent linked children only; school/platform broader read preserved | Requested `student_id` must resolve inside the already-visible student set before AI prompt construction | PASS |
| Parent Portal | `api_acknowledge_parent_alert` | `parent_intelligence.view` / `parent_intelligence.reports` / `edupay.parent_portal` | Parent linked children only; school/platform broader action preserved | Alert row is loaded first, then child linkage and `parent_profile_id` ownership are verified before acknowledgement | PASS |
| Online Tests | `api_create_test` | `online_tests.manage` | Teacher editor assigned batches/classes only; school admin school-wide; platform admin broader | Target batch/class must match assigned scope before create | PASS |
| Online Tests | `api_list_question_bank` | `online_tests.manage` | Own scope blocked; assigned teacher scope narrowed; school/platform broader | Assigned-scope listing is filtered to creator-owned question-bank rows | PASS |
| Online Tests | `api_create_question_bank` | `online_tests.manage` | Assigned teacher scope allowed with profile-bound ownership context; school/platform broader | Narrow-scope create requires a valid scoped profile context | PASS |
| Online Tests | `api_import_question_bank` | `online_tests.manage` | Own scope blocked; assigned teacher scope allowed with profile-bound ownership context; school/platform broader | Narrow-scope import requires a valid scoped profile context | PASS |
| Online Tests | `api_generate_ai_test` | `online_tests.manage` | Teacher editor assigned batches/classes only; school admin school-wide; platform admin broader | Target batch/class must match assigned scope before AI generation | PASS |
| Online Tests | `api_update_question` | `online_tests.manage` | Teacher editor assigned test scope only; school/platform broader | Question resolves to parent test, then source test scope is enforced before update | PASS |
| Online Tests | `api_delete_question` | `online_tests.manage` | Teacher editor assigned test scope only; school/platform broader | Question resolves to parent test, then source test scope is enforced before delete | PASS |
| Online Tests | `api_results_analytics` | `online_tests.reports` / `online_tests.view` / `online_tests.attempt` / `edupay.parent_portal` | Student own only; parent linked children only; teacher assigned classes only; school admin school-wide; platform admin global/school | Student profile resolution, parent linked-child resolution, and assigned-test filtering all gate aggregation before analytics are returned | PASS |
