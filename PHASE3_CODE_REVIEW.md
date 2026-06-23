# Phase 3 Code Review — AI Credit System

## Scope

- `backend/app/services/ai_credit_engine.py` (778 lines) — Core credit engine
- `backend/app/routes/credits.py` (87 lines) — 4 API endpoints
- `backend/app/schemas/ai_credit_api.py` (37 lines) — 5 Pydantic models
- `backend/app/services/subscription_foundation_repositories.py` (248 lines) — Wallet & ledger repos
- `backend/tests/test_ai_credit_engine_phase3.py` (300 lines) — Unit tests

---

## CHECK 1 — Ledger Integrity

### Analysis

Every wallet balance mutation goes through `_update_wallet_balance()` (line 242), which always calls `_record_ledger()` (line 209). All callers traced:

| Caller | Line | Path to `_update_wallet_balance` | Records ledger? |
|--------|------|----------------------------------|----------------|
| `credit()` | 382 | Direct call (line 412) | ✅ |
| `debit()` | 442 | Per-wallet loop (line 476) | ✅ |
| `refund()` | 519 | Via `credit()` (line 547) | ✅ |
| `expire()` | 576 | Direct call (line 601) | ✅ |
| `grant_bonus()` | 627 | Via `credit()` (line 639) | ✅ |
| `transfer()` | 652 | Direct call for debit (line 677), `credit()` for credit (line 685) | ✅ |
| `adjust_balance()` | 713 | Via `credit()` (line 724) or `debit()` (line 733) | ✅ |

### Finding 1A (BUG) — Wallet updated before ledger recorded

**File**: `ai_credit_engine.py:277-290`

```python
updated_wallet = self.wallet_repository.update_wallet(...)   # DB write (line 277)
...
ledger = self._record_ledger(...)                              # DB write (line 280)
```

The wallet balance is written to the DB **before** the corresponding ledger entry. If the ledger creation fails (Supabase REST error, network timeout), the wallet balance has changed with **no audit trail**. This is undetectable — there is no way to know the balance change ever occurred.

On Supabase REST API, each `.execute()` call is a separate HTTP request — no cross-table transaction support. The ordering guarantees are application-level only, and the current order is wrong.

**Severity**: HIGH — Permanent balance corruption on partial failure. Silent data loss with no detection mechanism.

**Fix**: Record the ledger entry **before** updating the wallet balance. If the ledger write succeeds but the wallet update fails, an orphan ledger entry exists — but the wallet balance is still correct (old value), and the orphan can be detected and reconciled.

### Finding 1B (OK) — `balance_after` is correct

`_record_ledger` records both `amount` (delta) and `balance_after` (resulting balance). In `_update_wallet_balance`:

```python
current_balance = _safe_int(wallet.get("balance"))
next_balance = current_balance + delta
# ...
ledger = self._record_ledger(
    amount=delta,                # e.g., -5 for debit, +25 for credit
    balance_after=next_balance,  # e.g., current + delta (correct post-TX balance)
)
```

The `balance_after` correctly equals the wallet balance **after** the transaction. The previous code review flagged this as a bug, but in the current code it is correct.

### Finding 1C (OK) — Wallet creation with zero balance

`_wallet_priority()` fallback (line 198-206) creates a SCHOOL wallet with `balance=0` when no wallets exist. No ledger entry is created for zero-balance wallet creation — acceptable since it's a structural record, not a financial event.

---

## CHECK 2 — Balance Consistency

### Finding 2A (OK) — Single-request consistency

Within a single request, balance is computed consistently:
1. Read current balance from wallet dict (DB snapshot or freshly read)
2. Compute `next_balance = current_balance + delta`
3. Write `next_balance` to DB
4. Write ledger with `balance_after = next_balance`

The `get_balance()` call at the end of `credit()`/`debit()` re-reads from the DB, confirming the write was applied.

### Finding 2B (NOTE) — Cross-request consistency

Cross-request consistency depends on the ordering fix (Finding 1A). If the ledger is created first, an orphan ledger entry is preferable to a silent balance change with no trail.

