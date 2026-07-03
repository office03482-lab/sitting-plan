# BUG_REPORT

## Issue 1

- Severity: High
- Title: Unsupported payment providers were exposed in the customer commerce flow
- Root Cause:
  - `frontend/src/pages/CommercePage.tsx` presented `Stripe` and `Cashfree` as selectable providers.
  - Backend payment service only implements a working gateway path for `Razorpay`.
  - Unsupported providers resolve to `UnsupportedProviderGateway`, which raises `501 not implemented yet`.
- Files Changed:
  - `frontend/src/pages/CommercePage.tsx`
- Fix Applied:
  - Removed `Stripe` and `Cashfree` from the Commerce order form.
  - Updated the helper copy to say Razorpay is the active payment flow in this release.
- Verification:
  - `cd frontend && npm run build` -> PASS
  - `cd backend && python -m compileall app` -> PASS
  - `cd backend && pytest` -> PASS (`89 passed`)

## Issue 2

- Severity: High
- Title: Full end-to-end role UAT could not be executed from the current runtime session
- Root Cause:
  - No browser automation/control surface was available in the tools exposed for this session.
  - The requested role credentials and demo tenant dataset were not provisioned for live login testing.
- Files Changed:
  - None
- Fix Applied:
  - None in application code.
- Verification:
  - Not applicable

## Issue 3

- Severity: Low
- Title: Frontend production bundle is large
- Root Cause:
  - `vite build` warns that the main JS chunk exceeds the default chunk-size warning threshold.
- Files Changed:
  - None
- Fix Applied:
  - None during this pass.
- Verification:
  - `npm run build` completed successfully, but emitted the chunk-size warning.
