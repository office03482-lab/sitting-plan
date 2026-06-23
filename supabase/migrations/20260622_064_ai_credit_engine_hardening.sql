begin;

alter table if exists public.ai_credit_wallets
  add column if not exists version integer not null default 0;

create table if not exists public.ai_credit_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  operation_key text not null,
  request_hash text not null,
  status text not null default 'completed',
  result_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_credit_idempotency_keys_unique unique (idempotency_key, operation_key),
  constraint ai_credit_idempotency_status_check check (status in ('completed'))
);

create index if not exists ai_credit_idempotency_created_idx
  on public.ai_credit_idempotency_keys (created_at desc);

drop trigger if exists set_updated_at_ai_credit_idempotency_keys on public.ai_credit_idempotency_keys;
create trigger set_updated_at_ai_credit_idempotency_keys
before update on public.ai_credit_idempotency_keys
for each row execute function public.set_updated_at();

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
  check (transaction_type in ('credit', 'debit', 'consumption', 'grant', 'purchase', 'refund', 'bonus', 'expiry', 'reset', 'adjustment'));

create or replace function public.ai_credit_ledger_immutable_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ai_credit_ledger is immutable';
end;
$$;

drop trigger if exists ai_credit_ledger_no_update on public.ai_credit_ledger;
create trigger ai_credit_ledger_no_update
before update on public.ai_credit_ledger
for each row execute function public.ai_credit_ledger_immutable_guard();

drop trigger if exists ai_credit_ledger_no_delete on public.ai_credit_ledger;
create trigger ai_credit_ledger_no_delete
before delete on public.ai_credit_ledger
for each row execute function public.ai_credit_ledger_immutable_guard();

