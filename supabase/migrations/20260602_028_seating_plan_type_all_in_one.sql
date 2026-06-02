begin;

alter table exam.seating_plans
  drop constraint if exists seating_plans_plan_type_check;

alter table exam.seating_plans
  add constraint seating_plans_plan_type_check
  check (plan_type in ('strict', 'compact', 'manual', 'all_in_one'));

commit;
