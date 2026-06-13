begin;

grant usage on schema analytics to service_role;

grant all privileges on all tables in schema analytics to service_role;
grant all privileges on all sequences in schema analytics to service_role;
grant execute on all functions in schema analytics to service_role;

alter default privileges in schema analytics
grant all on tables to service_role;

alter default privileges in schema analytics
grant all on sequences to service_role;

alter default privileges in schema analytics
grant execute on functions to service_role;

commit;
