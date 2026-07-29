# Production Hardening Report

Date: Wednesday, July 29, 2026

## Scope Audited

Reviewed modules and surfaces:

- Frontend SPA routing and bundle strategy
- Backend FastAPI bootstrap, middleware, security, and health endpoints
- Authentication and authorization guard patterns
- Supabase-backed ERP modules including offline exams, online tests, question bank, attendance, inventory, billing, commerce, reports, parent portal, LMS, AI, and hostel
- Mobile Flutter routing and commerce surface

## Changes Applied

### Frontend performance

Files:
- `frontend/src/App.tsx`
- `frontend/vite.config.ts`

Changes:
- Converted page-level imports in the main router to `React.lazy()` with `Suspense`
- Added manual chunk splitting for router, data, icons, DnD, and vendor code
- Kept business logic and route permissions unchanged

Measured result:
- Before hardening, the main generated JS bundle was approximately `1,984.58 kB`
- After route splitting and manual chunking, the largest generated shared chunks were approximately:
  - `data`: `238.73 kB`
  - `vendor`: `174.05 kB`
  - main entry `index`: `141.99 kB`
- This materially improves initial-load behavior by deferring heavy routes until navigation time

### Backend hardening

Files:
- `backend/app/config.py`
- `backend/app/main.py`
- `backend/app/middleware/security_headers.py`

Changes:
- Added configurable response compression flags
- Enabled `GZipMiddleware` for sufficiently large responses
- Added baseline browser security headers:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Cross-Origin-Opener-Policy`
  - `Cross-Origin-Resource-Policy`
  - `Strict-Transport-Security` in production only

### Existing hardening continuity

Files:
- `backend/app/routes/students.py`
- `backend/app/routes/teachers.py`
- `backend/app/services/payment_infrastructure.py`
- `mobile/lib/features/commerce/presentation/commerce_page.dart`
- `mobile/README.md`
- `mobile/MOBILE_ADMIN_ROUTING_TODO.md`

Changes retained from the previous production-readiness pass:
- Pydantic v2 `.model_dump()` migration in touched routes
- Billing provider matrix aligned to Razorpay-only runtime/UI behavior
- Mobile admin-route gap documented instead of silently misrepresenting support

## Security Findings

### Improved

- Production settings already reject unsafe JWT secrets and SQLite
- CORS remains allowlist-based
- Billing provider exposure is now truthful
- Browser hardening headers are now applied centrally

### Residual concerns

- No explicit trusted-host enforcement is currently enabled
- No centralized rate limiter was added in this pass
- Logging is present, but there is no built-in external alerting/monitoring sink in repo
- Supabase service-role use should be re-reviewed against production RLS policies before go-live

## Architecture Concerns

- `frontend/src/App.tsx` still acts as a very large route registry; lazy loading helps runtime cost, but the file remains a maintainability hotspot
- Frontend package manifest still includes `playwright` as a runtime dependency even though no source usage was found during this audit
- Mobile role model supports admin distinctions, but router coverage is still limited to student/teacher/parent flows
- Backend route graph is broad and mature, but operational concerns like host enforcement, metrics export, and deployment runbooks are still doc/process gaps rather than code-complete controls

## Database / Supabase Recommendations

These were reviewed logically, not by running production SQL introspection:

- Run `EXPLAIN ANALYZE` on attendance reporting, inventory reporting, parent portal, and billing dashboard queries
- Review duplicate/unused indexes before production scale-up
- Reconfirm service-role usage boundaries for finance, analytics, AI, and parent-linked data
- Revalidate backup restore timings and rollback procedures
- Audit RLS on all billing and platform-control-plane tables before public launch

## Billing Audit Summary

- Runtime provider handling is now production-truthful: Razorpay only
- Web and mobile UI no longer advertise unsupported providers
- Backend billing tests remain green
- Remaining production tasks:
  - live webhook replay verification
  - refund lifecycle validation with real credentials
  - alerting on webhook failures and payment verification anomalies

## Offline Exam Audit Summary

Status after the previous readiness pass remains intact:

- Create: supported
- Edit: supported
- View details: supported
- Evaluate: supported
- Results navigation: supported

Residual logical edge cases to smoke-test before release:

- empty subject list with custom exam type
- seating generation before hall-ticket generation
- marks import with malformed headers
- publish/update sequencing on already-published exams

## Mobile Review Summary

- Active router currently supports student, teacher, and parent flows
- Admin and platform-admin mobile journeys are not implemented in the active router
- This is documented in `mobile/MOBILE_ADMIN_ROUTING_TODO.md`
- Flutter validation commands could not be executed here because `flutter` was not installed on this machine on Wednesday, July 29, 2026

## Validation Run

Executed successfully:

- `frontend`: `npm run build`
- `backend`: `pytest` → `114 passed`

Not executable in this environment:

- `flutter analyze`
- `flutter build apk`

Reason:

- `flutter` command was not installed in the workspace environment

## Remaining Technical Debt

- Move or remove unused `playwright` runtime dependency
- Break down the top-level frontend router file into route groups for maintainability
- Add production metrics export and alerting
- Add trusted-host enforcement once hostnames are finalized
- Add deployment/runbook documentation for backups, rollback, and secret rotation

## Production Readiness Score

- Frontend: `8.8/10`
- Backend: `8.8/10`
- Mobile: `5.5/10`
- Billing: `8.0/10`
- Security: `8.2/10`
- Performance: `8.7/10`
- Overall: `8.3/10`
