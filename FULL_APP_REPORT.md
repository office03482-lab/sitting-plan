# Dr. Girish App - Full Application Report

## 📋 Overview

**App Name:** Dr. Girish App - Professional Anti-Cheat Examination Seating System
**Version:** 1.0.0
**Last Updated:** April 2026
**Tech Stack:** FastAPI (Python) + React (TypeScript) + PostgreSQL (Supabase)

Yeh ek **full-stack school management system** hai jo mainly **exam seating planning** ke liye bana hai, lekin ab isme **Attendance, Inventory, Fee (EduPay), Hostel, Timetable, Staff Management** jaise multiple modules add ho chuke hain.

---

## 🏗 Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    FRONTEND (React 18 + TS)                    │
│  Pages → Components → Services (Axios) → Store (Zustand)      │
│  Hosted on: Vite dev server / Render                          │
└──────────────────────────┬────────────────────────────────────┘
                           │ REST API (JSON)
┌──────────────────────────▼────────────────────────────────────┐
│                    BACKEND (FastAPI + Python)                   │
│  Routes → Services → Models → Database                         │
│  Auth: JWT + Supabase Auth                                     │
│  Hosted on: Uvicorn / Render                                   │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                    DATABASE (PostgreSQL via Supabase)           │
│  Tables: users, profiles, students, rooms, seating_plans,     │
│  exams, teachers, timetable, attendance, inventory, edupay,   │
│  hostels, invigilators, batches, activity_logs                │
└───────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

### Backend (`backend/`)
```
backend/
├── app/
│   ├── main.py              # FastAPI app entry, CORS, error handlers, route includes
│   ├── config.py            # Pydantic Settings with env vars, security validations
│   ├── database.py          # SQLAlchemy engine, SessionLocal, get_db()
│   ├── models/__init__.py   # 1191 lines - ALL ORM models (User, Student, Room, Exam, etc.)
│   ├── schemas/__init__.py  # Pydantic validation schemas for all modules
│   ├── routes/              # API endpoints per module
│   │   ├── auth.py          # Login, OTP, JWT, refresh
│   │   ├── students.py      # CRUD, import/export Excel, batch transfer, hostel
│   │   ├── rooms.py         # Room CRUD + summary
│   │   ├── seating.py       # Generate plans, list, finalize, delete
│   │   ├── reports.py       # PDF/Excel report generation
│   │   ├── exams.py         # Exam CRUD
│   │   ├── teachers.py      # Teacher CRUD
│   │   ├── dashboard.py     # Dashboard metrics via Supabase RPC
│   │   ├── timetable.py     # Timetable CRUD, conflict check, export
│   │   ├── batches.py       # Batch CRUD, reorder
│   │   ├── invigilators.py  # Invigilator CRUD, room assignments
│   │   ├── inventory.py     # Full inventory management
│   │   ├── edupay.py        # Fee management (EduPay)
│   │   ├── hostels.py       # Hostel CRUD, room management
│   │   ├── staff.py         # Staff import from Excel
│   │   └── settings.py      # School settings get/update
│   ├── services/            # Business logic layer
│   │   ├── seating_engine.py        # ★ CORE: Anti-cheat algorithm
│   │   ├── supabase_seating.py      # Seating plan repository (470 lines)
│   │   ├── supabase_students.py     # Student repository
│   │   ├── supabase_rooms.py        # Room repository with desk layout
│   │   ├── supabase_attendance.py   # Attendance repository with caching
│   │   ├── supabase_inventory.py    # Inventory CRUD
│   │   ├── supabase_edupay.py       # Fee/payment repository
│   │   ├── supabase_hostels.py      # Hostel with capacity calc
│   │   ├── supabase_timetable.py    # Timetable with conflict detection
│   │   ├── supabase_batches.py      # Batch management
│   │   ├── supabase_exams.py        # Exam repository
│   │   ├── supabase_teachers.py     # Teacher repository
│   │   ├── supabase_invigilators.py # Invigilator assignments
│   │   ├── supabase_admin.py        # Supabase admin client factory
│   │   ├── auth_security.py         # Auth abuse protection
│   │   └── admin_bootstrap.py       # Initial admin user
│   ├── utils/               # Utility functions
│   │   ├── auth.py          # Password hashing, JWT create/decode, OTP
│   │   ├── excel.py         # 1379 lines - Excel parse/write for all modules
│   │   ├── pdf.py           # 241 lines - PDF report generation (ReportLab)
│   │   ├── staff_excel.py   # 409 lines - Staff Excel template
│   │   ├── validation.py    # Validation classes for rooms, students, exams
│   │   ├── academic_batches.py # Batch name parsing
│   │   └── helpers.py       # General helpers
│   ├── middleware/
│   │   ├── auth.py          # 719 lines - JWT auth middleware, Supabase principal
│   │   └── observability.py # 125 lines - Request tracking, slow diagnostics
│   └── attendance/          # Native attendance module
│       ├── native/
│       │   ├── router.py    # 20+ attendance endpoints
│       │   └── service.py   # NativeAttendanceService class
│       ├── contracts.py     # Exception normalization
│       ├── factory.py       # Service factory
│       ├── guards.py        # Mode guards
│       └── schema_checks.py # Schema verification
├── requirements.txt
├── Dockerfile
├── tests/
└── alembic/
```

