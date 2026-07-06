# VERIFIED QUERY RISK REPORT

> Generated: 2026-07-06
> Scope: All `backend/app/` Python files containing Supabase `.select()` queries.
> Classification rules applied: filter presence, limit/range/single, tenant scope, table cardinality.

---

## TOP 20 RISKIEST QUERIES

### VERY RISKY --- Cross-tenant, NO filter, NO limit, high-cardinality table

| # | File | Function | Table | Select | Filters | Limit | Est. Cardinality | Risk |
|---|------|----------|-------|--------|---------|-------|-----------------|------|
| 1 | `services/subscription_engine.py:1042` | `send_renewal_reminders` | `finance.subscriptions` | `*` | **None** | **None** | All tenants (potentially 1000s) | **VERY RISKY** |
| 2 | `services/platform_control_plane.py:471` | `list_schools` | `schools` | `*` | **None** | **None** | All schools | **VERY RISKY** |
| 3 | `services/platform_control_plane.py:762` | `get_usage_dashboard` | `schools` | `*` | **None** (when school_id absent) | **None** | All schools | **VERY RISKY** |
| 4 | `services/platform_control_plane.py:775` | `get_health_dashboard` | `schools` | `*` | **None** (when school_id absent) | **None** | All schools | **VERY RISKY** |
| 5 | `services/platform_control_plane.py:934` | `list_notifications` | `platform_notifications` | `*` | **None** | **None** | All notifications (unbounded) | **VERY RISKY** |
| 6 | `routes/platform.py:137` | `get_platform_dashboard_summary` | `workflow.bulk_action_requests` | `*` | **None** | **None** | All workflow requests | **VERY RISKY** |

### RISKY --- NO filter, NO limit, lower-to-moderate cardinality

| # | File | Function | Table | Select | Filters | Limit | Est. Cardinality | Risk |
|---|------|----------|-------|--------|---------|-------|-----------------|------|
| 7 | `services/subscription_foundation_repositories.py:69` | `SchoolPlanRepository.list_plans` | `school_plans` | `*` | **None** | **None** | All plans (moderate) | **RISKY** |
| 8 | `services/subscription_foundation_repositories.py:165` | `AICreditWalletRepository.list_wallets` | `ai_credit_wallets` | `*` | **None** by default (optional params) | **None** | All wallets (moderate) | **RISKY** |
| 9 | `services/subscription_foundation_repositories.py:412` | `PlanChangeRequestRepository.list_requests` | `plan_change_requests` | `*` | **None** by default | **None** | All requests (moderate) | **RISKY** |
| 10 | `services/subscription_foundation_repositories.py:331` | `AICreditLedgerRepository.list_entries` | `ai_credit_ledger` | `*` | **None** by default (optional wallet_id/school_id) | **None** (has .range but no early filter) | All ledger entries (high) | **RISKY** |
| 11 | `services/subscription_foundation_repositories.py:47` | `EntitlementRuleRepository.list_rules` | `entitlement_rule` | `*` | **None** by default | **None** | All rules (low) | **RISKY** |
| 12 | `services/subscription_foundation_repositories.py:390` | `AICreditProductRepository.list_products` | `ai_credit_products` | `*` | **None** by default | **None** | All products (low) | **RISKY** |
| 13 | `services/supabase_bi.py:898` | `list_saved_reports` | `warehouse.report_definitions` | `*` | **None** when school_id absent | **None** | All report defs (moderate) | **RISKY** |
| 14 | `platform_control_plane.py:806` | `global_search` | `schools` | `id,name` | **None** | **None** | All schools | **RISKY** |
| 15 | `routes/platform.py:154` | `get_platform_dashboard_summary` | `schools` | `id,name` | **None** | **None** | All schools | **RISKY** |

### UNVERIFIED --- Has tenant filter (school_id) but NO limit; depends on per-school data size

| # | File | Function | Table | Select | Filters | Limit | Est. Cardinality | Risk |
|---|------|----------|-------|--------|---------|-------|-----------------|------|
| 16 | `services/supabase_edupay.py:173` | `_fetch_fee_structures` | `finance.fee_structures` | `*` | `school_id` | **None** | Per-school (low-moderate) | **UNVERIFIED** |
| 17 | `services/supabase_edupay.py:191` | `_fetch_assignments` | `finance.fee_assignments` | `*` | `school_id` (+ optional student_id) | **None** | Per-school (moderate-high) | **UNVERIFIED** |
| 18 | `services/supabase_edupay.py:209` | `_fetch_payments` | `finance.payments` | `*` | `school_id` | **None** | Per-school (moderate-high) | **UNVERIFIED** |
| 19 | `services/parent_portal_service.py:222` | `_batch_load_assignments` | `lms_assignments` | `*` | `school_id`, `status in [...]` | **None** | Per-school (moderate) | **UNVERIFIED** |
| 20 | `services/parent_portal_service.py:253` | `_load_shared_tests` | `online_tests.tests` | `*` | `school_id`, `status in [...]` | **None** | Per-school (moderate) | **UNVERIFIED** |

