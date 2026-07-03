# Go Live Signoff

## Current Signoff Status

- Engineering baseline: `PASS`
- Real pilot validation: `NOT SIGNED OFF`
- Commercial launch signoff: `NOT SIGNED OFF`

## Evidence Completed

- [x] Backend compiles
- [x] Backend automated tests pass
- [x] Frontend production build passes
- [x] Local system readiness check passes
- [x] Branding isolation automated coverage exists
- [x] Tenant isolation automated coverage exists
- [x] Subscription and billing automated coverage exists

## Evidence Still Required Before Signoff

- [ ] Provision 3 live pilot schools
- [ ] Create real pilot users per school
- [ ] Verify onboarding and first-login handoff
- [ ] Verify password change and password reset flows
- [ ] Verify school suspension and reactivation behavior
- [ ] Verify platform admin control plane operations in a live tenant environment
- [ ] Verify teacher, staff, parent, and student day-to-day usage
- [ ] Verify attendance, timetable, LMS, online tests, reports, inventory, AI tools, and parent portal in browser
- [ ] Verify subscription lifecycle and invoice visibility
- [ ] Verify AI credits depletion and insufficient-credit handling
- [ ] Verify desktop, tablet, Android, and iPhone behavior
- [ ] Verify slow-network and large-dataset usability
- [ ] Verify no school requires developer intervention during normal operation

## Signoff Decision

- `Pilot Ready = NO`
- `Commercial Launch Ready = NO`

## Why

The platform currently has a strong automated and build-verified baseline, but it has not yet passed the live pilot acceptance bar defined for Phase 7. A real school cannot be certified as fully self-sufficient until the live multi-school pilot and role-based browser UAT are completed successfully.