### Frontend (`frontend/`)
```
frontend/
├── src/
│   ├── main.tsx             # Entry point: ReactDOM + AuthProvider
│   ├── App.tsx              # Router setup with ProtectedRoute, all routes
│   ├── contexts/
│   │   └── AuthProvider.tsx # 717 lines - Supabase auth session management
│   ├── services/
│   │   ├── api.ts           # 1180 lines - ALL API calls (ApiService class)
│   │   └── seatingPlanner.ts # 393 lines - Client-side anti-cheat algorithm
│   ├── store/
│   │   ├── auth.ts          # Zustand auth store with localStorage persistence
│   │   ├── app.ts           # Zustand app store (students, rooms, plans)
│   │   └── settings.ts      # Zustand settings store (school config)
│   ├── types/index.ts       # 945 lines - ALL TypeScript interfaces
│   ├── components/
│   │   ├── Layout.tsx       # 602 lines - Sidebar navigation with search
│   │   ├── ProtectedRoute.tsx # Route guard with permission checks
│   │   ├── RoomVisualization.tsx # SVG room layout rendering
│   │   ├── Alert.tsx, ErrorBoundary.tsx, LoadingSpinner.tsx
│   │   └── MigrationUnavailableNotice.tsx
│   ├── pages/               # 30 page components
│   │   ├── Dashboard.tsx    # 1091 lines - Main dashboard with metrics
│   │   ├── SeatingGeneration.tsx
│   │   ├── SeatingPlanManagement.tsx
│   │   ├── RoomConfiguration.tsx
│   │   ├── StudentManagement.tsx
│   │   ├── AttendanceManagement.tsx
│   │   ├── InventoryManagement.tsx
│   │   ├── FeeManagement.tsx
│   │   ├── HostelManagement.tsx
│   │   ├── TimetableManagement.tsx
│   │   ├── BatchManagement.tsx
│   │   ├── TeacherManagement.tsx
│   │   ├── Login.tsx, Settings.tsx, Reports.tsx
│   │   └── ... (more)
│   ├── lib/
│   │   └── supabase.ts      # Supabase client initialization
│   ├── hooks/
│   └── utils/
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── Dockerfile
```

---

## 🔐 Authentication & Security

### Flow:
```
User enters Email → Supabase sends magic link / OTP
  → User clicks link → Supabase creates session
    → Frontend fetches profile + school_memberships + permissions
      → Builds App User with role, permissions, school_id
        → Store in Zustand + localStorage
```

### Key Files:
- **`frontend/src/contexts/AuthProvider.tsx`** (717 lines) - Complete auth lifecycle:
  - `syncSession()` - Session synchronization with profile bootstrap
  - `buildAppUserFromSession()` - Fetches Supabase profile, school_memberships, role_permissions
  - `signIn()` / `signOut()` - Supabase auth methods
  - Permission checking via `role_permissions` table queries
  