create or replace function public.ai_credit_apply_wallet_change(
  p_profile_id uuid,
  p_school_id uuid,
  p_wallet_type text,
  p_delta integer,
  p_transaction_type text,
  p_feature text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_description text default null,
  p_actor_profile_id uuid default null,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_request_hash text default null,
  p_allow_create boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_wallet public.ai_credit_wallets%rowtype;
  v_ledger public.ai_credit_ledger%rowtype;
  v_existing public.ai_credit_idempotency_keys%rowtype;
  v_operation_key text := 'wallet_change';
  v_created_by uuid := coalesce(p_actor_profile_id, p_profile_id);
  v_request_hash text := coalesce(nullif(p_request_hash, ''), md5(coalesce(p_profile_id::text, '') || '|' || coalesce(p_school_id::text, '') || '|' || coalesce(p_wallet_type, '') || '|' || coalesce(p_delta::text, '') || '|' || coalesce(p_transaction_type, '') || '|' || coalesce(p_feature, '') || '|' || coalesce(p_reference_type, '') || '|' || coalesce(p_reference_id, '')));
  v_result jsonb;
  v_lifetime_used integer := 0;
  v_lifetime_granted integer := 0;
begin
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    insert into public.ai_credit_idempotency_keys (
      idempotency_key,
      operation_key,
      request_hash,
      status,
      metadata
    )
    values (
      p_idempotency_key,
      v_operation_key,
      v_request_hash,
      'completed',
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (idempotency_key, operation_key) do nothing;

    select *
    into v_existing
    from public.ai_credit_idempotency_keys
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key
    for update;

    if v_existing.request_hash <> v_request_hash then
      raise exception 'Idempotency key reuse with different payload'
        using errcode = 'P0001';
    end if;

    if coalesce(v_existing.result_payload, '{}'::jsonb) <> '{}'::jsonb then
      return v_existing.result_payload || jsonb_build_object('idempotency_replayed', true);
    end if;
  end if;

  select *
  into v_wallet
  from public.ai_credit_wallets
  where profile_id = p_profile_id
    and school_id = p_school_id
    and wallet_type = p_wallet_type
  limit 1
  for update;

  if not found then
    if not p_allow_create or p_delta < 0 then
      raise exception 'AI credit wallet not found'
        using errcode = 'P0001';
    end if;

    insert into public.ai_credit_wallets (
      profile_id,
      school_id,
      wallet_type,
      balance,
      lifetime_used,
      lifetime_granted,
      expires_at,
      metadata,
      created_by,
      updated_by,
      version
    )
    values (
      p_profile_id,
      p_school_id,
      p_wallet_type,
      0,
      0,
      0,
      p_expires_at,
      coalesce(p_metadata, '{}'::jsonb),
      v_created_by,
      v_created_by,
      0
    )
    returning * into v_wallet;
  end if;

  if p_delta < 0 then
    v_lifetime_used := abs(p_delta);
  elsif p_delta > 0 then
    v_lifetime_granted := p_delta;
  end if;

  update public.ai_credit_wallets
  set
    balance = balance + p_delta,
    lifetime_used = lifetime_used + v_lifetime_used,
    lifetime_granted = lifetime_granted + v_lifetime_granted,
    expires_at = coalesce(p_expires_at, expires_at),
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_by = v_created_by,
    version = version + 1
  where id = v_wallet.id
    and balance + p_delta >= 0
  returning * into v_wallet;

  if not found then
    raise exception 'Insufficient AI credits'
      using errcode = 'P0001';
  end if;

  insert into public.ai_credit_ledger (
    wallet_id,
    profile_id,
    school_id,
    transaction_type,
    amount,
    balance_after,
    feature,
    reference_type,
    reference_id,
    description,
    metadata,
    created_by
  )
  values (
    v_wallet.id,
    v_wallet.profile_id,
    v_wallet.school_id,
    p_transaction_type,
    p_delta,
    v_wallet.balance,
    nullif(p_feature, ''),
    nullif(p_reference_type, ''),
    nullif(p_reference_id, ''),
    p_description,
    coalesce(p_metadata, '{}'::jsonb),
    v_created_by
  )
  returning * into v_ledger;

  v_result := jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'ledger', to_jsonb(v_ledger),
    'idempotency_replayed', false
  );

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    update public.ai_credit_idempotency_keys
    set
      result_payload = v_result,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key;
  end if;

  return v_result;
end;
$$;

create or replace function public.ai_credit_transfer_atomic(
  p_from_profile_id uuid,
  p_from_school_id uuid,
  p_from_wallet_type text,
  p_to_profile_id uuid,
  p_to_school_id uuid,
  p_to_wallet_type text,
  p_amount integer,
  p_actor_profile_id uuid default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_source public.ai_credit_wallets%rowtype;
  v_target public.ai_credit_wallets%rowtype;
  v_source_ledger public.ai_credit_ledger%rowtype;
  v_target_ledger public.ai_credit_ledger%rowtype;
  v_existing public.ai_credit_idempotency_keys%rowtype;
  v_created_by uuid := coalesce(p_actor_profile_id, p_from_profile_id);
  v_operation_key text := 'transfer';
  v_request_hash text := coalesce(nullif(p_request_hash, ''), md5(coalesce(p_from_profile_id::text, '') || '|' || coalesce(p_from_school_id::text, '') || '|' || coalesce(p_from_wallet_type, '') || '|' || coalesce(p_to_profile_id::text, '') || '|' || coalesce(p_to_school_id::text, '') || '|' || coalesce(p_to_wallet_type, '') || '|' || coalesce(p_amount::text, '')));
  v_result jsonb;
begin
  if p_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero'
      using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    insert into public.ai_credit_idempotency_keys (
      idempotency_key,
      operation_key,
      request_hash,
      status,
      metadata
    )
    values (
      p_idempotency_key,
      v_operation_key,
      v_request_hash,
      'completed',
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (idempotency_key, operation_key) do nothing;

    select *
    into v_existing
    from public.ai_credit_idempotency_keys
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key
    for update;

    if v_existing.request_hash <> v_request_hash then
      raise exception 'Idempotency key reuse with different payload'
        using errcode = 'P0001';
    end if;

    if coalesce(v_existing.result_payload, '{}'::jsonb) <> '{}'::jsonb then
      return v_existing.result_payload || jsonb_build_object('idempotency_replayed', true);
    end if;
  end if;

  select *
  into v_source
  from public.ai_credit_wallets
  where profile_id = p_from_profile_id
    and school_id = p_from_school_id
    and wallet_type = p_from_wallet_type
  limit 1
  for update;

  if not found then
    raise exception 'Source AI credit wallet not found'
      using errcode = 'P0001';
  end if;

  select *
  into v_target
  from public.ai_credit_wallets
  where profile_id = p_to_profile_id
    and school_id = p_to_school_id
    and wallet_type = p_to_wallet_type
  limit 1
  for update;

  if not found then
    insert into public.ai_credit_wallets (
      profile_id,
      school_id,
      wallet_type,
      balance,
      lifetime_used,
      lifetime_granted,
      metadata,
      created_by,
      updated_by,
      version
    )
    values (
      p_to_profile_id,
      p_to_school_id,
      p_to_wallet_type,
      0,
      0,
      0,
      coalesce(p_metadata, '{}'::jsonb),
      v_created_by,
      v_created_by,
      0
    )
    returning * into v_target;
  end if;

  update public.ai_credit_wallets
  set
    balance = balance - p_amount,
    lifetime_used = lifetime_used + p_amount,
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_by = v_created_by,
    version = version + 1
  where id = v_source.id
    and balance >= p_amount
  returning * into v_source;

  if not found then
    raise exception 'Insufficient AI credits'
      using errcode = 'P0001';
  end if;

  update public.ai_credit_wallets
  set
    balance = balance + p_amount,
    lifetime_granted = lifetime_granted + p_amount,
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_by = v_created_by,
    version = version + 1
  where id = v_target.id
  returning * into v_target;

  insert into public.ai_credit_ledger (
    wallet_id,
    profile_id,
    school_id,
    transaction_type,
    amount,
    balance_after,
    description,
    metadata,
    created_by
  )
  values (
    v_source.id,
    v_source.profile_id,
    v_source.school_id,
    'adjustment',
    -p_amount,
    v_source.balance,
    coalesce(p_description, 'AI credit transfer out'),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('transfer_direction', 'out'),
    v_created_by
  )
  returning * into v_source_ledger;

  insert into public.ai_credit_ledger (
    wallet_id,
    profile_id,
    school_id,
    transaction_type,
    amount,
    balance_after,
    description,
    metadata,
    created_by
  )
  values (
    v_target.id,
    v_target.profile_id,
    v_target.school_id,
    'adjustment',
    p_amount,
    v_target.balance,
    coalesce(p_description, 'AI credit transfer in'),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('transfer_direction', 'in'),
    v_created_by
  )
  returning * into v_target_ledger;

  v_result := jsonb_build_object(
    'amount', p_amount,
    'source', jsonb_build_object('wallet', to_jsonb(v_source), 'ledger', to_jsonb(v_source_ledger)),
    'target', jsonb_build_object('wallet', to_jsonb(v_target), 'ledger', to_jsonb(v_target_ledger)),
    'idempotency_replayed', false
  );

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    update public.ai_credit_idempotency_keys
    set
      result_payload = v_result,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key;
  end if;

  return v_result;
end;
$$;

create or replace function public.ai_credit_debit_atomic(
  p_profile_id uuid,
  p_school_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_feature text default null,
  p_wallet_type text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_description text default null,
  p_actor_profile_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_existing public.ai_credit_idempotency_keys%rowtype;
  v_created_by uuid := coalesce(p_actor_profile_id, p_profile_id);
  v_operation_key text := 'debit';
  v_request_hash text := coalesce(nullif(p_request_hash, ''), md5(coalesce(p_profile_id::text, '') || '|' || coalesce(p_school_id::text, '') || '|' || coalesce(p_amount::text, '') || '|' || coalesce(p_transaction_type, '') || '|' || coalesce(p_feature, '') || '|' || coalesce(p_wallet_type, '') || '|' || coalesce(p_reference_type, '') || '|' || coalesce(p_reference_id, '')));
  v_remaining integer := p_amount;
  v_take integer;
  v_wallet public.ai_credit_wallets%rowtype;
  v_updated_wallet public.ai_credit_wallets%rowtype;
  v_ledger public.ai_credit_ledger%rowtype;
  v_wallet_updates jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_amount <= 0 then
    raise exception 'Debit amount must be greater than zero'
      using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    insert into public.ai_credit_idempotency_keys (
      idempotency_key,
      operation_key,
      request_hash,
      status,
      metadata
    )
    values (
      p_idempotency_key,
      v_operation_key,
      v_request_hash,
      'completed',
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (idempotency_key, operation_key) do nothing;

    select *
    into v_existing
    from public.ai_credit_idempotency_keys
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key
    for update;

    if v_existing.request_hash <> v_request_hash then
      raise exception 'Idempotency key reuse with different payload'
        using errcode = 'P0001';
    end if;

    if coalesce(v_existing.result_payload, '{}'::jsonb) <> '{}'::jsonb then
      return v_existing.result_payload || jsonb_build_object('idempotency_replayed', true);
    end if;
  end if;

  for v_wallet in
    select *
    from public.ai_credit_wallets
    where school_id = p_school_id
      and (
        (
          p_wallet_type is null
          and (
            (wallet_type = 'personal' and profile_id = p_profile_id)
            or (wallet_type = 'school')
            or (wallet_type = 'bonus' and profile_id = p_profile_id)
          )
        )
        or (p_wallet_type is not null and wallet_type = p_wallet_type and (wallet_type = 'school' or profile_id = p_profile_id))
      )
      and coalesce(is_frozen, false) = false
      and (expires_at is null or expires_at > timezone('utc', now()))
      and balance > 0
    order by
      case wallet_type
        when 'personal' then 1
        when 'school' then 2
        when 'bonus' then 3
        else 9
      end,
      balance desc,
      created_at desc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_wallet.balance);

    update public.ai_credit_wallets
    set
      balance = balance - v_take,
      lifetime_used = lifetime_used + v_take,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_by = v_created_by,
      version = version + 1
    where id = v_wallet.id
      and balance >= v_take
    returning * into v_updated_wallet;

    if not found then
      raise exception 'Insufficient AI credits'
        using errcode = 'P0001';
    end if;

    insert into public.ai_credit_ledger (
      wallet_id,
      profile_id,
      school_id,
      transaction_type,
      amount,
      balance_after,
      feature,
      reference_type,
      reference_id,
      description,
      metadata,
      created_by
    )
    values (
      v_updated_wallet.id,
      v_updated_wallet.profile_id,
      v_updated_wallet.school_id,
      p_transaction_type,
      -v_take,
      v_updated_wallet.balance,
      nullif(p_feature, ''),
      nullif(p_reference_type, ''),
      nullif(p_reference_id, ''),
      p_description,
      coalesce(p_metadata, '{}'::jsonb),
      v_created_by
    )
    returning * into v_ledger;

    v_wallet_updates := v_wallet_updates || jsonb_build_array(
      jsonb_build_object(
        'wallet', to_jsonb(v_updated_wallet),
        'ledger', to_jsonb(v_ledger)
      )
    );
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Insufficient AI credits'
      using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object(
    'amount', p_amount,
    'wallet_updates', v_wallet_updates,
    'idempotency_replayed', false
  );

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    update public.ai_credit_idempotency_keys
    set
      result_payload = v_result,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
    where idempotency_key = p_idempotency_key
      and operation_key = v_operation_key;
  end if;

  return v_result;
end;
$$;

create or replace function public.ai_credit_verify_ledger_integrity(
  p_school_id uuid default null,
  p_profile_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  with wallet_rows as (
    select
      w.id,
      w.profile_id,
      w.school_id,
      w.wallet_type,
      w.balance,
      coalesce(sum(l.amount), 0) as ledger_balance
    from public.ai_credit_wallets w
    left join public.ai_credit_ledger l on l.wallet_id = w.id
    where (p_school_id is null or w.school_id = p_school_id)
      and (p_profile_id is null or w.profile_id = p_profile_id)
    group by w.id, w.profile_id, w.school_id, w.wallet_type, w.balance
  )
  select jsonb_build_object(
    'consistent',
    coalesce(bool_and(balance = ledger_balance), true),
    'wallets',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'wallet_id', id,
          'profile_id', profile_id,
          'school_id', school_id,
          'wallet_type', wallet_type,
          'wallet_balance', balance,
          'ledger_balance', ledger_balance,
          'consistent', balance = ledger_balance
        )
        order by school_id, profile_id, wallet_type
      ),
      '[]'::jsonb
    )
  )
  into v_payload
  from wallet_rows;

  return coalesce(v_payload, jsonb_build_object('consistent', true, 'wallets', '[]'::jsonb));
end;
$$;

commit;
