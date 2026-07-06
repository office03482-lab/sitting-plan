# VERIFIED SCHEMA PERMISSION MATRIX

**Generated:** Forensic analysis of ALL migration files in `supabase/migrations/`
**Date:** 2026-07-06
**Scope:** GRANT USAGE ON SCHEMA, GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON, ALTER DEFAULT PRIVILEGES, service_role, authenticated, anon

---

## Summary Matrix

| # | Schema | Creation Migration | Permission Migrations | authenticated GRANTs | anon GRANTs | service_role GRANTs | Default Privileges | RLS Status | Final Status |
|---|--------|-------------------|----------------------|---------------------|-------------|--------------------|-------------------|------------|--------------|
| 1 | **public** (default) | Built-in | `20260617_058_warehouse_tables.sql` | RLS policies only (for select) | None | ALL on ALL TABLES + SEQUENCES | None | ENABLED (via RLS policies on each table) | Has service_role grants (all tables), plus RLS-based controls |
| 2 | **academic** | `20260513_004_academic_and_timetable.sql` | `20260611_032_academic_schema_service_role_grants.sql` | None | None | ALL on schema (tables, sequences, functions) + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on academic tables) | Fully granted to service_role |
| 3 | **scheduling** | `20260513_004_academic_and_timetable.sql`, `20260520_016_batch_current_class_optimizations.sql` | **NONE** | None | None | None | None | ENABLED (RLS policies in academic/timetable migration) | **MISSING GRANTS** |
| 4 | **exam** | `20260513_005_exam_and_seating.sql` | **NONE** | None | None | None | None | ENABLED (RLS policies on exam tables) | **MISSING GRANTS** |
| 5 | **attendance** | `20260513_006_attendance.sql` | **NONE** | None | None | None | None | ENABLED (RLS policies on attendance tables) | **MISSING GRANTS** |
| 6 | **inventory** | `20260513_007_inventory_and_fees.sql`, `20260516_012_inventory_bootstrap.sql` | `20260531_024_inventory_finance_permissions.sql` (REPAIR) | SELECT, INSERT, UPDATE, DELETE on all inventory tables + functions | SELECT, INSERT, UPDATE, DELETE on all inventory tables + functions | SELECT, INSERT, UPDATE, DELETE on all inventory tables + functions | Tables (S/I/U/D) + Functions (EXECUTE) for anon, authenticated, service_role | ENABLED (RLS policies on inventory tables) | Fully granted to all three roles (repaired later) |
| 7 | **finance** | `20260513_007_inventory_and_fees.sql` | `20260531_024_inventory_finance_permissions.sql` (REPAIR) | SELECT, INSERT, UPDATE, DELETE on all finance tables | SELECT, INSERT, UPDATE, DELETE on all finance tables | SELECT, INSERT, UPDATE, DELETE on all finance tables | Tables (S/I/U/D) + Functions (EXECUTE) for anon, authenticated, service_role | ENABLED (RLS policies on finance tables) | Fully granted to all three roles (repaired later) |
| 8 | **hostel** | `20260513_008_hostel_and_reporting.sql` | `20260516_013_hostel_bootstrap.sql`, `20260610_031_hostel_schema_service_role_grants.sql` | USAGE on schema, S/I/U/D on 4 hostel tables, EXECUTE on 2 functions | None | ALL on all tables/sequences/functions + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on hostel tables) | Fully granted to authenticated and service_role |
| 9 | **reporting** | `20260513_008_hostel_and_reporting.sql` | **NONE** | None | None | None | None | ENABLED (RLS on generated_reports) | **MISSING GRANTS** |
| 10 | **workflow** | `20260608_028_bulk_action_requests.sql` | `20260609_029_workflow_schema_service_role_grants.sql` | None | None | ALL on all tables/sequences/functions + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on workflow tables) | Fully granted to service_role only |
| 11 | **online_tests** | `20260613_033_online_tests_schema.sql` | `20260613_034_online_tests_service_role_grants.sql` | None | None | ALL on all tables/sequences/functions + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on online_tests tables) | Fully granted to service_role only |
| 12 | **analytics** (a.k.a. online_test_analytics) | `20260613_035_online_test_analytics_schema.sql` | `20260613_036_online_test_analytics_service_role_grants.sql` | None | None | ALL on all tables/sequences/functions + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on analytics tables) | Fully granted to service_role only |
| 13 | **lms** | `20260613_037_lms_schema.sql` | `20260613_038_lms_service_role_grants.sql` | None | None | ALL on all tables/sequences/functions + ALTER DEFAULT | Tables + Sequences + Functions for service_role | ENABLED (RLS policies on lms tables) | Fully granted to service_role only |
| 14 | **ai** | `20260614_042_ai_tutor_schema.sql` | `20260614_043`, `20260614_045`, `20260614_047` (3x redundant grants) | None | None | ALL on all tables/sequences/functions + ALTER DEFAULT (granted 3 times) | Tables + Sequences + Functions for service_role (3x) | ENABLED (RLS policies on ai tables) | Fully granted to service_role only (redundant grants) |
| 15 | **warehouse** | `20260614_049_bi_warehouse.sql` | `20260614_049_bi_warehouse.sql` (same file, at creation time) | None | None | ALL on all tables/sequences + ALTER DEFAULT | Tables + Sequences for service_role | ENABLED (RLS policies on warehouse tables) | Fully granted at creation time -- only schema with inline grants |
| 16 | **sessions** | `20260619_059_portal_access_security_sessions.sql` | **DROPPED** in `20260619_060_move_sessions_to_public.sql` | N/A | N/A | N/A | N/A | ENABLED (before being dropped) | **DROPPED** |
| 17 | **public.ai_*** (ai_credit_wallets, etc.) | `20260622_063_subscription_entitlement_phase0.sql` | None needed (public schema) | Via RLS policies | Via RLS policies | Via `20260617_058_warehouse_tables.sql` (ALL on public) | None | ENABLED (RLS policies) | Public schema tables inherit from public grants |

