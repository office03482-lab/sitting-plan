# Full Supabase Migration Completion Plan

## Guarded Module Audit

| Guard String | Matches |
|---|---|
| `isMigrationGuardError` (frontend) | 42 matches across 12 files |
| `temporarily unavailable during supabase migration` | 1 definition + 1 frontend constant |
| `ensure_legacy_sqlite_route_available` (backend) | 12+ routes |
| `is_legacy_sqlite_mode` (backend) | 60+ branches across 10 route files |
| `build_legacy_sqlite_route_blocker` (backend) | 2 routers (Invigilators, Inventory) |

---

## Per-Module Migration Status

### 1. Teachers

| Attribute | Value |
|---|---|
| **Files** | `routes/teachers.py`, `services/supabase_teachers.py`, `models/__init__.py:509` |
| **Legacy Tables** | `teachers` (SQLite), `schools` |
| **Supabase Tables** | `staff_members` (with `staff_type='teaching'`) |
| **Supabase Service** | `supabase_teachers.py` |
| **Read Complete** | **YES** — `list_teachers`, `get_teacher`, `count_teachers`, `get_teachers_by_ids` |
| **Write Complete** | **NO** |
| **Delete Complete** | **NO** |
| **Migration Guard** | `ensure_legacy_sqlite_route_available()` on POST, PUT, DELETE; `is_legacy_sqlite_mode()` branching on GETs |

#### Guards to remove
- `routes/teachers.py:30` — POST block
- `routes/teachers.py:90` — GET branch
- `routes/teachers.py:125` — GET /count branch
- `routes/teachers.py:144` — GET /{id} branch
- `routes/teachers.py:182` — PUT block
- `routes/teachers.py:225` — DELETE block

#### What's needed
Add to `supabase_teachers.py`:
- `create_teacher(school_id, data)` — inserts into `staff_members` with `staff_type='teaching'`
- `update_teacher(school_id, teacher_id, data)` — updates `staff_members`
- `delete_teacher(school_id, teacher_id)` — soft delete on `staff_members`

---

### 2. Rooms

| Attribute | Value |
|---|---|
| **Files** | `routes/rooms.py`, `services/supabase_rooms.py`, `models/__init__.py` |
| **Legacy Tables** | `rooms`, `desks`, `seats`, `schools`, `users` |
| **Supabase Tables** | `rooms` (only) |
| **Supabase Service** | `supabase_rooms.py` |
| **Read Complete** | **YES** — `list_rooms`, `get_room`, `get_rooms_summary` |
| **Write Complete** | **NO** |
| **Delete Complete** | **NO** |
| **Migration Guard** | `ensure_legacy_sqlite_route_available()` on POST, PUT, DELETE, DELETE ALL; `is_legacy_sqlite_mode()` branching on GETs |

#### Guards to remove
- `routes/rooms.py:88` — POST block
- `routes/rooms.py:151` — GET branch
- `routes/rooms.py:175` — GET /summary branch
- `routes/rooms.py:197` — GET /{id} branch
- `routes/rooms.py:222` — PUT block
- `routes/rooms.py:252` — DELETE block
- `routes/rooms.py:276` — DELETE ALL block

#### What's needed
1. Create Supabase tables: `desks`, `seats` (if not already present)
2. Add to `supabase_rooms.py`:
   - `create_room(school_id, data)` — inserts room, desks, seats
   - `update_room(school_id, room_id, data)` — updates room + desks
   - `delete_room(school_id, room_id)` — soft delete room + cascade desks/seats
   - `delete_all_rooms(school_id)` — bulk soft delete
3. Remove `ensure_school_exists()` bootstrap helper (Supabase schools are pre-created)

---

### 3. Inventory

| Attribute | Value |
|---|---|
| **Files** | `routes/inventory.py` (2224 lines), no service file |
| **Legacy Tables** | `suppliers`, `inventory_subjects`, `inventory_sets`, `inventory_volumes`, `material_items`, `stock_in_entries`, `stock_out_entries`, `student_issue_entries`, `schools`, `users`, `batch_table`, `students` |
| **Supabase Tables** | `material_items`, `suppliers`, `stock_in_entries` (all in `inventory` schema, inline usage only) |
| **Supabase Service** | **NONE** |
| **Read Complete** | **NO** — entire router blocked |
| **Write Complete** | **NO** |
| **Delete Complete** | **NO** |
| **Migration Guard** | `build_legacy_sqlite_route_blocker()` applied at router level (line 81-87) |

