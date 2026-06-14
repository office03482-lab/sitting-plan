begin;

grant usage on schema ai to service_role;

grant all privileges on all tables in schema ai to service_role;
grant all privileges on all sequences in schema ai to service_role;
grant execute on all functions in schema ai to service_role;

alter default privileges in schema ai
grant all on tables to service_role;

alter default privileges in schema ai
grant all on sequences to service_role;

alter default privileges in schema ai
grant execute on functions to service_role;

commit;