---

## Detailed Grant Statements by Migration

### 20260516_013_hostel_bootstrap.sql
```sql
grant usage on schema hostel to authenticated;

grant select, insert, update, delete on hostel.hostels to authenticated;
grant select, insert, update, delete on hostel.hostel_rooms to authenticated;
grant select, insert, update, delete on hostel.hostel_requests to authenticated;
grant select, insert, update, delete on hostel.hostel_allocations to authenticated;

grant execute on function hostel.recalculate_hostel_room_occupancy(uuid, uuid) to authenticated;
grant execute on function hostel.sync_room_occupancy_on_allocation_change() to authenticated;
```

### 20260531_024_inventory_finance_permissions.sql (REPAIR)
```sql
grant usage on schema inventory  to anon, authenticated, service_role;
grant usage on schema finance    to anon, authenticated, service_role;

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

grant select, insert, update, delete
  on finance.fee_structures            to anon, authenticated, service_role;
grant select, insert, update, delete
  on finance.fee_assignments           to anon, authenticated, service_role;
grant select, insert, update, delete
  on finance.payments                  to anon, authenticated, service_role;

grant execute on function
  inventory.recalculate_material_current_stock(uuid, uuid)
  to anon, authenticated, service_role;
grant execute on function
  inventory.sync_material_stock_on_entry_change()
  to anon, authenticated, service_role;

alter default privileges in schema inventory
  grant select, insert, update, delete on tables    to anon, authenticated, service_role;
alter default privileges in schema inventory
  grant execute                   on functions to anon, authenticated, service_role;
alter default privileges in schema finance
  grant select, insert, update, delete on tables    to anon, authenticated, service_role;
alter default privileges in schema finance
  grant execute                   on functions to anon, authenticated, service_role;
```

### 20260609_029_workflow_schema_service_role_grants.sql
```sql
grant usage on schema workflow to service_role;
grant all privileges on all tables in schema workflow to service_role;
grant all privileges on all sequences in schema workflow to service_role;
grant execute on all functions in schema workflow to service_role;
alter default privileges in schema workflow grant all on tables to service_role;
alter default privileges in schema workflow grant all on sequences to service_role;
alter default privileges in schema workflow grant execute on functions to service_role;
```

### 20260610_031_hostel_schema_service_role_grants.sql
```sql
grant usage on schema hostel to service_role;
grant all privileges on all tables in schema hostel to service_role;
grant all privileges on all sequences in schema hostel to service_role;
grant execute on all functions in schema hostel to service_role;
alter default privileges in schema hostel grant all on tables to service_role;
alter default privileges in schema hostel grant all on sequences to service_role;
alter default privileges in schema hostel grant execute on functions to service_role;
```

### 20260611_032_academic_schema_service_role_grants.sql
```sql
grant usage on schema academic to service_role;
grant all privileges on all tables in schema academic to service_role;
grant all privileges on all sequences in schema academic to service_role;
grant execute on all functions in schema academic to service_role;
alter default privileges in schema academic grant all on tables to service_role;
alter default privileges in schema academic grant all on sequences to service_role;
alter default privileges in schema academic grant execute on functions to service_role;
```

