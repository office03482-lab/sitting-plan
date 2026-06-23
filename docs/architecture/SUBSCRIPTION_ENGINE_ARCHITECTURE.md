# Subscription Engine Architecture

## 1. Overview

The Subscription Engine governs **school-level** and **external-student-level** plan entitlements. It sits between the existing RBAC/Scope layer and every creation/usage flow, enforcing hard and soft limits before the business logic executes.

---

## 2. Existing Foundations

| Component | Status | Location |
|-----------|--------|----------|
| `finance.subscriptions` table | MIGRATED | Supabase `finance` schema — stores per-school/per-profile plan, status, dates |
| `finance.products` table | MIGRATED | Product catalog with pricing_model, billing_interval, access_tier |
| `finance.orders` / `finance.order_items` | MIGRATED | Order lifecycle |
| `supabase_monetization.py` | EXISTS | Order creation, verification, subscription creation, revenue dashboard |
| `monetization.py` routes | EXISTS | 5 REST endpoints |
| Scope engine (`scope_engine.py`) | EXISTS | Permission + scope resolution |
| Tenant isolation | EXISTS | `school_id` from actor context |
| RBAC | EXISTS | `require_permissions()` pattern |

### Missing Components

| Component | Gap |
|-----------|-----|
| School plan assignment table | `schools` table has no `plan_tier`, `max_students`, etc. |
| School entitlement cache | No fast lookup for "what can this school do?" |
| External student plan assignment | No table linking external students to Free/Pro/Elite plans |
| Per-plan limit definitions | No configuration for student/teacher/storage/AI limits per plan |
| Usage counters | No per-school/per-profile usage tracking tables |
| Plan enforcement layer | No middleware or dependency that checks limits before creation |

---

## 3. School Plans

### 3.1 Plan Definitions

```
Plan:         Starter       Standard      Premium       Enterprise
───
Students      100           500           2,000         Unlimited
Teachers      10            50            200           Unlimited
Parents       50            200           1,000         Unlimited
Storage GB    5             25            100           1,000
AI Credits    500           5,000         25,000        100,000
LMS Courses   10            50            200           Unlimited
Online Tests  20            100           500           Unlimited
API Calls/hr  1,000         10,000        50,000        Unlimited
Cost (INR/mo) Free          1,999         5,999         Custom
```

### 3.2 Plan Enforcement Rules

- **Starter**: No payment required. Hard-coded in the engine as the default for new schools.
- **Standard, Premium, Enterprise**: Require an active subscription record in `finance.subscriptions` with `subscription_status = 'active'` and `expiry_date >= today`.
- **Enterprise**: Custom contract; limits are stored as overrides in the school's subscription metadata.

### 3.3 Plan Upgrade/Downgrade

- **Upgrade**: Immediate. New limits apply on next request. Prorated billing.
- **Downgrade**: At end of current billing period. Soft warning 7 days before.
- **Overage**: On downgrade, if usage exceeds new limits:
  - Existing data is preserved (read-only)
  - New creations are blocked
  - Admin dashboard shows overage banner

---

## 4. External Student Plans

### 4.1 Plan Definitions

```
Plan:         Free          Pro           Elite
───
AI Credits    10/mo         100/mo        500/mo
Test Attempts 3/mo          30/mo         150/mo
LMS Access    Read-only     Full          Full + Download
Study Planner Basic         Full          Full + Analytics
Analytics     None          Basic         Advanced
Premium Feat  None          No ads        Priority support
```

### 4.2 External Student Lifecycle

1. Student registers (via parent portal or self-service)
2. Default plan: **Free**
3. Upgrade to Pro/Elite via:
   - In-app purchase → Razorpay order → subscription created
   - School-sponsored plan (school purchases bulk seats)
   - Coupon code
4. Downgrade / expiry: enforced at next request boundary

---

## 5. Required Tables

### 5.1 `public.school_plans` (NEW)

```sql
create table public.school_plans (
  school_id        uuid primary key references public.schools(id),
  plan_tier        text not null default 'starter',
  max_students     int not null default 100,
  max_teachers     int not null default 10,
  max_parents      int not null default 50,
  max_storage_gb   int not null default 5,
  max_ai_credits   int not null default 500,
  max_lms_courses  int not null default 10,
  max_online_tests int not null default 20,
  api_rate_limit   int not null default 1000,
  overrides        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
```

### 5.2 `public.external_student_plans` (NEW)

```sql
create table public.external_student_plans (
  profile_id       uuid primary key references public.profiles(id),
  school_id        uuid not null references public.schools(id),
  plan_tier        text not null default 'free',
  ai_credits_remaining int not null default 10,
  ai_credits_reset_at  date not null,
  test_attempts_remaining int not null default 3,
  test_attempts_reset_at date not null,
  starts_at        date not null default current_date,
  expires_at       date,
  auto_renew       boolean not null default false,
  overrides        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
```

### 5.3 `public.school_usage_counters` (NEW)

```sql
create table public.school_usage_counters (
  school_id        uuid primary key references public.schools(id),
  student_count    int not null default 0,
  teacher_count    int not null default 0,
  parent_count     int not null default 0,
  storage_used_gb  numeric(10,2) not null default 0,
  ai_credits_used  int not null default 0,
  lms_courses      int not null default 0,
  online_tests     int not null default 0,
  api_calls_1hr    int not null default 0,
  refreshed_at     timestamptz not null default timezone('utc', now())
);
```

### 5.4 Modify `finance.subscriptions`

Add `plan_tier` column to link subscriptions to the school plan:

```sql
alter table finance.subscriptions add column plan_tier text;
alter table finance.subscriptions add constraint chk_plan_tier
  check (plan_tier in ('starter', 'standard', 'premium', 'enterprise', 'free', 'pro', 'elite'));
```

---

## 6. Required Services

### 6.1 `entitlement_engine.py` (see separate document)

Central decision point: Permission + Scope + Subscription + Entitlement → Allow/Deny.

### 6.2 `usage_tracker.py`

```python
class UsageTracker:
    def increment_counter(school_id, counter_name: str, delta: int = 1)
    def get_counter(school_id, counter_name: str) -> int
    def reset_counter(school_id, counter_name: str)
    def refresh_usage_cache(school_id)
```

Backed by `public.school_usage_counters` with Redis caching for hot counters.

### 6.3 `plan_enforcer.py`

```python
class PlanEnforcer:
    def check_school_limit(school_id, limit_type: str) -> bool
    # limit_type: 'students', 'teachers', 'parents', 'storage', 'ai_credits', 'lms_courses', 'online_tests'
    
    def check_external_student_limit(profile_id, limit_type: str) -> bool
    # limit_type: 'ai_credits', 'test_attempts'
    
    def assert_school_limit(school_id, limit_type: str)  # raises 403 on exceeded
    
    def get_school_plan(school_id) -> SchoolPlan
    def get_external_student_plan(profile_id) -> ExternalStudentPlan
```

### 6.4 `subscription_orchestrator.py`

Handles:
- Plan assignment on school creation
- Plan upgrade/downgrade
- Subscription renewal
- Grace period management
- Override handling for Enterprise plans

---

## 7. Required API Endpoints

### 7.1 Platform Admin APIs (guard: `platform_admin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/platform/schools/{school_id}/plan` | Get school plan + usage |
| PUT | `/api/platform/schools/{school_id}/plan` | Set/override school plan |
| GET | `/api/platform/plans` | List all plan definitions |
| PUT | `/api/platform/plans/{plan_tier}` | Update plan limits |
| GET | `/api/platform/billing/summary` | MRR, ARR, active/trial/expired schools |
| POST | `/api/platform/billing/invoice/{school_id}` | Generate manual invoice |

### 7.2 School Admin APIs (guard: `admin_office`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/school/plan` | Get current plan + usage |
| GET | `/api/school/plan/upgrade` | Available upgrades + pricing |
| POST | `/api/school/plan/upgrade` | Initiate upgrade (→ Razorpay order) |
| GET | `/api/school/plan/usage` | Detailed usage breakdown |

### 7.3 External Student APIs (guard: authenticated student)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/student/plan` | Current plan + remaining credits |
| POST | `/api/student/plan/upgrade` | Upgrade to Pro/Elite |
| GET | `/api/student/plan/history` | Plan change history |

---

## 8. Required UI Screens

| Screen | Route | Description |
|--------|-------|-------------|
| School Billing | `/settings/billing` | View current plan, usage bars, upgrade options, payment history |
| Plan Selection | `/settings/billing/upgrade` | Plan comparison table, CTA → checkout |
| External Student Plan | `/student/settings/plan` | Current plan, remaining credits, upgrade |
| Platform Billing Dashboard | `/admin/platform/billing` | MRR, ARR, active/trial/expired schools, plan distribution |
| Platform Plan Config | `/admin/platform/plans` | Edit plan limits per tier |

---

## 9. Enforcement Flow

```
Request → Route → Dependency Chain
                    │
                    ├─ 1. authenticate_user()  → JWT → User + School
                    ├─ 2. require_permissions() → RBAC check
                    ├─ 3. resolve_school_id()   → Tenant isolation
                    ├─ 4. PlanEnforcer.assert_school_limit()
                    │       ┌──────────────────────────────┐
                    │       │  school_plans table           │
                    │       │  ↓                            │
                    │       │  school_usage_counters table  │
                    │       │  ↓                            │
                    │       │  current < max? → Allow/Deny  │
                    │       └──────────────────────────────┘
                    ├─ 5. EntitlementEngine.check()
                    │       Permission + Scope + Plan
                    └─ 6. Route handler (business logic)
```

---

## 10. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Plan enforcement adds latency to every creation flow | Medium | Use Redis counters with async DB sync |
| Race condition on limit check (two concurrent creates) | Medium | Use atomic `UPDATE ... SET count = count + 1 WHERE count < max` |
| Existing schools have no plan assigned | High | Migration assigns `starter` plan to all existing schools |
| External students created before plans existed | Medium | Assign `free` plan on migration |
| Webhook failure delays subscription activation | Medium | Queue-based processing with retry |
| Downgrade deletes data | Critical | Never delete on downgrade; block new writes only |
| Plan override for Enterprise bypasses limits | Low | Track overrides in audit log |

---

## 11. PASS / PARTIAL / FAIL

| Check | Status |
|-------|--------|
| Existing subscription table with plan_name | PASS |
| Existing order/payment lifecycle | PASS |
| Existing RBAC + scope engine | PASS |
| Existing tenant isolation (school_id) | PASS |
| Existing platform admin routes | PARTIAL — no plan/billing management |
| Per-plan limit definitions | FAIL — not defined anywhere |
| School plan assignment table | FAIL — does not exist |
| Usage tracking counters | FAIL — does not exist |
| Plan enforcement middleware | FAIL — does not exist |
| External student plan system | FAIL — does not exist |
| Payment gateway integration | PARTIAL — mock adapter exists, no real integration |
