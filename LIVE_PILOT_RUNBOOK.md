# Live Pilot Deployment Runbook

## Purpose

This runbook is for deploying the first real paying school from an empty production-ready platform to a fully operational customer environment.

Use this document exactly in order. Do not skip validation gates.

## Scope

- No source-code changes
- No schema changes
- No emergency data patching unless rollback is triggered
- All checks must be recorded as `PASS` or `FAIL`

## Required Roles

- Deployment Engineer
- Platform Admin
- School Admin delegate
- Billing / finance contact
- School implementation contact

## Required Inputs Before Starting

- Production frontend URL
- Production backend URL
- Supabase project URL
- Supabase service-role access
- Supabase anon key
- SMTP / email provider credentials
- Razorpay production credentials
- DNS access for school domain or subdomain
- School legal name and display name
- School plan tier
- School billing contact
- School admin full name, email, and phone
- School branding assets
- Import files for staff, students, and parents

---

## Section 1: Pre-Deployment

### 1.1 Production URL Verification

Steps:
1. Open production frontend URL.
2. Open backend root URL.
3. Open backend `/health`.
4. Open backend `/readyz`.

Acceptance:
- Frontend URL loads over `https`
- Backend root returns API metadata
- `/health` returns `status=ok`
- `/readyz` returns `status=ready`

PASS/FAIL:
- Frontend URL:
- Backend root:
- `/health`:
- `/readyz`:

### 1.2 SSL and Domain Verification

Steps:
1. Check certificate on frontend domain.
2. Check certificate on backend domain if separate.
3. Confirm no mixed-content warnings in browser.
4. Confirm DNS resolves correctly from public internet.

Acceptance:
- Valid SSL certificate
- No browser security warning
- Correct DNS resolution
- No redirect loops

PASS/FAIL:
- Frontend SSL:
- Backend SSL:
- DNS:
- Mixed content:

### 1.3 Environment Variable Verification

Backend required values to verify:
- `ENVIRONMENT=production`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `USE_SUPABASE_NATIVE_SERVICES=true`
- `SMTP_EMAIL`
- `SMTP_PASSWORD`
- `SMTP_SERVER`
- `SMTP_PORT`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `CORS_ORIGINS`

