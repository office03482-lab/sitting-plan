## PLATFORM NOTIFICATION FIX REPORT

**Root Cause**

The backend is already querying the correct table name and schema: `public.platform_notifications`.

The production error `PGRST205 Could not find public.platform_notifications` points to a database-state issue, not an application query bug. The table creation exists in migration history, but the live database reporting this error does not currently have that relation available to PostgREST.

**Exact Backend References**

- `backend/app/services/platform_control_plane.py::list_notifications`
- `backend/app/services/platform_control_plane.py::create_notification`
- `backend/app/routes/platform.py::list_platform_notifications`

Current runtime queries:

```python
_public_table("platform_notifications").select("*")
_public_table("platform_notifications").insert(insert_payload)
```

`_public_table(...)` resolves to the public schema, so backend references are already aligned with the expected table:

- Expected: `public.platform_notifications`
- Actual backend target: `public.platform_notifications`

**Migration Status**

Original creation migration exists:

- `supabase/migrations/20260628_066_platform_control_plane.sql`

That migration creates:

```sql
create table if not exists public.platform_notifications (
```

No alternate schema and no rename path were found in the backend or migration history.

**Table Status**

From the codebase audit:

- Table is defined in migration history under `public`
- Backend reads and writes target `public`
- No duplicate table under another schema was found

Therefore the most likely exact operational cause is:

- the original migration was skipped in the affected environment, or
- the environment was provisioned before Phase 6 and never received the `platform_notifications` table

**Corrective Action**

Added a new idempotent corrective migration:

- `supabase/migrations/20260703_067_ensure_platform_notifications.sql`

This does not modify old migrations. It safely ensures:

- `public.platform_notifications` exists
- required constraints exist as part of table definition
- index exists
- `set_updated_at` trigger exists

**Files Changed**

- `supabase/migrations/20260703_067_ensure_platform_notifications.sql`
- `PLATFORM_NOTIFICATION_FIX_REPORT.md`

**Validation**

Backend reference audit:

- `backend/app/services/platform_control_plane.py:666`
- `backend/app/services/platform_control_plane.py:697`
- `backend/app/routes/platform.py:600`

Compile:

- `python -m compileall app` -> PASS

Related tests:

- `pytest tests/test_platform_control_plane.py` -> PASS (`3 passed`)

**PASS / FAIL**

PASS
