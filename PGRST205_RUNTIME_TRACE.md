# PGRST205 RUNTIME TRACE — `public.school_self_service_profiles`

## Failing Request

```
GET /bi/reports/export?dashboard_key=academic&period=monthly
```

Returns HTTP 500 with PGRST205 for `public.school_self_service_profiles`.

## End-to-End Trace

### Frontend → API Call Chain

```
User clicks "Export" on BusinessIntelligencePage.tsx
  │
  ├── Layout.tsx:89-110 (useEffect on mount)
  │   └── apiService.getPublicSchoolBranding({ school: user.school_id })
  │       └── GET /api/school-self-service/public-branding?school=<school_id>
  │           │
  │           ▼ Backend
  │           routes/school_self_service.py:53  get_school_login_branding()
  │             │
  │             ▼ services/school_self_service.py:520  get_public_school_branding()
  │               │
  │               ├── services/school_self_service.py:523  _public_table("schools").select(...)
  │               │     ✓ SUCCESS — schools table exists
  │               │
  │               └── services/school_self_service.py:528  _public_table("school_self_service_profiles").select(...)
  │                     ✗ FAILS — PGRST205 "table not in schema cache"
  │                     HTTP 500 returned to frontend
  │
  └── BusinessIntelligencePage.tsx:100  apiService.exportBiReport(...)
      └── GET /bi/reports/export?dashboard_key=academic&period=monthly
            │
            ▼ Backend
            routes/bi.py:157  api_bi_reports_export()
              │
              ├── Depends(resolve_school_id_from_actor)   ✓ (JWT claims only)
              ├── Depends(get_authenticated_actor_context) ✓ (profiles/memberships exist)
              ├── Depends(require_bi_school_user)          ✓ (permissions check)
              │
              ├── get_academic_dashboard()                 ✓ (warehouse tables exist)
              └── export_dashboard_payload()                ✓ (reporting.generated_reports has INSERT)
                  
                  → BI export ITSELF never touches school_self_service_profiles
                  → BI export would SUCCEED on its own
```

### Why the Error Appears on the BI Page

The Layout component (`Layout.tsx:89-110`) calls `getPublicSchoolBranding()` on EVERY page render to set the school's branding colors in the sidebar/header. This is an independent API call that runs in parallel with the page's own data loading.

When the branding call fails with PGRST205 (500 error), the catch block handles it gracefully (sets `schoolBranding = null`). However:

1. **If the user is testing the API directly** (curl/Postman) against `GET /api/school-self-service/public-branding`, they get the raw 500 error.
2. **If the frontend has error handling that surfaces API errors**, the 500 might show as a toast/notification on the BI page.
3. **If there is no individual error boundary**, the page may show a generic error state.

### Key Insight

The BI export route (`GET /bi/reports/export`) does NOT directly or indirectly query `school_self_service_profiles`. The PGRST205 error comes from a COLLATERAL request to the school-self-service branding endpoint, triggered by the Layout component's `useEffect`.

### Confirmed at Runtime

| Check | Result |
|-------|--------|
| `GET /rest/v1/school_self_service_profiles` | **404 PGRST205** |
| `GET /rest/v1/schools` (control) | **200 OK** (1 row) |
| `GET /rest/v1/school_brand_assets` | **404 PGRST205** |
| `GET /rest/v1/school_backup_requests` | **404 PGRST205** |
| Migration 068 applied? | **NO** — all 3 tables missing from production |