---

## DETAILED VERIFICATION

### VERY RISKY Queries

#### 1. `services/subscription_engine.py` - `send_renewal_reminders()`

```python
rows = _finance_table("subscriptions").select("*").execute().data or []
```

- **No filter, no limit** - fetches ALL subscriptions across ALL schools.
- Filters happen in-memory (Python loop checking status, renewal_date).
- At scale (1000s of schools x multiple subscriptions), this will blow up.

#### 2. `services/platform_control_plane.py` - `list_schools()`

```python
rows = [dict(row) for row in list(_public_table("schools").select("*").order("created_at", desc=False).execute().data or [])]
```

- **No filter, no limit.**
- Returns ALL schools unconditionally. Filters (status, search) applied in-memory.

#### 3. `services/platform_control_plane.py` - `get_usage_dashboard()`

```python
schools = [_load_school_row(school_id)] if school_id else [dict(row) for row in list(_public_table("schools").select("*").order("name").execute().data or [])]
```

- When `school_id` is None (platform-wide view), fetches ALL schools.

#### 4. `services/platform_control_plane.py` - `get_health_dashboard()`

```python
schools = [_load_school_row(school_id)] if school_id else [dict(row) for row in list(_public_table("schools").select("*").order("name").execute().data or [])]
```

- Identical pattern to #3.

#### 5. `services/platform_control_plane.py` - `list_notifications()`

```python
rows = [dict(row) for row in list(_public_table("platform_notifications").select("*").order("created_at", desc=True).execute().data or [])]
```

- **No filter, no limit.** Fetches ALL platform notifications.

#### 6. `routes/platform.py` - `get_platform_dashboard_summary()`

```python
request_rows = list(supabase.schema("workflow").table("bulk_action_requests").select("*").order("created_at", desc=True).execute().data or [])
```

- **No filter, no limit.** Fetches ALL bulk action requests.

### RISKY Queries

#### 7-12. `services/subscription_foundation_repositories.py`

Multiple repository methods (`list_plans`, `list_wallets`, `list_requests`, `list_entries`, `list_rules`, `list_products`) chain `.select("*")` with at most optional filters and no mandatory limit. These are platform-level administrative views; while they are lower cardinality than student/attendance tables, they still lack any protective limit.

#### 13. `services/supabase_bi.py` - `list_saved_reports()`

```python
query = _warehouse_table("report_definitions").select("*").order("created_at", desc=True)
```

- When `school_id` is None and `include_platform` is True, there is no filter at all.

#### 14. `platform_control_plane.py` - `global_search()`

```python
schools_map = {str(row.get("id")): str(row.get("name") or "") for row in list(_public_table("schools").select("id,name").execute().data or [])}
```

- No filter, no limit. While it selects only 2 columns, it iterates ALL schools.

### UNVERIFIED Queries

#### 16-18. `services/supabase_edupay.py`

`_fetch_fee_structures`, `_fetch_assignments`, `_fetch_payments` all have `.eq("school_id", school_id)` but no `.limit()`. The tenant filter limits scope to one school, but within a large school these tables may hold thousands of rows.

#### 19-20. `services/parent_portal_service.py`

`_batch_load_assignments` and `_load_shared_tests` have school_id + status filters but no limit. They are scoped to a single school but could still return large result sets.

---

## SUMMARY STATISTICS

| Risk Level | Count | Key Tables Affected |
|------------|-------|---------------------|
| VERY RISKY | 6 | `subscriptions`, `schools`, `platform_notifications`, `bulk_action_requests` |
| RISKY | 9 | `school_plans`, `ai_credit_wallets`, `plan_change_requests`, `ai_credit_ledger`, `entitlement_rule`, `ai_credit_products`, `report_definitions`, `schools` |
| UNVERIFIED | 5 | `fee_structures`, `fee_assignments`, `payments`, `lms_assignments`, `online_tests.tests` |

---

## RECOMMENDATIONS

1. **Add `.limit()` to all cross-tenant queries** - especially `send_renewal_reminders()` and the `list_schools()` / `list_notifications()` patterns.
2. **Use `.range()` with pagination** for all admin dashboard endpoints (`get_platform_dashboard_summary`, `list_notifications`).
3. **Add `.limit()` to school-scoped queries** in `supabase_edupay.py` and `parent_portal_service.py` that may return large per-school datasets.
4. **Apply `.limit(1)` with `.single()`** where only one result is expected (or use `.maybe_single()`).
5. **Consider server-side pagination** for `list_schools()` and other platform admin list endpoints - currently filtering in-memory.
