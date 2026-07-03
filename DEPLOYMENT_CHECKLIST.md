# Deployment Checklist

## Instructions

- Mark every line `PASS` or `FAIL`
- Do not leave blanks at final signoff
- Any `FAIL` in a blocker item means go-live is blocked

## Pre-Deployment

| Item | PASS/FAIL |
|---|---|
| Frontend production URL reachable over HTTPS |  |
| Backend root URL reachable |  |
| `/health` returns OK |  |
| `/readyz` returns READY |  |
| Frontend SSL valid |  |
| Backend SSL valid |  |
| DNS resolves correctly |  |
| No mixed-content warning |  |
| Backend env vars configured |  |
| Frontend env vars configured |  |
| No placeholder secrets remain |  |
| Supabase auth reachable |  |
| Supabase data access verified |  |
| Supabase storage verified |  |
| Required storage buckets exist |  |
| SMTP auth verified |  |
| Test email delivered |  |
| Razorpay keys verified |  |
| Razorpay webhook verified |  |
| Database backup verified |  |
| Storage backup verified |  |
| Logs accessible |  |
| Monitoring and alerting active |  |

## Platform Verification

| Item | PASS/FAIL |
|---|---|
| Backend health verified |  |
| API docs accessible |  |
| Frontend login page loads |  |
| Platform Admin login works |  |
| Platform dashboard works |  |
| Schools page works |  |
| Subscriptions page works |  |
| Usage page works |  |
| Health page works |  |
| Analytics page works |  |
| Notifications page works |  |

## School Provisioning

| Item | PASS/FAIL |
|---|---|
| School created successfully |  |
| Plan assigned correctly |  |
| School Admin provisioned |  |
| Admin credentials issued securely |  |
| First login succeeds |  |
| Password change enforced |  |
| Post-login landing page correct |  |
| Audit entries created |  |

## Academic Setup

| Item | PASS/FAIL |
|---|---|
| Academic session configured |  |
| Classes configured |  |
| Sections configured |  |
| Subjects configured |  |
| Departments configured |  |
| Rooms configured |  |

## User Import

| Item | PASS/FAIL |
|---|---|
| School Admin active |  |
| Teachers imported or created |  |
| Non-teaching staff imported or created |  |
| Students imported or created |  |
| Parents linked or imported |  |
| Portal access generated where needed |  |

## ERP Validation

| Item | PASS/FAIL |
|---|---|
| Attendance works |  |
| Timetable works |  |
| Online Tests work |  |
| LMS works |  |
| Inventory works |  |
| Reports work |  |
| AI Tutor works |  |
| Teacher AI works |  |
| Study Planner works |  |
| Parent Portal works |  |

## Billing Validation

| Item | PASS/FAIL |
|---|---|
| Subscription status correct |  |
| Plan limits correct |  |
| Invoice flow verified |  |
| Renewal metadata correct |  |
| AI wallet visible |  |
| AI credit usage decrements correctly |  |
| Insufficient AI credits handled correctly |  |

## Role Validation

| Item | PASS/FAIL |
|---|---|
| Platform Admin permissions correct |  |
| School Admin permissions correct |  |
| Teacher permissions correct |  |
| Staff permissions correct |  |
| Parent permissions correct |  |
| Student permissions correct |  |
| Scope isolation verified |  |
| School isolation verified |  |
| Brand isolation verified |  |

## Branding Validation

| Item | PASS/FAIL |
|---|---|
| School logo correct |  |
| Theme colors correct |  |
| Portal title correct |  |
| Login branding correct |  |
| Sidebar branding correct |  |
| Favicon correct |  |
| Email template correct |  |
| SMS template correct |  |
| Unknown domain does not leak branding |  |

## Rollback Readiness

| Item | PASS/FAIL |
|---|---|
| Backup restore procedure documented |  |
| School disable path confirmed |  |
| Incomplete provisioning cleanup path documented |  |
| Retry owner assigned |  |

## Handover

| Item | PASS/FAIL |
|---|---|
| Admin credential sheet delivered |  |
| School onboarding document delivered |  |
| Teacher quick guide delivered |  |
| Parent quick guide delivered |  |
| Student quick guide delivered |  |
| Hypercare support owner assigned |  |

## Final Decision

| Decision | PASS/FAIL |
|---|---|
| Ready for First Paying School |  |