- **`backend/app/middleware/auth.py`** (719 lines):
  - `verify_token()` - JWT validation from Authorization header
  - `get_authenticated_user()` - Dependency that resolves user from token
  - `require_permissions()` - Decorator/dependency for endpoint-level permission checking
  - `get_authenticated_actor_context()` - Returns user_id, school_id, role
  - Caches Supabase principals for 180 seconds

- **`backend/app/utils/auth.py`** (215 lines):
  - `hash_password()` / `verify_password()` - PBKDF2 + bcrypt
  - `create_access_token()` / `create_refresh_token()` - JWT creation with HS256
  - `decode_token()` - JWT validation with caching
  - `generate_otp()` - 6-digit OTP generation

---

## 🎯 Core: Anti-Cheat Seating Algorithm

### Backend: `backend/app/services/seating_engine.py` (516 lines)
### Frontend: `frontend/src/services/seatingPlanner.ts` (393 lines)

Dono side (backend + frontend) par same algorithm implement hai - backend Supabase pe save karta hai, frontend client-side generation ke liye.

### Algorithm Details:

#### 1. **Student Distribution - Round Robin by Batch**
```python
# backend: seating_engine.py - _round_robin_students_by_batch()
# frontend: seatingPlanner.ts - roundRobinStudentsByBatch()
```
- Pehle students ko batch-wise group karo
- Largest batch se start karo, alternating forward/reverse pass
- Har batch se ek student pick karo in round-robin fashion
- Isse batches evenly distribute hote hain

#### 2. **8-Way Adjacency Check**
```python
# backend: _is_restricted_neighbor()
# frontend: isRestrictedNeighbor()
```
Same batch ke students ko adjacent desks par nahi baithaya ja sakta:
- **Front/Back:** row distance 1-2, same column → ❌ Blocked
- **Left/Right:** same row, column distance 1-2 → ❌ Blocked
- **Diagonal (strict mode):** row=1 AND col=1 → ❌ Blocked

#### 3. **Conflict Group Support**
```python
# backend: _build_batch_conflict_lookup()
# frontend: buildConflictLookup()
```
Different batch names ko same anti-cheat group mein map kiya ja sakta hai. Eg: "11th A", "11th B" dono ek group treat honge.

#### 4. **Desk Selection Algorithm**
```python
# backend: _find_best_desk_for_student() / _candidate_desk_sort_key()
# frontend: findBestDeskForStudent() / candidateDeskSortKey()
```
Har student ke liye best desk find karta hai based on sort key:
1. **Occupancy priority:** Empty desk first (0), then half-filled (1), then full (skip)
2. **Sequence penalty:** Nearby same-batch students avoid karo
3. **Pair penalty:** Batch combinations ko balance karo (same batch pair na ho)
4. **Restricted neighbors:** Minimum conflicts wali desk
5. **Position:** Row/column order - consistent layout

#### 5. **Multi-Room Distribution**
```python
# frontend: allocateStudentsToRoomPools()
```
Students ko multiple rooms mein distribute karta hai:
- Har batch ko rooms mein evenly distribute karo
- Sabse kam batch count wale room ko prefer karo
- Room fill percentage balance karo
- Round-robin order maintain karo per room

#### Plan Types:
| Plan | Mode | Diagonal Check | Occupancy Priority |
|------|------|----------------|-------------------|
| **Plan A (Strict)** | strict | ✅ Yes | Empty → Half → Full |
| **Plan B (Compact)** | compact | ❌ No | Half → Empty → Full |
| **All-in-One** | all_in_one | ❌ No | Empty → Half → Full |

---

## 🗄 Database Models (`backend/app/models/__init__.py` - 1191 lines)

