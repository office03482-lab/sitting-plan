# GO_LIVE_CHECKLIST

## Runtime readiness

- [x] Backend health endpoint responds
- [x] Swagger/OpenAPI is reachable
- [x] Frontend dev server responds
- [x] Backend compiles
- [x] Backend automated regression suite passes
- [x] Frontend production build passes

## Customer workflow safety

- [x] Known customer-facing payment dead end in Commerce page removed
- [ ] Full browser click-path validation completed
- [ ] All role logins validated live
- [ ] Platform Admin workflows validated live
- [ ] School Admin workflows validated live
- [ ] Teacher workflows validated live
- [ ] Non-Teaching Staff workflows validated live
- [ ] Parent workflows validated live
- [ ] Student workflows validated live
- [ ] External Student workflows validated live
- [ ] Cross-tenant isolation validated through live browser behavior

## Data readiness

- [ ] Demo schools provisioned
- [ ] Demo academic structures provisioned
- [ ] Demo users provisioned for every required role
- [ ] Billing/catalog demo products provisioned

## Performance and UX

- [x] Frontend build completes
- [ ] Page-by-page responsive review completed
- [ ] Mobile review completed
- [ ] Loading, empty states, validation, and success/error states reviewed live
- [ ] Table/search/filter/pagination behavior reviewed live
- [ ] Main bundle size warning addressed or explicitly accepted

## Blocking items before sign-off

1. Provision live demo tenants and credentials for all required roles.
2. Run a true browser-driven UAT pass across the full role matrix and module list.
3. Reconfirm cross-tenant isolation from the live UI, not only automated backend tests.

## Current release status

GO LIVE BLOCKED
