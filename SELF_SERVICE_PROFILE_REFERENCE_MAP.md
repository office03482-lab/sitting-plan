# SELF-SERVICE PROFILE REFERENCE MAP

## `public.school_self_service_profiles`

### Backend (Python)

| File | Line | Function | Operation | Schema | Route | Status |
|------|------|----------|-----------|--------|-------|--------|
| `backend/app/services/school_self_service.py` | 139 | `_upsert_profile_row()` | SELECT (eq school_id) | public | via `GET /api/school-self-service/profile` | ACTIVE — fails with PGRST205 |
| `backend/app/services/school_self_service.py` | 150 | `_upsert_profile_row()` | INSERT (create row) | public | via `GET /api/school-self-service/profile` | ACTIVE — fails with PGRST205 |
| `backend/app/services/school_self_service.py` | 179 | `_record_audit()` | entity_table value | public | via all school-self-service routes | ACTIVE — dead code path (audit_logs insert independent) |
| `backend/app/services/school_self_service.py` | 343 | `_update_profile_section()` | UPDATE (set column) | public | via `PUT /api/school-self-service/*` | ACTIVE — fails with PGRST205 |
| `backend/app/services/school_self_service.py` | 528 | `get_public_school_branding()` | SELECT (all rows) | public | via `GET /api/school-self-service/public-branding` | ACTIVE — fails with PGRST205 |

### Backend (Route — school_self_service.py)

| File | Line | Function | Operation | Route |
|------|------|----------|-----------|-------|
| `backend/app/routes/school_self_service.py` | 53 | `get_school_login_branding()` | READ (public branding) | `GET /api/school-self-service/public-branding` |
| `backend/app/routes/school_self_service.py` | 65 | `get_self_service_profile()` | READ (full profile) | `GET /api/school-self-service/profile` |
| `backend/app/routes/school_self_service.py` | 74 | `update_self_service_branding()` | WRITE (branding) | `PUT /api/school-self-service/branding` |
| `backend/app/routes/school_self_service.py` | 84 | `update_self_service_preferences()` | WRITE (preferences) | `PUT /api/school-self-service/preferences` |
| `backend/app/routes/school_self_service.py` | 94 | `update_self_service_portal_settings()` | WRITE (portal) | `PUT /api/school-self-service/portal-settings` |
| `backend/app/routes/school_self_service.py` | 104 | `update_self_service_domain_settings()` | WRITE (domain) | `PUT /api/school-self-service/domain` |
| `backend/app/routes/school_self_service.py` | 114 | `update_self_service_email_templates()` | WRITE (email) | `PUT /api/school-self-service/email-templates` |
| `backend/app/routes/school_self_service.py` | 124 | `update_self_service_messaging_templates()` | WRITE (messaging) | `PUT /api/school-self-service/messaging-templates` |
| `backend/app/routes/school_self_service.py` | 134 | `get_self_service_storage()` | READ (storage) | `GET /api/school-self-service/storage` |

### Frontend (TypeScript)

| File | Line | Method | Route Called | Context |
|------|------|--------|-------------|---------|
| `frontend/src/components/Layout.tsx` | 97 | `getPublicSchoolBranding()` | `GET /api/school-self-service/public-branding` | Called on EVERY page load to set school branding (header colors, portal name) |
| `frontend/src/pages/SchoolBrandingPage.tsx` | 17 | `getSchoolSelfServiceProfile()` | `GET /api/school-self-service/profile` | Branding management page |
| `frontend/src/pages/SchoolPreferencesPage.tsx` | 18 | `getSchoolSelfServiceProfile()` | `GET /api/school-self-service/profile` | Preferences management page |
| `frontend/src/pages/SchoolPortalSettingsPage.tsx` | 29 | `getSchoolSelfServiceProfile()` | `GET /api/school-self-service/profile` | Portal settings page |
| `frontend/src/pages/SchoolEmailTemplatesPage.tsx` | 23 | `getSchoolSelfServiceProfile()` | `GET /api/school-self-service/profile` | Email templates page |
| `frontend/src/pages/SchoolSmsTemplatesPage.tsx` | 21 | `getSchoolSelfServiceProfile()` | `GET /api/school-self-service/profile` | SMS templates page |
| `frontend/src/pages/Login.tsx` | 35 | `getPublicSchoolBranding()` | `GET /api/school-self-service/public-branding` | Login page branding |

### Primary Caller (the one triggering the BI page error)

**`frontend/src/components/Layout.tsx:97`** — `getPublicSchoolBranding()` is called in a `useEffect` on every page that uses the Layout component, including `BusinessIntelligencePage.tsx`.

---

## `public.school_brand_assets`

| File | Line | Function | Operation | Route |
|------|------|----------|-----------|-------|
| `backend/app/services/school_self_service.py` | 219 | `_list_assets()` | SELECT (all for school) | `GET /api/school-self-service/storage` |
| `backend/app/services/school_self_service.py` | 425 | `upload_school_brand_asset()` | INSERT (new asset) | `POST /api/school-self-service/assets/{asset_type}` |

---

## `public.school_backup_requests`

| File | Line | Function | Operation | Route |
|------|------|----------|-----------|-------|
| `backend/app/services/school_self_service.py` | 243 | `_backup_history()` | SELECT (all for school) | `GET /api/school-self-service/backups` |
| `backend/app/services/school_self_service.py` | 480 | `request_backup()` | INSERT (new request) | `POST /api/school-self-service/backups/request` |
| `backend/app/services/school_self_service.py` | 501 | `request_restore()` | INSERT (new request) | `POST /api/school-self-service/backups/restore-request` |

---

## Dead Code / Test Code

| File | Line | Notes |
|------|------|-------|
| `backend/tests/test_phase6d_branding_uat.py` | 90 | Test dataset has mock `school_self_service_profiles` entry |
| `backend/tests/test_phase6d_branding_uat.py` | various | UAT tests use monkeypatched `_public_table` — never queries production |
| `PHASE6C_BRANDING_REPORT.md` | 62, 68 | Old phase documentation — confirms the feature was designed |

---

## Summary

- **29 total references** across codebase
- **ACTIVE**: All 10 backend routes in `school_self_service.py` and `routes/school_self_service.py`
- **CRITICAL PATH**: `Layout.tsx:97` → `getPublicSchoolBranding()` → `get_public_school_branding()` → `_public_table("school_self_service_profiles")` — fires on every page load
- **ROOT CAUSE**: Migration file exists (068), but was NEVER applied to production database
- **NOT stale code** — this is recently developed Phase 6 code, not legacy
