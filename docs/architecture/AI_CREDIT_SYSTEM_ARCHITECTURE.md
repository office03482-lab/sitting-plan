# AI Credit System Architecture

## 1. Overview

The AI Credit System is a usage-based consumption layer that meters AI operations across the platform. Every AI feature consumes a defined number of credits from the user's wallet. Credits are granted by plan allocation, purchased in bundles, or awarded as bonuses.

---

## 2. Credit Consumption Table

| Feature | Credits | Scope |
|---------|---------|-------|
| Chat with AI Tutor | 1 per message | Per student/teacher |
| Generate test questions | 5 per set | Per teacher |
| Generate study plan | 3 per plan | Per student |
| Analyze student performance | 2 per analysis | Per teacher |
| Generate report card | 1 per report | Per teacher |
| AI doubt solver | 1 per question | Per student |
| Parent AI insights | 2 per report | Per parent |
| AI agent execution | 5 per run | Per agent |
| Bulk test generation | 20 per batch | Per teacher |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI Credit System                          │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Credit Wallet│    │  Credit      │    │  Ledger      │       │
│  │  (current     │    │  Transaction │    │  (history)   │       │
│  │   balance)    │    │  (atomic)    │    │              │       │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│         │                   │                   │                │
│         └───────────────────┼───────────────────┘                │
│                             │                                    │
│                    ┌────────▼────────┐                           │
│                    │ Credit Engine   │                           │
│                    │ ── consume()    │                           │
│                    │ ── grant()      │                           │
│                    │ ── purchase()   │                           │
│                    │ ── refund()     │                           │
│                    │ ── expire()     │                           │
│                    └────────┬────────┘                           │
│                             │                                    │
│                    ┌────────▼────────┐                           │
│                    │ Entitlement     │                           │
│                    │ Engine          │                           │
│                    │ (limit check)   │                           │
│                    └─────────────────┘                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Required Tables

### 4.1 `public.ai_credit_wallets` (NEW)

```sql
create table public.ai_credit_wallets (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id),
  school_id       uuid not null references public.schools(id),
  wallet_type     text not null default 'school',
  -- wallet_type: 'school' (pool for school plan), 'personal' (external student), 'bonus' (granted)
  balance         int not null default 0,
  lifetime_used   int not null default 0,
  lifetime_granted int not null default 0,
  expires_at      timestamptz,
  is_frozen       boolean not null default false,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now())
);

create index idx_ai_credit_wallets_profile on public.ai_credit_wallets(profile_id);
create index idx_ai_credit_wallets_school on public.ai_credit_wallets(school_id);
```

### 4.2 `public.ai_credit_ledger` (NEW)

```sql
create table public.ai_credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  wallet_id       uuid not null references public.ai_credit_wallets(id),
  profile_id      uuid not null references public.profiles(id),
  school_id       uuid not null references public.schools(id),
  transaction_type text not null,
  -- transaction_type: 'consumption', 'grant', 'purchase', 'refund',
  --                   'bonus', 'expiry', 'reset', 'adjustment'
  amount          int not null,
  balance_after   int not null,
  feature         text,          -- 'ai_chat', 'test_generation', 'study_plan', ...
  reference_type  text,          -- 'subscription', 'order', 'promo', 'admin'
  reference_id    text,
  description     text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default timezone('utc', now())
);

create index idx_ai_credit_ledger_wallet on public.ai_credit_ledger(wallet_id);
create index idx_ai_credit_ledger_profile on public.ai_credit_ledger(profile_id);
create index idx_ai_credit_ledger_school on public.ai_credit_ledger(school_id);
create index idx_ai_credit_ledger_created on public.ai_credit_ledger(created_at desc);
```

### 4.3 `public.ai_credit_products` (NEW)

```sql
create table public.ai_credit_products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  credits         int not null,
  price_inr       numeric(10,2) not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default timezone('utc', now())
);

-- Seed data
insert into public.ai_credit_products (name, credits, price_inr) values
  ('Starter Pack', 100, 49),
  ('Pro Pack', 500, 199),
  ('Elite Pack', 2000, 699),
  ('School Pool Top-Up 1K', 1000, 299),
  ('School Pool Top-Up 5K', 5000, 1299),
  ('School Pool Top-Up 25K', 25000, 4999);
```

---

## 5. Credit Engine Service

### 5.1 Core Methods

```python
class CreditEngine:
    @staticmethod
    async def consume(
        profile_id: str,
        school_id: str,
        feature: str,
        credits: int,
        reference: dict | None = None,
    ) -> CreditTransaction:
        """
        1. Check wallet balance
        2. If insufficient → raise INSUFFICIENT_CREDITS
        3. Atomic UPDATE wallet SET balance = balance - credits WHERE balance >= credits
        4. Insert ledger record
        5. Log audit event
        6. Return transaction
        """
    
    @staticmethod
    async def grant(
        profile_id: str,
        school_id: str,
        credits: int,
        reason: str,
        reference: dict | None = None,
    ) -> CreditTransaction:
        """
        1. Atomic UPDATE wallet SET balance = balance + credits
        2. Insert ledger record with type='grant' or 'bonus'
        3. Return transaction
        """
    
    @staticmethod
    async def purchase(
        profile_id: str,
        school_id: str,
        product_id: str,
        order_id: str,
    ) -> CreditTransaction:
        """
        1. Lookup product for credit amount
        2. Grant credits from purchase
        3. Link to order reference
        4. Return transaction
        """
    
    @staticmethod
    async def refund(
        profile_id: str,
        school_id: str,
        original_transaction_id: str,
        reason: str,
    ) -> CreditTransaction:
        """
        1. Lookup original consumption
        2. Grant back credits
        3. Link refund to original transaction
        4. Return transaction
        """
    
    @staticmethod
    async def get_balance(
        profile_id: str,
        school_id: str,
    ) -> int:
        """Return current wallet balance."""
    
    @staticmethod
    async def get_ledger(
        profile_id: str,
        school_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CreditTransaction]:
        """Return paginated transaction history."""
    
    @staticmethod
    async def expire_old_credits():
        """
        Cron job: Find wallets with expires_at < now
        Set balance to 0, record expiry ledger entry
        Notify affected users
        """
```

