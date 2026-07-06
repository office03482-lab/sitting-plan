# POSTGREST SCHEMA EXPOSURE VERIFICATION

**Audit Date:** 2026-07-06

---

## EVIDENCE

PostgREST schema exposure was determined by forcing an error with an unexposed schema (`supabase_migrations`). The error response listed all exposed schemas:

```
Invalid schema: supabase_migrations
Only the following schemas are exposed: 
public, graphql_public, inventory, academic, attendance, exam, finance, hostel, reporting, scheduling, workflow
```

## SCHEMA EXPOSURE MATRIX

| Schema | Exposed via PostgREST? | service_role Access? | Status |
|--------|----------------------|---------------------|--------|
| `public` | ✅ YES | ✅ YES | ✅ |
| `graphql_public` | ✅ YES | UNVERIFIED | — |
| `inventory` | ✅ YES | ✅ YES | ✅ |
| `academic` | ✅ YES | ✅ YES | ✅ |
| `attendance` | ✅ YES | ✅ YES | ✅ |
| `exam` | ✅ YES | ✅ YES | ✅ |
| `finance` | ✅ YES | ✅ YES | ✅ |
| `hostel` | ✅ YES | ✅ YES | ✅ |
| `reporting` | ✅ YES | **❌ 42501** | ❌ |
| `scheduling` | ✅ YES | ✅ YES | ✅ |
| `workflow` | ✅ YES | ✅ YES | ✅ |

## DISTINCTIONS

### 1. PostgreSQL Permission Failure (what's happening with `reporting`)

The `reporting` schema IS exposed via PostgREST, but the `service_role` role lacks `GRANT USAGE ON SCHEMA reporting`. When PostgREST attempts `SET ROLE service_role` and then queries tables in the schema, PostgreSQL rejects the access with 42501.

**Fix:** Add `GRANT USAGE ON SCHEMA reporting TO service_role;` — this is sufficient for PostgREST to expose the schema's tables. Table-level grants may also be needed.

### 2. PostgREST Exposed-Schema Configuration (NOT the issue)

All 11 schemas are already configured in PostgREST's `db_schemas` setting (visible via the error response). No configuration change needed.

### 3. Schema Cache Issue (NOT the issue)

The PostgREST schema cache resolves correctly for `reporting` — the error "permission denied for schema reporting" is a PostgreSQL ACL error, not a cache error (which would be `PGRST106` or `PGRST205`).

### 4. Missing Object (NOT the issue)

The table `reporting.generated_reports` exists. When we try direct HTTP access with `Accept-Profile: reporting`, we get 42501, not 404 — confirming the table exists but privileges are denied.

### 5. RLS Denial (NOT the issue)

The error is "permission denied for schema reporting" (42501), which is a schema-level ACL error. RLS denials produce different error messages ("permission denied for table" in PostgreSQL, or `PGRST` error codes in PostgREST).

## CONCLUSION

The only issue is **missing PostgreSQL schema USAGE privilege** for the `service_role` role on the `reporting` schema. PostgREST configuration is correct and needs no changes. A simple `GRANT USAGE ON SCHEMA reporting TO service_role;` plus table-level grants will resolve the issue.
