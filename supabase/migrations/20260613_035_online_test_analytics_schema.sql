begin;

create schema if not exists analytics;

create table if not exists analytics.student_performance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  latest_test_id uuid references online_tests.tests (id) on delete set null,
  overall_percentage numeric(5,2) not null default 0,
  accuracy numeric(5,2) not null default 0,
  speed numeric(10,2) not null default 0,
  rank_in_school integer,
  percentile numeric(5,2),
  summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_student_performance_percentage_check check (overall_percentage >= 0 and overall_percentage <= 100),
  constraint analytics_student_performance_accuracy_check check (accuracy >= 0 and accuracy <= 100),
  constraint analytics_student_performance_speed_check check (speed >= 0),
  constraint analytics_student_performance_rank_check check (rank_in_school is null or rank_in_school > 0),
  constraint analytics_student_performance_percentile_check check (percentile is null or (percentile >= 0 and percentile <= 100))
);

create unique index if not exists analytics_student_performance_school_student_active_key
  on analytics.student_performance (school_id, student_id)
  where deleted_at is null;

create index if not exists analytics_student_performance_school_generated_idx
  on analytics.student_performance (school_id, generated_at desc);

create table if not exists analytics.topic_performance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  owner_type text not null,
  owner_id text not null,
  student_id uuid references public.students (id) on delete cascade,
  test_id uuid references online_tests.tests (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  chapter_name text,
  topic_name text not null,
  attempts_count integer not null default 0,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  unanswered_count integer not null default 0,
  percentage numeric(5,2) not null default 0,
  summary jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_topic_performance_owner_type_check check (
    owner_type in ('student', 'test', 'batch', 'school', 'platform')
  ),
  constraint analytics_topic_performance_attempts_check check (attempts_count >= 0),
  constraint analytics_topic_performance_correct_check check (correct_count >= 0),
  constraint analytics_topic_performance_incorrect_check check (incorrect_count >= 0),
  constraint analytics_topic_performance_unanswered_check check (unanswered_count >= 0),
  constraint analytics_topic_performance_percentage_check check (percentage >= 0 and percentage <= 100)
);

create unique index if not exists analytics_topic_performance_owner_topic_active_key
  on analytics.topic_performance (
    coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
    owner_type,
    owner_id,
    lower(coalesce(chapter_name, '')),
    lower(topic_name)
  )
  where deleted_at is null;

create index if not exists analytics_topic_performance_school_owner_idx
  on analytics.topic_performance (school_id, owner_type, owner_id, generated_at desc);

create table if not exists analytics.test_analytics (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  average_percentage numeric(5,2) not null default 0,
  average_score numeric(10,2) not null default 0,
  completion_rate numeric(5,2) not null default 0,
  participant_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_test_analytics_average_percentage_check check (average_percentage >= 0 and average_percentage <= 100),
  constraint analytics_test_analytics_completion_rate_check check (completion_rate >= 0 and completion_rate <= 100),
  constraint analytics_test_analytics_average_score_check check (average_score >= 0),
  constraint analytics_test_analytics_participant_count_check check (participant_count >= 0)
);

create unique index if not exists analytics_test_analytics_school_test_active_key
  on analytics.test_analytics (school_id, test_id)
  where deleted_at is null;

create index if not exists analytics_test_analytics_school_generated_idx
  on analytics.test_analytics (school_id, generated_at desc);

create table if not exists analytics.school_analytics (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  scope_type text not null,
  scope_id text not null,
  average_percentage numeric(5,2) not null default 0,
  active_students_count integer not null default 0,
  active_tests_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint analytics_school_analytics_scope_type_check check (scope_type in ('school', 'platform')),
  constraint analytics_school_analytics_average_percentage_check check (average_percentage >= 0 and average_percentage <= 100),
  constraint analytics_school_analytics_active_students_check check (active_students_count >= 0),
  constraint analytics_school_analytics_active_tests_check check (active_tests_count >= 0)
);

create unique index if not exists analytics_school_analytics_scope_active_key
  on analytics.school_analytics (scope_type, scope_id)
  where deleted_at is null;

create index if not exists analytics_school_analytics_school_generated_idx
  on analytics.school_analytics (school_id, generated_at desc);

create or replace function analytics.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, analytics
as $$
declare
  v_school_id uuid;
  v_entity_id uuid;
  v_action text;
  v_payload jsonb := '{}'::jsonb;
  v_row jsonb;
