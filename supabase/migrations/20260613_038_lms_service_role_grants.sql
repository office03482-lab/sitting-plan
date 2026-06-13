begin;

grant usage on schema lms to service_role;

grant all privileges on all tables in schema lms to service_role;
grant all privileges on all sequences in schema lms to service_role;
grant execute on all functions in schema lms to service_role;

alter default privileges in schema lms
grant all on tables to service_role;

alter default privileges in schema lms
grant all on sequences to service_role;

alter default privileges in schema lms
grant execute on functions to service_role;

commit;
