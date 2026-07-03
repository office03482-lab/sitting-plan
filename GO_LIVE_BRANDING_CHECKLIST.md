# Go Live Branding Checklist

## Provisioning

- [ ] Create `Aspire IIT & Medical`
- [ ] Create `Delhi Public School`
- [ ] Create `St. Xavier School`
- [ ] Provision school admin for each school
- [ ] Provision teacher, non-teaching staff, student, and parent users for each school
- [ ] Confirm active subscription record for each school

## Branding Setup

- [ ] Upload logo for each school
- [ ] Upload banner for each school
- [ ] Upload favicon for each school
- [ ] Set primary, secondary, and accent colors for each school
- [ ] Set portal name and tagline for each school
- [ ] Set welcome message and footer for each school
- [ ] Save email templates per school
- [ ] Save SMS / WhatsApp templates per school

## Domain Resolution

- [ ] Verify `school1.yourdomain.com`
- [ ] Verify `school2.yourdomain.com`
- [ ] Verify `school3.yourdomain.com`
- [ ] Verify custom domains if enabled
- [ ] Confirm forwarded host with port still resolves correctly
- [ ] Confirm unknown domains show neutral fallback branding only

## Role Validation

- [ ] Platform admin login checked
- [ ] School admin login checked
- [ ] Teacher login checked
- [ ] Parent login checked
- [ ] Student login checked
- [ ] Every role sees only its own school's branding

## Surface Validation

- [ ] Login page logo is correct
- [ ] Login page banner/background is correct
- [ ] Login page favicon is correct
- [ ] Login page title is correct
- [ ] Sidebar branding is correct
- [ ] Authenticated portal title is correct
- [ ] Authenticated favicon is correct
- [ ] School theme colors are correct after login
- [ ] Storage page shows only current school assets
- [ ] Backup page shows only current school backups
- [ ] Email templates are school-specific
- [ ] SMS templates are school-specific

## Isolation Validation

- [ ] School A cannot see School B logo
- [ ] School A cannot see School B templates
- [ ] School A cannot see School B storage
- [ ] School A cannot see School B backups
- [ ] Invalid school hint does not leak another school's branding
- [ ] Unknown host does not leak another school's branding

## Broken Asset Validation

- [ ] Missing logo fallback checked
- [ ] Missing banner fallback checked
- [ ] Missing favicon fallback checked

## Device Validation

- [ ] Desktop browser checked
- [ ] Tablet viewport checked
- [ ] Mobile viewport checked

## Technical Validation

- [x] `python -m compileall app`
- [x] `pytest`
- [x] `npm run build`

## Go / No-Go Rule

- Go live only when every unchecked item above is completed in a live environment and no cross-tenant branding leak is observed.
