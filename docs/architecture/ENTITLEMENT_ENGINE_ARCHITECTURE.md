# Entitlement Engine Architecture

## 1. Core Concept

The Entitlement Engine is the central decision layer that answers one question:

> **Can this actor perform this action on this resource?**

The decision is a conjunction of four independent checks:

```
Result = Permission  AND  Scope  AND  Subscription  AND  Entitlement
```

If any check fails → `403 Forbidden` with a structured error body explaining which check failed.

---

## 2. Decision Matrix

| Permission | Scope | Subscription | Entitlement | Result |
|------------|-------|-------------|-------------|--------|
| GRANT | school | active plan | within limit | **ALLOW** |
| GRANT | school | active plan | limit exceeded | **DENY** (entitlement) |
| GRANT | school | expired plan | — | **DENY** (subscription) |
| GRANT | own | active plan | within limit | **ALLOW** |
| DENY | — | — | — | **DENY** (permission) |
| GRANT | platform | — | — | **ALLOW** (platform admin bypass) |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Route Handler                         │
│  Depends(EntitlementEngine.check("students.create"))     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│               EntitlementEngine.check()                  │
│                                                         │
│  1. PermissionCheck                                      │
│     ├─ resolve_permission_scope(user, permission_key)    │
│     ├─ user_has_permission(user, permission_key)         │
│     └─ scope = own / assigned / school / platform        │
│                                                         │
│  2. SubscriptionCheck                                    │
│     ├─ get_school_plan(school_id)                        │
│     ├─ is plan active?                                   │
│     ├─ is plan within trial/grace period?                │
│     └─ platform_admin bypass                             │
│                                                         │
│  3. EntitlementCheck (limit enforcement)                 │
│     ├─ get_usage(school_id, resource_type)               │
│     ├─ get_limit(plan_tier, resource_type)               │
│     ├─ current < max?                                    │
│     └─ platform_admin bypass                             │
│                                                         │
│  4. ResourceCheck (action-specific)                      │
│     ├─ dept/class/batch scoping for teachers             │
│     └─ student self-scoping                              │
│                                                         │
│  Return: EntitlementResult{allowed, reason, code}        │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Check Details

### 4.1 Permission Check

Delegates to existing:
- `user_has_permission(user, permission_key)` — from `auth.py`
- `resolve_permission_scope(user, permission_key)` — from `scope_engine.py`
- `build_scope_context(...)` — from `scope_engine.py`

No new work. Existing RBAC is fully reused.

### 4.2 Subscription Check

```python
def check_subscription(school_id: str) -> SubscriptionStatus:
    """
    Returns: 'active' | 'trial' | 'expired' | 'grace' | 'none'
    """
    plan = get_school_plan(school_id)       # school_plans table
    sub = get_active_subscription(school_id) # finance.subscriptions
    
    if plan.plan_tier == 'starter':
        return 'active'  # free tier, always active
    
    if not sub:
        return 'none'
    
    if sub.status == 'active' and sub.expiry_date >= today:
        return 'active'
    
    if sub.status == 'active' and sub.expiry_date < today:
        # 7-day grace period
        if days_since_expiry <= 7:
            return 'grace'
        return 'expired'
    
    return sub.status  # cancelled, paused, etc.
```

### 4.3 Entitlement Check (Limit Enforcement)

```python
def check_entitlement(school_id: str, resource: str, delta: int = 1) -> EntitlementResult:
    plan = get_school_plan(school_id)
    usage = get_usage(school_id, resource)
    limit = plan.get_limit(resource)
    
    if limit == -1:  # unlimited (Enterprise)
        return EntitlementResult(True)
    
    if usage + delta > limit:
        return EntitlementResult(
            False,
            code="LIMIT_EXCEEDED",
            message=f"{resource} limit of {limit} reached. Current: {usage}"
        )
    
    return EntitlementResult(True)
```

### 4.4 Resource Check (Action-Specific Scoping)

Delegates to existing `scope_engine.py`:

- Teacher creating a student → scope is `assigned` (only their batches)
- Student viewing own record → scope is `own`
- Admin managing all → scope is `school`

---

## 5. EntitlementResult

```python
@dataclass
class EntitlementResult:
    allowed: bool
    code: str = ""        # machine-readable: LIMIT_EXCEEDED, PLAN_EXPIRED, PERMISSION_DENIED, SCOPE_DENIED
    message: str = ""     # human-readable
    http_status: int = 403

    @classmethod
    def allow(cls) -> "EntitlementResult":
        return cls(allowed=True)

    @classmethod
    def deny(cls, code: str, message: str, http_status: int = 403) -> "EntitlementResult":
        return cls(allowed=False, code=code, message=message, http_status=http_status)
```

---

## 6. FastAPI Dependency Integration

