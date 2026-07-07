# Student Principal — Source of Truth

## Authority Chain

```
auth.users.id
    │
    ▼  (1:1)
public.profiles.id
    │
    ▼  (N:1 — many students? No, 1:1 per design)
public.students.profile_id
```

- `auth.users` — Supabase authentication identity.
- `public.profiles` — Profile record keyed to auth user.
- `public.students` — **Authoritative student record**. Linked by `students.profile_id` → `profiles.id`.

## Critical Fields

| Field | Purpose |
|---|---|
| `students.is_active` | Portal access gate. `false` = 403. |
| `students.school_id` | School context. Determines which school's data the student sees. |
| `students.profile_id` | FK to `profiles.id`. Establishes link to auth identity. |

## Rules

1. `students` is the single source of truth for **student-ness**. Profile role field is NOT authoritative.
2. `students.is_active` must be `true` for portal access. Past students are deactivated, not deleted.
3. `students.school_id` is immutable per portal session. School switching is not supported for students.
4. No other table (memberships, roles) contributes to student identity.

## Query Pattern

```sql
SELECT s.* FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE p.id = <auth_user_id> AND s.is_active = true;
```
