# PHASE6D Branding UAT Report

## Scope

Phase 6D was treated as a validation and hardening sprint for multi-school branding isolation. No authentication, billing, platform control plane, or tenant-isolation redesign was performed.

## Demo School Matrix

The UAT dataset covered these three independent school identities:

1. `Aspire IIT & Medical`
   - Theme: Blue
   - Domain coverage: `school1.yourdomain.com`, `portal.aspire-school.com`
2. `Delhi Public School`
   - Theme: Green
   - Domain coverage: `school2.yourdomain.com`, `portal.dps-school.com`
3. `St. Xavier School`
   - Theme: Red
   - Domain coverage: `school3.yourdomain.com`, `portal.xavier-school.com`

## Bugs Found

1. Unknown school hint or host could fall back to the first school row and leak another tenant's branding on the login screen.
2. Authenticated app shell branding was incomplete:
   - document title was not school-branded
   - favicon was not school-branded after login
   - app shell colors were not using school branding colors

## Fixes Applied

### Backend

- Hardened `backend/app/services/school_self_service.py`
  - added hostname normalization for forwarded hosts with ports
  - prevented fallback to the first school when school hint or host does not resolve
  - preserved neutral default branding for unknown domains or invalid school hints

### Frontend

- Updated `frontend/src/components/Layout.tsx`
  - school branding now drives sidebar logo, portal title, favicon, document title, and shell color theme
  - platform admins remain excluded from school self-service navigation
- Updated `frontend/src/pages/Login.tsx`
  - school branding now updates login document title
  - login favicon continues to resolve per school

### Test Coverage Added

- Added `backend/tests/test_phase6d_branding_uat.py`
  - verifies 3-school branding resolution by domain and school hint
  - verifies unknown host/hint never leaks another school's branding
  - verifies school-scoped templates, storage assets, and backups
  - verifies missing logo/banner/favicon fallback behavior

## Validation Results

### Python Compile

- Command: `python -m compileall app`
- Result: `PASS`

### Backend Tests

- Command: `pytest`
- Result: `PASS`
- Summary: `93 passed`

### Frontend Build

- Command: `npm run build`
- Result: `PASS`
- Note: Vite emitted chunk-size warnings only.

## What Was Verified

- Multi-school login branding resolution by:
  - school code
  - school hint
  - subdomain
  - custom domain
  - forwarded host with port
- No cross-tenant branding leak on unknown host/hint
- School-scoped storage and backup visibility at service level
- Broken-asset fallback for missing logo, banner, and favicon
- Authenticated shell title, favicon, and theme application now use school branding

## What Was Not Fully Verified In A Live Runtime

- Real browser UAT across desktop, tablet, and mobile
- Actual provision of three live schools against a connected Supabase environment
- Real asset loading timings and browser cache timings
- Real certificate/report-card render surfaces, if they exist in production modules outside the branding layer
- Role-by-role interactive browser walkthrough for platform admin, teacher, parent, and student

## Files Modified For Phase 6D

- `backend/app/services/school_self_service.py`
- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/Login.tsx`
- `backend/tests/test_phase6d_branding_uat.py`

## Final Verdict

- `BRANDING READY = NO`
- `GO LIVE READY = NO`

Reason: multi-school branding isolation bugs were fixed and automated validation is green, but the required live 3-school browser UAT and real domain-based end-to-end verification were not completed in this environment.