---

## CHECK 3 — Concurrency Safety

### Finding 3A (CRITICAL BUG) — Lost update / double-spend

**File**: `ai_credit_engine.py:255-277`

```python
current_balance = _safe_int(wallet.get("balance"))         # READ (stale)
next_balance = current_balance + delta                      # COMPUTE
if next_balance < 0: raise HTTPException(...)               # CHECK
payload = AICreditWalletUpdate(balance=next_balance)        # PREPARE
self.wallet_repository.update_wallet(wallet_id, payload)    # WRITE (non-atomic)
```

The DB write is:
```sql
UPDATE ai_credit_wallets SET balance = 5 WHERE id = '...'
```

Not:
```sql
UPDATE ai_credit_wallets SET balance = balance - 5 WHERE id = '...' AND balance >= 5
```

**Race scenario**:
1. Request A: reads balance = 10, writes balance = 5 (debit 5)
2. Request B (concurrent): reads balance = 10 (stale!), writes balance = 2 (debit 8)
3. Wallet ends at 2. Request A's debit is lost. Total debited = 13 from original 10 = money created from nothing.

**Severity**: CRITICAL — Double-spend vulnerability. Direct financial loss.

**Fix required**: Atomic DB update via Supabase RPC function (`UPDATE SET balance = balance + delta`) or optimistic locking with a version column. This is an infrastructure-level change (new RPC or migration) and cannot be fixed purely in application code with the current Supabase REST API.

### Finding 3B (NOTE) — TOCTOU in `debit()`

**File**: `ai_credit_engine.py:459`

```python
self.ensure_sufficient_credits(profile_id, school_id, credits)  # DB read #1
wallets = self._wallet_priority(profile_id, school_id)           # DB read #2
```

The `ensure_sufficient_credits` call reads the balance, creating a TOCTOU window before the actual debit. This isn't an independent bug — it's a consequence of Finding 3A (no atomic operations). The early check also duplicates work (both read from DB) and creates a larger race window.

### Finding 3C (NOTE) — `transfer()` non-atomic

**File**: `ai_credit_engine.py:677-694`

`transfer()` performs debit then credit as two separate DB operations. If the credit fails after the debit succeeds, funds are permanently lost (in neither source nor destination wallet). No compensation rollback is attempted.

---

## CHECK 4 — Idempotency

### Finding 4A (NOTE) — No idempotency support

None of the mutation methods accept an idempotency key:

| Method | Idempotency key? | Retry behavior |
|--------|-----------------|----------------|
| `credit()` | ❌ | Double-credit on retry |
| `debit()` | ❌ | Double-debit on retry (until balance exhausted) |
| `refund()` | ❌ | Double-refund on retry (bounded by original amount) |
| `adjust_balance()` | ❌ | Double-adjustment on retry |
| `grant_bonus()` | ❌ | Double-grant on retry |
| `transfer()` | ❌ | Double-transfer on retry |

**Severity**: MEDIUM — Production risk. Safe only if callers guarantee at-most-once semantics.

---

## CHECK 5 — Tenant Isolation

### Finding 5A (OK) — Proper school_id scoping

All wallet and ledger queries filter by `school_id`:

| Operation | DB filter | Additional Python filter |
|-----------|-----------|--------------------------|
| `_wallets_for_context()` | `list_wallets(school_id=school_id)` | `wallet.get("school_id") == school_id` |
| `get_ledger()` | `list_entries(school_id=school_id, profile_id=profile_id)` | N/A |
| `_find_wallet()` | via `_wallets_for_context()` | wallet_type + profile_id matching |
| `_wallet_priority()` | via `_wallets_for_context()` | wallet_type + active status |

Route layer uses `resolve_school_id_from_actor` (from auth context — not user-supplied). Admin endpoints require `require_platform_admin`.

### Finding 5B (NOTE) — Redundant Python filter

`_wallets_for_context()` filters by school_id in Python after the DB already filtered. Harmless defense-in-depth.

