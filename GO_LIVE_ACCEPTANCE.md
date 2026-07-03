# Go Live Acceptance

## Rule

Every line must be marked `PASS` or `FAIL`.

No subjective answers are allowed.

Any `FAIL` in a blocker row means launch is blocked.

## Acceptance Matrix

### Blocker Checks

| Check | PASS/FAIL |
|---|---|
| Production frontend URL is reachable over HTTPS |  |
| Production backend `/health` returns OK |  |
| Production backend `/readyz` returns READY |  |
| Platform Admin can log in |  |
| School can be provisioned successfully |  |
| School Admin can log in successfully |  |
| First-login password change is enforced |  |
| No cross-school data leakage observed |  |
| No cross-school branding leakage observed |  |
| Subscription plan is assigned correctly |  |
| Billing flow is operational |  |
| Backup and rollback plan is available |  |

### Operational Checks

| Check | PASS/FAIL |
|---|---|
| Academic session configured |  |
| Classes configured |  |
| Sections configured |  |
| Subjects configured |  |
| Departments configured |  |
| Rooms configured |  |
| Teachers created/imported |  |
| Staff created/imported |  |
| Students created/imported |  |
| Parents linked/imported |  |
| Attendance operational |  |
| Timetable operational |  |
| LMS operational |  |
| Online Tests operational |  |
| Inventory operational |  |
| Reports operational |  |
| AI operational |  |

### Role Checks

| Role | PASS/FAIL |
|---|---|
| Platform Admin |  |
| School Admin |  |
| Teacher |  |
| Staff |  |
| Parent |  |
| Student |  |

### Branding Checks

| Check | PASS/FAIL |
|---|---|
| Logo correct |  |
| Theme correct |  |
| Portal title correct |  |
| Login branding correct |  |
| Sidebar branding correct |  |
| Email template correct |  |
| SMS template correct |  |

### Support Readiness Checks

| Check | PASS/FAIL |
|---|---|
| Admin credential sheet delivered securely |  |
| School onboarding document delivered |  |
| Teacher quick guide delivered |  |
| Parent quick guide delivered |  |
| Student quick guide delivered |  |
| Hypercare owner assigned |  |

## Acceptance Decision

Decision logic:
- If every blocker check is `PASS`, and no operational check required for launch is `FAIL`, the school is accepted for go live.
- If any blocker check is `FAIL`, go live is rejected.

## Final Verdict

- `Ready for First Paying School = YES / NO`

Use `YES` only when every required operational item is documented, executed, and signed off as `PASS`.
