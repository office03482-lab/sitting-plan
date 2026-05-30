# PROJECT AUDIT REPORT

## Dr. Girish App - School ERP System

**Audit Date:** 2026-05-29
**Auditor:** Principal Software Architect
**Status:** Complete

---

## 1. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React 18 + Vite)                   │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Zustand  │  │   React  │  │  Axios   │  │   TailwindCSS    │   │
│  │  Stores   │  │  Router  │  │  Client  │  │   Components     │   │
│  │  (auth,   │  │   v6     │  │  (api.ts)│  │   (15+ pages)    │   │
│  │   app,    │  │          │  │          │  │                  │   │
│  │   settings)│  │          │  │          │  │                  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │             │             │                  │             │
│       └─────────────┴─────────────┴──────────────────┘             │
│                              │                                     │
│                    JWT (Authorization: Bearer)                     │
│                    + X-User-* Headers (LEGACY)                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      BACKEND (FastAPI + Python)                     │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   Auth   │  │  Routes  │  │ Services │  │    Middleware     │   │
│  │  Middle  │  │  (13     │  │ (auth,   │  │  - CORS           │   │
│  │  ware    │  │  files)  │  │  supabase)│  │  - Observability  │   │
│  │          │  │          │  │          │  │  - Rate Limiting   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────────┘   │
│       │             │             │                                 │
│       └─────────────┴─────────────┴──────────────────┘              │
│                              │                                     │
│                   SQLAlchemy ORM (49+ models)                      │
│                   Alembic Migrations                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                         DATA LAYER                                  │
│                                                                     │
│  ┌─────────────────────┐  ┌────────────────────────────────────┐   │
│  │   SQLite (Dev)      │  │   PostgreSQL + Supabase (Prod)     │   │
│  │   - seating_planner │  │   - 23 Supabase SQL migrations     │   │
│  │     .db             │  │   - RLS policies (partial)         │   │
│  └─────────────────────┘  └────────────────────────────────────┘   │
│                                                                     │
│  Legacy: SQLite (integer IDs)                                       │
│  Target: Supabase PostgreSQL (UUID IDs)                             │
│  State: PARTIALLY MIGRATED                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. DATA FLOW DIAGRAM

```
User → Browser → React App → Axios (api.ts) → FastAPI Routes
                                                 │
                    ┌────────────────────────────┤
                    │                            │
                    ▼                            ▼
           Auth Middleware                  Route Handler
           (JWT verify +                    (process request,
            role check)                      query DB)
                    │                            │
                    └────────────────────────────┘
                                                 │
                                                 ▼
                                         SQLAlchemy ORM
                                         (49+ models)
                                                 │
                                    ┌────────────┴────────────┐
                                    │                         │
                                    ▼                         ▼
                              SQLite (Dev)           PostgreSQL (Prod)
                                                    + Supabase RLS
```

---

## 3. AUTHENTICATION FLOW (CURRENT - FLAWED)

```
Step 1: Client sends request with:
  - Authorization: Bearer <JWT> (PRIMARY)
  - X-User-Role: <role> (FALLBACK - VULNERABLE)
  - X-User-Name: <name> (FALLBACK - VULNERABLE)
  - X-User-Email: <email> (FALLBACK - VULNERABLE)
  - X-User-Permissions: <perms> (FALLBACK - VULNERABLE)

Step 2: Backend verify_token() checks JWT first
  ├── JWT valid → extract claims → proceed
  └── JWT invalid/missing → check X-User-* headers
       ├── Headers present → CREATE SYNTHETIC USER OBJECT
       │   (id=0, role=from header, bypasses DB) ← CRITICAL FLAW
       └── Headers missing → return 401

Step 3: Supabase tokens are accepted as alternative to local JWT
  - Creates synthetic User with id=0
  - role extracted from token OR from X-User-Role header
  - school_id extracted from token claims
```

---

## 4. SCHOOL ISOLATION FLOW

```
Request → resolve_school_id_from_actor()
  ├── 1. Check actor claims (from JWT) for school_id
  ├── 2. Lookup Supabase profiles table by profile_id
  ├── 3. Lookup Supabase school_memberships table
  ├── 4. Use explicit school_id query param
  ├── 5. Legacy SQLite mode → fallback to "1"
  └── 6. All fail → HTTP 403

ISSUES:
  - School isolation depends on Supabase being available
  - School ID resolution is complex and fragile
  - Many routes don't pass school_id to DB queries
  - No school_id on User model
  - Legacy integer school_id "1" used as fallback
```

---

## 5. RBAC FLOW

```
Request → require_permissions("module.action")
  │
  ├── get_authenticated_user() → User object
  │   ├── From JWT → DB lookup by user.id
  │   └── From headers → Synthetic User(id=0) ← BYPASS
  │
  └── Check permissions:
      ├── User.role == ADMIN → GRANT ALL
      ├── User.permissions contains "module.action" → GRANT
      ├── User.permissions starts with "module.action." → GRANT
      └── None match → HTTP 403

Permissions structure (hierarchical):
  admin_office
    ├── admin_office.seating_generation
    ├── admin_office.seating_plans
    ├── admin_office.rooms
    ├── admin_office.batches
    ├── admin_office.students
    ├── admin_office.teachers
    ├── admin_office.invigilators
    ├── admin_office.reports
    └── admin_office.access_control
  timetable
    ├── timetable.view
    └── timetable.manage
  attendance
    ├── attendance.student
    ├── attendance.staff
    ├── attendance.leaves
    └── attendance.reports
  inventory
    ├── inventory.dashboard
    ├── inventory.materials
    ├── inventory.suppliers
    ├── inventory.stock_in
    ├── inventory.stock_out
    └── inventory.reports
  edupay
    ├── edupay.dashboard
    ├── edupay.students
    ├── edupay.fees
    ├── edupay.payments
    └── edupay.parent_portal
  settings
```