### 5.2 Wallet Resolution Priority

When a user performs an AI action, credits are consumed from wallets in this order:

1. **Personal wallet** (profile_id matches, wallet_type = 'personal')
   → External students' own purchased/bonus credits
2. **School pool wallet** (school_id matches, wallet_type = 'school')
   → School plan's monthly AI credit pool
3. **Bonus wallet** (profile_id matches, wallet_type = 'bonus')
   → Promotional or support-granted credits

Each wallet is tried in sequence until sufficient credits are found. If no wallet has enough, the action is denied.

---

## 6. Monthly Reset

### School Plan Credits

At the start of each billing period:
1. School pool wallet balance resets to the plan's `max_ai_credits`
2. Previous balance is recorded in ledger as `reset` transaction
3. Unused credits do NOT roll over (use-it-or-lose-it)

### External Student Credits

At the start of each calendar month:
1. External student personal wallet resets to plan allocation
2. Free tier: 10 credits
3. Pro tier: 100 credits
4. Elite tier: 500 credits
5. Purchased credits (from credit products) DO roll over and are consumed first

---

## 7. Bonus Credit Rules

| Bonus Type | Credits | Trigger |
|------------|---------|---------|
| New account | 20 | On first login |
| Referral | 50 | Referred user purchases a plan |
| Monthly active | 10 | Used AI feature 5+ times in a month |
| Bug report | 25 | Verified bug report submitted |
| Review | 15 | Platform review submitted |
| Admin adjustment | variable | Manual grant by platform admin |

Bonuses are tracked in the ledger with `transaction_type = 'bonus'` and have a 90-day expiry.

---

## 8. API Endpoints

### 8.1 Student/Teacher APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/credits/wallet` | Current balance |
| GET | `/api/credits/ledger` | Transaction history |
| GET | `/api/credits/products` | Available credit packs |
| POST | `/api/credits/purchase` | Buy credit pack → Razorpay order |

### 8.2 School Admin APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/school/credits/usage` | School AI credit usage breakdown |
| GET | `/api/school/credits/ledger` | School pool transaction history |
| POST | `/api/school/credits/top-up` | Purchase school pool top-up |

### 8.3 Platform Admin APIs

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/platform/credits/grant` | Grant bonus credits to any profile |
| GET | `/api/platform/credits/audit` | Full ledger with search |
| GET | `/api/platform/credits/summary` | Total credits consumed across platform |

---

## 9. Required UI Screens

| Screen | Route | Description |
|--------|-------|-------------|
| AI Credits Dashboard | `/settings/credits` | Current balance, usage history, purchase options |
| Credit Usage Breakdown | `/settings/credits/usage` | Chart: credits per feature per day/week/month |
| Purchase Credits | `/settings/credits/buy` | Credit pack selection → checkout |
| School Credit Pool | `/admin/settings/credits` | School-level pool management |
| Platform Credit Audit | `/admin/platform/credits` | Full platform credit usage |

---

## 10. Integration Points

### 10.1 AI Chat

```python
# In ai_tutor service
async def chat_message(profile_id, school_id, message):
    # Check + consume credit
    await CreditEngine.consume(profile_id, school_id, 'ai_chat', 1)
    # Generate response
    ...
```

### 10.2 Test Generation

```python
async def generate_test(profile_id, school_id, params):
    await CreditEngine.consume(profile_id, school_id, 'test_generation', 5)
    ...
```

### 10.3 Study Plan

```python
async def generate_study_plan(profile_id, school_id, student_id):
    await CreditEngine.consume(profile_id, school_id, 'study_plan', 3)
    ...
```

---

## 11. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Race condition on balance check | Medium | Use atomic `UPDATE ... SET balance = balance - N WHERE balance >= N` |
| Credit exhaustion blocks critical features | Medium | Configurable overdraft per school plan (Enterprise = unlimited) |
| Users game the system (abuse) | Medium | Rate limiting per profile per feature; audit trail for review |
| Wallet not found for new user | Low | Auto-create wallet on first credit-related action |
| Ledger grows unbounded | Low | Archive ledger records older than 1 year to cold storage |
| Purchased credits expire before use | Medium | Clear expiry policy shown at purchase; email reminder before expiry |

---

## 12. PASS / PARTIAL / FAIL

| Check | Status |
|-------|--------|
| Existing user/profile system | PASS |
| Existing order/payment system | PASS |
| Credit wallet table | FAIL — does not exist |
| Credit ledger table | FAIL — does not exist |
| Credit products table | FAIL — does not exist |
| Credit engine service | FAIL — does not exist |
| Credit consumption in AI flows | FAIL — not implemented |
| Credit purchase flow | FAIL — not implemented |
| Monthly reset mechanism | FAIL — not implemented |
| Bonus/expiry system | FAIL — not implemented |
