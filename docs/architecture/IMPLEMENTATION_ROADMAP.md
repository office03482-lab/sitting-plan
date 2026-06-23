# Implementation Roadmap — Subscription & Entitlement Engine

## Phase Overview

| Phase | Focus | Duration | Risk |
|-------|-------|----------|------|
| 0 | Foundation & Data Models | 1 week | Low |
| 1 | Subscription Engine | 2 weeks | Medium |
| 2 | Entitlement Engine | 2 weeks | Medium |
| 3 | AI Credit System | 1 week | Medium |
| 4 | Retrofit Existing Routes | 2 weeks | High |
| 5 | UI & Self-Service | 2 weeks | Low |
| 6 | Launch & Monitoring | 1 week | Low |

**Total**: ~11 weeks

---

## Phase 0 — Foundation & Data Models (Week 1)

### Goals
- Define all new database tables
- Create migration scripts
- Establish enum values and seed data

### Tasks
```
[ ] Create plan_tiers enum: 'starter', 'basic', 'standard', 'premium', 'enterprise'
[ ] Create subscription_status enum: 'active', 'trial', 'expired', 'cancelled', 'paused'
[ ] Create entitlement_rule table (plan_tier → resource → max_count)
[ ] Create school_plans table
[ ] Create plan_feature_overrides table
[ ] Create ai_credit_wallets table
[ ] Create ai_credit_ledger table
[ ] Create ai_credit_products table & seed data
[ ] Create plan_change_requests table
[ ] Write migration files with rollback
```

### Validation
- [ ] Migration runs cleanly up and down
- [ ] Seed data loads correctly
- [ ] Indexes are in place

---

## Phase 1 — Subscription Engine (Weeks 2-3)

### Goals
- Implement the core subscription service
- School plan management (CRUD)
- External student plans
- Plan change request workflow

### Tasks
```
[ ] Implement SchoolSubscriptionService
    [ ] get_school_plan(school_id) → school_plan record
    [ ] activate_plan(school_id, plan_tier, billing_cycle)
    [ ] change_plan(school_id, new_tier, effective_date)
    [ ] cancel_plan(school_id, immediate/immediate+retain)
    [ ] pause_plan(school_id, pause_until)
    [ ] resume_plan(school_id)
    [ ] get_plan_limits(school_id, plan_tier) → dict of resource → max

[ ] Implement PlanChangeRequestService
    [ ] create_request(school_id, current_tier, requested_tier)
    [ ] approve_request(request_id)
    [ ] reject_request(request_id)
    [ ] schedule_change(effective_date)

[ ] Implement ExternalStudentPlanService
    [ ] purchase_plan(profile_id, plan_tier, payment_id)
    [ ] cancel_plan(profile_id)
    [ ] get_current_plan(profile_id)
    [ ] is_active(profile_id) → bool

[ ] Implement PlanCronService
    [ ] process_expired_plans() — daily
    [ ] send_renewal_reminders() — 7 days before expiry
    [ ] process_scheduled_changes() — nightly
```

### Validation
- [ ] Unit tests for all service methods
- [ ] Integration test: plan lifecycle (create → activate → cancel → reactivate)
- [ ] Integration test: plan change request workflow
- [ ] Integration test: external student plan purchase

---

## Phase 2 — Entitlement Engine (Weeks 4-5)

### Goals
- Implement the central entitlement decision layer
- Usage counter atomic operations
- Grace period logic
- Platform admin bypass
- FastAPI dependency integration
- Caching layer

### Tasks
```
[ ] Implement EntitlementEngine
    [ ] check_permission(user, permission_key) — delegates to RBAC
    [ ] check_scope(user, permission_key) — delegates to scope_engine
    [ ] check_subscription(school_id) → status enum
    [ ] check_entitlement(school_id, resource, delta) → result
    [ ] check_limits(school_id) → all limits with current usage
    [ ] combine_all(user, permission_key, school_id, resource, delta) → result

[ ] Implement UsageCounterService
    [ ] increment(school_id, resource, delta=1) → atomic
    [ ] decrement(school_id, resource, delta=1) → atomic
    [ ] get_usage(school_id, resource) → int
    [ ] get_all_usage(school_id) → dict of resource → count
    [ ] reset_usage(school_id, resource) — for monthly billing reset
    [ ] reset_all_usage(school_id) — end of billing period

[ ] Implement GracePeriodService
    [ ] get_status(school_id) → 'active' | 'grace' | 'expired'
    [ ] days_until_hard_block(school_id) → int
    [ ] days_until_data_retention_end(school_id) → int
    [ ] is_soft_blocked(school_id) → bool
    [ ] is_hard_blocked(school_id) → bool

[ ] Implement require_entitlement() FastAPI dependency
    [ ] Wrap permission + subscription + entitlement checks
    [ ] Structured error responses (code, message, status)
    [ ] OPTIONS passthrough for CORS
    [ ] Platform admin bypass

[ ] Implement caching layer
    [ ] Redis cache for school plans (5 min TTL)
    [ ] Redis cache for usage counters (30 sec TTL)
    [ ] Redis cache for subscription status (1 min TTL)
    [ ] Cache invalidation on relevant mutations

[ ] Implement health check endpoint
    [ ] GET /api/entitlement/health — reports engine status
```

