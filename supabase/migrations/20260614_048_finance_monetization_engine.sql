begin;

create table if not exists finance.products (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  owner_scope text not null default 'platform',
  product_type text not null,
  category text not null,
  title text not null,
  description text,
  external_entity_id uuid,
  pricing_model text not null default 'one_time',
  access_tier text not null default 'free',
  currency text not null default 'INR',
  base_price numeric(12,2) not null default 0,
  sale_price numeric(12,2),
  billing_interval text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_products_owner_scope_check check (owner_scope in ('school', 'platform')),
  constraint finance_products_type_check check (product_type in ('course', 'test_series', 'subscription_plan', 'bundle')),
  constraint finance_products_category_check check (category in ('free_course', 'paid_course', 'premium_course', 'subscription_course', 'paid_test_series', 'mock_test_package', 'neet_test_series', 'jee_test_series')),
  constraint finance_products_pricing_model_check check (pricing_model in ('free', 'one_time', 'monthly', 'yearly')),
  constraint finance_products_access_tier_check check (access_tier in ('free', 'paid', 'premium', 'subscription'))
);

create table if not exists finance.orders (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  provider_key text not null,
  provider_order_id text,
  provider_payment_id text,
  provider_signature text,
  order_status text not null default 'pending',
  currency text not null default 'INR',
  subtotal_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  credits_redeemed numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  coupon_id uuid,
  referral_id uuid,
  affiliate_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_orders_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_orders_status_check check (order_status in ('pending', 'paid', 'failed', 'cancelled', 'expired'))
);

create table if not exists finance.order_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  order_id uuid not null references finance.orders (id) on delete cascade,
  product_id uuid not null references finance.products (id) on delete restrict,
  quantity integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  access_start_at timestamptz,
  access_end_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists finance.subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  product_id uuid not null references finance.products (id) on delete restrict,
  order_id uuid references finance.orders (id) on delete set null,
  provider_key text not null,
  plan_name text not null,
  subscription_status text not null default 'active',
  start_date date not null default current_date,
  expiry_date date,
  renewal_date date,
  auto_renew boolean not null default false,
  renewal_count integer not null default 0,
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_subscriptions_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_subscriptions_status_check check (subscription_status in ('active', 'trial', 'expired', 'cancelled', 'paused')),
  constraint finance_subscriptions_plan_check check (plan_name in ('Basic', 'Premium', 'Enterprise'))
);

create table if not exists finance.coupons (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  code text not null,
  coupon_type text not null,
  discount_value numeric(12,2) not null default 0,
  min_order_amount numeric(12,2) not null default 0,
  max_discount_amount numeric(12,2),
  usage_limit integer,
  used_count integer not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_coupons_type_check check (coupon_type in ('percentage', 'fixed'))
);

create unique index if not exists finance_coupons_code_unique
  on finance.coupons (coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));

create table if not exists finance.referrals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  referrer_profile_id uuid references public.profiles (id) on delete set null,
  referred_profile_id uuid references public.profiles (id) on delete set null,
  referral_code text not null,
  referral_status text not null default 'invited',
  credits_earned numeric(12,2) not null default 0,
  credits_redeemed numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_referrals_status_check check (referral_status in ('invited', 'registered', 'converted', 'redeemed'))
);

create table if not exists finance.affiliates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  affiliate_code text not null,
  commission_type text not null default 'percentage',
  commission_value numeric(12,2) not null default 0,
  clicks_count integer not null default 0,
  conversions_count integer not null default 0,
  sales_amount numeric(12,2) not null default 0,
  commissions_earned numeric(12,2) not null default 0,
  commission_balance numeric(12,2) not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_affiliates_type_check check (commission_type in ('percentage', 'fixed'))
);

create table if not exists finance.payouts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  affiliate_id uuid not null references finance.affiliates (id) on delete cascade,
  payout_status text not null default 'pending',
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  requested_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  provider_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_payouts_status_check check (payout_status in ('pending', 'processing', 'paid', 'rejected'))
);

alter table finance.orders
  add constraint finance_orders_coupon_fk foreign key (coupon_id) references finance.coupons (id) on delete set null;

