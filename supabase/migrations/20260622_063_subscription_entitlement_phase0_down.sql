begin;

do $$
begin
  if to_regclass('public.plan_change_requests') is not null then
    drop trigger if exists set_updated_at_plan_change_requests on public.plan_change_requests;
  end if;
  if to_regclass('public.ai_credit_products') is not null then
    drop trigger if exists set_updated_at_ai_credit_products on public.ai_credit_products;
  end if;
  if to_regclass('public.ai_credit_wallets') is not null then
    drop trigger if exists set_updated_at_ai_credit_wallets on public.ai_credit_wallets;
  end if;
  if to_regclass('public.usage_snapshots') is not null then
    drop trigger if exists set_updated_at_usage_snapshots on public.usage_snapshots;
  end if;
  if to_regclass('public.plan_feature_overrides') is not null then
    drop trigger if exists set_updated_at_plan_feature_overrides on public.plan_feature_overrides;
  end if;
  if to_regclass('public.school_plans') is not null then
    drop trigger if exists set_updated_at_school_plans on public.school_plans;
  end if;
  if to_regclass('public.entitlement_rule') is not null then
    drop trigger if exists set_updated_at_entitlement_rule on public.entitlement_rule;
  end if;
end $$;

drop table if exists public.plan_change_requests;
drop table if exists public.ai_credit_ledger;
drop table if exists public.ai_credit_wallets;
drop table if exists public.ai_credit_products;
drop table if exists public.usage_snapshots;
drop table if exists public.plan_feature_overrides;
drop table if exists public.school_plans;
drop table if exists public.entitlement_rule;

drop type if exists public.subscription_status;
drop type if exists public.plan_tiers;

commit;
