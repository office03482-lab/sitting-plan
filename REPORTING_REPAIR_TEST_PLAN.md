# REPORTING REPAIR TEST PLAN

**Audit Date:** 2026-07-06
**Status:** NOT EXECUTED

---

## BASELINE FAILURE (Pre-Repair)

**Successfully reproduced** on 2026-07-06 via supabase-py client:

### Step 1: Direct PostgREST query
```bash
curl -H "Authorization: Bearer <service_role_key>" \
     -H "Accept-Profile: reporting" \
     -H "Content-Profile: reporting" \
     "https://<project>.supabase.co/rest/v1/generated_reports?select=id&limit=1"
```
**Result:** HTTP 403
```json
{"code":"42501","message":"permission denied for schema reporting"}
```

### Step 2: Backend simulation
```python
client.schema("reporting").table("generated_reports").insert({
    "school_id": None,
    "requested_by_profile_id": None,
    "module_key": "bi",
    "report_key": "test",
    "export_format": "csv",
    "status": "completed",
    "filters": {},
    "generated_at": "2026-07-06T00:00:00Z",
    "expires_at": "2026-07-13T00:00:00Z",
    "storage_bucket": "download",
    "storage_path": "inline://test-2026-07-06.csv",
}).execute()
```
**Result:** 42501 error — same as Step 1.

### Pre-condition: Dashboard read queries work
```python
client.schema("inventory").table("material_categories").select("id,name").limit(3).execute()
```
**Result:** ✅ SUCCESS — 3 rows returned. This proves other schemas are unaffected and the BI dashboard data pipeline works.

---

## REPAIR EXECUTION

### SQL to execute (via Supabase Dashboard SQL Editor)
```sql
BEGIN;
GRANT USAGE ON SCHEMA reporting TO service_role;
GRANT INSERT, SELECT ON TABLE reporting.generated_reports TO service_role;
COMMIT;
```

---

## POST-REPAIR VERIFICATION (Same Scripts)

### Check 1: has_schema_privilege
```sql
SELECT has_schema_privilege('service_role', 'reporting', 'USAGE');
```
**Expected:** `true`

### Check 2: has_table_privilege
```sql
SELECT has_table_privilege('service_role', 'reporting.generated_reports', 'INSERT');
SELECT has_table_privilege('service_role', 'reporting.generated_reports', 'SELECT');
```
**Expected:** `true` for both

### Check 3: Direct PostgREST query
```bash
curl -H "Authorization: Bearer <service_role_key>" \
     -H "Accept-Profile: reporting" \
     "https://<project>.supabase.co/rest/v1/generated_reports?select=id&limit=1"
```
**Expected:** HTTP 200 with `[]` (empty array — no exports yet)

### Check 4: Backend simulation (INSERT)
```python
client.schema("reporting").table("generated_reports").insert({
    "school_id": None,
    "requested_by_profile_id": None,
    "module_key": "bi",
    "report_key": "test-verify",
    "export_format": "csv",
    "status": "completed",
    "filters": {},
    "generated_at": "2026-07-06T00:00:00Z",
    "expires_at": "2026-07-13T00:00:00Z",
    "storage_bucket": "download",
    "storage_path": "inline://test-verify-2026-07-06.csv",
}).execute()
```
**Expected:** HTTP 201 with the created row data (including `id`)

### Check 5: No cross-schema leakage
Verify other schemas remain unaffected:
```python
# These should STILL work
client.schema("exam").table("exams").select("id").limit(1).execute()
client.schema("attendance").table("student_attendance").select("id").limit(1).execute()
client.schema("scheduling").table("timetable_entries").select("id").limit(1).execute()

# These should STILL fail (no privileges granted)
client.schema("reporting").table("generated_reports").update({"status": "expired"}).eq("id", "00000000-0000-0000-0000-000000000000").execute()
```
**Expected:** `update` fails (no UPDATE granted) — confirming least privilege

### Check 6: Clean up test row
```python
client.schema("reporting").table("generated_reports").delete().eq("report_key", "test-verify").execute()
```
**Expected:** fails (no DELETE granted) — confirming least privilege. Test row must be cleaned up manually via SQL Editor.

---

## SUCCESS CRITERIA

- [ ] `has_schema_privilege` returns `true`
- [ ] `has_table_privilege` returns `true` for INSERT, SELECT
- [ ] PostgREST direct query returns HTTP 200
- [ ] Backend INSERT simulation works and returns row with `id`
- [ ] UPDATE simulation returns 42501 (confirming least privilege)
- [ ] DELETE simulation returns 42501 (confirming least privilege)
- [ ] Other schemas (exam, attendance, scheduling) remain fully accessible

---

## ROLLBACK PLAN

If repair causes unexpected behavior:
```sql
BEGIN;
REVOKE INSERT, SELECT ON TABLE reporting.generated_reports FROM service_role;
REVOKE USAGE ON SCHEMA reporting FROM service_role;
COMMIT;
```
Then rerun baseline checks to confirm 42501 returns.
