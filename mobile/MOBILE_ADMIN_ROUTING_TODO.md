## Mobile Admin Routing TODO

Date reviewed: July 29, 2026

Conclusion:
The mobile README previously claimed support for school admin and platform admin journeys, but the active router currently exposes only `student/*`, `teacher/*`, and `parent/*` routes.

Evidence:
- Router redirect logic in `mobile/lib/app/router/app_router.dart` defaults non-student and non-parent users into the `teacher/*` namespace.
- Declared shell routes are limited to student, teacher, and parent pages.
- Core profile models already distinguish `school_admin` and `platform_admin`, so this is an implementation gap rather than a pure data-model gap.

Safe next steps:
- Add dedicated `school-admin/*` routes only after the required admin pages are designed and approved.
- Add dedicated `platform-admin/*` routes only after platform-specific mobile UX is defined.
- Keep teacher routes scoped to teacher/staff flows; do not silently reuse them as admin substitutes.
- Add Flutter navigation tests that assert role-to-route mapping for student, parent, teacher, school admin, and platform admin.

Current production stance:
- Student mobile journey: partially implemented
- Parent mobile journey: partially implemented
- Teacher mobile journey: partially implemented
- School admin mobile journey: not implemented in router
- Platform admin mobile journey: not implemented in router