### 20260613_034_online_tests_service_role_grants.sql
```sql
grant usage on schema online_tests to service_role;
grant all privileges on all tables in schema online_tests to service_role;
grant all privileges on all sequences in schema online_tests to service_role;
grant execute on all functions in schema online_tests to service_role;
alter default privileges in schema online_tests grant all on tables to service_role;
alter default privileges in schema online_tests grant all on sequences to service_role;
alter default privileges in schema online_tests grant execute on functions to service_role;
```

### 20260613_036_online_test_analytics_service_role_grants.sql
```sql
grant usage on schema analytics to service_role;
grant all privileges on all tables in schema analytics to service_role;
grant all privileges on all sequences in schema analytics to service_role;
grant execute on all functions in schema analytics to service_role;
alter default privileges in schema analytics grant all on tables to service_role;
alter default privileges in schema analytics grant all on sequences to service_role;
alter default privileges in schema analytics grant execute on functions to service_role;
```

### 20260613_038_lms_service_role_grants.sql
```sql
grant usage on schema lms to service_role;
grant all privileges on all tables in schema lms to service_role;
grant all privileges on all sequences in schema lms to service_role;
grant execute on all functions in schema lms to service_role;
alter default privileges in schema lms grant all on tables to service_role;
alter default privileges in schema lms grant all on sequences to service_role;
alter default privileges in schema lms grant execute on functions to service_role;
```

### 20260614_043 / 045 / 047 (ai schema grants - 3 identical files)
```sql
grant usage on schema ai to service_role;
grant all privileges on all tables in schema ai to service_role;
grant all privileges on all sequences in schema ai to service_role;
grant execute on all functions in schema ai to service_role;
alter default privileges in schema ai grant all on tables to service_role;
alter default privileges in schema ai grant all on sequences to service_role;
alter default privileges in schema ai grant execute on functions to service_role;
```

### 20260614_049_bi_warehouse.sql (inline at creation)
```sql
grant usage on schema warehouse to service_role;
grant all privileges on all tables in schema warehouse to service_role;
grant all privileges on all sequences in schema warehouse to service_role;
alter default privileges in schema warehouse grant all on tables to service_role;
alter default privileges in schema warehouse grant all on sequences to service_role;
```

### 20260617_058_warehouse_tables.sql (public schema grants)
```sql
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
```

---

## Key Findings

### Schemas MISSING any GRANT statements:
1. **scheduling** -- Created in `20260513_004_academic_and_timetable.sql`, NO GRANT statements anywhere
2. **exam** -- Created in `20260513_005_exam_and_seating.sql`, NO GRANT statements anywhere
3. **attendance** -- Created in `20260513_006_attendance.sql`, NO GRANT statements anywhere
4. **reporting** -- Created in `20260513_008_hostel_and_reporting.sql`, NO GRANT statements anywhere

### Schemas with REPAIRED grants (missing at creation, added later):
1. **inventory** -- Created in `20260513_007_inventory_and_fees.sql` without grants; repaired in `20260531_024_inventory_finance_permissions.sql` (all 3 roles)
2. **finance** -- Created in `20260513_007_inventory_and_fees.sql` without grants; repaired in `20260531_024_inventory_finance_permissions.sql` (all 3 roles)
3. **hostel** -- Created in `20260513_008_hostel_and_reporting.sql` without grants; granted for authenticated in `20260516_013_hostel_bootstrap.sql` and service_role in `20260610_031_hostel_schema_service_role_grants.sql`

### Schemas with ONLY service_role grants:
- academic, workflow, online_tests, analytics, lms, ai, warehouse

### Schemas with grants for ALL three roles (anon, authenticated, service_role):
- inventory, finance (both via repair migration)

### Schemas with grants for authenticated AND service_role:
- hostel, public (service_role via GRANT ALL; authenticated via RLS)

### Redundancy:
- The **ai** schema has its service_role grants and ALTER DEFAULT PRIVILEGES repeated **3 times** across three separate migration files.

### Inventory first migration (20260513_007_inventory_and_fees.sql):
- Creates `inventory` and `finance` schemas (lines 3-4)
- Creates 6 inventory tables and 3 finance tables
- Enables RLS on all tables
- Creates RLS policies
- **Contains ZERO GRANT statements** -- no GRANT USAGE ON SCHEMA, no GRANT SELECT/INSERT/UPDATE/DELETE, no ALTER DEFAULT PRIVILEGES
- All permissions were retroactively added 18 days later in `20260531_024_inventory_finance_permissions.sql`
