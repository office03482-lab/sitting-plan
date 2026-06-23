begin;

do $$
begin
  if to_regtype('public.plan_tiers') is null then
    create type public.plan_tiers as enum ('starter', 'basic', 'standard', 'premium', 'enterprise');
  end if;
end $$;

do $$
begin
  if to_regtype('public.subscription_status') is null then
    create type public.subscription_status as enum ('active', 'trial', 'expired', 'cancelled', 'paused');
  end if;
end $$;

create table if not exists public.entitlement_rule (
  id uuid primary key default gen_random_uuid(),
  plan_tier public.plan_tiers not null,
  resource_key text not null,
  max_count numeric(18,2) not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint entitlement_rule_plan_resource_unique unique (plan_tier, resource_key),
  constraint entitlement_rule_max_count_check check (max_count >= -1)
);

create table if not exists public.school_plans (
  school_id uuid primary key references public.schools (id) on delete cascade,
  plan_tier public.plan_tiers not null default 'starter',
  subscription_status public.subscription_status not null default 'active',
  student_limit integer not null default 100,
  teacher_limit integer not null default 10,
  parent_limit integer not null default 50,
  storage_limit_gb numeric(12,2) not null default 5,
  ai_credit_limit integer not null default 500,
  test_limit integer not null default 20,
  lms_limit integer not null default 10,
  effective_from date not null default current_date,
  effective_until date,
  trial_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint school_plans_student_limit_check check (student_limit >= -1),
  constraint school_plans_teacher_limit_check check (teacher_limit >= -1),
  constraint school_plans_parent_limit_check check (parent_limit >= -1),
  constraint school_plans_storage_limit_check check (storage_limit_gb >= -1),
  constraint school_plans_ai_credit_limit_check check (ai_credit_limit >= -1),
  constraint school_plans_test_limit_check check (test_limit >= -1),
  constraint school_plans_lms_limit_check check (lms_limit >= -1)
);

create table if not exists public.plan_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  plan_tier public.plan_tiers not null,
  resource_key text not null,
  override_max_count numeric(18,2) not null,
  reason text,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint plan_feature_overrides_unique unique (school_id, resource_key),
  constraint plan_feature_overrides_max_count_check check (override_max_count >= -1)
);

create table if not exists public.usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  snapshot_date date not null,
  students_used integer not null default 0,
  teachers_used integer not null default 0,
  parents_used integer not null default 0,
  storage_used numeric(12,2) not null default 0,
  ai_credits_used integer not null default 0,
  tests_used integer not null default 0,
  lms_usage integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint usage_snapshots_school_date_unique unique (school_id, snapshot_date),
  constraint usage_snapshots_students_used_check check (students_used >= 0),
  constraint usage_snapshots_teachers_used_check check (teachers_used >= 0),
  constraint usage_snapshots_parents_used_check check (parents_used >= 0),
  constraint usage_snapshots_storage_used_check check (storage_used >= 0),
  constraint usage_snapshots_ai_credits_used_check check (ai_credits_used >= 0),
  constraint usage_snapshots_tests_used_check check (tests_used >= 0),
  constraint usage_snapshots_lms_usage_check check (lms_usage >= 0)
);

create table if not exists public.ai_credit_wallets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  wallet_type text not null default 'school',
  balance integer not null default 0,
  lifetime_used integer not null default 0,
  lifetime_granted integer not null default 0,
  expires_at timestamptz,
  is_frozen boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_credit_wallets_type_check check (wallet_type in ('school', 'personal', 'bonus')),
  constraint ai_credit_wallets_balance_check check (balance >= 0),
  constraint ai_credit_wallets_lifetime_used_check check (lifetime_used >= 0),
  constraint ai_credit_wallets_lifetime_granted_check check (lifetime_granted >= 0)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_credit_wallets_profile_school_type_unique'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.ai_credit_wallets
    add constraint ai_credit_wallets_profile_school_type_unique
    unique (profile_id, school_id, wallet_type);
  end if;
end $$;

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.ai_credit_wallets (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  transaction_type text not null,
  amount integer not null,
  balance_after integer not null,
  feature text,
  reference_type text,
  reference_id text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_credit_ledger_type_check check (transaction_type in ('consumption', 'grant', 'purchase', 'refund', 'bonus', 'expiry', 'reset', 'adjustment')),
  constraint ai_credit_ledger_balance_after_check check (balance_after >= 0)
);

create table if not exists public.ai_credit_products (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  name text not null,
  credits integer not null,
  price_inr numeric(12,2) not null,
  target_wallet_type text not null default 'school',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_credit_products_product_key_unique unique (product_key),
  constraint ai_credit_products_credits_check check (credits > 0),
  constraint ai_credit_products_price_check check (price_inr >= 0),
  constraint ai_credit_products_wallet_type_check check (target_wallet_type in ('school', 'personal', 'bonus'))
);

create table if not exists public.plan_change_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  current_plan_tier public.plan_tiers not null,
  requested_plan_tier public.plan_tiers not null,
  current_subscription_status public.subscription_status not null,
  request_status text not null default 'pending',
  effective_date date,
  reason text,
  review_notes text,
  metadata jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint plan_change_requests_status_check check (request_status in ('pending', 'approved', 'rejected', 'cancelled', 'scheduled'))
);

create index if not exists entitlement_rule_plan_tier_idx
  on public.entitlement_rule (plan_tier, is_active, resource_key);

create index if not exists school_plans_plan_tier_status_idx
  on public.school_plans (plan_tier, subscription_status, created_at desc);

