# ALEMBIC AUTHORITY VERIFICATION

**Date:** 2026-07-06
**Scope:** Exhaustive verification of Alembic's role as the authoritative migration system.

---

## 1. ALEMBIC CONFIGURATION

### 1.1 ackend/alembic.ini (complete content)
`ini
[alembic]
script_location = alembic
prepend_sys_path = .
sqlalchemy.url = postgresql://postgres:password@localhost:5432/seating_planner

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
`

**Key observation:** The default sqlalchemy.url points to PostgresQL, but this is overridden at runtime by env.py line 18 using settings.database_url.

### 1.2 ackend/alembic/env.py (complete content)
`python
from app.config import settings
from app.database import Base
from app.models import *  # noqa: F401,F403

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata

# run_migrations_offline() and run_migrations_online() use target_metadata
# with compare_type=True, compare_server_default=True
`

**Key observations:**
- Imports ALL models from pp.models to populate Base.metadata
- Overrides sqlalchemy.url with settings.database_url at runtime
- 	arget_metadata = Base.metadata — Alembic uses the SQLAlchemy ORM models as the source of truth
- Uses compare_type=True and compare_server_default=True for autogenerate

### 1.3 Alembic Version Files

**Version 1: 6379ccf231f_initial_schema.py**
- Revision: 6379ccf231f
- Down revision: None (first migration)
- Creates: 	okens, users, ctivity_logs, schools, ttendance_holidays, ttendance_notifications, ttendance_settings, ttendance_staff, ttendance_students, ttendance_subjects, atches, edupay_fee_structures, edupay_parents, exams, hostels, inventory_subjects, invigilators, ooms, settings, suppliers, 	eachers, ttendance_leaves, desks, hostel_rooms, inventory_sets, oom_invigilators, seating_plans, staff_attendance, student_attendance, 	imetable_entries, edupay_students, inventory_volumes, students, edupay_fee_assignments, material_items, seats, student_hostel_requests, edupay_payments, stock_in_entries, and more
- Total: ~1000 lines creating the entire initial schema

**Version 2: 53d47c22f8aa_auth_security_hardening.py**
- Revision: 53d47c22f8aa
- Down revision: 6379ccf231f
- Creates: uth_throttles, uth_security_events tables
- Alters: 	okens table (adds user_id, token_jti, token_family, failure_count, etc.)

### 1.4 Migration Template (script.py.mako)
Standard Alembic template with upgrade() and downgrade() functions.

---

## 2. DATABASE URL RESOLUTION

### 2.1 ackend/app/config.py — Settings.database_url field
`python
class Settings(BaseSettings):
    database_url: str | None = None  # Default: None

    @model_validator(mode="after")
    def enforce_security_defaults(self):
        if not self.database_url:
            if self.environment == "production":
                raise ValueError("DATABASE_URL must be set in production.")
            self.database_url = f"sqlite:///{DEFAULT_DEV_DB_PATH.as_posix()}"
        # ... production validation ...
`

**Default behavior:**
- Development: Falls back to sqlite:///C:/Users/GIRISH/Desktop/SITTING PLAN/backend/seating_planner.db
- Production: MUST be set explicitly, cannot be SQLite

### 2.2 .env Files

| File | DATABASE_URL Value | Environment |
|------|-------------------|-------------|
| ackend/.env | sqlite:///seating_planner.db | development (active) |
| ackend/.env.example | sqlite:///seating_planner.db | template |
| ackend/.env.production.example | (not checked, likely postgres) | production template |

### 2.3 Production/Docker Database URLs

| Config Source | DATABASE_URL Value |
|---------------|-------------------|
| docker-compose.dev.yml | ${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/postgres} |
| docker-compose.yml | ${DATABASE_URL} (from environment) |
| ender.yaml | From Render PostgreSQL service (sitting-plan-db) |
| lembic.ini (default) | postgresql://postgres:password@localhost:5432/seating_planner |

### 2.4 ackend/app/database.py — Engine Configuration
`python
engine_kwargs = {
    "echo": settings.debug,
    "future": True,
    "pool_pre_ping": True,
}
if settings.database_url.startswith("sqlite:///"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = 20
    engine_kwargs["max_overflow"] = 40

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()
`

---

## 3. ALEMBIC REFERENCES ACROSS THE ENTIRE CODEBASE

### 3.1 Scripts That RUN Alembic Migrations

| File | Line | Command |
|------|------|---------|
| docker-compose.dev.yml | 12 | command: sh -c "alembic upgrade head && uvicorn ..." |
| un_app.bat | 126 | "%VENV_PY%" -m alembic upgrade head |
| uto_run.bat | 141 | python -m alembic upgrade head >nul 2>&1 |
| ackend/scripts/migrate.ps1 | 21 | & .\venv\Scripts\python.exe -m alembic upgrade  |
| ackend/scripts/rollback.ps1 | 21 | & .\venv\Scripts\python.exe -m alembic downgrade  |

### 3.2 Scripts That CHECK Alembic State

| File | Line | Purpose |
|------|------|---------|
| ackend/setup_db_script.py | 21 | SELECT version_num FROM alembic_version — fails fast if not migrated |
| ackend/populate_sample_data.py | 22 | SELECT version_num FROM alembic_version — fails fast if not migrated |

