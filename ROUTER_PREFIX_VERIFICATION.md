# ROUTER PREFIX VERIFICATION

> Generated: 2026-07-06
> Source: `backend/app/main.py` lines 247-386, individual router files, `frontend/src/services/api.ts`

---

## ROUTER PREFIX MAPPING

### 1. Inventory

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/inventory.py` |
| **APIRouter definition** (line 92-95) | `router = APIRouter(prefix="/api/inventory", tags=["inventory"])` |
| **include_router in main.py** (line 253-256) | `app.include_router(inventory.router, dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/inventory` (from APIRouter prefix) |
| **Frontend URL patterns** (api.ts) | `/inventory/dashboard` (L2113), `/inventory/materials` (L2199), `/inventory/suppliers` (L2215), `/inventory/stock-in` (L2231), `/inventory/stock-out` (L2243), `/inventory/student-issues` (L2255), `/inventory/subjects` (L2267), `/inventory/sets` (L2283), `/inventory/volumes` (L2299), `/inventory/catalog` (L2315), `/inventory/materials/template/download` (L2319), `/inventory/materials/import` (L2323), `/inventory/history/material/*` (L2327), `/inventory/reports/data` (L2331), `/inventory/reports/export` (L2335) |
| **Resolved frontend path** | `/api/inventory/...` (baseURL = `/api`) |
| **MISMATCH?** | **NO** -- Backend `/api/inventory` matches frontend `/api/inventory/...` |

### 2. EduPay

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/edupay.py` |
| **APIRouter definition** (line 38) | `router = APIRouter(prefix="/api/edupay", tags=["EduPay"])` |
| **include_router in main.py** (line 257-259) | `app.include_router(edupay.router, dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/edupay` |
| **Frontend URL patterns** (api.ts) | `/edupay/dashboard` (L2117), `/edupay/students` (L2145), `/edupay/fee-structures` (L2149), `/edupay/assignments` (L2153), `/edupay/payments` (L2157), `/edupay/parent-portal` (L2161) |
| **Resolved frontend path** | `/api/edupay/...` |
| **MISMATCH?** | **NO** |

### 3. Invigilators

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/invigilators.py` |
| **APIRouter definition** (line 28-31) | `router = APIRouter(prefix="/api/invigilators", tags=["invigilators"])` |
| **include_router in main.py** (line 248-252) | `app.include_router(invigilators.router, tags=["Invigilators"], dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/invigilators` |
| **Frontend URL patterns** (api.ts) | `/invigilators` (L1309), `/invigilators/assignments` (L1339), `/invigilators/room-assignment` (L1350), `/invigilators/room/*/invigilators` (L1356), `/invigilators/assignments/*` (L1365, 1369), `/invigilators/assignments DELETE` (L1373) |
| **Resolved frontend path** | `/api/invigilators/...` |
| **MISMATCH?** | **NO** |

### 4. Online Tests

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/online_tests.py` |
| **APIRouter definition** (line 69) | `router = APIRouter(prefix="/api/online-tests", tags=["Online Tests"])` |
| **include_router in main.py** (line 291-294) | `app.include_router(online_tests.router, dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/online-tests` |
| **Frontend URL patterns** (api.ts) | `/online-tests/tests` (L650), `/online-tests/tests/*` (L654), `/online-tests/tests/*/questions` (L676), `/online-tests/question-bank` (L697), `/online-tests/question-bank/import` (L708), `/online-tests/ai-generate` (L716), `/online-tests/questions/*` (L751), `/online-tests/attempts` (L759), `/online-tests/attempts/*` (L763), `/online-tests/attempts/*/save` (L778), `/online-tests/attempts/*/submit` (L782), `/online-tests/results` (L789), `/online-tests/results/*` (L793), `/online-tests/results/analytics` (L801), `/online-tests/tests/*/publish` (L805), `/online-tests/tests/*/unpublish` (L809), `/online-tests/tests/*/duplicate` (L813) |
| **Resolved frontend path** | `/api/online-tests/...` |
| **MISMATCH?** | **NO** |

### 5. LMS

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/lms.py` |
| **APIRouter definition** (line 71) | `router = APIRouter(prefix="/api/lms", tags=["LMS"])` |
| **include_router in main.py** (line 301-304) | `app.include_router(lms.router, dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/lms` |
| **Frontend URL patterns** (api.ts) | `/lms/courses` (L1009), `/lms/courses/*` (L1013), `/lms/modules` (L1029), `/lms/modules/*` (L1037), `/lms/lessons` (L1045), `/lms/lessons/*` (L1049), `/lms/progress` (L1065, 1078), `/lms/revision-tracker` (L1082, 1095), `/lms/assignments` (L1099), `/lms/assignments/*` (L1103), `/lms/assignments/*/submit` (L1122) |
| **Resolved frontend path** | `/api/lms/...` |
| **MISMATCH?** | **NO** |

### 6. Platform

| Property | Value |
|----------|-------|
| **Router file** | `backend/app/routes/platform.py` |
| **APIRouter definition** (line 54) | `router = APIRouter(prefix="/api/platform", tags=["Platform Administration"])` |
| **include_router in main.py** (line 276-279) | `app.include_router(platform.router, dependencies=[...])` -- **NO prefix** |
| **Final backend path** | `/api/platform` |
| **Frontend URL patterns** (api.ts) | `/platform/dashboard-summary` (L1924), `/platform/workflow/*` (L1928), `/platform/audit-logs` (L1938), `/platform/schools` (L1942), `/platform/schools/*` (L1950), `/platform/schools/*/status` (L1958), `/platform/schools/clone-settings` (L1962), `/platform/schools/copy-academic-structure` (L1966), `/platform/schools/*/subscription-summary` (L1970), `/platform/usage` (L1974), `/platform/health` (L1978), `/platform/search` (L1982), `/platform/analytics-overview` (L1986), `/platform/support/*` (L1990), `/platform/audit-center` (L2001), `/platform/notifications` (L2005), `/platform/notifications POST` (L2009), `/platform/onboarding` (L2013), `/platform/schools/*/regenerate-admin-password` (L2017) |
| **Resolved frontend path** | `/api/platform/...` |
| **MISMATCH?** | **NO** |

---

## SUMMARY

| Router | APIRouter Prefix | include_router Prefix | Final Backend Path | Frontend Resolved Path | MISMATCH? |
|--------|-----------------|----------------------|-------------------|----------------------|-----------|
| inventory | `/api/inventory` | *(none)* | `/api/inventory` | `/api/inventory` | **NO** |
| edupay | `/api/edupay` | *(none)* | `/api/edupay` | `/api/edupay` | **NO** |
| invigilators | `/api/invigilators` | *(none)* | `/api/invigilators` | `/api/invigilators` | **NO** |
| online_tests | `/api/online-tests` | *(none)* | `/api/online-tests` | `/api/online-tests` | **NO** |
| lms | `/api/lms` | *(none)* | `/api/lms` | `/api/lms` | **NO** |
| platform | `/api/platform` | *(none)* | `/api/platform` | `/api/platform` | **NO** |

### Key Finding

All six examined routers define their own `prefix=` inside the `APIRouter()` constructor call. None of their `include_router()` invocations in `main.py` provide an additional prefix (they are omitted or `None`). Since the frontend axios `baseURL` is `/api`, frontend paths like `/inventory/materials` resolve to `/api/inventory/materials`, which matches the backend route prefix `/api/inventory` + `/materials`.

**No genuine mismatches were found between backend and frontend paths for these six routers.**

### Additional Observations

- The `api_prefix` setting in `config.py` is `/api` -- this is only used as a prefix for routers that do NOT define their own prefix in the `APIRouter()` call (e.g., `auth.router`, `students.router`, `rooms.router`, etc.). Those routers rely on `include_router(..., prefix=f"{settings.api_prefix}/...")`.
- For the six routers above, the prefix is hardcoded in the `APIRouter()` call, so they are unaffected by changes to `settings.api_prefix`.
- This dual approach (prefix in APIRouter vs. prefix in include_router) is consistent within the codebase and does not cause routing conflicts.