### Core Models:
| Model | Table | Key Fields |
|-------|-------|-----------|
| User | users | email, username, password_hash, role, permissions |
| School | schools | name, address, admin_id |
| Student | students | roll_number, name, batch, class_name, section, school_id |
| Room | rooms | name, length_feet, width_feet, num_benches, door_location |
| Desk | desks | room_id, row, col, is_reserved |
| Seat | seats | desk_id, position(1/2), student_id, is_occupied |
| Exam | exams | name, subject, date, school_id |
| SeatingPlan | seating_plans | exam_id, room_id, plan_type, status, assignment_data |
| Teacher | teachers | name, subject, employee_code, school_id |
| BatchTable | batches | name, category, display_order, school_id |
| TimetableEntry | timetable | teacher_id, day_of_week, start_time, end_time, class_name |
| Invigilator | invigilators | staff_id, name, department |
| RoomInvigilator | room_invigilators | room_id, invigilator_id, exam_id |
| ActivityLog | activity_logs | user_id, action, resource_type, details |
| Token | tokens | email, token, token_type, otp_code, expires_at |
| Hostel | hostels | name, hostel_head, gender_category |
| HostelRoom | hostel_rooms | hostel_id, room_number, total_beds, occupied_beds |
| StudentHostelRequest | student_hostel_requests | student_id, hostel_id, status |
| Holiday | holidays | title, holiday_date |
| Leave | leaves | staff_member_id, leave_type, from_date, to_date, status |
| AttendanceRecord | attendance_records | student_id, date, status, subject_id |
| StaffAttendanceRecord | staff_attendance | staff_member_id, date, status |

### Inventory Models:
| Model | Key Fields |
|-------|-----------|
| InventorySubject | name, is_active |
| InventorySet | subject_id, name |
| InventoryVolume | subject_id, set_id, volume_number |
| MaterialItem | name, subject_id, unit_type, current_stock |
| Supplier | name, contact_person, phone |
| StockInEntry | material_id, supplier_id, quantity_received |
| StockOutEntry | material_id, batch_id, quantity_issued |
| StudentIssueEntry | student_id, material_id, quantity_issued |

### EduPay Models:
| Model | Key Fields |
|-------|-----------|
| EduPayStudent | admission_no, full_name, class_name, parent_name |
| FeeStructure | name, fee_type, total_amount, installment_plan |
| EduPayAssignment | student_id, fee_structure_id, total_amount, amount_paid, status |
| EduPayPayment | assignment_id, amount, method, transaction_reference |

---

## 🚏 API Routes (Summary)

### Authentication: `/api/auth/`
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/send-otp` | POST | Email par OTP bhejta hai |
| `/auth/verify-otp` | POST | OTP verify karta hai, JWT return karta hai |
| `/auth/logout` | POST | Session invalidate |
| `/auth/refresh` | POST | Token refresh |
| `/auth/me` | GET | Current user profile |
| `/auth/users` | GET/POST/PUT/DELETE | Role user management |

### Students: `/api/students/`
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/students` | GET | List with pagination, batch filter |
| `/students` | POST | Create single student |
| `/students/{id}` | PUT/DELETE | Update/Delete |
| `/students/import` | POST | Excel bulk import (180s timeout) |
| `/students/export` | GET | Excel export |
| `/students/transfer` | POST | Batch transfer |
| `/students/template/download` | GET | Excel template |
| `/students/count` | GET | Student count |
| `/students/hostels` | GET/POST | Hostel management |
| `/students/hostel-requests` | GET | Hostel requests |

### Rooms: `/api/rooms/`
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/rooms` | GET/POST | List/Create |
| `/rooms/{id}` | GET/PUT/DELETE | Single CRUD |
| `/rooms/summary` | GET | Summary stats |

### Seating: `/api/seating/`
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/seating/generate` | POST | Plans generate karo (core algorithm) |
| `/seating/plans` | GET | All plans |
| `/seating/plans/{room_id}` | GET | Room-wise plans |
| `/seating/{plan_id}/layout` | GET | Room layout with student positions |
| `/seating/{plan_id}/finalize` | POST | Plan finalize |
| `/seating/{plan_id}` | DELETE | Delete plan |
| `/seating/template/download` | GET | Excel template |
| `/seating/import` | POST | Import from Excel |

