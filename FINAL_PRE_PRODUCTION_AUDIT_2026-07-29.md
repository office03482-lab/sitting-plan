# Final Pre-Production Audit

Date: Wednesday, July 29, 2026

## Final Decision

GO WITH CONDITIONS

The application is no longer in a broken-build state and the backend test suite passes, but it is not yet at a clean enterprise launch posture. The main blockers are deployment consistency, perimeter security controls, private file-handling assumptions, and incomplete mobile role coverage.

## Highest-Risk Findings

### High

1. Deployment configuration is inconsistent across production artifacts.
   - `backend/Dockerfile` exposes and serves port `10000`, while `docker-compose.yml` health checks and port mappings expect `8000`, and `frontend/Dockerfile` proxies `/api` to `http://backend:8000`.
   - Impact: containerized production deployments can fail health checks, fail intra-service routing, or behave differently across environments.

2. Render production config points Redis to `localhost`.
   - `render.yaml` sets `REDIS_URL=redis://localhost:6379/0` with no Redis service declared beside the backend.
   - Impact: any production path relying on Redis will silently degrade or fail depending on code path and runtime expectations.

3. Upload architecture assumes public URL access for every stored file.
   - `backend/app/services/supabase_storage.py` calls `get_public_url(...)` for all upload categories, including assignment submissions and live class recordings.
   - Impact:
   - If buckets are public, sensitive school/student content becomes internet-addressable.
   - If buckets are private, returned URLs may not work for clients.

4. Perimeter hardening is incomplete.
   - `backend/app/main.py` enables CORS, compression, and baseline security headers, but there is no Trusted Host middleware and no Content Security Policy.
   - Impact: host-header abuse protection and browser-side script policy enforcement are not at enterprise baseline yet.

### Medium

5. Mobile role coverage is incomplete for admin users.
   - `mobile/MOBILE_ADMIN_ROUTING_TODO.md` documents that `school_admin` and `platform_admin` journeys are not implemented in the active router.
   - Impact: mobile cannot be advertised as fully role-complete for school or platform administration.

6. Frontend test coverage exists but is narrow compared with surface area.
   - Web tests found: `6`
   - Mobile tests found: `0`
   - Impact: high-risk flows such as billing, offline exams, uploads, parent portal, and admin workflows remain under-verified at the UI level.

7. Runtime package hygiene needs cleanup.
   - `frontend/package.json` still ships `playwright` as a runtime dependency even though source usage was not found.
   - Impact: unnecessary install weight and avoidable attack surface in frontend CI/build environments.

## What Is Working Properly

- Frontend production build succeeds.
- Backend test suite passes: `114` tests.
- Route-level lazy loading is active in `frontend/src/App.tsx`.
- Manual chunk splitting is active in `frontend/vite.config.ts`.
- Backend response compression is enabled.
- Baseline security headers are enabled.
- Auth abuse controls exist for OTP and password login.
- Refresh token validation and logout invalidation exist.
- Offline exam web module is implemented and builds successfully.
- Billing surface is now aligned to Razorpay-only behavior across backend and mobile UI.
- Supabase migrations show broad RLS/policy coverage across major ERP domains.

## Module Status

- Frontend web: Ready with conditions
- Backend API: Ready with conditions
- Authentication: Ready with conditions
- Authorization/RBAC: Ready with conditions
- Offline exams: Ready with conditions
- Billing/payments: Ready with conditions
- Supabase/RLS foundation: Promising, but requires production policy revalidation
- File uploads/storage: Not ready without privacy/access review
- Mobile app: Not ready for full-role production claim
- DevOps/deployment: Not ready without config alignment
- Observability/SRE: Partial only

## Conditions Before Production Go-Live

1. Align all production deployment targets on one backend port and one routing contract.
2. Replace the Render Redis placeholder with a real managed Redis dependency or remove Redis assumptions from production.
3. Decide which upload buckets are private vs public, then replace blanket `get_public_url(...)` usage with signed/private access where required.
4. Add Trusted Host enforcement and a production CSP policy.
5. Define whether mobile launch scope excludes admin roles; if not, implement and test those routes first.
6. Add at least smoke coverage for web critical flows and basic Flutter navigation/auth tests.

## Production Stance

- Web launch for controlled school pilots: reasonable after the conditions above are closed.
- Full enterprise launch across web + mobile + billing-sensitive workflows: not recommended until those conditions are resolved.
