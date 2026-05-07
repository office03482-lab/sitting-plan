# Database Architecture Report

## Current architecture snapshot
- ORM stack: SQLAlchemy declarative models in [app/models/__init__.py](../app/models/__init__.py)
- Application DB bootstrap: [app/main.py](../app/main.py) no longer mutates schema at startup
- Migration stack: Alembic configured through [alembic.ini](../alembic.ini) and [alembic/env.py](../alembic/env.py)
- Runtime database session: [app/database.py](../app/database.py)
- Production database target: PostgreSQL via `DATABASE_URL`

## Schema management findings
- The project previously relied on `Base.metadata.create_all(...)` and ad-hoc runtime schema patching. The current app startup path is now clean, but several helper scripts still reflected the old approach until this pass.
- Schema definition is centralized in one monolithic model file. This is workable today, but it makes migration review and domain ownership harder as the ERP grows.
- Startup schema mutation has been removed from the main app lifecycle. Schema creation is now expected to happen through Alembic migrations before the API serves traffic.

## Duplicate identity systems
- Staff-like identities are spread across:
  - `users`
  - `teachers`
  - `invigilators`
  - `attendance_staff`
- Student-like identities are spread across:
  - `students`
  - `attendance_students`
  - `edupay_students`
- These tables are not yet normalized around one canonical identity key, so cross-module joins still depend on email, name, or parallel entity creation.

## Dangerous production patterns found
- Helper and seed scripts historically used `create_all`, which can drift from migration history.
- Some support scripts still assume SQLite or local one-off bootstrap flows.
- Several modules still hardcode `school_id = 1` in scripts and test utilities.
- The ORM metadata file is broad enough that one accidental model change can affect many domains in a single revision.

## PostgreSQL compatibility notes
- Main runtime config is PostgreSQL-first and Docker Compose already points the backend at PostgreSQL.
- Alembic is now wired to the same `DATABASE_URL` source as the app.
- Initial migration was generated from the live SQLAlchemy metadata. Existing environments should be stamped only after a verified schema backup.

## Cleanup recommendations
1. Keep all future structural changes in Alembic revisions only.
2. Avoid reintroducing `create_all` in long-lived scripts and startup paths.
3. Split the monolithic model file by domain once migration flow is stable.
4. Add canonical identity links before merging reporting domains.
5. Retire SQLite-only utility scripts or clearly mark them as local test tools.