---

## 6. MODULE DEPENDENCY GRAPH

```
                    ┌─────────────┐
                    │  Settings   │
                    └──────┬──────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
  ┌─────────┐       ┌──────────┐       ┌──────────┐
  │  Auth   │       │ Batches  │       │  Rooms   │
  │  Users  │       └────┬─────┘       └────┬─────┘
  │  Roles  │            │                   │
  └─────────┘            ▼                   ▼
                   ┌──────────┐       ┌──────────┐
                   │ Students │       │  Desks   │
                   │ Hostels  │       │  Seats   │
                   └────┬─────┘       └────┬─────┘
                        │                  │
                        ▼                  ▼
                   ┌──────────┐       ┌──────────┐
                   │  Exams   │◄──────│ Seating  │
                   └────┬─────┘       │  Plans   │
                        │             └────┬─────┘
                        │                  │
                        ▼                  ▼
                   ┌──────────┐       ┌──────────┐
                   │Teachers  │       │Invigila- │
                   │          │       │  tors    │
                   └────┬─────┘       └────┬─────┘
                        │                  │
                        ▼                  ▼
                   ┌──────────┐       ┌──────────┐
                   │Timetable │       │ Reports  │
                   └──────────┘       └──────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Attendance  │  │  Inventory   │  │   EduPay     │
│  - Students  │  │  - Subjects  │  │  - Fees      │
│  - Staff     │  │  - Sets      │  │  - Payments  │
│  - Leaves    │  │  - Stock     │  │  - Parents   │
│  - Holidays  │  │  - Suppliers │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
     (Standalone)     (Standalone)      (Standalone)
```

---

## 7. RISK ASSESSMENT

| # | Risk | Severity | Impact | Status |
|---|------|----------|--------|--------|
| R1 | Header-based auth bypass | CRITICAL | Anyone with HTTP access can impersonate any user | UNFIXED |
| R2 | Synthetic User objects (id=0) bypassing DB | CRITICAL | No DB user validation for Supabase tokens | UNFIXED |
| R3 | Missing school isolation on seating plans | HIGH | Cross-school data access | UNFIXED |
| R4 | Missing school isolation on single-entity GET/PUT/DELETE | HIGH | Cross-school data access | UNFIXED |
| R5 | All integer IDs (not UUIDs) | HIGH | Collision risk across schools | UNFIXED |
| R6 | No school_id on User model | HIGH | Users not tied to schools | UNFIXED |
| R7 | No pagination on user listing | MEDIUM | Memory exhaustion | UNFIXED |
| R8 | Duplicate attendance/student data | MEDIUM | Data inconsistency | UNFIXED |
| R9 | Duplicate EduPay student data | MEDIUM | Data inconsistency | UNFIXED |
| R10 | Missing FK constraints | MEDIUM | Orphan records | UNFIXED |
| R11 | Missing indexes on foreign keys | MEDIUM | Performance degradation | UNFIXED |
| R12 | Inconsistent API response format | LOW | Client confusion | UNFIXED |
| R13 | CORS allows all origins (wildcard config) | MEDIUM | Potential CSRF | UNFIXED |
| R14 | Debug information in 500 errors | MEDIUM | Information leakage | UNFIXED |
| R15 | SMTP password in plaintext env var | HIGH | Credential exposure | UNFIXED |

---

## 8. TECHNICAL DEBT ASSESSMENT

| Area | Debt Level | Description |
|------|-----------|-------------|
| Auth System | CRITICAL | Dual auth (JWT + headers) is fundamentally broken |
| Database Models | HIGH | Integer IDs, missing school_id on several models |
| Data Duplication | HIGH | AttendanceStudent/EduPayStudent duplicate Student model |
| API Consistency | MEDIUM | No standardized response format |
| Error Handling | MEDIUM | Inconsistent error patterns |
| Pagination | MEDIUM | Most list endpoints lack pagination |
| Testing | LOW | Only 3 test files, ~14 tests total |
| Documentation | LOW | Good ARCHITECTURE.md and DEPLOY_RENDER.md |
| Deployment | MEDIUM | Render config exists, CI/CD missing |
| Frontend Architecture | MEDIUM | No code splitting, no lazy loading |
| State Management | LOW | Zustand stores are clean and well-structured |
| TypeScript Types | MEDIUM | Mixed int/str types indicate partial migration |

---

## 9. RECOMMENDED ACTIONS (PRIORITY ORDER)

### P0 - Fix Immediately
1. Remove header-based auth fallback
2. Remove X-User-* headers from frontend
3. Enforce JWT-only authentication
4. Fix school isolation on all routes

### P1 - Fix Within Sprint
5. Add UUID support to all models
6. Add school_id to User model
7. Standardize API response format
8. Add proper pagination to all list endpoints
9. Add missing indexes
10. Remove duplicate data models

### P2 - Fix Within Quarter
11. Implement CI/CD pipeline
12. Reach 80% test coverage
13. Implement code splitting on frontend
14. Add proper audit logging
15. Implement data retention policies

---

## 10. STATISTICS

| Metric | Value |
|--------|-------|
| Total Python files | ~30 |
| Total TypeScript/React files | ~50+ |
| ORM Models | 49 |
| API Routes | 150+ |
| Frontend Pages | 18 |
| Zustand Stores | 3 |
| Pydantic Schemas | 100+ |
| Alembic Migrations | 2 |
| Supabase SQL Migrations | 23 |
| Test Files | 3 |
| Total Tests | ~14 |
| Configuration Files | 6+ |
| Docker Files | 3 |