alter table finance.orders
  add constraint finance_orders_referral_fk foreign key (referral_id) references finance.referrals (id) on delete set null;

alter table finance.orders
  add constraint finance_orders_affiliate_fk foreign key (affiliate_id) references finance.affiliates (id) on delete set null;

create index if not exists finance_products_school_type_idx on finance.products (school_id, product_type, is_active);
create index if not exists finance_orders_school_status_idx on finance.orders (school_id, order_status, created_at desc);
create index if not exists finance_subscriptions_school_status_idx on finance.subscriptions (school_id, subscription_status, expiry_date desc);
create index if not exists finance_referrals_school_status_idx on finance.referrals (school_id, referral_status, created_at desc);
create index if not exists finance_affiliates_school_code_idx on finance.affiliates (school_id, affiliate_code);
create index if not exists finance_payouts_school_status_idx on finance.payouts (school_id, payout_status, requested_at desc);

create trigger set_updated_at_finance_products before update on finance.products for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_orders before update on finance.orders for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_order_items before update on finance.order_items for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_subscriptions before update on finance.subscriptions for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_coupons before update on finance.coupons for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_referrals before update on finance.referrals for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_affiliates before update on finance.affiliates for each row execute function public.set_updated_at();
create trigger set_updated_at_finance_payouts before update on finance.payouts for each row execute function public.set_updated_at();

alter table finance.products enable row level security;
alter table finance.orders enable row level security;
alter table finance.order_items enable row level security;
alter table finance.subscriptions enable row level security;
alter table finance.coupons enable row level security;
alter table finance.referrals enable row level security;
alter table finance.affiliates enable row level security;
alter table finance.payouts enable row level security;

create policy finance_products_select_scope on finance.products
for select to authenticated
using (public.is_platform_admin() or school_id is null or public.same_school_membership(school_id));

create policy finance_products_manage_scope on finance.products
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.commerce'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.commerce'));

create policy finance_orders_select_scope on finance.orders
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.revenue')
  or profile_id = public.current_profile_id()
);

create policy finance_orders_manage_scope on finance.orders
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
  or public.has_permission(school_id, 'edupay.payments')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
  or public.has_permission(school_id, 'edupay.payments')
);

create policy finance_order_items_scope on finance.order_items
for all to authenticated
using (
  public.is_platform_admin()
  or school_id is null
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
  or public.has_permission(school_id, 'edupay.revenue')
)
with check (
  public.is_platform_admin()
  or school_id is null
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
);

create policy finance_subscriptions_select_scope on finance.subscriptions
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.subscriptions')
  or profile_id = public.current_profile_id()
);

create policy finance_subscriptions_manage_scope on finance.subscriptions
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.subscriptions')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.subscriptions')
);

create policy finance_coupons_scope on finance.coupons
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.commerce'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.commerce'));

create policy finance_referrals_select_scope on finance.referrals
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or referrer_profile_id = public.current_profile_id()
  or referred_profile_id = public.current_profile_id()
);

create policy finance_referrals_manage_scope on finance.referrals
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
  or referrer_profile_id = public.current_profile_id()
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.commerce')
  or referrer_profile_id = public.current_profile_id()
);

create policy finance_affiliates_scope on finance.affiliates
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.revenue'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.revenue'));

create policy finance_payouts_scope on finance.payouts
for all to authenticated
using (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.revenue'))
with check (public.is_platform_admin() or public.is_school_admin(school_id) or public.has_permission(school_id, 'edupay.revenue'));

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('edupay.commerce', 'edupay', 'commerce', 'Manage monetized products, orders, and coupons.', true),
  ('edupay.subscriptions', 'edupay', 'subscriptions', 'Manage subscriptions and recurring access.', true),
  ('edupay.revenue', 'edupay', 'revenue', 'View revenue, affiliate, and monetization dashboards.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'edupay.commerce',
  'edupay.subscriptions',
  'edupay.revenue'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'edupay.subscriptions'
)
where r.role_key in ('teacher', 'student', 'parent')
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
