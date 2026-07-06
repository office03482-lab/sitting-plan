# SUPABASE HEALTH AUDIT — Dr. Girish App

**Audit Date:** 2026-07-06

---

## 1. SCHEMA PERMISSION MATRIX

| Schema | Created in Migration | USAGE Grant | Table Grants | Function Grants | RLS | Risk |
|--------|---------------------|-------------|-------------|----------------|-----|------|
| **public** | Default | ✅ authenticated + anon | ✅ Full | ✅ Full | ✅ | ✅ HEALTHY |
| **academic** | 20260513_003 | ✅ authenticated | ✅ Select/Insert/Update/Delete | Not checked | ✅ | ✅ HEALTHY |
| **scheduling** | 20260513_004 | ❌ **MISSING** | ❌ None | ❌ None | ❓ | **⚠️ CRITICAL** |
| **exam** | 20260513_005 | ❌ **MISSING** | ❌ None | ❌ None | ❓ | **⚠️ CRITICAL** |
| **attendance** | 20260513_006 | ❌ **MISSING** | ❌ None | ❌ None | ✅ | **⚠️ CRITICAL** |
| **inventory** | 20260513_007 | ❌ **MISSING** | ❌ None | ❌ None | ✅ | **⚠️ CRITICAL** |
| **finance** | 20260513_007 | ❌ **MISSING** | ❌ None | ❌ None | ✅ | **⚠️ CRITICAL** |
| **hostel** | 20260513_008 | ✅ authenticated | ✅ Select/Insert/Update/Delete | Not checked | ✅ | ✅ HEALTHY |
| **reporting** | 20260513_008 | ✅ authenticated | ✅ Select/Insert/Update/Delete | Not checked | ✅ | ✅ HEALTHY |
| **workflow** | 20260609_029 | ✅ service_role | ✅ All to service_role only | ❓ | ✅ | **⚠️ WARNING** |
| **online_tests** | 20260613_033 | ✅ authenticated | ✅ Select/Insert/Update/Delete | ✅ GRANT EXECUTE | ✅ | ✅ HEALTHY |
| **analytics** | 20260613_035 | ✅ authenticated | ✅ Select | ✅ GRANT EXECUTE | ✅ | ✅ HEALTHY |
| **lms** | 20260613_037 | ✅ authenticated | ✅ Select/Insert/Update/Delete | ✅ GRANT EXECUTE | ✅ | ✅ HEALTHY |
| **ai** | 20260614_042 | ✅ authenticated | ✅ Select/Insert/Update/Delete | ✅ GRANT EXECUTE | ✅ | ✅ HEALTHY |
| **warehouse** | 20260617_058 | ❌ **MISSING** | ❌ None | ❌ None | ❓ | **⚠️ CRITICAL** |
| **sessions** | 20260619_060 | ✅ public | ✅ Full | N/A | ❓ | ✅ HEALTHY |

### CRITICAL FINDING: 5 schemas have NO USAGE grants
**`scheduling`, `exam`, `attendance`, `inventory`, `finance`, `warehouse`** — PostgREST cannot access these schemas. Any API call targeting these schemas returns 403.

### Backend Code References to Ungranted Schemas
- `backend/app/services/supabase_attendance.py` — Uses `schema="attendance"` — ❌ WILL FAIL
- `backend/app/services/supabase_inventory.py` — Uses `schema="inventory"` — ❌ WILL FAIL
- `backend/app/routes/` — Multiple routes reference `exam` schema — ❌ WILL FAIL
- `backend/app/services/supabase_bi.py` — Uses `warehouse` schema — ❌ WILL FAIL

---

## 2. RLS AUDIT MATRIX

| Table | Schema | RLS Enabled | SELECT Policy | INSERT Policy | UPDATE Policy | DELETE Policy | Tenant Isolation | Risk |
|-------|--------|-------------|---------------|---------------|---------------|---------------|------------------|------|
| schools | public | ✅ | ✅ | ✅ | ✅ | ❌ | auth.uid() via admin_id | ✅ HEALTHY |
| profiles | public | ✅ | ✅ | ✅ | ✅ | ❌ | auth.uid() = id | ✅ HEALTHY |
| school_memberships | public | ✅ | ✅ | ✅ | ✅ | ❌ | school_id check | ✅ HEALTHY |
| roles | public | ✅ | ✅ | ✅ | ✅ | ❌ | school_id | ✅ HEALTHY |
| permissions | public | ✅ | ✅ | ❌ (system) | ❌ (system) | ❌ (system) | N/A | ✅ HEALTHY |
| role_permissions | public | ✅ | ⚠️ **No explicit policy** | ⚠️ **No explicit policy** | ⚠️ **No explicit policy** | ⚠️ **No explicit policy** | N/A | **⚠️ WARNING** |
| students | academic | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| rooms | exam | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| seating_plans | exam | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| attendance_records | attendance | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| material_items | inventory | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| fee_structures | finance | ✅ | ✅ school_id | ✅ school_id | ✅ school_id | ✅ school_id | school_id | ✅ HEALTHY |
| hostel_rooms | hostel | ✅ | ✅ | ✅ | ✅ | ✅ | hostel.school_id | ✅ HEALTHY |
| workflow_requests | workflow | ✅ | ✅ | ✅ | ✅ | ✅ | school_id | ✅ HEALTHY |
| online_tests | online_tests | ✅ | ✅ | ✅ | ✅ | ✅ | school_id | ✅ HEALTHY |
| lms_courses | lms | ✅ | ✅ | ✅ | ✅ | ✅ | school_id | ✅ HEALTHY |
| ai_tutor_conversations | ai | ✅ | ✅ | ✅ | ✅ | ✅ | profile_id | ✅ HEALTHY |

