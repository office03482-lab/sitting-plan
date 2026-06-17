-- Workaround: online_tests schema is not exposed in PostgREST.
-- These public views let the service_role access online_tests data through the public schema.

begin;

create or replace view public.online_test_tests
  with (security_invoker = false)
  as select * from online_tests.tests;

create or replace view public.online_test_test_sections
  with (security_invoker = false)
  as select * from online_tests.test_sections;

create or replace view public.online_test_test_questions
  with (security_invoker = false)
  as select * from online_tests.test_questions;

create or replace view public.online_test_test_attempts
  with (security_invoker = false)
  as select * from online_tests.test_attempts;

create or replace view public.online_test_test_responses
  with (security_invoker = false)
  as select * from online_tests.test_responses;

create or replace view public.online_test_test_results
  with (security_invoker = false)
  as select * from online_tests.test_results;

notify pgrst, 'reload schema';

commit;
