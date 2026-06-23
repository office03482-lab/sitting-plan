begin;

do $$
begin
  if to_regclass('finance.payment_idempotency_keys') is not null then
    drop policy if exists finance_payment_idempotency_platform_scope on finance.payment_idempotency_keys;
    drop trigger if exists set_updated_at_finance_payment_idempotency_keys on finance.payment_idempotency_keys;
  end if;

  if to_regclass('finance.payment_webhook_events') is not null then
    drop policy if exists finance_payment_webhook_events_platform_scope on finance.payment_webhook_events;
    drop trigger if exists set_updated_at_finance_payment_webhook_events on finance.payment_webhook_events;
  end if;

  if to_regclass('finance.payment_refunds') is not null then
    drop policy if exists finance_payment_refunds_manage_scope on finance.payment_refunds;
    drop policy if exists finance_payment_refunds_select_scope on finance.payment_refunds;
    drop trigger if exists set_updated_at_finance_payment_refunds on finance.payment_refunds;
  end if;

  if to_regclass('finance.invoices') is not null then
    drop policy if exists finance_invoices_manage_scope on finance.invoices;
    drop policy if exists finance_invoices_select_scope on finance.invoices;
    drop trigger if exists set_updated_at_finance_invoices on finance.invoices;
  end if;
end $$;

drop table if exists finance.payment_idempotency_keys;
drop table if exists finance.payment_webhook_events;
drop table if exists finance.payment_refunds;
drop table if exists finance.invoices;

delete from public.ai_credit_products
where product_key in ('ai-credit-100', 'ai-credit-500', 'ai-credit-1000');

commit;