### Validation
- [ ] Unit tests for all engine methods
- [ ] Integration test: entitlement decision matrix (16 combinations)
- [ ] Integration test: platform admin bypass
- [ ] Integration test: grace period → soft block → hard block
- [ ] Load test: 1000 concurrent entitlement checks

---

## Phase 3 — AI Credit System (Week 6)

### Goals
- Implement credit wallet & ledger
- Consume/grant/refund operations
- Monthly reset mechanism
- Purchase flow integration
- Rate limiting

### Tasks
```
[ ] Implement CreditEngine
    [ ] consume(profile_id, school_id, feature, credits)
    [ ] grant(profile_id, school_id, credits, reason)
    [ ] purchase(profile_id, school_id, product_id, order_id)
    [ ] refund(profile_id, school_id, transaction_id, reason)
    [ ] get_balance(profile_id, school_id) → int
    [ ] get_ledger(profile_id, school_id, limit, offset) → list
    [ ] get_all_wallets(profile_id) → list of wallet summaries

[ ] Implement wallet resolution priority logic
    [ ] Try personal → school pool → bonus wallets in order

[ ] Implement monthly reset cron
    [ ] School pool: reset to plan max_ai_credits on billing date
    [ ] External student: reset to plan allocation on 1st of month
    [ ] Purchased credits preserved across resets

[ ] Implement credit expiry cron
    [ ] Check wallets with expires_at < now
    [ ] Zero out balance, record expiry ledger entry
    [ ] Send notification email

[ ] Implement bonus credit triggers
    [ ] New account bonus
    [ ] Referral bonus
    [ ] Monthly active bonus
    [ ] Bug report bonus

[ ] Implement credit product purchase flow
    [ ] GET /api/credits/products → list of available packs
    [ ] POST /api/credits/purchase → create Razorpay order
    [ ] POST /api/credits/purchase/webhook → verify payment → grant credits

[ ] Implement rate limiting per profile per feature
    [ ] Configurable max requests per minute per feature
    [ ] 429 Too Many Requests response
```

### Validation
- [ ] Unit tests for all credit operations
- [ ] Integration test: consume → consume → consume → insufficient → purchase → consume
- [ ] Integration test: monthly reset preserves purchased credits
- [ ] Integration test: credit expiry at 90 days

---

## Phase 4 — Retrofit Existing Routes (Weeks 7-8)

### Goals
- Replace `require_permissions` with `require_entitlement` on all creation routes
- Add entitlement checks to existing business logic
- Add credit consumption to AI routes
- Verify no route is missed (comprehensive audit)

### Task Strategy

**Step 1: Route Audit (Day 1)**
Run an audit of every POST/PUT route in the codebase. Classify each:
- Creation route → entitlement check needed
- Read-only route → permission check only (no entitlement)
- Update route → permission check + optional entitlement (if the target is subscription-gated)
- Delete route → permission check only
- Non-navigational (reports, exports) → permission check only

**Step 2: Migrate Creation Routes (Days 2-7)**
Replace `require_permissions` with `require_entitlement` on every creation route identified in audit. Group by subsystem:

```
Week 7:
  [ ] Students module (students, guardians, documents)
  [ ] Teachers module (teachers, assignments)
  [ ] LMS module (courses, lessons, assignments)
  [ ] Online Tests module (tests, questions, results)
  [ ] Timetable module (periods, schedules)

Week 8:
  [ ] Attendance module (records)
  [ ] Finance module (invoices, payments)
  [ ] Inventory module (items)
  [ ] Communication module (announcements, notifications)
  [ ] Parents/vendor/agent modules
```

**Step 3: Add Credit Consumption (Days 8-10)**
```
  [ ] AI Chat endpoint — consume 1 credit per message
  [ ] Test Generation endpoint — consume 5 credits per set
  [ ] Study Plan endpoint — consume 3 credits per plan
  [ ] Student Analysis endpoint — consume 2 credits per analysis
  [ ] Report Card endpoint — consume 1 credit per report
  [ ] AI Doubt Solver endpoint — consume 1 credit per question
  [ ] Bulk Test Generation — consume 20 credits per batch
```

**Step 4: Regression Test (Day 11-12)**
```
  [ ] Run full test suite
  [ ] Manual smoke test of top 20 routes
  [ ] Verify error responses for blocked actions
```

### Validation
- [ ] Every creation route in codebase is accounted for
- [ ] All routes pass existing tests
- [ ] AI routes correctly consume credits
- [ ] Error responses are structured and informative

---

## Phase 5 — UI & Self-Service (Weeks 9-10)

### Goals
- Subscription management dashboard
- Plan selection & upgrade flow
- Payment integration
- Usage analytics
- Credit management UI

### Tasks

