# Parent/Guardian Relationship — Source of Truth

## Authority Chain

```
auth.users.id
    │
    ▼  (1:1)
public.profiles.id
    │
    ▼  (1:1 — one guardian record per profile)
academic.guardians.profile_id
    │
    ▼  (1:N — one guardian, many students)
academic.student_guardians (junction table)
    │
    ▼  (N:1)
public.students.id
```

## Critical Fields

| Table | Field | Purpose |
|---|---|---|
| `academic.guardians` | `profile_id` | Links to auth identity |
| `academic.guardians` | `school_id` | Parent's school context |
| `academic.guardians` | `is_active` | Portal access gate |
| `academic.student_guardians` | `guardian_id` | FK to guardians |
| `academic.student_guardians` | `student_id` | FK to students |
| `academic.student_guardians` | `relationship` | e.g. 'father', 'mother' |

## Rules

1. `academic.guardians` is the single source of truth for **guardian-ness**.
2. A guardian may be linked to **multiple students** across the same school.
3. Parent access is **relationship-scoped** — backend enforces that the parent can only access data for their linked `student_ids`.
4. Arbitrary `student_id` selection in API calls is rejected by backend validation against `linked_student_ids`.
5. A guardian with zero linked students is denied portal access (403).

## Query Pattern (Linked Students)

```sql
SELECT s.* FROM public.students s
JOIN academic.student_guardians sg ON sg.student_id = s.id
JOIN academic.guardians g ON g.id = sg.guardian_id
WHERE g.profile_id = <auth_user_id> AND g.is_active = true;
```
