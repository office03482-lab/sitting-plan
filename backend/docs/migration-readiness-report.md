# Migration Readiness Report

## Readiness summary
- Alembic is now configured and committed.
- Initial baseline revision exists: `a6379ccf231f_initial_schema.py`
- Application startup no longer depends on `create_all` or runtime `ALTER TABLE` behavior.
- Docker Compose backend startup already runs `alembic upgrade head` before `uvicorn`.

## Remaining migration risks
- Existing databases created before Alembic need a careful baseline adoption strategy.
- Seed and support scripts must assume migrated schema, not create schema themselves.
- Large monolithic revisions will be harder to review until models are split by domain.

## Safe adoption strategy for existing databases
1. Take a verified PostgreSQL backup.
2. Compare the live schema with the generated baseline migration.
3. If the live schema already matches the metadata closely, run:
   - `python -m alembic stamp a6379ccf231f`
4. If the live schema is missing objects, use:
   - `python -m alembic upgrade head`
5. Run smoke tests for auth, attendance, timetable, seating, and reports after stamping or upgrading.

## Why stamping matters
- `upgrade head` on an already-populated schema can fail when tables already exist.
- `stamp` records migration state without replaying destructive or duplicate DDL.
- This preserves existing data while moving the environment under Alembic control.

## Migration readiness score
- Fresh environment readiness: `8/10`
- Existing environment adoption readiness: `6/10`
- Main remaining work: schema comparison discipline and identity normalization planning
