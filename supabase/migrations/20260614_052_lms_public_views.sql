-- Workaround: lms schema is not exposed in PostgREST.
-- These public views let the service_role access LMS data through the public schema.
-- Drop and recreate each time so they stay in sync.

begin;

create or replace view public.lms_courses
  with (security_invoker = false)
  as select * from lms.courses;
create or replace view public.lms_course_modules
  with (security_invoker = false)
  as select * from lms.course_modules;
create or replace view public.lms_lessons
  with (security_invoker = false)
  as select * from lms.lessons;
create or replace view public.lms_lesson_resources
  with (security_invoker = false)
  as select * from lms.lesson_resources;
create or replace view public.lms_student_progress
  with (security_invoker = false)
  as select * from lms.student_progress;
create or replace view public.lms_assignments
  with (security_invoker = false)
  as select * from lms.assignments;
create or replace view public.lms_assignment_submissions
  with (security_invoker = false)
  as select * from lms.assignment_submissions;

-- The views are owned by the migration user (supabase_admin), so they inherit
-- full access to the underlying lms.* tables.  The service_role key used by
-- the backend bypasses RLS, so all operations (select/insert/update/delete)
-- will be forwarded to the base tables through the auto-updatable views.

notify pgrst, 'reload schema';

commit;
