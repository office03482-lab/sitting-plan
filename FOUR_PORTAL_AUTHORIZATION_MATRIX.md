# Four-Portal Authorization Matrix

## Core Principle

**Portal intent is NOT authorization.** The intent cookie only determines which bootstrap flow runs. Backend independently validates each portal's principal via its own dedicated lookup, irrespective of the intent claim.

## Matrix

| Intent | Principal Lookup | Authorizes | Session | Heartbeat |
|---|---|---|---|---|
| `school_erp` | `public.profiles` → `public.organization_memberships` | Teachers, staff, admins with active membership | Yes | Yes |
| `student_portal` | `public.profiles` → `public.students` (by profile_id) | Active students only | No | No |
| `parent_portal` | `public.profiles` → `academic.guardians` → `academic.student_guardians` | Active guardians with ≥1 linked student | No | No |
| `platform_admin` | `public.profiles` where `role = 'platform_admin'` | Platform-wide administrators | Yes | Yes |

## Enforcement Points

| Layer | Mechanism |
|---|---|
| Middleware | Intent cookie check; redirect to login if no session |
| Portal bootstrap | Resolve principal per intent; reject if not found |
| API routes | Validate user.role and user.school_id from session |
| Database RLS | Row-level security policies per table |

## Key Rules

- A user with a valid `school_erp` membership cannot access `student_portal` unless they also have a `public.students` record.
- A valid student cannot access `parent_portal` unless they also have an `academic.guardians` record.
- Cross-portal access is naturally gated by the principal lookup — each portal checks its own table.