create index if not exists plan_feature_overrides_school_active_idx
  on public.plan_feature_overrides (school_id, is_active, resource_key);

create index if not exists usage_snapshots_school_date_idx
  on public.usage_snapshots (school_id, snapshot_date desc);

create index if not exists usage_snapshots_snapshot_date_idx
  on public.usage_snapshots (snapshot_date desc);

create index if not exists ai_credit_wallets_profile_idx
  on public.ai_credit_wallets (profile_id, wallet_type, created_at desc);

create index if not exists ai_credit_wallets_school_idx
  on public.ai_credit_wallets (school_id, wallet_type, created_at desc);

create index if not exists ai_credit_ledger_wallet_created_idx
  on public.ai_credit_ledger (wallet_id, created_at desc);

create index if not exists ai_credit_ledger_profile_created_idx
  on public.ai_credit_ledger (profile_id, created_at desc);

create index if not exists ai_credit_ledger_school_created_idx
  on public.ai_credit_ledger (school_id, created_at desc);

create index if not exists ai_credit_products_active_idx
  on public.ai_credit_products (is_active, credits, created_at desc);

create index if not exists plan_change_requests_school_status_idx
  on public.plan_change_requests (school_id, request_status, created_at desc);

drop trigger if exists set_updated_at_entitlement_rule on public.entitlement_rule;
create trigger set_updated_at_entitlement_rule
before update on public.entitlement_rule
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_school_plans on public.school_plans;
create trigger set_updated_at_school_plans
before update on public.school_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_plan_feature_overrides on public.plan_feature_overrides;
create trigger set_updated_at_plan_feature_overrides
before update on public.plan_feature_overrides
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_usage_snapshots on public.usage_snapshots;
create trigger set_updated_at_usage_snapshots
before update on public.usage_snapshots
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ai_credit_wallets on public.ai_credit_wallets;
create trigger set_updated_at_ai_credit_wallets
before update on public.ai_credit_wallets
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ai_credit_products on public.ai_credit_products;
create trigger set_updated_at_ai_credit_products
before update on public.ai_credit_products
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_plan_change_requests on public.plan_change_requests;
create trigger set_updated_at_plan_change_requests
before update on public.plan_change_requests
for each row execute function public.set_updated_at();

insert into public.entitlement_rule (plan_tier, resource_key, max_count, is_active)
values
  ('starter', 'students_used', 100, true),
  ('starter', 'teachers_used', 10, true),
  ('starter', 'parents_used', 50, true),
  ('starter', 'storage_used', 5, true),
  ('starter', 'ai_credits_used', 500, true),
  ('starter', 'tests_used', 20, true),
  ('starter', 'lms_usage', 10, true),
  ('basic', 'students_used', 250, true),
  ('basic', 'teachers_used', 25, true),
  ('basic', 'parents_used', 100, true),
  ('basic', 'storage_used', 10, true),
  ('basic', 'ai_credits_used', 2000, true),
  ('basic', 'tests_used', 50, true),
  ('basic', 'lms_usage', 25, true),
  ('standard', 'students_used', 500, true),
  ('standard', 'teachers_used', 50, true),
  ('standard', 'parents_used', 200, true),
  ('standard', 'storage_used', 25, true),
  ('standard', 'ai_credits_used', 5000, true),
  ('standard', 'tests_used', 100, true),
  ('standard', 'lms_usage', 50, true),
  ('premium', 'students_used', 2000, true),
  ('premium', 'teachers_used', 200, true),
  ('premium', 'parents_used', 1000, true),
  ('premium', 'storage_used', 100, true),
  ('premium', 'ai_credits_used', 25000, true),
  ('premium', 'tests_used', 500, true),
  ('premium', 'lms_usage', 200, true),
  ('enterprise', 'students_used', -1, true),
  ('enterprise', 'teachers_used', -1, true),
  ('enterprise', 'parents_used', -1, true),
  ('enterprise', 'storage_used', -1, true),
  ('enterprise', 'ai_credits_used', 100000, true),
  ('enterprise', 'tests_used', -1, true),
  ('enterprise', 'lms_usage', -1, true)
on conflict (plan_tier, resource_key) do update
set
  max_count = excluded.max_count,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

insert into public.school_plans (
  school_id,
  plan_tier,
  subscription_status,
  student_limit,
  teacher_limit,
  parent_limit,
  storage_limit_gb,
  ai_credit_limit,
  test_limit,
  lms_limit
)
select
  s.id,
  'starter'::public.plan_tiers,
  'active'::public.subscription_status,
  100,
  10,
  50,
  5,
  500,
  20,
  10
from public.schools s
on conflict (school_id) do nothing;

insert into public.ai_credit_products (product_key, name, credits, price_inr, target_wallet_type, is_active)
values
  ('starter-pack', 'Starter Pack', 100, 49, 'personal', true),
  ('pro-pack', 'Pro Pack', 500, 199, 'personal', true),
  ('elite-pack', 'Elite Pack', 2000, 699, 'personal', true),
  ('school-pool-top-up-1k', 'School Pool Top-Up 1K', 1000, 299, 'school', true),
  ('school-pool-top-up-5k', 'School Pool Top-Up 5K', 5000, 1299, 'school', true),
  ('school-pool-top-up-25k', 'School Pool Top-Up 25K', 25000, 4999, 'school', true)
on conflict (product_key) do update
set
  name = excluded.name,
  credits = excluded.credits,
  price_inr = excluded.price_inr,
  target_wallet_type = excluded.target_wallet_type,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

commit;
