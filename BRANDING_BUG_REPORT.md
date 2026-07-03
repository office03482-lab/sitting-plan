# Branding Bug Report

## Bug 1

- Title: Unknown domain could leak another school's branding
- Severity: Critical
- Area: Login branding resolution
- Root cause:
  - `get_public_school_branding()` could fall back to the first `schools` row when hostname or school hint did not resolve.
  - In a multi-school SaaS environment this risks showing School A branding to School B or to an unknown tenant host.
- Files:
  - `backend/app/services/school_self_service.py`
- Fix:
  - normalized forwarded hosts
  - stripped port information
  - removed unsafe fallback for unresolved school hints and unknown hosts
  - preserved neutral default branding instead
- Status: Fixed

## Bug 2

- Title: Authenticated app shell did not fully apply school branding
- Severity: High
- Area: Post-login branding experience
- Root cause:
  - school branding in the shell was only partially applied
  - document title and favicon did not consistently update after login
  - shell colors did not reflect school branding
- Files:
  - `frontend/src/components/Layout.tsx`
  - `frontend/src/pages/Login.tsx`
- Fix:
  - school branding now updates sidebar logo and portal title
  - school branding now updates document title and favicon after login
  - shell gradients now use school branding colors
- Status: Fixed

## Validation

- `python -m compileall app` -> `PASS`
- `pytest` -> `PASS` (`93 passed`)
- `npm run build` -> `PASS`

## Residual Risk

- Live browser/device/domain UAT is still pending.
- Real asset caching and end-user performance under production CDN conditions remain unverified here.
