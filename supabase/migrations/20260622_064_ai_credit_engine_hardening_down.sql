begin;

drop trigger if exists ai_credit_ledger_no_delete on public.ai_credit_ledger;
drop trigger if exists ai_credit_ledger_no_update on public.ai_credit_ledger;
drop function if exists public.ai_credit_ledger_immutable_guard();

drop function if exists public.ai_credit_verify_ledger_integrity(uuid, uuid);
drop function if exists public.ai_credit_debit_atomic(uuid, uuid, integer, text, text, text, text, text, text, uuid, jsonb, text, text);
drop function if exists public.ai_credit_transfer_atomic(uuid, uuid, text, uuid, uuid, text, integer, uuid, text, jsonb, text, text);
drop function if exists public.ai_credit_apply_wallet_change(uuid, uuid, text, integer, text, text, text, text, text, uuid, timestamptz, jsonb, text, text, boolean);

do $$
begin
  if to_regclass('public.ai_credit_idempotency_keys') is not null then
    drop trigger if exists set_updated_at_ai_credit_idempotency_keys on public.ai_credit_idempotency_keys;
  end if;
end $$;

drop table if exists public.ai_credit_idempotency_keys;

alter table if exists public.ai_credit_wallets
  drop column if exists version;

do $$
begin
  if to_regclass('public.ai_credit_ledger') is not null then
    update public.ai_credit_ledger
    set transaction_type = 'grant'
    where transaction_type = 'credit';

    update public.ai_credit_ledger
    set transaction_type = 'consumption'
    where transaction_type = 'debit';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'ai_credit_ledger_type_check'
      and connamespace = 'public'::regnamespace
  ) then
    alter table public.ai_credit_ledger drop constraint ai_credit_ledger_type_check;
  end if;
end $$;

alter table public.ai_credit_ledger
  add constraint ai_credit_ledger_type_check
  check (transaction_type in ('consumption', 'grant', 'purchase', 'refund', 'bonus', 'expiry', 'reset', 'adjustment'));

commit;
