begin;

grant usage on schema academic to service_role;

grant all privileges on all tables in schema academic to service_role;
grant all privileges on all sequences in schema academic to service_role;
grant execute on all functions in schema academic to service_role;

alter default privileges in schema academic
grant all on tables to service_role;

alter default privileges in schema academic
grant all on sequences to service_role;

alter default privileges in schema academic
grant execute on functions to service_role;

commit;