```python
# In entitlement_engine.py
async def require_entitlement(
    permission_key: str,
    resource: str | None = None,
    delta: int = 1,
) -> Callable:
    async def dependency(
        request: Request,
        user: User = Depends(get_authenticated_user),
        actor: dict = Depends(get_authenticated_actor_context),
    ) -> User:
        if request.method == "OPTIONS":
            return user
        
        # 1. Permission check (existing)
        require_permissions(permission_key)(request, user)
        
        # 2. Scope check (existing, delegated to scope_engine)
        scope_ctx = build_scope_context(user, permission_key)
        
        # 3. Subscription check
        school_id = actor.get("school_id", "")
        sub_status = check_subscription(school_id)
        if sub_status not in ('active', 'trial', 'grace'):
            raise HTTPException(403, detail=f"Plan {sub_status}")
        
        # 4. Entitlement check
        if resource:
            result = check_entitlement(school_id, resource, delta)
            if not result.allowed:
                raise HTTPException(result.http_status, detail=result.message)
        
        return user
    
    return dependency
```

---

## 7. Usage in Routes

**Before (current pattern):**
```python
@router.post("/students")
async def create_student(
    _: User = Depends(require_permissions("admin_office.students")),
    school_id: str = Depends(resolve_school_id_from_actor),
):
    ...
```

**After:**
```python
@router.post("/students")
async def create_student(
    _: User = Depends(require_entitlement("admin_office.students", resource="students")),
    school_id: str = Depends(resolve_school_id_from_actor),
):
    ...
```

The entitlement dependency wraps permission, subscription, and limit checks into one reusable dependency.

---

## 8. Entitlement-Aware Endpoints (Complete List)

| Route | Permission Key | Resource | Delta |
|-------|---------------|----------|-------|
| POST `/students` | `admin_office.students` | `students` | 1 |
| POST `/teachers` | `admin_office.teachers` | `teachers` | 1 |
| POST `/parents` | `parent_intelligence` | `parents` | 1 |
| POST `/lms/courses` | `lms.manage` | `lms_courses` | 1 |
| POST `/online-tests/tests` | `online_tests.manage` | `online_tests` | 1 |
| POST `/ai/chat` | `ai_tutor.chat` | `ai_credits` | 1 |
| POST `/ai/generate-test` | `teacher_ai.generate` | `ai_credits` | 5 |
| POST `/upload` | `lms` | `storage_gb` | file_size |
| GET `/api/subscriptions` | `edupay.subscriptions` | none | 0 |
| POST `/sessions/register` | none | `active_sessions` | 1 |

---

## 9. Grace Period & Soft Block

When a subscription expires:

1. **Days 1-7**: Soft block. Existing data is readable. New writes blocked. Dashboard shows "Renew Now" banner. School admin can still access billing page.
2. **Day 8**: Hard block. All API endpoints return `402 Payment Required`. Only the billing page remains accessible.
3. **Day 30**: Data retention period ends. School flagged for archival. Automated email sequence sent at days 7, 14, 30.

### Grace Period Exception

- **Enterprise contracts**: No hard block. Account manager notified.
- **Starter plan**: Never expires. Always active.

---

## 10. Platform Admin Bypass

Platform admin users (`role_key = 'platform_admin'`) bypass:
- Subscription checks
- Entitlement limit checks
- Grace period restrictions

Permission and scope checks still apply (platform admin has `platform` scope, not `school`).

---

## 11. Caching Strategy

| Data | Cache | TTL | Invalidation |
|------|-------|-----|-------------|
| School plan | Redis | 5 min | On plan change event |
| Usage counters | Redis | 30 sec | On every increment |
| Permission grant | In-memory (existing) | 300 sec | On permission change |
| Subscription status | Redis | 1 min | On webhook event |

---

## 12. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Entitlement engine becomes a bottleneck | High | All checks are O(1) cache lookups; no DB queries on hot path |
| Stale cache allows brief over-limit | Low | Counter increments are atomic DB writes; cache is eventually consistent |
| Existing routes not retrofitted | High | All creation routes must be identified and wrapped; phased rollout |
| Platform admin bypass accidentally removed | Medium | Explicit bypass in check, not in route |

---

## 13. PASS / PARTIAL / FAIL

| Check | Status |
|-------|--------|
| Existing RBAC permission system | PASS |
| Existing scope engine | PASS |
| Existing school_id resolution | PASS |
| Existing `require_permissions` dependency pattern | PASS |
| Entitlement check middleware | FAIL — does not exist |
| Subscription check logic | FAIL — does not exist |
| Limit enforcement | FAIL — does not exist |
| Grace period logic | FAIL — does not exist |
| Entitlement-aware route dependencies | FAIL — all routes use `require_permissions` directly |
