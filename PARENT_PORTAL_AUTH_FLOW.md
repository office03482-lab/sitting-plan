# Parent Portal Auth Flow (Bootstrap)

## Sequence

```
supabase.auth.getSession()
        │
        ▼
public.profiles lookup by auth.user.id
        │
        ▼
academic.guardians lookup by guardians.profile_id = profiles.id
        │
        ▼
Verify guardian is active
        │
        ▼
academic.student_guardians query for linked students
  (require at least 1 linked student)
        │
        ▼
Build user object:
  - role: 'parent'
  - school_id: from guardians.school_id
  - permissions: none (not resolved)
  - linked_student_ids: from student_guardians
        │
        ▼
Skip session registration
        │
        ▼
Skip heartbeat
        │
        ▼
Redirect to /parent/dashboard
```

## Key Decisions

- **Guardian lookup**: Uses `academic.guardians` schema, not `public` schema.
- **Minimum one student**: A guardian with zero linked students cannot access the portal.
- **Relationship-scoped**: Parent can only see/act on their linked students. Backend enforces this via `linked_student_ids`.
- **school_id**: Derived from `guardians.school_id`, not the student's school.

## Error States

| Condition | Result |
|---|---|
| No supabase session | Redirect to login |
| Profile not found | 403 Forbidden |
| Guardian record not found | 403 Forbidden |
| Guardian not active | 403 Forbidden |
| Zero linked students | 403 Forbidden |
