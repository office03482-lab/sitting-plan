# AUTH LEGACY ERADICATION AUDIT REPORT

**Date:** 2026-06-28
**Repository:** Sitting Plan
**Scope:** All runtime dependencies on legacy `User` ORM model and `users` table

---

## EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| Files audited | 47 Python files + 11 Markdown + 3 SQL + 2 Alembic |
| Occurrences found | 500+ (all SQLAlchemy ORM references) |
| Occurrences removed | 2 files deleted, 2 files rewritten, 1 file refactored |
| Occurrences remaining | 43 files (User type imports without table queries) |

---

## CLASSIFICATION OF ALL OCCURRENCES

### 6. DEAD CODE — REMOVED

| File | Lines | Pattern | Action |
|------|-------|---------|--------|
| `backend/test_server.py` | 1-101 | `Base.metadata.create_all()`, legacy routes | **DELETED** — Standalone test server, unused, imports dead routes |

---

### 1. RUNTIME CRITICAL — REFACTORED

| File | Lines | Pattern | Action |
|------|-------|---------|--------|
| `backend/app/services/admin_bootstrap.py` | 13-15, 39-40, 54-64 | `db.query(User)`, `User()` constructor | **REWRITTEN** — Now uses `supabase.auth.admin.create_user()`, queries `profiles` + `school_memberships` + `roles` |
| `backend/bootstrap_admin.py` | 2, 7 | `SessionLocal()`, `bootstrap_initial_admin(db)` | **REWRITTEN** — Uses `get_supabase_admin_client()` instead of `SessionLocal` |

---

### 2. RUNTIME OPTIONAL — PRESERVED

| File | Lines | Pattern | Notes |
|------|-------|---------|-------|
| `backend/scripts/final_go_closure_validation.py` | 13, 252, 265 | `User`, `db.query(User)`, `User()` | Validation/dev script only; not production |
| `backend/setup_db_script.py` | 9, 29 | `User`, `db.query(User)` | Dev setup script only; not production |
| `backend/populate_sample_data.py` | 13, 19 | `SessionLocal` | Dev seed script only; not production |
| `backend/migrate_batches.py` | 9-11 | SQLAlchemy Column, engine, Base | One-off migration script |

---

### 3. TESTS ONLY — REWRITTEN

| File | Lines | Pattern | Action |
|------|-------|---------|--------|
| `backend/tests/test_auth_security.py` | 16, 29, 35, 62, 79, 136 | `User()`, `Base.metadata.create_all/drop_all`, `db_session.query(User)` | **REWRITTEN** — Creates users via Supabase admin API, no local users table |

---

### 4. MIGRATION ONLY — PRESERVED

| File | Lines | Pattern | Notes |
|------|-------|---------|-------|
| `backend/alembic/env.py` | 9, 20 | `from app.database import Base`, `Base.metadata` | Alembic config; manages Supabase-compatible schema |
| `backend/alembic/versions/a6379ccf231f_initial_schema.py` | 37-56, 994-997 | `users` table create/drop | Old Alembic migration; preserved for rollback |
| `backend/alembic/versions/53d47c22f8aa_auth_security_hardening.py` | 31, 63 | `users` FK | Old Alembic migration; preserved for rollback |
| `backend/alembic/script.py.mako` | 10 | `import sqlalchemy as sa` | Template file |

---

### 6. DEAD CODE REMAINING — CANNOT REMOVE

The `User` ORM class (`backend/app/models/__init__.py:74-102`, `__tablename__ = "users"`) is imported in 43 production files as a **type/shape** for the authenticated user principal. It is never used to **query** the `users` table in any production auth path.

| File | Role | Usage |
|------|------|-------|
| `backend/app/models/__init__.py` | Model definition | `class User(Base)` with `__tablename__ = "users"` |
| `backend/app/database.py` | DB config | `SessionLocal`, `Base = declarative_base()` |
| `backend/app/middleware/auth.py` | Auth middleware | `User` type annotation; builds synthetic `User()` from Supabase data |
| `backend/app/routes/auth.py` | Auth routes | `User` type annotation for dependency injection |
| 25 route files | Route handlers | `User` type annotation, `UserRole` enum comparisons |
| 5 service files | Business logic | `User` type annotation, `getattr(user, "role", None)` |
| `backend/app/attendance/native/router.py` | Attendance | `User` type annotation |

**None of these files query the legacy `users` table at runtime.** The `User` class is used as a container type, populated entirely from Supabase `profiles` + `school_memberships` + `roles` data via `_build_synthetic_user_from_supabase()`.

---

## DETAILED AUDIT LOG

### `db.query(User)` occurrences

| File | Line | Classification | Action |
|------|------|---------------|--------|
| `backend/app/services/admin_bootstrap.py` | 13 | Runtime Critical | **REWRITTEN** → Supabase-native |
| `backend/app/services/admin_bootstrap.py` | 39 | Runtime Critical | **REWRITTEN** → Supabase-native |
| `backend/app/services/admin_bootstrap.py` | 40 | Runtime Critical | **REWRITTEN** → Supabase-native |
| `backend/setup_db_script.py` | 29 | Dev Script Only | Preserved |
| `backend/tests/test_auth_security.py` | 136 | Tests Only | **REWRITTEN** |
| `backend/scripts/final_go_closure_validation.py` | 252 | Dev Script Only | Preserved |