---

## 3. DUPLICATE MIGRATION FILES

| Sequence | File 1 | File 2 | Conflict |
|----------|--------|--------|----------|
| **028** | `20260602_028_seating_plan_type_all_in_one.sql` | `20260608_028_bulk_action_requests.sql` | Two files, same number |
| **056** | `20260617_056_inventory_report_indexes.sql` | `20260618_056_lms_online_tests_sprint1.sql` | Two files, same number |
| **057** | `20260617_057_analytics_public_views.sql` | `20260619_057_storage_infrastructure_sprint.sql` | Two files, same number |
| **058** | `20260617_058_warehouse_tables.sql` | `20260619_058_student_success_dashboard.sql` | Two files, same number |
| **059** | `20260617_059_ai_public_views.sql` | `20260619_059_portal_access_security_sessions.sql` | Two files, same number |
| **060** | `20260619_060_move_sessions_to_public.sql` | `20260620_060_move_generated_credentials_to_public.sql` | Two files, same number |

**Impact:** Supabase migration resolver cannot determine which file to apply. The migration state is ambiguous.

---

## 4. SUPABASE UNHEALTHY ROOT-CAUSE ANALYSIS

### Confirmed Causes (from repository evidence)

1. **Request Storms from Unbounded Queries**  
   `select("*")` without `limit()` across 30+ service files → PostgREST processes huge result sets

2. **Connection Exhaustion from Auth Bootstrap**  
   Every API request triggers 3-5 sequential Supabase calls (profile → membership → permissions → session validation). Auth middleware principal fetch hits Supabase tables on every request (180s cache). If Supabase connection pool is small, this exhausts connections.

3. **Missing Schema GRANTs Causing Error Thundering Herd**  
   Inventory/finance/attendance module calls hit 403 because schema is inaccessible. Frontend retries (axios interceptor retries GET 502/503/504 errors). Retries amplify the load.

4. **Repeated Auth Requests from Frontend**  
   `AuthProvider.tsx:828` — `supabase.auth.onAuthStateChange` fires on `TOKEN_REFRESHED` → `syncSession()` → `buildAppUserFromSession()` (3 Supabase queries). Token refresh happens every 15 minutes (token TTL) across all active users.

5. **Dashboard Fan-out on Every Permission Re-evaluation**  
   `Dashboard.tsx:282` — dependency array includes permission-derived booleans that change on every render. Each change triggers full dashboard re-fetch (5-8 parallel API calls).

### Strongly Indicated Causes

6. **Lock Contention from Parallel Requests**  
   Multiple services write to the same tables (activity_logs, attendance_records) concurrently.

7. **PostgREST Schema Cache Issues**  
   Missing schema GRANTs may cause PostgREST to fail to cache schema definitions, forcing re-parsing on every request.

8. **RLS Policy Recursion Risk**  
   `school_memberships` RLS references `schools` table which references back. Complex policy chains can degrade performance.

### Hypothesis (Requires Runtime Evidence)

9. **Connection Pool Saturation** from sequential re-fetch cascades in AttendanceManagement (3-5 sequential calls per mutation) and InventoryManagement (9 parallel calls per mutation).

10. **Auth Token Storm** — 15-minute token TTL means all active users' tokens expire simultaneously in a wave, causing a coordinated refresh storm every 15 minutes.

---

## 5. RECOMMENDED IMMEDIATE ACTIONS

1. **Add GRANT USAGE on all 5 missing schemas** (P0)
2. **Resolve 6 migration duplicate file pairs** (P0)
3. **Add `.limit()` to all unbounded `select("*")` calls** (P1)
4. **Add connection pooling limits to Supabase admin client** (P1)
5. **Remove session registration heartbeat loop** (60-second interval) or make it conditional on user activity (P1)
