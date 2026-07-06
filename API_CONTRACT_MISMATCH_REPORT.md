# API CONTRACT MISMATCH REPORT — Dr. Girish App

**Audit Date:** 2026-07-06

---

## CONTRACT MISMATCH TABLE

| # | Frontend Method | Frontend File | Expected Endpoint | Actual Backend Endpoint | Method | Contract Status | Severity |
|---|----------------|---------------|-------------------|------------------------|--------|----------------|----------|
| 1 | `signIn()` | `AuthProvider.tsx:905` | Supabase JS Client `supabase.auth.signInWithPassword()` | Backend `/api/auth/login-password` exists but unused | — | ⚠️ **INTENTIONAL — dead code on backend** | P2 |
| 2 | `sendOtp()` | `api.ts` | `/api/auth/send-otp` | `routes/auth.py:651` POST `/api/auth/send-otp` | POST | ✅ Match | — |
| 3 | `verifyOtp()` | `api.ts` | `/api/auth/verify-otp` | `routes/auth.py:761` POST `/api/auth/verify-otp` | POST | ✅ Match | — |
| 4 | `getParentIntelligenceDashboard()` | `api.ts:904` | `GET /parent/dashboard` | `parent_portal.py` | GET | ⚠️ **DUPLICATE** | P2 |
| 5 | `getParentPortalDashboard()` | `api.ts:2344` | `GET /parent/dashboard` | `parent_portal.py` | GET | ⚠️ **DUPLICATE** | P2 |
| 6 | `listBatches()` | `api.ts:1580` | `GET /batches` | `routes/batches.py` | GET | ⚠️ **UNTYPED** | P2 |
| 7 | `getAttendanceSettings()` | `api.ts:2130` | `GET /attendance/settings` | N/A | GET | ✅ Match | — |
| 8 | `login-password` response | `auth.py:635-648` | `LoginResponse` with integer IDs | Frontend expects UUID strings | — | ❌ **TYPE MISMATCH** | **P1** |
| 9 | `Student` type | `types/index.ts:668` | `name: string` | `full_name: string` from backend | — | ❌ **FIELD MISMATCH** | **P1** |
| 10 | `Student` type | `types/index.ts:672` | `batch: string` | `batch_id: string` from backend | — | ❌ **FIELD MISMATCH** | P2 |
| 11 | `SeatingPlan.plan_type` | `types/index.ts:878` | `'strict' \| 'compact'` | Missing `'all_in_one'` | — | ❌ **MISSING VARIANT** | P3 |
| 12 | Auth routes prefix | `main.py:172` | `/api/auth` | In `auth.py:43` router has NO prefix override | — | ✅ Match | — |
| 13 | Students routes | `main.py:178-183` | `/api/students` | `students.py` | — | ✅ Match | — |
| 14 | Rooms routes | `main.py:184-189` | `/api/rooms` | `rooms.py` | — | ✅ Match | — |
| 15 | Seating routes | `main.py:190-198` | `/api/seating` | `seating.py` | — | ✅ Match | — |
| 16 | Reports routes | `main.py:199-207` | `/api/reports` | `reports.py` | — | ✅ Match | — |
| 17 | Invigilators routes | `main.py:247-252` | NO PREFIX in main.py | `invigilators.py` defines own `prefix="/invigilators"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |
| 18 | Inventory routes | `main.py:253-256` | NO PREFIX in main.py | `inventory.py` defines own `prefix="/inventory"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |
| 19 | EduPay routes | `main.py:257-260` | NO PREFIX in main.py | `edupay.py` defines own `prefix="/edupay"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |
| 20 | Online Tests routes | `main.py:291-294` | NO PREFIX | `online_tests.py` defines own `prefix="/online-tests"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |
| 21 | LMS routes | `main.py:301-304` | NO PREFIX | `lms.py` defines own `prefix="/lms"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |
| 22 | Platform routes | `main.py:276-279` | NO PREFIX | `platform.py` defines own `prefix="/platform"` | — | ✅ **NOT A MISMATCH** — router defines its own prefix | — |

---

## DETAILED MISMATCH ANALYSIS

### Mismatch #1: Auth Architecture (P2 — Architectural Debt)
**Frontend:** `AuthProvider.tsx:905` calls `supabase.auth.signInWithPassword({ email, password })`  
**Backend:** `routes/auth.py:822` has `/login-password` endpoint using SQLAlchemy User model (dead code — no UI calls it)  
**Verified Behavior:** Backend middleware (`middleware/auth.py`) has 3-step JWT fallback (local JWT → SUPABASE_JWT → Supabase Auth REST API). When SQLAlchemy User lookup fails, it falls through to `_fetch_supabase_principal()` which builds principal from Supabase tables. **Auth succeeds without SQLAlchemy User table.**  
**Impact:** Architectural debt — legacy code path exists but is not blocking. Dead routes should be cleaned up but are not an active risk.

### Mismatch #9: Student Type (P1 HIGH)
**Frontend:** `types/index.ts:668` expects `name: string`  
**Backend:** `routes/students.py` returns `full_name`  
**Problem:** Frontend type has both fields but the backend returns `full_name`. Components using `student.name` get `undefined`.  
**Impact:** Student names display as blank or "undefined" in lists.

### Mismatch #17-22: Router Prefixes — DISPROVED
**Previous claim:** Routers included without explicit prefix in `main.py` may cause 404s  
**Verified:** ALL six routers (`invigilators`, `inventory`, `edupay`, `online_tests`, `lms`, `platform`) define their own `prefix=` parameter in their `APIRouter()` constructor. The absence of a second prefix in `include_router()` is correct — they would get double-prefixed if both were set. **No mismatch exists.**  
**Status:** DISPROVED — removed from contract mismatch list.

### Response Shape Issues
The `LoginResponse` schema returns:
- `user_id: int` (from SQLAlchemy User.id)
- `role: str` (from UserRole enum value)
- `permissions: str` (comma-separated string)

But frontend `AuthProvider.tsx:273-355` (`buildAppUserFromSession`) reads from Supabase tables directly, not from the LoginResponse. The backend `/auth/me` endpoint is not called. This means the backend-issued JWT contains DIFFERENT claims than what the frontend builds from Supabase. The two systems diverge.
