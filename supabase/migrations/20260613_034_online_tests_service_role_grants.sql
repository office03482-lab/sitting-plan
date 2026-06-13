begin;

grant usage on schema online_tests to service_role;

grant all privileges on all tables in schema online_tests to service_role;
grant all privileges on all sequences in schema online_tests to service_role;
grant execute on all functions in schema online_tests to service_role;

alter default privileges in schema online_tests
grant all on tables to service_role;

alter default privileges in schema online_tests
grant all on sequences to service_role;

alter default privileges in schema online_tests
grant execute on functions to service_role;

commit;