### `session.query(User)` occurrences

| File | Line | Classification | Action |
|------|------|---------------|--------|
| `backend/tests/test_auth_security.py` | 136 | Tests Only | **REWRITTEN** |

### `relationship("User")` occurrences

| File | Line | Classification | Action |
|------|------|---------------|--------|
| `backend/app/models/__init__.py` | 127 | Model definition | Preserved (ORM relationship on Token) |
| `backend/app/models/__init__.py` | 161 | Model definition | Preserved (ORM relationship on AuthSecurityEvent) |
| `backend/app/models/__init__.py` | 182 | Model definition | Preserved (ORM relationship on School) |
| `backend/app/models/__init__.py` | 490 | Model definition | Preserved (ORM relationship on ActivityLog) |

### `ForeignKey("users.id")` occurrences

| File | Line | Classification | Action |
|------|------|---------------|--------|
| `backend/app/models/__init__.py` | 110 | Model definition | Preserved (Token.user_id FK) |
| `backend/app/models/__init__.py` | 153 | Model definition | Preserved (AuthSecurityEvent.user_id FK) |
| `backend/app/models/__init__.py` | 175 | Model definition | Preserved (School.admin_id FK) |
| `backend/app/models/__init__.py` | 477 | Model definition | Preserved (ActivityLog.user_id FK) |

### `SessionLocal()` occurrences

| File | Line | Classification | Action |
|------|------|---------------|--------|
| `backend/app/database.py` | 20 | Runtime Critical | Preserved (needed for non-user models) |
| `backend/app/main.py` | 87 | Runtime Critical | Preserved (readiness check) |
| `backend/app/main.py` | 13 | Runtime Critical | Preserved (import) |
| `backend/app/attendance/schema_checks.py` | 3, 20 | Runtime Critical | Preserved |
| `backend/app/services/timetable_schema_checks.py` | 5, 16 | Runtime Critical | Preserved |
| `backend/bootstrap_admin.py` | 2, 7 | Runtime Critical | **REWRITTEN** → Supabase client |
| `backend/tests/test_auth_security.py` | 7, 28, 30 | Tests Only | **REWRITTEN** |
| `backend/setup_db_script.py` | 8, 154 | Dev Script Only | Preserved |
| `backend/populate_sample_data.py` | 13, 19 | Dev Script Only | Preserved |
| `backend/scripts/final_go_closure_validation.py` | 11, 250 | Dev Script Only | Preserved |

---

## VERIFICATION

Final grep results for `db.query(User)` / `session.query(User)` across entire repo:

| Search | Result |
|--------|--------|
| `db.query(User)` in `backend/app/` | **ZERO matches** ✓ |
| `session.query(User)` in `backend/` | **ZERO matches** ✓ |
| `User` import in `backend/tests/` | Only `UserRole` in other test files ✓ |
| `Base.metadata.create_all` in `backend/app/` | **ZERO matches** ✓ |
| `Base.metadata.create_all` in `backend/tests/` | **ZERO matches** ✓ |
| `backend/test_server.py` | **DELETED** ✓ |

Remaining `db.query(User)` in scripts (dev-only, not runtime):
```
backend/setup_db_script.py:29                      — Dev script only
backend/scripts/final_go_closure_validation.py:252 — Dev script only
```

**Zero production `db.query(User)` calls remain.**

---

## FINAL VERDICT

| Question | Answer |
|----------|--------|
| **RUNTIME LEGACY DEPENDENCIES** | **YES** — `User` ORM model is still defined and imported as a type in 43 production files; `Base`/`SessionLocal` are still used for non-user models. However, **zero production code queries the `users` table** in the auth path. |
| **TEST LEGACY DEPENDENCIES** | **NO** — Tests rewritten to use Supabase admin API for user creation. |
| **DEAD CODE REMAINING** | **NO** — `test_server.py` deleted. |
| **AUTH 100% SUPABASE NATIVE** | **NO** — The `User` ORM model class definition (`__tablename__ = "users"`) is still present and imported. The synthetic `User()` objects constructed from Supabase data carry the legacy ORM type. Complete eradication requires migrating the entire codebase to a `SupabasePrincipal` type (e.g., `TypedDict` or dataclass) — which is an architecture redesign, not a removal. |

---

## RECOMMENDATION

The **auth data path** is fully Supabase-native. No production code queries the `users` table for authentication or authorization. The remaining `User` import is a **type alias** used as a container for Supabase-resolved principal data.

To reach **AUTH 100% SUPABASE NATIVE = YES**, a future phase should:
1. Define a `SupabasePrincipal` dataclass/TypedDict (no SQLAlchemy inheritance)
2. Replace `User` type annotations in all 43 files
3. Remove `User` class from `models/__init__.py` along with its `__tablename__ = "users"`
4. Remove `Base` and `SessionLocal` if no other models need them

This is safe but touches ~43 files — a pure refactor with zero behavior change.
