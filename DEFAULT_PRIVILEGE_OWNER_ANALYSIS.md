# DEFAULT PRIVILEGE OWNER ANALYSIS

**Audit Date:** 2026-07-06

---

## THE PROBLEM

`ALTER DEFAULT PRIVILEGES` only affects objects created by the role specified in `FOR ROLE`. If you run:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT ALL ON TABLES TO service_role;
```

This only affects tables created by the CURRENT ROLE (the one executing the statement). If future migration runs as `postgres` but tables were originally created by `supabase_admin`, the default privilege won't apply.

## REPOSITORY EVIDENCE

### Who Creates Schemas in Migrations?

All migration files use:
```sql
CREATE SCHEMA IF NOT EXISTS <name>;
```

No explicit `AUTHORIZATION` clause — ownership goes to the role executing the migration.

### Who Creates Tables in Migrations?

All tables use `CREATE TABLE IF NOT EXISTS <schema>.<table> (...)` — no `AUTHORIZATION` clause. Ownership goes to the executing role.

### Supabase Project Default Roles

In a typical Supabase project:

| Role | Typical Owner Of | Notes |
|------|-----------------|-------|
| `postgres` | Default superuser | Migrations run as this in local dev |
| `supabase_admin` | Custom objects created via Dashboard SQL Editor | Most common for manual SQL |
| `authenticated` | — | Application-level role, not an owner |
| `service_role` | — | Application-level role, not an owner |
| `anon` | — | Application-level role, not an owner |

### Which Role Actually Owns the Objects?

**Cannot determine definitively without runtime `pg_tables` access** (unavailable via PostgREST).

However, based on the fact that:
1. `supabase_migrations.schema_migrations` was never created (CLI not used)
2. SQL files were likely applied manually via Supabase Dashboard SQL Editor
3. Dashboard SQL Editor runs as `supabase_admin` in most Supabase projects

**The most likely object owner is `supabase_admin`.**

## SAFE APPROACH

Since the exact owner is unknown, the repair SQL should cover both likely candidates:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA reporting GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA reporting GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE authenticated IN SCHEMA reporting GRANT ALL ON TABLES TO service_role;
```

This is idempotent — running it for a role that doesn't exist or doesn't own objects is a no-op.

## ALTERNATIVE: OWNERLESS DEFAULT PRIVILEGES

PostgreSQL 15+ supports `ALTER DEFAULT PRIVILEGES FOR ALL ROLES`, but Supabase currently runs PostgreSQL 14.x in most projects. Verify Supabase project's PG version before using.

## RECOMMENDATION

Include `FOR ROLE supabase_admin, postgres, authenticated` in the ALTER DEFAULT PRIVILEGES statement. This is additive and risk-free.
