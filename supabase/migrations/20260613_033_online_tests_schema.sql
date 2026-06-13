begin;

create schema if not exists online_tests;

create table if not exists online_tests.tests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  published_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  test_code text,
  title text not null,
  description text,
  instructions text,
  test_type text not null default 'objective',
  delivery_mode text not null default 'scheduled',
  status text not null default 'draft',
  duration_minutes integer not null default 60,
  total_marks numeric(10,2) not null default 0,
  pass_marks numeric(10,2),
  max_attempts integer not null default 1,
  shuffle_questions boolean not null default false,
  shuffle_options boolean not null default false,
  show_result_immediately boolean not null default false,
  allow_review boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_tests_type_check check (
    test_type in ('objective', 'subjective', 'mixed', 'practice')
  ),
  constraint online_tests_tests_delivery_mode_check check (
    delivery_mode in ('scheduled', 'practice', 'assignment')
  ),
  constraint online_tests_tests_status_check check (
    status in ('draft', 'published', 'in_progress', 'completed', 'archived', 'cancelled')
  ),
  constraint online_tests_tests_duration_check check (duration_minutes > 0),
  constraint online_tests_tests_total_marks_check check (total_marks >= 0),
  constraint online_tests_tests_pass_marks_check check (
    pass_marks is null or (pass_marks >= 0 and pass_marks <= total_marks)
  ),
  constraint online_tests_tests_max_attempts_check check (max_attempts > 0),
  constraint online_tests_tests_schedule_check check (
    ends_at is null or starts_at is null or ends_at > starts_at
  )
);

create unique index if not exists online_tests_tests_school_code_active_key
  on online_tests.tests (school_id, lower(test_code))
  where test_code is not null and deleted_at is null;

create index if not exists online_tests_tests_school_status_idx
  on online_tests.tests (school_id, status, created_at desc);

create index if not exists online_tests_tests_school_batch_idx
  on online_tests.tests (school_id, batch_id, starts_at desc);

create index if not exists online_tests_tests_school_subject_idx
  on online_tests.tests (school_id, subject_id, starts_at desc);

create index if not exists online_tests_tests_school_active_idx
  on online_tests.tests (school_id, is_active, created_at desc);

create table if not exists online_tests.test_sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  section_code text,
  title text not null,
  description text,
  instructions text,
  display_order integer not null default 1,
  question_type text not null default 'mixed',
  marks_per_question numeric(10,2) not null default 1,
  negative_marks numeric(10,2) not null default 0,
  question_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_sections_question_type_check check (
    question_type in ('single_choice', 'multiple_choice', 'true_false', 'short_answer', 'long_answer', 'numeric', 'mixed')
  ),
  constraint online_tests_sections_display_order_check check (display_order > 0),
  constraint online_tests_sections_marks_check check (marks_per_question >= 0),
  constraint online_tests_sections_negative_marks_check check (negative_marks >= 0),
  constraint online_tests_sections_question_count_check check (question_count >= 0)
);

create unique index if not exists online_tests_sections_test_section_code_active_key
  on online_tests.test_sections (test_id, lower(section_code))
  where section_code is not null and deleted_at is null;

create unique index if not exists online_tests_sections_test_display_order_active_key
  on online_tests.test_sections (test_id, display_order)
  where deleted_at is null;

create index if not exists online_tests_sections_school_test_idx
  on online_tests.test_sections (school_id, test_id, display_order);

create table if not exists online_tests.test_questions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  section_id uuid not null references online_tests.test_sections (id) on delete cascade,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  question_code text,
  display_order integer not null default 1,
  question_type text not null default 'single_choice',
  difficulty_level text not null default 'medium',
  prompt_text text not null,
  option_items jsonb not null default '[]'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  explanation text,
  marks numeric(10,2) not null default 1,
  negative_marks numeric(10,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_questions_type_check check (
    question_type in ('single_choice', 'multiple_choice', 'true_false', 'short_answer', 'long_answer', 'numeric')
  ),
  constraint online_tests_questions_difficulty_check check (
    difficulty_level in ('easy', 'medium', 'hard')
  ),
  constraint online_tests_questions_display_order_check check (display_order > 0),
  constraint online_tests_questions_marks_check check (marks >= 0),
  constraint online_tests_questions_negative_marks_check check (negative_marks >= 0)
);