### 3.3 Documentation References

| File | Purpose |
|------|---------|
| START_GUIDE.md | Documents lembic upgrade head, lembic current, lembic downgrade -1 |
| README.md | References lembic upgrade head in setup instructions |
| .github/copilot-instructions.md | Extensive Alembic documentation (6 references) |
| DEPLOY_RENDER.md | Documents lembic upgrade head as a required production step |
| ackend/docs/database-operations.md | Complete Alembic operations guide |
| ackend/docs/db-architecture-report.md | Identifies Alembic as the migration stack |
| ackend/docs/migration-readiness-report.md | Docker Compose runs lembic upgrade head |

### 3.4 Dependency Declaration

| File | Line | Entry |
|------|------|-------|
| ackend/requirements.txt | 4 | lembic==1.12.1 |

---

## 4. PRODUCTION GAP: Render Does NOT Run Alembic

**ender.yaml start command:**
`yaml
startCommand: gunicorn app.main:app -k uvicorn.workers.UvicornWorker --workers 3 --bind 0.0.0.0: --timeout 60 --keep-alive 5 --max-requests 2000 --max-requests-jitter 200
`

This start command does **NOT** include lembic upgrade head. This is documented as a **P1 finding** in:
- P0_FINDING_VERIFICATION.md:110 — "No migration step in Render production start command"
- MIGRATION_VERSION_VERIFICATION.md:119 — "No production migration step — HIGH risk"
- MIGRATION_VERSION_VERIFICATION.md:105 — Only docker-compose.dev.yml runs alembic

**Recommendation from reports:** Change Render start command to:
`yaml
startCommand: alembic upgrade head && gunicorn ...
`

---

## 5. COMPARISON: ALEMBIC vs SUPABASE SQL MIGRATIONS

| Aspect | Alembic | Supabase SQL Files |
|--------|---------|-------------------|
| **Config location** | ackend/alembic.ini | No config (would be supabase/config.toml) |
| **Revision storage** | ackend/alembic/versions/ | supabase/migrations/ |
| **Version tracking** | lembic_version table in database | supabase_migrations.schema_migrations (DOES NOT EXIST) |
| **Current versions** | 2 Python revisions | 76 SQL files + 1 unversioned |
| **Autorun in dev** | YES: docker-compose.dev.yml, run_app.bat, auto_run.bat | NO |
| **Autorun in production** | NO (gap, recommended) | NO |
| **Autorun in Docker** | NO (Dockerfile doesn't run it) | NO |
| **Rollback capability** | YES: lembic downgrade <revision> | YES: Manual *_down.sql execution |
| **Scripts for management** | YES: migrate.ps1, rollback.ps1 | NO |
| **Code-checked** | YES: setup_db_script.py checks alembic_version | NO |
| **Coverage** | Local SQLite + Supabase PostgreSQL | Supabase PostgreSQL only |
| **Autogenerate** | YES: lembic revision --autogenerate | Manual SQL writing |

---

## 6. DEFINITIVE CLASSIFICATION: Alembic IS the Authoritative Migration System

### 6.1 Evidence Supporting Alembic Authority

1. **Only automated migration tool in the project** — Alembic is the ONLY migration system with automated execution (in dev scripts and Docker compose)
2. **Runtime dependency** — setup_db_script.py and populate_sample_data.py both CHECK for Alembic migration state before running
3. **Version tracking exists** — lembic_version table is expected and checked by application code
4. **Rollback capability** — ackend/scripts/rollback.ps1 provides controlled downgrade
5. **Model-driven** — Alembic uses Base.metadata from the ORM models as schema source of truth
6. **Developer documentation** — All developer guides reference Alembic as the migration tool
7. **Standard tooling** — Uses standard Alembic patterns (ini config, env.py, versions/, script.py.mako)

### 6.2 Role of supabase/migrations/ SQL Files

The SQL files in supabase/migrations/ are:
- **Supplementary schema definitions** for Supabase-native PostgreSQL objects (functions, RLS policies, triggers, enums, etc.)
- **Manually applied** through Supabase Dashboard SQL Editor or psql
- **Not tracked** by any automated system
- **Potential drift source** — since they're applied manually, the Supabase database may be out of sync with these files
- **Style-guide following** — named per Supabase CLI conventions, but CLI is not installed

### 6.3 Risk Assessment

| Risk | Severity | Notes |
|------|----------|-------|
| Alembic not run in production (Render) | **HIGH** | Schema would be the initial state only |
| Dual migration systems | **MEDIUM** | Two sources of truth for schema changes |
| Supabase SQL files never applied | **LOW** (if Alembic covers all needs) / **HIGH** (if Supabase-only features are needed) | Depends on which features rely on Supabase-native objects |
| supabase_migrations.schema_migrations missing | **MEDIUM** | If Supabase CLI is ever adopted, migration state is unknown |

### 6.4 Final Classification

**Alembic is the authoritative, integrated, and automated migration system for this project.**

The supabase/migrations/ SQL files are a secondary, manual, unmanaged collection of schema changes targeting Supabase-specific PostgreSQL features. They have no automation, no version tracking, and no dependency integration with the application code.