begin
  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_school_id := new.school_id;
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  v_payload := jsonb_build_object(
    'scope_type', nullif(v_row ->> 'scope_type', ''),
    'scope_id', nullif(v_row ->> 'scope_id', ''),
    'owner_type', nullif(v_row ->> 'owner_type', ''),
    'owner_id', nullif(v_row ->> 'owner_id', ''),
    'student_id', nullif(v_row ->> 'student_id', ''),
    'test_id', nullif(v_row ->> 'test_id', ''),
    'generated_at', nullif(v_row ->> 'generated_at', ''),
    'is_active', coalesce((v_row ->> 'is_active')::boolean, true)
  );

  if tg_op = 'INSERT' then
    v_action := 'analytics.' || tg_table_name || '.created';
  elsif tg_op = 'UPDATE' and coalesce(old.is_active, true) = true and coalesce(new.is_active, true) = false then
    v_action := 'analytics.' || tg_table_name || '.soft_deleted';
  elsif tg_op = 'UPDATE' then
    v_action := 'analytics.' || tg_table_name || '.updated';
  else
    v_action := 'analytics.' || tg_table_name || '.deleted';
  end if;

  insert into public.audit_logs (
    school_id,
    profile_id,
    action,
    module_key,
    entity_table,
    entity_id,
    payload
  )
  values (
    v_school_id,
    auth.uid(),
    v_action,
    'analytics',
    'analytics.' || tg_table_name,
    v_entity_id,
    v_payload
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger set_updated_at_analytics_student_performance
before update on analytics.student_performance
for each row
execute function public.set_updated_at();

create trigger set_updated_at_analytics_topic_performance
before update on analytics.topic_performance
for each row
execute function public.set_updated_at();

create trigger set_updated_at_analytics_test_analytics
before update on analytics.test_analytics
for each row
execute function public.set_updated_at();

create trigger set_updated_at_analytics_school_analytics
before update on analytics.school_analytics
for each row
execute function public.set_updated_at();

create trigger audit_analytics_student_performance
after insert or update or delete on analytics.student_performance
for each row
execute function analytics.write_audit_log();

create trigger audit_analytics_topic_performance
after insert or update or delete on analytics.topic_performance
for each row
execute function analytics.write_audit_log();

create trigger audit_analytics_test_analytics
after insert or update or delete on analytics.test_analytics
for each row
execute function analytics.write_audit_log();

create trigger audit_analytics_school_analytics
after insert or update or delete on analytics.school_analytics
for each row
execute function analytics.write_audit_log();

alter table analytics.student_performance enable row level security;
alter table analytics.topic_performance enable row level security;
alter table analytics.test_analytics enable row level security;
alter table analytics.school_analytics enable row level security;

create policy analytics_student_performance_select_scope
on analytics.student_performance
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.reports')
  or exists (
    select 1
    from public.students s
    where s.id = student_performance.student_id
      and s.school_id = student_performance.school_id
      and s.profile_id = auth.uid()
  )
);

create policy analytics_student_performance_manage_scope
on analytics.student_performance
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.reports')
);

create policy analytics_topic_performance_select_scope
on analytics.topic_performance
for select
to authenticated
using (
  public.is_platform_admin()
  or (school_id is not null and public.same_school_membership(school_id))
);

create policy analytics_topic_performance_manage_scope
on analytics.topic_performance
for all
to authenticated
using (
  public.is_platform_admin()
  or (school_id is not null and (public.is_school_admin(school_id) or public.has_permission(school_id, 'online_tests.reports')))
)
with check (
  public.is_platform_admin()
  or (school_id is not null and (public.is_school_admin(school_id) or public.has_permission(school_id, 'online_tests.reports')))
);

create policy analytics_test_analytics_select_scope
on analytics.test_analytics
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy analytics_test_analytics_manage_scope
on analytics.test_analytics
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.reports')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.reports')
);

create policy analytics_school_analytics_select_scope
on analytics.school_analytics
for select
to authenticated
using (
  public.is_platform_admin()
  or (scope_type = 'school' and school_id is not null and public.same_school_membership(school_id))
);

create policy analytics_school_analytics_manage_scope
on analytics.school_analytics
for all
to authenticated
using (
  public.is_platform_admin()
  or (scope_type = 'school' and school_id is not null and (public.is_school_admin(school_id) or public.has_permission(school_id, 'online_tests.reports')))
)
with check (
  public.is_platform_admin()
  or (scope_type = 'school' and school_id is not null and (public.is_school_admin(school_id) or public.has_permission(school_id, 'online_tests.reports')))
);

notify pgrst, 'reload schema';

commit;
