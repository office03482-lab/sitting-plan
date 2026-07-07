# Student/Parent Portal — Performance Trace

## Targets

| Metric | Target |
|---|---|
| Auth success → first usable data | ≤ 3 seconds |
| Timeout (abandon) | No 40s wait |
| Pending request hang | No 120s pending request |
| Hard refresh required | Never (soft navigation only) |
| Duplicate dashboard API storm | Zero duplicate calls |

## Critical Path Timing

```
supabase.auth.getSession()        ~200ms
    │
public.profiles lookup             ~100ms
    │
Student: public.students lookup    ~100ms
Parent: academic.guardians + s_g   ~200ms
    │
User object construction           ~10ms
    │
Redirect to dashboard              ~100ms
    │
Dashboard data fetch               ~500ms–2s
    │
First paint                         ≤ 3s total
```

## Anti-Patterns to Avoid

| Anti-Pattern | Guard |
|---|---|
| `setTimeout(..., 40000)` | Remove any 40s timer |
| `Promise.race` with 120s timeout | Remove or reduce to 10s |
| `window.location.reload()` | Use router.push only |
| Dashboard re-fetch on mount + effect | Deduplicate with single query |
| Sequential waterfall fetches | Parallelize independent queries |

## Monitoring

- Track `auth_time` → `dashboard_ready` span in production.
- Log warnings if bootstrap exceeds 3s.
- Client-side timeout at 10s with user-facing error message.