Frontend required values to verify:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` or correct reverse-proxy path

Acceptance:
- No placeholder values remain
- Production secrets are non-empty
- CORS includes live frontend domain only
- Frontend Supabase URL matches backend Supabase project

PASS/FAIL:
- Backend env:
- Frontend env:
- Secret completeness:
- CORS:

### 1.4 Supabase Verification

Verify:
- Project reachable
- Auth enabled
- Profiles table reachable
- `school_memberships`, `roles`, `role_permissions` reachable
- Storage reachable

Acceptance:
- Platform Admin login works
- Supabase auth health is reachable
- Admin service-role queries succeed

PASS/FAIL:
- Supabase auth:
- Supabase data:
- Supabase storage:

### 1.5 Storage Bucket Verification

Verify required buckets exist:
- `lms-videos`
- `lms-documents`
- `lms-assignments`
- `assignment-submissions`
- `online-test-images`
- `live-class-recordings`
- `lms-notes`

Acceptance:
- All buckets exist
- Public/private access policy matches intended usage
- Upload and public URL generation work for a test file

PASS/FAIL:
- Bucket existence:
- Upload test:
- Public URL test:

### 1.6 Email Provider Verification

Steps:
1. Send test email to internal mailbox.
2. Send password-reset style test email.
3. Verify SPF/DKIM/DMARC are configured if provider supports it.

Acceptance:
- Email delivered
- No auth failure
- No obvious spam rejection for test mailbox

PASS/FAIL:
- SMTP auth:
- Delivery:
- DNS mail records:

### 1.7 Razorpay Verification

Steps:
1. Confirm production key ID and secret are installed.
2. Confirm webhook secret is configured.
3. Create a low-value test order.
4. Confirm webhook event can be received and verified.

Acceptance:
- Order creation succeeds
- Callback / webhook validation succeeds
- Payment record is written correctly

PASS/FAIL:
- Order creation:
- Webhook:
- Payment record:

### 1.8 Backups, Monitoring, and Logs

Verify:
- Database backup schedule
- Storage backup / retention policy
- Application logs
- Reverse proxy / infrastructure logs
- Error monitoring or alerting destination

Acceptance:
- Backup location documented
- Restore owner assigned
- Logs accessible to support team
- Alert destination documented

PASS/FAIL:
- DB backup:
- Storage backup:
- App logs:
- Infra logs:
- Monitoring:

---

## Section 2: Platform Verification

### 2.1 Backend Health

Steps:
1. Call `/health`
2. Call `/readyz`
3. Load `/docs`
4. Load `/redoc`

Acceptance:
- All four endpoints load
- No startup schema errors

PASS/FAIL:
- `/health`:
- `/readyz`:
- `/docs`:
- `/redoc`:

### 2.2 Frontend Verification

Steps:
1. Load login page
2. Verify no console fatal error
3. Verify API calls resolve against production backend

Acceptance:
- Login page renders fully
- No blank screen
- No failed bootstrap request blocking login

PASS/FAIL:
- UI load:
- Console clean:
- API bootstrap:

### 2.3 Database Verification

Verify:
- Production database reachable
- No pending critical migrations outside approved release
- Core platform tables accessible

Acceptance:
- Read/write operations succeed
- No schema mismatch errors at app startup

PASS/FAIL:
- Connectivity:
- Write test:
- Schema health:

### 2.4 Platform Admin Login

Steps:
1. Log in as Platform Admin
2. Open platform dashboard
3. Open schools page
4. Open subscriptions, usage, health, analytics, notifications

Acceptance:
- Login succeeds
- Platform routes load
- No permission denial for platform role

PASS/FAIL:
- Login:
- Dashboard:
- Platform modules:

---

## Section 3: School Provisioning

### 3.1 Create School

Steps:
1. Open Platform Onboarding Wizard
2. Enter school master data
3. Set plan tier
4. Enter School Admin data
5. Run onboarding

Acceptance:
- School row created
- School admin credentials generated
- School activation status is provisioned / active
- Audit event recorded

PASS/FAIL:
- School created:
- Admin provisioned:
- Audit entry:

### 3.2 Assign Plan

Steps:
1. Confirm assigned plan in platform subscriptions
2. Confirm limits align with contract
3. Confirm expiry / renewal metadata

Acceptance:
- Plan tier matches contract
- Student / teacher / storage limits are correct

PASS/FAIL:
- Plan tier:
- Limits:
- Renewal data:

### 3.3 Verify Onboarding and First Login

Steps:
1. Use generated School Admin credentials
2. Log in at production login URL
3. Force password change
4. Complete onboarding-required prompts

Acceptance:
- First login succeeds
- Password change enforced
- School Admin reaches default school workspace after completion

PASS/FAIL:
- Initial login:
- Password change:
- Post-login landing:

---

## Section 4: Academic Setup

### 4.1 Academic Session

Steps:
1. Set current academic session
2. Verify session visible in school settings or onboarding state

Acceptance:
- Academic session saved and visible

PASS/FAIL:
- Academic session:

### 4.2 Classes, Sections, Subjects, Departments, Rooms

Minimum setup:
- At least 1 academic session
- At least 3 classes
- At least 1 section per class
- At least 5 subjects
- Departments for staff allocation
- At least 5 rooms

Acceptance:
- Each dataset saves successfully
- Counts visible in relevant module
- No cross-school visibility

PASS/FAIL:
- Classes:
- Sections:
- Subjects:
- Departments:
- Rooms:

---

## Section 5: User Import

### 5.1 School Admin

Acceptance:
- School Admin active and able to log in

PASS/FAIL:
- School Admin:

### 5.2 Teachers, Staff, Students, Parents

Recommended pilot minimum:
- 5 teachers
- 5 non-teaching staff
- 25 students for first cutover
- 25 parents for first cutover

Steps:
1. Import or create teachers
2. Import or create non-teaching staff
3. Import students
4. Link or import parents
5. Generate portal access where applicable

Acceptance:
- Records created
- No duplicate / schema import failures
- Portal login generated where required
- Role-scoped visibility correct

PASS/FAIL:
- Teachers:
- Staff:
- Students:
- Parents:
- Portal access:

---

## Section 6: ERP Validation

Validate each module using school-scoped test users.

### 6.1 Attendance

Acceptance:
- Can mark attendance
- Can view report
- No scope leakage

PASS/FAIL:
- Attendance:

### 6.2 Timetable

Acceptance:
- Can create or view timetable entries
- Entries stay school-scoped

PASS/FAIL:
- Timetable:

### 6.3 Online Tests

Acceptance:
- Teacher can create test
- Student can attempt test
- Results render

PASS/FAIL:
- Online Tests:

### 6.4 LMS

Acceptance:
- Course content visible to intended role
- Assignment flow works

PASS/FAIL:
- LMS:

### 6.5 Inventory

Acceptance:
- Material or supplier entry works
- Inventory reports render

PASS/FAIL:
- Inventory:

### 6.6 Reports

Acceptance:
- Export or report view works for at least one module

PASS/FAIL:
- Reports:

### 6.7 AI

Validate:
- AI Tutor
- Teacher AI
- Study Planner
- Parent AI if enabled

Acceptance:
- AI request succeeds
- Usage decrements or usage record updates correctly
- Permission enforcement works

PASS/FAIL:
- AI Tutor:
- Teacher AI:
- Study Planner:
- Parent AI:

---

## Section 7: Billing Validation

### 7.1 Subscription

Acceptance:
- School plan is active
- Limits enforce correctly

PASS/FAIL:
- Subscription active:
- Limit enforcement:

### 7.2 Invoice

Acceptance:
- Invoice record exists or is generated per billing flow

PASS/FAIL:
- Invoice:

### 7.3 Renewal

Acceptance:
- Renewal date and subscription metadata are visible and correct

PASS/FAIL:
- Renewal:

### 7.4 AI Credits

Acceptance:
- AI wallet visible
- Consumption visible
- Insufficient-credit handling displays correctly

PASS/FAIL:
- Wallet:
- Consumption:
- Insufficient credits:

---

## Section 8: Role Validation

Validate each role separately:
- Platform Admin
- School Admin
- Teacher
- Staff
- Parent
- Student

For each role confirm:
- Can log in
- Lands in correct area
- Cannot access unauthorized modules
- Cannot access another school's data

PASS/FAIL:
- Platform Admin:
- School Admin:
- Teacher:
- Staff:
- Parent:
- Student:

---

## Section 9: Branding Validation

Verify:
- Logo
- Theme colors
- Portal name
- Login page branding
- Sidebar branding
- Favicon
- Email template rendering
- SMS template rendering

Acceptance:
- Branding appears only for that school
- Unknown host or invalid school hint does not show another school's branding

PASS/FAIL:
- Logo:
- Theme:
- Portal title:
- Login branding:
- Sidebar branding:
- Favicon:
- Email template:
- SMS template:
- Isolation:

---

## Section 10: Acceptance Checklist

Every item in [DEPLOYMENT_CHECKLIST.md](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/DEPLOYMENT_CHECKLIST.md) must be marked `PASS` before signoff.

Rule:
- Any `FAIL` in security, auth, isolation, billing, onboarding, or school-admin usability is a go-live blocker.

---

## Section 11: Rollback Plan

Trigger rollback if any of these occur:
- School cannot complete onboarding
- School Admin cannot log in after provisioning
- Cross-school data leakage
- Billing plan assigned incorrectly
- Critical module unavailable for core daily use

Rollback steps:
1. Stop further user provisioning for the affected school.
2. Capture logs and exact timestamps.
3. Restore latest known-good backup if data corruption occurred.
4. Set school status to suspended or inactive from Platform Control Plane.
5. Disable incomplete portal accounts if credentials were already issued.
6. Remove or archive incomplete operational data only through approved platform workflows.
7. Re-run provisioning only after root cause is documented.

Acceptance:
- School is safely isolated
- No broken partial access remains active
- Retry owner and next attempt time are assigned

PASS/FAIL:
- Rollback executable:
- Backup usable:
- Retry plan assigned:

---

## Section 12: Support Handover

Generate and deliver:
- Admin credential sheet
- School onboarding document
- Teacher quick guide
- Parent quick guide
- Student quick guide

Store handover pack:
- In approved secure location
- With access limited to school implementation stakeholders

Acceptance:
- All documents delivered
- School Admin acknowledges receipt
- Support owner for first 7 days assigned

PASS/FAIL:
- Admin credential sheet:
- Onboarding guide:
- Teacher guide:
- Parent guide:
- Student guide:
- Ownership assigned:

---

## Final Gate

Go live only if:
1. All mandatory steps above are `PASS`
2. No blocker remains in auth, isolation, billing, or onboarding
3. School Admin can operate without developer assistance
