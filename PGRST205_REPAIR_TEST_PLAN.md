# PGRST205 REPAIR TEST PLAN

## Pre-Fix Verification (run BEFORE applying migration)

### 1. Reproduce Current PGRST205

```bash
curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles"
```
Expected: 404 PGRST205

### 2. Verify No Version Collision at 070

```bash
# Check no other migration file has "070" in name
Get-ChildItem supabase/migrations/ | Where-Object { $_.Name -match "070" }
```
Expected: ONLY `20260706_070_apply_school_self_service_branding.sql`

### 3. Verify Table Does NOT Exist

Query `information_schema.tables` via Dashboard SQL Editor:
```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('school_self_service_profiles', 'school_brand_assets', 'school_backup_requests');
```
Expected: 0 rows

### 4. Verify FK Dependencies Exist

```sql
SELECT id FROM public.schools LIMIT 1;
SELECT id FROM public.profiles LIMIT 1;
```
Expected: Both return rows

---

## Apply Fix

Run migration `20260706_070_apply_school_self_service_branding.sql` via Supabase Dashboard SQL Editor.

---

## Post-Fix Verification

### 5. Table Existence

```bash
curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles"
```
Expected: 200 (empty array or data)

```bash
curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_brand_assets"
```
Expected: 200

```bash
curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_backup_requests"
```
Expected: 200

### 6. service_role INSERT Privilege

```bash
curl -s -X POST \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"school_id":"<VALID_SCHOOL_UUID>","branding":{"school_name":"Test"},"portal_settings":{},"domain_settings":{},"email_templates":{},"messaging_templates":{},"preferences":{}}' \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles"
```
Expected: 201 Created

### 7. service_role SELECT Privilege

```bash
curl -s \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles?school_id=eq.<VALID_SCHOOL_UUID>"
```
Expected: 200 with row data

### 8. service_role UPDATE Privilege

```bash
curl -s -X PATCH \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"branding":{"school_name":"Updated Test"}}' \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles?school_id=eq.<VALID_SCHOOL_UUID>"
```
Expected: 204 No Content

### 9. Test Public Branding Endpoint

```bash
curl -s -H "Authorization: Bearer $USER_JWT_TOKEN" \
  "https://api-server.com/api/school-self-service/public-branding?school=<SCHOOL_ID>"
```
Expected: 200 with branding data

### 10. Test Full Profile Endpoint

```bash
curl -s -H "Authorization: Bearer $USER_JWT_TOKEN" \
  "https://api-server.com/api/school-self-service/profile"
```
Expected: 200 with full profile (branding, portal_settings, etc.)

### 11. Test BI Export Page Load (Frontend)

Navigate to Business Intelligence page in browser:
- Open browser DevTools → Network tab
- Navigate to BI page
- Verify `GET /api/school-self-service/public-branding` returns 200
- Verify `GET /bi/reports/export` returns 200
- No HTTP 500 errors in console

### 12. Test BI Export (Full Flow)

Click "Export" on BI page:
- Verify `.csv` file downloads
- File contains dashboard data
- No error toasts

### 13. Test Auth/Principal Resolution

After fix:
- Login/logout flow works
- School admin role resolves correctly
- School ID in JWT matches membership

### 14. Test Tenant Isolation

```bash
# Verify profile data is scoped to school_id
curl -s \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/school_self_service_profiles"
```
- Verify no cross-school data leakage

### 15. Test Unrelated Tables Unaffected

```bash
curl -s \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://fdmbpzknpwobpzrpjtor.supabase.co/rest/v1/reporting/generated_reports"
```
Expected: 200 (reporting fix from Phase 1.8 still works)

---

## Cleanup Test Data

```sql
DELETE FROM public.school_backup_requests WHERE metadata->>'source' = 'test_phase2';
DELETE FROM public.school_brand_assets WHERE metadata->>'source' = 'test_phase2';
DELETE FROM public.school_self_service_profiles WHERE metadata->>'source' = 'test_phase2';
```

## Success Criteria

- [ ] No PGRST205 for any of the 3 tables
- [ ] No 42501 permission errors
- [ ] Public branding endpoint returns 200
- [ ] School self-service profile endpoint returns 200
- [ ] BI export page loads without errors
- [ ] BI export download works
- [ ] No regression on existing functionality
