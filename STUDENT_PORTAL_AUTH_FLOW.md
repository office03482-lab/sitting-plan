# Student Portal Auth Flow (Bootstrap)

## Sequence

```
supabase.auth.getSession()
        │
        ▼
public.profiles lookup by auth.user.id
        │
        ▼
public.students lookup by students.profile_id = profiles.id
        │
        ▼
Verify students.is_active = true
        │
        ▼
Build user object:
  - role: 'student'
  - school_id: from students.school_id
  - permissions: none (not resolved)
        │
        ▼
Skip session registration (no sessions table entry)
        │
        ▼
Skip heartbeat (no periodic keep-alive)
        │
        ▼
Redirect to /student/dashboard
```

## Key Decisions

- **No permissions**: Students have no role-based permissions object. Dashboard rendering relies on school-level config, not user-level permissions.
- **No session registration**: The student and parent portals are lightweight; no server-side session tracking.
- **No heartbeat**: Reduces server load. Student sessions rely on supabase auth token expiry.
- **is_active gate**: If `students.is_active` is false, request is denied with 403.
- **school_id provenance**: Always from `students.school_id`, never from profile or auth metadata.

## Error States

| Condition | Result |
|---|---|
| No supabase session | Redirect to login |
| Profile not found | 403 Forbidden |
| Student record not found | 403 Forbidden |
| Student not active | 403 Forbidden |