create unique index if not exists online_tests_questions_section_code_active_key
  on online_tests.test_questions (section_id, lower(question_code))
  where question_code is not null and deleted_at is null;

create unique index if not exists online_tests_questions_section_display_order_active_key
  on online_tests.test_questions (section_id, display_order)
  where deleted_at is null;

create index if not exists online_tests_questions_school_test_idx
  on online_tests.test_questions (school_id, test_id, section_id, display_order);

create table if not exists online_tests.test_attempts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  attempt_number integer not null default 1,
  status text not null default 'in_progress',
  started_at timestamptz not null default timezone('utc', now()),
  submitted_at timestamptz,
  auto_submitted_at timestamptz,
  evaluated_at timestamptz,
  total_questions_snapshot integer not null default 0,
  answered_questions_snapshot integer not null default 0,
  time_spent_seconds integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_attempts_attempt_number_check check (attempt_number > 0),
  constraint online_tests_attempts_status_check check (
    status in ('in_progress', 'submitted', 'evaluated', 'expired', 'cancelled')
  ),
  constraint online_tests_attempts_time_spent_check check (time_spent_seconds >= 0),
  constraint online_tests_attempts_total_questions_check check (total_questions_snapshot >= 0),
  constraint online_tests_attempts_answered_questions_check check (
    answered_questions_snapshot >= 0 and answered_questions_snapshot <= total_questions_snapshot
  ),
  constraint online_tests_attempts_submission_timing_check check (
    submitted_at is null or submitted_at >= started_at
  )
);

create unique index if not exists online_tests_attempts_test_student_attempt_active_key
  on online_tests.test_attempts (test_id, student_id, attempt_number)
  where deleted_at is null;

create index if not exists online_tests_attempts_school_test_status_idx
  on online_tests.test_attempts (school_id, test_id, status, started_at desc);

create index if not exists online_tests_attempts_school_student_idx
  on online_tests.test_attempts (school_id, student_id, started_at desc);

create table if not exists online_tests.test_responses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  attempt_id uuid not null references online_tests.test_attempts (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  question_id uuid not null references online_tests.test_questions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  response_payload jsonb not null default '{}'::jsonb,
  is_marked_for_review boolean not null default false,
  is_correct boolean,
  marks_awarded numeric(10,2),
  answered_at timestamptz,
  evaluated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_responses_marks_awarded_check check (
    marks_awarded is null or marks_awarded >= 0
  )
);

create unique index if not exists online_tests_responses_attempt_question_active_key
  on online_tests.test_responses (attempt_id, question_id)
  where deleted_at is null;

create index if not exists online_tests_responses_school_attempt_idx
  on online_tests.test_responses (school_id, attempt_id, question_id);

create index if not exists online_tests_responses_school_student_idx
  on online_tests.test_responses (school_id, student_id, created_at desc);

create table if not exists online_tests.test_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  attempt_id uuid not null references online_tests.test_attempts (id) on delete cascade,
  test_id uuid not null references online_tests.tests (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  generated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  status text not null default 'evaluated',
  total_questions integer not null default 0,
  attempted_questions integer not null default 0,
  correct_answers integer not null default 0,
  incorrect_answers integer not null default 0,
  unanswered_questions integer not null default 0,
  score_obtained numeric(10,2) not null default 0,
  max_score numeric(10,2) not null default 0,
  percentage numeric(5,2),
  rank_in_batch integer,
  rank_in_school integer,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint online_tests_results_status_check check (
    status in ('evaluated', 'published', 'cancelled')
  ),
  constraint online_tests_results_total_questions_check check (total_questions >= 0),
  constraint online_tests_results_attempted_questions_check check (
    attempted_questions >= 0 and attempted_questions <= total_questions
  ),
  constraint online_tests_results_correct_answers_check check (correct_answers >= 0),
  constraint online_tests_results_incorrect_answers_check check (incorrect_answers >= 0),
  constraint online_tests_results_unanswered_questions_check check (unanswered_questions >= 0),
  constraint online_tests_results_score_obtained_check check (score_obtained >= 0),
  constraint online_tests_results_max_score_check check (max_score >= 0),
  constraint online_tests_results_percentage_check check (
    percentage is null or (percentage >= 0 and percentage <= 100)
  ),
  constraint online_tests_results_rank_batch_check check (rank_in_batch is null or rank_in_batch > 0),
  constraint online_tests_results_rank_school_check check (rank_in_school is null or rank_in_school > 0)
);

