# REPORTING BACKEND OPERATION MATRIX

**Audit Date:** 2026-07-06
**Target:** `reporting.generated_reports`

---

## EXACT OPERATIONS PERFORMED

### Operation 1: INSERT — `supabase_bi.py:955-969`

| Detail | Value |
|--------|-------|
| **Function** | `export_dashboard_payload()` |
| **File** | `backend/app/services/supabase_bi.py:949-978` |
| **Route** | `GET /bi/reports/export` → `router.get("/reports/export")` in `routes/bi.py:156-175` |
| **Operation** | `.insert({...}).execute()` — INSERT a new export record |
| **Privilege required** | `INSERT` |
| **Return value** | `.data[0].get("id")` — reads back the auto-generated UUID from the PostgREST response |
| **Also needs** | `SELECT` — PostgREST returns the created row by default after INSERT |

### Operation 2: No direct SELECT exists

There is NO standalone `client.schema("reporting").table("generated_reports").select(...)` call elsewhere in the codebase.

### Operation 3: No direct UPDATE exists

No `client.schema("reporting").table("generated_reports").update(...)` call exists.

### Operation 4: No direct DELETE exists

No `client.schema("reporting").table("generated_reports").delete(...)` call exists.

---

## COLUMN-LEVEL INSERT MAPPING

Backend code (supabase_bi.py:955-968) inserts the following columns:

| Column | Value in Code | Type | Required? |
|--------|--------------|------|-----------|
| `school_id` | `school_id` parameter (nullable) | uuid | YES (no default) |
| `requested_by_profile_id` | `actor_profile_id` parameter (nullable) | uuid | YES (no default) |
| `module_key` | `MODULE_KEY` = "bi" | text | YES |
| `report_key` | `dashboard_key` parameter | text | YES |
| `export_format` | `"csv"` (or format param) | text | YES |
| `status` | `"completed"` | text | YES |
| `filters` | `{"dashboard_key": dashboard_key}` | jsonb | YES |
| `generated_at` | `_utc_now().isoformat()` | timestamptz | YES (no default) |
| `expires_at` | `(_utc_now() + timedelta(days=7)).isoformat()` | timestamptz | YES (no default) |
| `storage_bucket` | `"download"` | text | YES (no default) |
| `storage_path` | `f"inline://{dashboard_key}-{_today().isoformat()}.csv"` | text | YES (no default) |

**Not inserted by backend** (use defaults):
- `id` → default: `gen_random_uuid()`
- `is_active` → default: `true`
- `created_at` → default: `now()`
- `updated_at` → default: `now()`

---

## SUMMARY

| Operation | Required Privilege | Backend Evidence |
|-----------|-------------------|------------------|
| INSERT | `INSERT` | `supabase_bi.py:955` |
| SELECT (returned row id) | `SELECT` | `generated.data[0].get("id")` at `supabase_bi.py:971` — PostgREST returns inserted row by default |

**Privileges actually needed:**
1. `USAGE ON SCHEMA reporting` — currently **MISSING** (42501)
2. `INSERT ON TABLE reporting.generated_reports` — currently **MISSING** (blocked by schema)
3. `SELECT ON TABLE reporting.generated_reports` — currently **MISSING** (needed for PostgREST INSERT return)

**NOT needed (not used by any backend code):**
- UPDATE
- DELETE
- TRUNCATE
- REFERENCES
- TRIGGER
- CREATE ON SCHEMA
- Sequence privileges