---

## CHECK 6 — Permission Protection

### Finding 6A (OK) — All endpoints protected

| Route | Dependency | Protected? |
|-------|-----------|------------|
| `GET /api/credits/wallet` | `get_authenticated_user` + auth context | ✅ |
| `GET /api/credits/ledger` | `get_authenticated_user` + auth context | ✅ |
| `GET /api/credits/costs` | `get_authenticated_user` | ✅ |
| `POST /api/credits/admin/adjust` | `require_platform_admin` | ✅ |
| `POST /api/credits/admin/grant` | `require_platform_admin` | ✅ |

### Finding 6B (NOTE) — Duplicated `require_platform_admin`

Identical function defined in 3 files:
- `credits.py:22`
- `platform.py:34`
- `entitlement.py:14`

Code duplication — not a safety issue (all check `role_key == "platform_admin"`).

---

## CHECK 7 — Performance

### Finding 7A (OK) — No N+1 queries

Maximum query count per operation:
- `get_balance()`: 1 read
- `get_ledger()`: 1 read (paginated)
- `credit()`: 1-2 reads + 2 writes
- `debit()`: 2 reads + N writes (N ≤ 3)
- `expire()`: 1 read + M writes (M = expired wallets)

### Finding 7B (NOTE) — Redundant reads

- `credit()` line 439: calls `self.get_balance()` to return `total_balance`. Could compute from in-memory `result["wallet"]`.
- `debit()` line 516: same redundant `get_balance()` call.
- `debit()` line 459: `ensure_sufficient_credits()` reads balance, then `_wallet_priority()` reads wallets again.

Minor overhead — not a bottleneck.

---

## CHECK 8 — Production Risks

### Critical

| ID | Risk | Root Cause | Fix Available? |
|----|------|-----------|----------------|
| 3A | **Lost update / double-spend** | Non-atomic read-modify-write in `_update_wallet_balance` | ❌ Needs RPC or migration |

### High

| ID | Risk | Root Cause | Fix Available? |
|----|------|-----------|----------------|
| 1A | **Balance change with no audit trail** | Wallet updated before ledger created | ✅ **Yes — reorder operations** |
| 3C | **Transfer funds lost on partial failure** | Non-atomic `transfer()` debit-then-credit | ❌ Needs compensation logic |
| 3B | **TOCTOU race window in debit** | `ensure_sufficient_credits` before actual debit | ⚠️ Mitigated by 3A fix |

### Medium

| ID | Risk | Root Cause |
|----|------|-----------|
| 4A | **Double-apply on retry** | No idempotency keys |
| 7B | **Redundant DB reads** | `get_balance()` re-reads after mutation |

### Low

| ID | Risk | Note |
|----|------|------|
| 5B | Redundant Python filter | Defense-in-depth, harmless |
| 6B | Duplicated `require_platform_admin` | Maintenance burden |

---

## Bugs Fixed

### Bug 1A — Wallet update before ledger

**File**: `backend/app/services/ai_credit_engine.py:277-290`

**Change**: In `_update_wallet_balance()`, the ledger entry is now recorded **before** the wallet update. This ensures that if the wallet update fails, an audit trail still exists.

---

## Open Risks (documented, not fixed)

### Risk 3A — Lost update / double-spend

Requires atomic DB-level update. Two approaches:
1. **Supabase RPC function**: `UPDATE ai_credit_wallets SET balance = balance + delta WHERE id = p_wallet_id AND balance + delta >= 0`
2. **Optimistic locking**: Add `version` column, increment on each update, retry on version mismatch

Neither can be implemented without a migration or new RPC.

### Risk 3C — Non-atomic transfer

`transfer()` runs debit then credit as separate operations. A crash between the two loses funds. Fix: wrap in compensation logic (try credit, reverse debit on failure), or implement a two-phase commit pattern.

### Risk 4A — No idempotency

Adding idempotency requires a new DB table (`idempotency_keys`) and key-check logic in every mutation method. This is a feature addition, not a simple bug fix.
