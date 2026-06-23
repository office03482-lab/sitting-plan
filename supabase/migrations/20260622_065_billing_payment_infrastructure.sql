begin;

create table if not exists finance.invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  order_id uuid references finance.orders (id) on delete set null,
  subscription_id uuid references finance.subscriptions (id) on delete set null,
  provider_key text not null,
  provider_payment_id text,
  invoice_number text not null,
  invoice_status text not null default 'issued',
  currency text not null default 'INR',
  subtotal_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  gst_number text,
  tax_breakdown jsonb not null default '{}'::jsonb,
  billing_name text,
  billing_email text,
  billing_phone text,
  billing_address jsonb not null default '{}'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_invoices_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_invoices_status_check check (invoice_status in ('draft', 'issued', 'paid', 'refunded', 'cancelled')),
  constraint finance_invoices_number_unique unique (invoice_number)
);

create table if not exists finance.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  order_id uuid references finance.orders (id) on delete set null,
  invoice_id uuid references finance.invoices (id) on delete set null,
  provider_key text not null,
  provider_payment_id text,
  provider_refund_id text,
  refund_status text not null default 'pending',
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_payment_refunds_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_payment_refunds_status_check check (refund_status in ('pending', 'processed', 'failed', 'cancelled'))
);

create table if not exists finance.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  event_key text not null,
  provider_event_id text not null,
  event_status text not null default 'received',
  signature_hash text,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_payment_webhook_events_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_payment_webhook_events_status_check check (event_status in ('received', 'processed', 'ignored', 'failed')),
  constraint finance_payment_webhook_events_provider_event_unique unique (provider_key, provider_event_id)
);

create table if not exists finance.payment_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  operation_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  resource_type text,
  resource_id text,
  status text not null default 'completed',
  response_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_payment_idempotency_provider_check check (provider_key in ('razorpay', 'stripe', 'cashfree')),
  constraint finance_payment_idempotency_status_check check (status in ('pending', 'completed', 'failed')),
  constraint finance_payment_idempotency_unique unique (provider_key, operation_key, idempotency_key)
);

create index if not exists finance_invoices_school_status_idx
  on finance.invoices (school_id, invoice_status, created_at desc);

create index if not exists finance_invoices_order_idx
  on finance.invoices (order_id, issued_at desc);

create index if not exists finance_invoices_provider_payment_idx
  on finance.invoices (provider_key, provider_payment_id);

create index if not exists finance_payment_refunds_school_status_idx
  on finance.payment_refunds (school_id, refund_status, created_at desc);

create index if not exists finance_payment_refunds_order_idx
  on finance.payment_refunds (order_id, created_at desc);

create index if not exists finance_payment_webhook_events_provider_status_idx
  on finance.payment_webhook_events (provider_key, event_status, created_at desc);

create index if not exists finance_payment_idempotency_lookup_idx
  on finance.payment_idempotency_keys (provider_key, operation_key, idempotency_key);

create index if not exists finance_orders_provider_order_idx
  on finance.orders (provider_key, provider_order_id);

create index if not exists finance_orders_provider_payment_idx
  on finance.orders (provider_key, provider_payment_id);

drop trigger if exists set_updated_at_finance_invoices on finance.invoices;
create trigger set_updated_at_finance_invoices
before update on finance.invoices
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_finance_payment_refunds on finance.payment_refunds;
create trigger set_updated_at_finance_payment_refunds
before update on finance.payment_refunds
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_finance_payment_webhook_events on finance.payment_webhook_events;
create trigger set_updated_at_finance_payment_webhook_events
before update on finance.payment_webhook_events
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_finance_payment_idempotency_keys on finance.payment_idempotency_keys;
create trigger set_updated_at_finance_payment_idempotency_keys
before update on finance.payment_idempotency_keys
for each row execute function public.set_updated_at();

alter table finance.invoices enable row level security;
alter table finance.payment_refunds enable row level security;
alter table finance.payment_webhook_events enable row level security;
alter table finance.payment_idempotency_keys enable row level security;

drop policy if exists finance_invoices_select_scope on finance.invoices;
create policy finance_invoices_select_scope on finance.invoices
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.revenue')
  or profile_id = public.current_profile_id()
);

drop policy if exists finance_invoices_manage_scope on finance.invoices;
create policy finance_invoices_manage_scope on finance.invoices
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
  or public.has_permission(school_id, 'edupay.commerce')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
  or public.has_permission(school_id, 'edupay.commerce')
);

drop policy if exists finance_payment_refunds_select_scope on finance.payment_refunds;
create policy finance_payment_refunds_select_scope on finance.payment_refunds
for select to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.revenue')
  or profile_id = public.current_profile_id()
);

drop policy if exists finance_payment_refunds_manage_scope on finance.payment_refunds;
create policy finance_payment_refunds_manage_scope on finance.payment_refunds
for all to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
);

drop policy if exists finance_payment_webhook_events_platform_scope on finance.payment_webhook_events;
create policy finance_payment_webhook_events_platform_scope on finance.payment_webhook_events
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists finance_payment_idempotency_platform_scope on finance.payment_idempotency_keys;
create policy finance_payment_idempotency_platform_scope on finance.payment_idempotency_keys
for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

insert into public.ai_credit_products (product_key, name, credits, price_inr, target_wallet_type, is_active, metadata)
values
  ('ai-credit-100', 'AI Credit Pack 100', 100, 99, 'personal', true, '{"source":"phase5_billing"}'::jsonb),
  ('ai-credit-500', 'AI Credit Pack 500', 500, 399, 'personal', true, '{"source":"phase5_billing"}'::jsonb),
  ('ai-credit-1000', 'AI Credit Pack 1000', 1000, 699, 'personal', true, '{"source":"phase5_billing"}'::jsonb)
on conflict (product_key) do update
set
  name = excluded.name,
  credits = excluded.credits,
  price_inr = excluded.price_inr,
  target_wallet_type = excluded.target_wallet_type,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());

notify pgrst, 'reload schema';

commit;