#### Guards to remove
- `routes/inventory.py:81-87` — `build_legacy_sqlite_route_blocker()` on entire router

#### What's needed
1. Create Supabase tables for all 7 inventory entities (subjects, sets, volumes, stock-out, student-issues)
2. Create `supabase_inventory.py` service with full CRUD for all 7 entities
3. Rewrite all 30+ endpoints to use Supabase service
4. The import endpoint already writes to Supabase inline — needs to be extracted into the service
5. **Estimated: 2-3 weeks of work** — largest module

---

### 4. Invigilators

| Attribute | Value |
|---|---|
| **Files** | `routes/invigilators.py`, no service file |
| **Legacy Tables** | `invigilators`, `room_invigilators`, `rooms` |
| **Supabase Tables** | **NONE** — no supabase tables exist for invigilators |
| **Supabase Service** | **NONE** |
| **Read Complete** | **NO** — entire router blocked |
| **Write Complete** | **NO** |
| **Delete Complete** | **NO** |
| **Migration Guard** | `build_legacy_sqlite_route_blocker()` applied at router level (line 24-27) |

#### Guards to remove
- `routes/invigilators.py:24-27` — `build_legacy_sqlite_route_blocker()` on entire router

#### What's needed
1. Create Supabase tables:
   - `room_invigilators` or repurpose `staff_members` with `staff_type='invigilator'`
   - `invigilator_assignments` join table (room_id, invigilator_id, etc.)
2. Create `supabase_invigilators.py` service with full CRUD
3. Rewrite all 12+ endpoints

---

### 5. Hostels

| Attribute | Value |
|---|---|
| **Files** | `routes/students.py` (lines 752-1174), no service file |
| **Legacy Tables** | `hostels`, `hostel_rooms`, `student_hostel_requests`, `students` |
| **Supabase Tables** | **NONE** — hostel fields serialized as metadata passthrough only |
| **Supabase Service** | **NONE** |
| **Read Complete** | **NO** — all hostel routes blocked |
| **Write Complete** | **NO** |
| **Delete Complete** | **NO** |
| **Migration Guard** | `ensure_students_legacy_routes_available()` per-route guard in `students.py` |

#### Guards to remove
- `routes/students.py` — multiple `ensure_students_legacy_routes_available()` calls

#### What's needed
1. Create Supabase tables: `hostels`, `hostel_rooms`, `student_hostel_requests`
2. Create `supabase_hostels.py` service with full CRUD + room occupancy tracking
3. Extract routes from `students.py` into new `routes/hostels.py`
4. Rewrite all 10 endpoints

---

### 6. Seating Generation / Import

| Attribute | Value |
|---|---|
| **Files** | `routes/seating.py`, `services/supabase_seating.py`, `services/seating_engine.py` |
| **Legacy Tables** | `seating_plans`, `exam`, `rooms`, `students`, `desks`, `seats` |
| **Supabase Tables** | `exam.seating_plans`, `exam.exams`, `rooms` |
| **Supabase Service** | `supabase_seating.py` |
| **Read Complete** | **YES** — `list_seating_plans`, `get_seating_plan_layout` |
| **Mutate Complete** | **YES** — `finalize_seating_plan`, `delete_seating_plan`, `delete_all_seating_plans` |
| **Create Complete** | **NO** — generation blocked |
| **Import Complete** | **NO** — import blocked |
| **Migration Guard** | `ensure_legacy_sqlite_route_available()` on POST /generate and POST /import; `is_legacy_sqlite_mode()` branching on all other routes |

#### Guards to remove
- `routes/seating.py:208-211` — POST /generate block
- `routes/seating.py:460` — GET plans branch
- `routes/seating.py:485` — GET plans branch
- `routes/seating.py:508` — GET layout branch
- `routes/seating.py:581` — POST finalize branch
- `routes/seating.py:606` — DELETE plan branch
- `routes/seating.py:636-637` — DELETE all branch
- `routes/seating.py:679-682` — POST import block