**Week 9 — Subscription UI**
```
[ ] Subscription status banner (active/trial/expired/grace)
[ ] Plan selection page (compare tiers, pricing)
[ ] Plan upgrade/downgrade flow with confirmation
[ ] Payment method management (Razorpay integration)
[ ] Invoice history page
[ ] Plan change request UI
[ ] External student plan purchase flow
[ ] Renewal flow for expiring plans
```

**Week 10 — Usage & Credit UI**
```
[ ] School usage dashboard (charts: limits vs usage)
[ ] Per-module usage breakdown (students created, storage used, etc.)
[ ] AI credit wallet UI (balance, history, purchase)
[ ] Credit pack selection & checkout
[ ] Monthly usage report (downloadable PDF)
[ ] Upgrade prompts when approaching limits
[ ] Admin: platform usage overview page
[ ] Admin: manual credit grant UI (bonus credits)
```

### Validation
- [ ] Plan upgrade/downgrade works end-to-end
- [ ] Payment flows complete successfully
- [ ] Usage dashboard shows accurate real-time data
- [ ] Mobile responsive

---

## Phase 6 — Launch & Monitoring (Week 11)

### Goals
- Deploy to staging
- Run manual QA
- Soft launch with 5 pilot schools
- Monitor & fix
- Full rollout
- Documentation

### Tasks
```
[ ] Deploy all migrations, services, and UI to staging
[ ] Manual QA: all 16 entitlement matrix combinations
[ ] Manual QA: credit consumption for all AI features
[ ] Manual QA: plan lifecycle (create, upgrade, downgrade, cancel, renew)
[ ] Manual QA: grace period and hard block
[ ] Manual QA: payment flows (Razorpay)
[ ] Manual QA: admin bypass
[ ] Soft launch: enable for 5 pilot schools
[ ] Monitor for 1 week: logging, error rates, support tickets
[ ] Fix issues found during soft launch
[ ] Full rollout to all schools
[ ] Write internal runbook for entitlement/subscription support
[ ] Create end-user docs / knowledge base articles
[ ] Create support scripts (manual refund, manual grant, manual reset)
[ ] Set up dashboards (Datadog/Grafana) for:
    - Entitlement check latency (p50, p95, p99)
    - Credit consumption rate
    - Plan change frequency
    - Blocked request rate (403s from entitlement)
    - Payment success rate
```

### Validation
- [ ] Staging tests pass
- [ ] Pilot schools report no issues after 1 week
- [ ] Monitoring dashboards operational
- [ ] Support team trained on new system

---

## Existing Readiness Assessment

| Component | Ready? | Notes |
|-----------|--------|-------|
| RBAC permission system | ✅ PASS | `require_permissions`, `user_has_permission` |
| Scope engine | ✅ PASS | `scope_engine.py`, `build_scope_context` |
| School ID resolution | ✅ PASS | `resolve_school_id_from_actor`, `get_school_id` |
| Actor context | ✅ PASS | `get_authenticated_actor_context` |
| FastAPI dependency pattern | ✅ PASS | Reusable dependency injection |
| Razorpay integration | ✅ PASS | Existing payment flow in finance module |
| User/profiles system | ✅ PASS | `profiles` table, auth |
| Cron job infrastructure | ✅ PASS | Existing cron jobs in app |
| Redis caching | ✅ PASS | Existing Redis integration |
| Supabase monetization | ✅ PASS | `supabase_monetization.py`, `finance.subscriptions` |
| Email notification system | ✅ PASS | Existing notification service |
| Entitlement engine | ❌ FAIL | Core new component |
| Subscription engine | ❌ FAIL | Core new component |
| Credit engine | ❌ FAIL | Core new component |
| Usage counters | ❌ FAIL | Does not exist |
| Plan limit definitions | ❌ FAIL | Does not exist |
| Grace period logic | ❌ FAIL | Does not exist |
| Entitlement-aware routes | ❌ FAIL | All routes use `require_permissions` |
| Credit wallet/ledger tables | ❌ FAIL | Do not exist |
| Subscription/school_plans tables | ❌ FAIL | Do not exist |

---

## Key Dependencies & Risk Mitigation

### Critical Path
```
Phase 0 → Phase 1 → Phase 2 → Phase 4 → Phase 5 → Phase 6
       ↘ Phase 3 ↗
```

Phase 3 (AI Credits) can run in parallel with Phase 1-2 since it only depends on Phase 0 tables.

### Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Phase 4 (route retrofit) takes longer than expected | High | Automated route audit script; group by module; parallel per engineer |
| Production regression from route retrofit | High | Feature flag each module's entitlement check; gradual rollout |
| Payment integration delays | Medium | Razorpay integration already exists; credit purchase reuses existing order flow |
| Load concerns on usage counter writes | Low | Atomic SQL UPDATE; Redis cache absorbs reads |
| Schools hit limits unexpectedly | Medium | Admin email alerts at 80%, 90%, 100% of each limit |
| Migration rollback needed | Low | All migrations have reversible definitions; data preserved |
