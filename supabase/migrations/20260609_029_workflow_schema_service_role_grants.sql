begin;

grant usage on schema workflow to service_role;

grant all privileges on all tables in schema workflow to service_role;
grant all privileges on all sequences in schema workflow to service_role;
grant execute on all functions in schema workflow to service_role;

alter default privileges in schema workflow
grant all on tables to service_role;

alter default privileges in schema workflow
grant all on sequences to service_role;

alter default privileges in schema workflow
grant execute on functions to service_role;

commit;