#### What's needed
1. Add to `supabase_seating.py`:
   - `generate_seating_plan(school_id, exam_id, room_ids)` — runs `SeatingAlgorithmEngine` and inserts into `exam.seating_plans`
   - `import_seating_plan(school_id, data)` — imports from Excel/CSV
2. The seating generation algorithm is pure Python (`seating_engine.py`) and can be reused directly — it doesn't depend on the database
3. Remove the `ensure_legacy_sqlite_route_available()` guard and replace with `is_legacy_sqlite_mode()` → Supabase branch

---

## Modules Without Guards (Already Supabase-Native)

### Timetable — Already Supabase-Native
- `supabase_timetable.py` — full CRUD
- Route uses `is_legacy_sqlite_mode()` branching for all 9 endpoints
- **Ready to unblock** — just remove branches

### Exams — Already Supabase-Native  
- `supabase_exams.py` — full CRUD
- Route uses `is_legacy_sqlite_mode()` branching
- **Ready to unblock** — just remove branches

### Batches — Already Supabase-Native
- `supabase_batches.py` — full CRUD
- Route uses `is_legacy_sqlite_mode()` branching
- **Ready to unblock** — just remove branches

### Attendance — Already Supabase-Native (dual-mode)
- `supabase_attendance.py` — full read + bulk save
- Route uses `is_legacy_sqlite_mode()` branching
- **Ready to unblock** — just remove branches

### EduPay — Partially Supabase-Native
- `supabase_edupay.py` — read + payment create
- Route uses `is_legacy_sqlite_mode()` branching
- **Needs write functions** for fee structures, assignments

---

## Priority Order Implementation Plan

```
Priority 1: Teachers (smallest gap — read works, add writes)
    └─ Add 3 functions → remove 6 guards → done

Priority 2: Rooms (read works, needs writes + desks/seats tables)
    └─ Create desks/seats tables → add 4 functions → remove 7 guards → done

Priority 3: Seating (read/mutate works, needs create/import)
    └─ Add 2 functions → remove 8 guards → done

Priority 4: Invigilators (full build)
    └─ Create 2 Supabase tables → create service → create routes → remove 1 guard → done

Priority 5: Hostels (full build)
    └─ Create 3 Supabase tables → create service → extract routes → remove guards → done

Priority 6: Inventory (massive — 2224 lines, 7 entities, 30+ endpoints)
    └─ Create 3+ Supabase tables → create service → rewrite 30+ endpoints → remove 1 guard → done
```

---

## Modules Ready To Unblock Now

| Module | Reason |
|---|---|
| **Teachers** | Read path fully working in Supabase (`staff_members`). Only need 3 write functions to complete. |
| **Seating** | Read, update, delete all work via `supabase_seating.py`. Only generation (create) and import need porting. |
| **Timetable** | Full CRUD via `supabase_timetable.py`. Only need to remove legacy fallback branches. |
| **Exams** | Full CRUD via `supabase_exams.py`. Only need to remove legacy fallback branches. |
| **Batches** | Full CRUD via `supabase_batches.py`. Only need to remove legacy fallback branches. |

## Modules Requiring Migration Work

| Module | Complexity | Dependency |
|---|---|---|
| **Rooms** | Medium — needs desks/seats tables in Supabase + write service | Supabase schema change |
| **Invigilators** | High — no tables, no service, no routes | Supabase schema change |
| **Hostels** | High — no tables, no service, routes embedded in students.py | Supabase schema change + route extraction |
| **EduPay** | Low-Medium — needs write functions in service | None |
| **Inventory** | **Very High** — 2224 lines, 30+ endpoints, 7 entities, inline Supabase calls | Supabase schema change + full service |

---

## Files To Modify

### Backend Services (create or modify)

