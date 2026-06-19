begin;

alter table if exists lms.lessons
  drop constraint if exists lms_lessons_type_check;

alter table if exists lms.lessons
  add constraint lms_lessons_type_check
  check (lesson_type in ('video', 'pdf', 'note', 'assignment', 'mixed', 'document', 'resource'));

alter table if exists lms.lesson_resources
  drop constraint if exists lms_lesson_resources_type_check;

alter table if exists lms.lesson_resources
  add constraint lms_lesson_resources_type_check
  check (resource_type in ('video', 'pdf', 'note', 'assignment', 'link', 'docx', 'zip', 'mp4', 'image'));

create table if not exists online_tests.question_bank (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  deleted_by_profile_id uuid references public.profiles (id) on delete set null,
  subject text,
  chapter text,
  topic text,
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
  constraint online_tests_question_bank_type_check check (question_type in ('single_choice', 'multiple_choice', 'short_answer', 'long_answer', 'numeric')),
  constraint online_tests_question_bank_difficulty_check check (difficulty_level in ('easy', 'medium', 'hard')),
  constraint online_tests_question_bank_marks_check check (marks >= 0),
  constraint online_tests_question_bank_negative_marks_check check (negative_marks >= 0)
);

create index if not exists online_tests_question_bank_school_subject_idx
  on online_tests.question_bank (school_id, subject, chapter, topic, difficulty_level, created_at desc);

create or replace view public.online_test_question_bank as
select *
from online_tests.question_bank;

commit;