### Reports: `/api/reports/`
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/reports/pdf/{plan_id}` | GET | PDF seating chart |
| `/reports/excel/{plan_id}` | GET | Excel export |
| `/reports/excel/all-rooms/{exam_id}` | GET | Multi-room export |

### Attendance: `/api/attendance/`
~30 endpoints including:
- Overview, dashboard, student/staff marking, records, holidays, leaves, reports, export, calendar, notifications, settings

### Inventory: `/api/inventory/`
~25 endpoints including:
- Materials CRUD, suppliers, stock-in/out, student issues, subjects, sets, volumes, catalog, reports, history, import

### EduPay: `/api/edupay/`
~10 endpoints including:
- Students, fee-structures, assignments, payments, parent-portal, dashboard

### Other: `/api/`
- `/exams/` - CRUD
- `/teachers/` - CRUD + count
- `/timetable/` - CRUD + conflict check + upload/export
- `/batches/` - CRUD + reorder
- `/invigilators/` - CRUD + room assignments
- `/staff/` - Import + template
- `/hostels/` - CRUD (via students route)
- `/settings/` - Get/Update school settings
- `/dashboard/metrics` - Aggregated stats

---

## 🔄 Key Data Flows

### 1. Seating Plan Generation Flow
```
User clicks "Generate" on SeatingGeneration page
  → Frontend calls POST /api/seating/generate
    → Backend: resolve_school_id_from_actor()
    → Backend: supabase_seating.generate_seating_plans()
      → Fetch students from DB
      → Fetch room configurations
      → Run SeatingAlgorithmEngine:
        1. Round-robin students by batch
        2. For each student, find best desk
        3. Check 8-way adjacency rules
        4. Assign to desk
      → Store plan in seating_plans table
      → Store assignments in seats table
    → Return plan data
  → Frontend: Display room visualization
  → User can export PDF/Excel
```

### 2. Student Import Flow
```
User uploads Excel file
  → Frontend: POST /api/students/import (multipart FormData)
  → Backend: parse_student_excel() (1379 lines Excel parser)
    → Validate headers (roll_number, name, batch, etc.)
    → Parse rows, detect batch names
    → Check duplicates
    → Upsert into Supabase
    → Return imported_count, skipped_count, errors
```

### 3. Attendance Marking Flow
```
Teacher opens Attendance page
  → Frontend: GET /attendance/student-marking (date, class, section)
  → Backend: Fetch students for that class
  → Teacher marks Present/Absent/Late
  → Frontend: POST /attendance/student-marking
  → Backend: Save records with status, date, marked_by
```

### 4. Fee Payment Flow
```
Admin manages fee structures
  → Frontend: Create FeeStructure with amount, installment plan
  → Assign to students
  → Student/Parent portal shows due amounts
  → Payment recorded with method, transaction ID
  → Assignment status updates: pending → paid/overdue
