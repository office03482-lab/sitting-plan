-- Grant schema and table permissions for inventory and finance schemas.
-- These were omitted from the original schema-creation migrations, causing
-- "permission denied for schema inventory" (PostgreSQL 42501) when the
-- backend (service_role key) or authenticated users try to access them.

begin;

-- ── Schema USAGE ────────────────────────────────────────────────────────────
grant usage on schema inventory  to anon, authenticated, service_role;
grant usage on schema finance    to anon, authenticated, service_role;

-- ── Inventory tables ────────────────────────────────────────────────────────
grant select, insert, update, delete
  on inventory.suppliers               to anon, authenticated, service_role;
grant select, insert, update, delete
  on inventory.material_categories     to anon, authenticated, service_role;
grant select, insert, update, delete
  on inventory.material_items          to anon, authenticated, service_role;
grant select, insert, update, delete
  on inventory.stock_in_entries        to anon, authenticated, service_role;
grant select, insert, update, delete
  on inventory.stock_out_entries       to anon, authenticated, service_role;
grant select, insert, update, delete
  on inventory.student_issue_entries   to anon, authenticated, service_role;

-- ── Finance tables ──────────────────────────────────────────────────────────
grant select, insert, update, delete
  on finance.fee_structures            to anon, authenticated, service_role;
grant select, insert, update, delete
  on finance.fee_assignments           to anon, authenticated, service_role;
grant select, insert, update, delete
  on finance.payments                  to anon, authenticated, service_role;

-- ── Inventory functions (trigger + helper) ──────────────────────────────────
grant execute on function
  inventory.recalculate_material_current_stock(uuid, uuid)
  to anon, authenticated, service_role;
grant execute on function
  inventory.sync_material_stock_on_entry_change()
  to anon, authenticated, service_role;

-- ── Default privileges for future objects ───────────────────────────────────
-- Ensures any new tables, views, or functions created in these schemas
-- automatically inherit the same roles.
alter default privileges in schema inventory
  grant select, insert, update, delete on tables    to anon, authenticated, service_role;
alter default privileges in schema inventory
  grant execute                   on functions to anon, authenticated, service_role;
alter default privileges in schema finance
  grant select, insert, update, delete on tables    to anon, authenticated, service_role;
alter default privileges in schema finance
  grant execute                   on functions to anon, authenticated, service_role;

commit;