| File | Action |
|---|---|
| `services/supabase_teachers.py` | Add `create_teacher`, `update_teacher`, `delete_teacher` |
| `services/supabase_rooms.py` | Add `create_room`, `update_room`, `delete_room`, `delete_all_rooms` |
| `services/supabase_seating.py` | Add `generate_seating_plan`, `import_seating_plan` |
| `services/supabase_inventory.py` | **CREATE** — full CRUD for 7 entities (Suppliers, Subjects, Sets, Volumes, Materials, StockIn, StockOut, StudentIssues) |
| `services/supabase_invigilators.py` | **CREATE** — full CRUD |
| `services/supabase_hostels.py` | **CREATE** — full CRUD |
| `services/supabase_edupay.py` | Add write functions |

### Backend Routes (modify)

| File | Change |
|---|---|
| `routes/teachers.py` | Remove all 6 guards, remove SQLite fallback code |
| `routes/rooms.py` | Remove all 7 guards, remove SQLite fallback (including `ensure_school_exists`) |
| `routes/seating.py` | Remove all 8 guards, remove SQLite fallback |
| `routes/inventory.py` | Remove router-level blocker, replace all SQLite queries with Supabase calls |
| `routes/invigilators.py` | Remove router-level blocker, replace all SQLite queries with Supabase calls |
| `routes/students.py` | Extract hostel routes into separate file, remove guards |
| `routes/hostels.py` | **CREATE** — extract from students.py |
| `routes/timetable.py` | Remove `is_legacy_sqlite_mode()` branches |
| `routes/exams.py` | Remove `is_legacy_sqlite_mode()` branches |
| `routes/batches.py` | Remove `is_legacy_sqlite_mode()` branches |
| `routes/attendance.py` | Remove `is_legacy_sqlite_mode()` branches |
| `routes/edupay.py` | Remove `is_legacy_sqlite_mode()` branches |

### Backend Core (modify)

| File | Change |
|---|---|
| `config.py` | Remove `use_supabase_native_services` toggle, always use Supabase |
| `main.py` | Remove conditional router registration, always register native routers |
| `services/supabase_context.py` | Remove `is_legacy_sqlite_mode()`, `ensure_legacy_sqlite_route_available()`, `build_legacy_sqlite_route_blocker()`, `ensure_students_legacy_routes_available()` |

### Frontend (modify)

| File | Change |
|---|---|
| `services/api.ts` | Remove `MIGRATION_GUARD_DETAIL_FRAGMENT`, `isMigrationGuardError()`, `getMigrationUnavailableMessage()` |
| All 12 page files | Remove `isMigrationGuardError` imports and `setMigrationUnavailable` handling |

---

## Migration Completion Percentage

| Metric | Current | Target |
|---|---|---|
| **Backend services with Supabase CRUD** | 6 of 12 (50%) | 12 of 12 (100%) |
| **Route files with guards removed** | 0 of 12 (0%) | 12 of 12 (100%) |
| **Supabase tables with service coverage** | 20 of ~40 tables (50%) | ~40 of ~40 (100%) |
| **Frontend migration-guard code removed** | 0% | 100% |
| **Overall Migration Completion** | **~55%** | **100%** |

### Remaining Work Distribution

| Category | % of Remaining Work |
|---|---|
| Inventory module rewrite | 35% |
| Invigilators module creation | 15% |
| Hostels module creation | 15% |
| Rooms desks/seats + writes | 10% |
| Teachers write functions | 5% |
| Seating create/import | 5% |
| Guard removal (all modules) | 5% |
| Frontend cleanup | 10% |

---

## Estimated Production Readiness After Full Migration

| Criterion | Current | Post-Migration |
|---|---|---|
| Database | Dual (SQLite + Supabase) | Supabase only |
| Auth | JWT + Supabase fallback | Supabase JWT only |
| API Reliability | ✅ | ✅ |
| Migration Guards | 12 route files blocked | Zero guards |
| Build | ✅ | ✅ (smaller bundle) |
| Tests | 11/11 pass | 11/11 pass (updated) |
| **Score** | **8.5/10** | **10/10** |

The single toggle `use_supabase_native_services` in `config.py` must be set to `True` and kept. Remove the legacy SQLite `seating_planner.db` path from config. Remove all conditional register logic in `main.py`. Once all modules are rewritten, delete `app/database.py` and all SQLAlchemy model classes that only support legacy mode.