```

---

## 🔧 Tech Stack Details

### Backend:
- **FastAPI** - Async Python web framework
- **SQLAlchemy** - ORM (legacy SQLite)
- **Supabase** - PostgreSQL + Auth + REST API (production)
- **Pydantic** - Data validation (Settings + Schemas)
- **python-jose** - JWT tokens
- **passlib** - Password hashing (PBKDF2 + bcrypt)
- **openpyxl** - Excel file processing
- **reportlab** - PDF generation
- **APScheduler** - Task scheduling
- **httpx** - HTTP client for Supabase integration

### Frontend:
- **React 18** with TypeScript
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **Zustand** - State management (3 stores: auth, app, settings)
- **Axios** - HTTP client (ApiService singleton)
- **React Router v6** - Routing with AuthGuard
- **Supabase JS Client** - Auth session management
- **Lucide React** - Icons
- **SVG** - Room visualization (no canvas library)

### Database:
- **Development:** SQLite (`seating_planner.db`)
- **Production:** PostgreSQL 14+ via Supabase

---

## 📊 Key Features Summary

| Module | Features |
|--------|----------|
| **Seating** | Anti-cheat algorithm, Plan A/B, multi-room, drag-drop viz, PDF/Excel export |
| **Students** | CRUD, Excel import/export, batch management, hostel allocation |
| **Rooms** | Configurable dimensions, door placement, auto desk calculation |
| **Attendance** | Student/staff marking, dashboard, reports, holidays, leaves, notifications |
| **Timetable** | Weekly schedule, conflict detection, teacher assignment, Excel upload/export |
| **Inventory** | Catalog (subject/set/volume), materials, suppliers, stock in/out, student issues |
| **EduPay** | Fee structures, student assignments, payments, parent portal |
| **Hostel** | Multi-hostel, room/bed management, student requests, approval workflow |
| **Staff** | Teaching/non-teaching import, bulk upload, directory |
| **Settings** | School info, batch colors, export preferences, feature toggles |
| **Reports** | PDF (ReportLab), Excel (openpyxl) - seating, attendance, inventory, timetable |
| **Auth** | Email/OTP, Supabase SSO, role-based access control, activity logging |
| **Invigilators** | Staff assignment to rooms during exams |

---

## ⚙️ Configuration (`backend/app/config.py` - 227 lines)

Pydantic `Settings` class reads from `.env` / `.env.local`:
- `database_url` - PostgreSQL or SQLite
- `supabase_url`, `supabase_anon_key`, `supabase_service_role_key`
- `jwt_secret`, `jwt_algorithm` - JWT config
- `environment` - development/production
- Security validators: production mode enforces strong passwords, blocks SQLite, validates JWT length
- Unsafe credential detection (common weak passwords are blocked)

---

## 🌐 Frontend Routing (`App.tsx` - 238 lines)

Protected routes with permission checks:
```
/                              → Dashboard (Overview)
/admin-office                  → Admin Office Dashboard
/rooms                         → Room Configuration
/seating/generate              → Seating Generation
/seating/plans                 → Seating Plan Management
/students                      → Student Management
/students/directory            → Student Directory
/batches                       → Batch Management
/teachers                      → Teacher Management
/staff/add                     → Add Staff
/staff/directory               → Staff Directory
/staff/bulk-upload             → Staff Bulk Upload
/invigilators                  → Invigilator Management
/timetable                     → Timetable Management
/attendance-management         → Attendance Management
/hostels                       → Hostel Management
/inventory                     → Inventory Management
/edupay                        → Fee Management
/reports                       → Reports & Export
/settings                      → System Settings
/admin/access-control          → Role & Security
```

---

## ✅ Testing & Deployment

- **Backend Tests:** `backend/tests/` - pytest
- **Frontend Build:** `npm run build` → `dist/`
- **Docker:** `docker-compose.yml` with frontend (Nginx) + backend (Uvicorn) + PostgreSQL
- **Render Deployment:** Backend on Render Web Service, Frontend on Render Static Site
- **One-Click Run:** `run_app.bat` - Installs deps, sets up DB, starts both servers

---

## ⚡ Performance & Security

- **Async FastAPI** handlers for non-blocking I/O
- **JWT caching** (300s TTL) for token decode
- **Supabase principal caching** (180s TTL)
- **Connection pooling** (pool_size=20, max_overflow=40 for PostgreSQL)
- **School context isolation** - har request mein school_id resolve hota hai
- **Permission-based access** - har route par granular permission checks
- **Auth rate limiting** - brute force protection
- **Error handling** - UUID tracking, no stack leak in production

---

## 📝 Notes for Developer

1. **Codebase size:** ~15,000+ lines of Python + ~8,000+ lines of TypeScript/React
2. **Legacy SQLite code** still exists alongside Supabase-native code - migration in progress
3. **Frontend ApiService** (`api.ts`) has 1180 lines with ALL API methods in one class
4. **Core algorithm** is duplicated (backend + frontend) for client-side generation support
5. **Auth system** uses Supabase Auth but maps roles/permissions from custom tables
6. **Excel parsing** (`utils/excel.py - 1379 lines`) is the largest utility file
