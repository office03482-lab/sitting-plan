-- =============================================================================
-- Migration: Add offline exam tables to the exam schema
-- This recreates exam.exams with the full offline-exam column set and creates
-- the related tables: exam_sections, exam_questions, hall_tickets, attendance,
-- evaluations, exam_results, seating.
-- =============================================================================

begin;

-- 1. Drop the old exam.exams table and recreate with the full column set
--    (data loss is acceptable because the old table was a bare seating-plan stub)

drop table if exists exam.seating_assignments cascade;
drop table if exists exam.seating_plans cascade;
drop table if exists exam.invigilator_assignments cascade;
drop table if exists exam.exam_registrations cascade;
drop table if exists exam.room_seats cascade;
drop table if exists exam.room_desks cascade;

-- Drop the old exams table (and any dependent views)
drop view if exists public.exam_exams cascade;
drop table if exists exam.exams cascade;

create table if not exists exam.exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  title text not null,
  description text,
  instructions text,
  exam_code text,
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  created_by_profile_id uuid,
  exam_type text not null default 'custom',
  paper_format text not null default 'mcq',
  status text not null default 'draft',
  duration_minutes integer not null default 120,
  total_marks numeric not null default 0,
  pass_marks numeric,
  total_sets integer not null default 1,
  shuffle_questions boolean not null default false,
  allow_negative_marking boolean not null default false,
  exam_date date,
  exam_start_time time,
  exam_end_time time,
  question_source text not null default 'question_bank',
  seating_required boolean not null default true,
  invigilators_required boolean not null default true,
  hall_tickets_required boolean not null default true,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists exams_school_active_idx on exam.exams (school_id, is_active);

-- 2. Exam Sections
create table if not exists exam.exam_sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  title text not null default 'Section 1',
  description text,
  display_order integer not null default 1,
  question_type text not null default 'mcq',
  marks_per_question numeric not null default 1,
  negative_marks numeric not null default 0,
  question_count integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists exam_sections_exam_idx on exam.exam_sections (exam_id);

-- 3. Exam Questions
create table if not exists exam.exam_questions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  section_id uuid references exam.exam_sections (id) on delete set null,
  question_code text,
  display_order integer not null default 1,
  question_type text not null default 'mcq',
  difficulty_level text not null default 'medium',
  prompt_text text not null,
  option_items jsonb not null default '[]'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  explanation text,
  marks numeric not null default 1,
  negative_marks numeric not null default 0,
  set_labels jsonb not null default '["A"]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists exam_questions_exam_idx on exam.exam_questions (exam_id);
create index if not exists exam_questions_section_idx on exam.exam_questions (section_id);

-- 4. Hall Tickets
create table if not exists exam.hall_tickets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  roll_number text,
  room_id uuid references public.rooms (id) on delete set null,
  seat_number integer,
  set_label text default 'A',
  status text not null default 'issued',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists hall_tickets_exam_idx on exam.hall_tickets (exam_id);
create index if not exists hall_tickets_student_idx on exam.hall_tickets (student_id);

-- 5. Attendance
create table if not exists exam.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  hall_ticket_id uuid references exam.hall_tickets (id) on delete set null,
  status text not null default 'present',
  entry_time timestamptz,
  exit_time timestamptz,
  remarks text,
  marked_by text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists attendance_exam_idx on exam.attendance (exam_id);

-- 6. Evaluations
create table if not exists exam.evaluations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  question_id uuid references exam.exam_questions (id) on delete set null,
  set_label text not null default 'A',
  marks_awarded numeric not null default 0,
  max_marks numeric not null default 0,
  evaluator_id uuid,
  evaluation_method text not null default 'manual',
  remarks text,
  evaluated_at timestamptz,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists evaluations_exam_idx on exam.evaluations (exam_id);
create index if not exists evaluations_student_idx on exam.evaluations (student_id);

-- 7. Exam Results
create table if not exists exam.exam_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  total_questions integer not null default 0,
  attempted_questions integer not null default 0,
  correct_answers integer not null default 0,
  incorrect_answers integer not null default 0,
  unanswered_questions integer not null default 0,
  score_obtained numeric not null default 0,
  max_score numeric not null default 0,
  percentage numeric,
  rank_in_batch integer,
  rank_in_school integer,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (exam_id, student_id)
);

create index if not exists exam_results_exam_idx on exam.exam_results (exam_id);

-- 8. Seating (per-student seat assignment for offline exams)
create table if not exists exam.seating (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  exam_id uuid not null references exam.exams (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  student_id uuid not null references public.students (id) on delete cascade,
  seat_number integer not null default 0,
  row_number integer,
  column_number integer,
  set_label text,
  invigilator_id uuid,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists seating_exam_idx on exam.seating (exam_id);

-- 9. Public views for PostgREST access

create or replace view public.exam_exams
  with (security_invoker = true)
  as select * from exam.exams;

create or replace view public.exam_exam_sections
  with (security_invoker = true)
  as select * from exam.exam_sections;

create or replace view public.exam_exam_questions
  with (security_invoker = true)
  as select * from exam.exam_questions;

create or replace view public.exam_hall_tickets
  with (security_invoker = true)
  as select * from exam.hall_tickets;

create or replace view public.exam_attendance
  with (security_invoker = true)
  as select * from exam.attendance;

create or replace view public.exam_evaluations
  with (security_invoker = true)
  as select * from exam.evaluations;

create or replace view public.exam_exam_results
  with (security_invoker = true)
  as select * from exam.exam_results;

create or replace view public.exam_seating
  with (security_invoker = true)
  as select * from exam.seating;

-- 10. Recreate the old seating plan views that were dropped
--     (these are used by supabase_seating.py for room/desk management)
--     We recreate them with empty tables so the old code doesn't break.

create table if not exists exam.room_desks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  row_no integer not null,
  col_no integer not null,
  x_position numeric(10,2),
  y_position numeric(10,2),
  is_reserved boolean not null default false,
  reservation_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (room_id, row_no, col_no)
);

create table if not exists exam.room_seats (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  desk_id uuid not null references exam.room_desks (id) on delete cascade,
  seat_number integer not null,
  seat_label text,
  is_blocked boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (desk_id, seat_number)
);

create or replace view public.exam_room_desks
  with (security_invoker = true)
  as select * from exam.room_desks;

create or replace view public.exam_room_seats
  with (security_invoker = true)
  as select * from exam.room_seats;

commit;