create unique index if not exists online_tests_results_attempt_active_key
  on online_tests.test_results (attempt_id)
  where deleted_at is null;

create index if not exists online_tests_results_school_test_idx
  on online_tests.test_results (school_id, test_id, published_at desc);

create index if not exists online_tests_results_school_student_idx
  on online_tests.test_results (school_id, student_id, created_at desc);

create or replace function online_tests.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, online_tests
as $$
declare
  v_school_id uuid;
  v_entity_id uuid;
  v_action text;
  v_profile_id uuid := auth.uid();
  v_payload jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    v_school_id := old.school_id;
    v_entity_id := old.id;
  else
    v_school_id := new.school_id;
    v_entity_id := new.id;
  end if;

  if tg_table_name = 'tests' then
    v_payload := jsonb_build_object(
      'title', coalesce(new.title, old.title),
      'status', coalesce(new.status, old.status),
      'test_type', coalesce(new.test_type, old.test_type),
      'batch_id', coalesce(new.batch_id, old.batch_id),
      'subject_id', coalesce(new.subject_id, old.subject_id),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif tg_table_name = 'test_sections' then
    v_payload := jsonb_build_object(
      'test_id', coalesce(new.test_id, old.test_id),
      'section_code', coalesce(new.section_code, old.section_code),
      'title', coalesce(new.title, old.title),
      'display_order', coalesce(new.display_order, old.display_order),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif tg_table_name = 'test_questions' then
    v_payload := jsonb_build_object(
      'test_id', coalesce(new.test_id, old.test_id),
      'section_id', coalesce(new.section_id, old.section_id),
      'question_code', coalesce(new.question_code, old.question_code),
      'question_type', coalesce(new.question_type, old.question_type),
      'difficulty_level', coalesce(new.difficulty_level, old.difficulty_level),
      'marks', coalesce(new.marks, old.marks),
      'display_order', coalesce(new.display_order, old.display_order),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif tg_table_name = 'test_attempts' then
    v_payload := jsonb_build_object(
      'test_id', coalesce(new.test_id, old.test_id),
      'student_id', coalesce(new.student_id, old.student_id),
      'attempt_number', coalesce(new.attempt_number, old.attempt_number),
      'status', coalesce(new.status, old.status),
      'started_at', coalesce(new.started_at, old.started_at),
      'submitted_at', coalesce(new.submitted_at, old.submitted_at),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif tg_table_name = 'test_responses' then
    v_payload := jsonb_build_object(
      'attempt_id', coalesce(new.attempt_id, old.attempt_id),
      'test_id', coalesce(new.test_id, old.test_id),
      'question_id', coalesce(new.question_id, old.question_id),
      'student_id', coalesce(new.student_id, old.student_id),
      'is_correct', coalesce(new.is_correct, old.is_correct),
      'marks_awarded', coalesce(new.marks_awarded, old.marks_awarded),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  elsif tg_table_name = 'test_results' then
    v_payload := jsonb_build_object(
      'attempt_id', coalesce(new.attempt_id, old.attempt_id),
      'test_id', coalesce(new.test_id, old.test_id),
      'student_id', coalesce(new.student_id, old.student_id),
      'status', coalesce(new.status, old.status),
      'score_obtained', coalesce(new.score_obtained, old.score_obtained),
      'max_score', coalesce(new.max_score, old.max_score),
      'percentage', coalesce(new.percentage, old.percentage),
      'is_active', coalesce(new.is_active, old.is_active)
    );
  end if;

  if tg_op = 'INSERT' then
    v_action := 'online_tests.' || tg_table_name || '.created';
  elsif tg_op = 'UPDATE' and coalesce(old.is_active, true) = true and coalesce(new.is_active, true) = false then
    v_action := 'online_tests.' || tg_table_name || '.soft_deleted';
  elsif tg_op = 'UPDATE' then
    v_action := 'online_tests.' || tg_table_name || '.updated';
  else
    v_action := 'online_tests.' || tg_table_name || '.deleted';
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
    v_profile_id,
    v_action,
    'online_tests',
    'online_tests.' || tg_table_name,
    v_entity_id,
    v_payload
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger set_updated_at_online_tests_tests
before update on online_tests.tests
for each row
execute function public.set_updated_at();

create trigger set_updated_at_online_tests_sections
before update on online_tests.test_sections
for each row
execute function public.set_updated_at();

create trigger set_updated_at_online_tests_questions
before update on online_tests.test_questions
for each row
execute function public.set_updated_at();

create trigger set_updated_at_online_tests_attempts
before update on online_tests.test_attempts
for each row
execute function public.set_updated_at();

create trigger set_updated_at_online_tests_responses
before update on online_tests.test_responses
for each row
execute function public.set_updated_at();

create trigger set_updated_at_online_tests_results
before update on online_tests.test_results
for each row
execute function public.set_updated_at();

create trigger audit_online_tests_tests
after insert or update or delete on online_tests.tests
for each row
execute function online_tests.write_audit_log();

create trigger audit_online_tests_sections
after insert or update or delete on online_tests.test_sections
for each row
execute function online_tests.write_audit_log();

create trigger audit_online_tests_questions
after insert or update or delete on online_tests.test_questions
for each row
execute function online_tests.write_audit_log();

create trigger audit_online_tests_attempts
after insert or update or delete on online_tests.test_attempts
for each row
execute function online_tests.write_audit_log();

create trigger audit_online_tests_responses
after insert or update or delete on online_tests.test_responses
for each row
execute function online_tests.write_audit_log();

create trigger audit_online_tests_results
after insert or update or delete on online_tests.test_results
for each row
execute function online_tests.write_audit_log();

alter table online_tests.tests enable row level security;
alter table online_tests.test_sections enable row level security;
alter table online_tests.test_questions enable row level security;
alter table online_tests.test_attempts enable row level security;
alter table online_tests.test_responses enable row level security;
alter table online_tests.test_results enable row level security;

create policy online_tests_tests_select_scope
on online_tests.tests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy online_tests_tests_manage_scope
on online_tests.tests
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

create policy online_tests_sections_select_scope
on online_tests.test_sections
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy online_tests_sections_manage_scope
on online_tests.test_sections
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

create policy online_tests_questions_select_scope
on online_tests.test_questions
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
);

create policy online_tests_questions_manage_scope
on online_tests.test_questions
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

create policy online_tests_attempts_select_scope
on online_tests.test_attempts
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_attempts.student_id
      and s.school_id = test_attempts.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_attempts_insert_scope
on online_tests.test_attempts
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_attempts.student_id
      and s.school_id = test_attempts.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_attempts_update_scope
on online_tests.test_attempts
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_attempts.student_id
      and s.school_id = test_attempts.school_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_attempts.student_id
      and s.school_id = test_attempts.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_attempts_delete_scope
on online_tests.test_attempts
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

create policy online_tests_responses_select_scope
on online_tests.test_responses
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_responses.student_id
      and s.school_id = test_responses.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_responses_insert_scope
on online_tests.test_responses
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_responses.student_id
      and s.school_id = test_responses.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_responses_update_scope
on online_tests.test_responses
for update
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_responses.student_id
      and s.school_id = test_responses.school_id
      and s.profile_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_responses.student_id
      and s.school_id = test_responses.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_responses_delete_scope
on online_tests.test_responses
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

create policy online_tests_results_select_scope
on online_tests.test_results
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
  or exists (
    select 1
    from public.students s
    where s.id = test_results.student_id
      and s.school_id = test_results.school_id
      and s.profile_id = auth.uid()
  )
);

create policy online_tests_results_manage_scope
on online_tests.test_results
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'online_tests.manage')
);

notify pgrst, 'reload schema';

commit;
