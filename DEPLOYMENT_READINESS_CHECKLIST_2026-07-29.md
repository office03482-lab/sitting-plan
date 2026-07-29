# Deployment Readiness Checklist

Date: July 29, 2026

## Application Build

- [x] Frontend production build passes with Vite
- [x] Backend automated tests pass
- [ ] Flutter toolchain installed on deployment workstation
- [ ] `flutter analyze` executed
- [ ] `flutter build apk` executed if mobile release is required

## Frontend Runtime

- [x] Route-level lazy loading enabled for page modules
- [x] Manual vendor chunk splitting configured
- [x] Error boundaries present at the app shell level
- [ ] Add real-user monitoring for route load time and chunk failure tracking
- [ ] Review `playwright` as an unused runtime dependency and move/remove in the next lockfile refresh

## Backend Runtime

- [x] `/health` endpoint present
- [x] `/readyz` endpoint validates database connectivity
- [x] Slow-request profiling middleware enabled
- [x] Observability middleware enabled
- [x] GZip compression enabled for responses above the configured threshold
- [x] Security headers middleware enabled
- [ ] Add structured log shipping to a centralized sink
- [ ] Add production alerting for 5xx rate, latency, and webhook failure rate

## Security

- [x] Production config blocks unsafe JWT secret values
- [x] Production config blocks SQLite in production
- [x] CORS is allowlist-based rather than wildcard-based
- [x] Offline exams, billing, auth, and portal routes remain permission-protected
- [x] Browser security headers added
- [ ] Add explicit trusted host enforcement once production hostnames are finalized
- [ ] Add secret rotation runbook for JWT, Supabase service role, Razorpay, SMTP, and Gemini credentials

## Billing

- [x] Billing runtime provider matrix aligned to Razorpay only
- [x] Mobile and web UI no longer advertise unsupported gateways
- [x] Billing tests remain green
- [ ] Replay-test Razorpay webhook handling in a production-like environment
- [ ] Validate invoice/refund lifecycle against live credentials before go-live

## Database / Supabase

- [x] Supabase-native architecture is in use across major ERP modules
- [ ] Run `EXPLAIN ANALYZE` on the highest-volume attendance, inventory, reporting, and parent-portal queries
- [ ] Review duplicate and unused indexes in Supabase
- [ ] Reconfirm RLS and service-role boundaries on billing, analytics, AI, and parent data paths
- [ ] Verify backup restore drill and rollback timings

## Operations

- [ ] Confirm environment variables are present for production
- [ ] Enable HTTPS termination and HSTS at the edge
- [ ] Enable asset caching/compression at CDN or reverse proxy
- [ ] Document rollback procedure for frontend and backend deployments
- [ ] Confirm database backup frequency and retention policy
- [ ] Confirm incident owner and escalation path

## Smoke Test Before Release

- [ ] Authentication login/logout/password reset
- [ ] Student management CRUD/import
- [ ] Teacher management CRUD
- [ ] Attendance dashboards and marking flows
- [ ] Offline exams create/edit/publish/evaluate/results
- [ ] Online tests create/take/results
- [ ] Question bank create/edit/import
- [ ] Inventory CRUD/reporting
- [ ] Billing order creation and payment verification
- [ ] Parent portal dashboard/attendance/results
- [ ] Platform admin dashboard and school management
