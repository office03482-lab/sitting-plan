# Current Multi-Portal Extension Points (Phase 2.6-2.7)

## Portal Intents

| Intent | Target |
|---|---|
| `school_erp` | School ERP app |
| `student_portal` | Student self-service |
| `parent_portal` | Parent/guardian portal |
| `platform_admin` | Platform-wide admin |

## What's Implemented

- **school_erp**: Full auth with memberships, permissions, session registration, heartbeat, redirect to `/school/dashboard`.
- **platform_admin**: Full auth via `platform_admin` role in profiles, redirect to `/platform/admin`.
- **student_portal**: Auth scaffold — supabase auth → profile → students lookup by profile_id → role=`student`, school_id from student, **no session registration**, **no heartbeat**, redirect to `/student/dashboard`.
- **parent_portal**: Auth scaffold — supabase auth → profile → academic.guardians lookup → academic.student_guardians → role=`parent`, school_id from guardian, **no session registration**, **no heartbeat**, redirect to `/parent/dashboard`.

## Extension Points

| Point | File | Purpose |
|---|---|---|
| Portal route guard | `middleware.ts` | Inspect intent cookie, redirect unauthenticated |
| Bootstrap function | `lib/auth/portal-auth.ts` | Per-intent principal resolution |
| Intent enum | `lib/auth/types.ts` | Define portal intent strings |
| Login page | `app/(auth)/login/page.tsx` | Intent-aware login form |
| Dashboard redirect | Per-portal layout | Post-auth redirect target |

## Adding a New Portal Intent

1. Add intent string to `PortalIntent` type/enum.
2. Add `case` in portal bootstrap dispatch.
3. Add route guard case in middleware.
4. Create dashboard page under `/(portals)/<intent>/dashboard`.
