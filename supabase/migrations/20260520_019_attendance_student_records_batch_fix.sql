begin;

drop function if exists public.attendance_student_report_rows(uuid, text, text, text, date, date, integer, integer, jsonb);

create function public.attendance_student_report_rows(
  p_school_id uuid,
  p_class_name text default null,
  p_section text default null,
  p_student_name text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_skip integer default 0,
  p_limit integer default 100,
  p_batch_filters jsonb default null
)
returns table (
  id uuid,
  student_id uuid,
  student_name text,
  roll_no text,
  batch_id uuid,
  class_name text,
  section text,
  date timestamptz,
  subject_id uuid,
  subject_name text,
  status text,
  absence_reason text,
  marked_by text,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
set search_path = public, attendance
as $$
  with scoped_rows as (
    select
      sa.id,
      sa.student_id,
      s.full_name as student_name,
      coalesce(s.roll_number, '') as roll_no,
      s.batch_id,
      coalesce(nullif(trim(s.class_name), ''), 'General') as class_name,
      coalesce(nullif(trim(s.section), ''), 'A') as section,
      sa.attendance_date,
      sa.subject_id,
      subj.name as subject_name,
      sa.status,
      sa.absence_reason,
      coalesce(nullif(trim(sa.metadata ->> 'marked_by'), ''), 'System') as marked_by,
      sa.metadata,
      sa.created_at
    from attendance.student_attendance sa
    join public.students s
      on s.id = sa.student_id
     and s.school_id = sa.school_id
     and s.is_active = true
    left join public.subjects subj
      on subj.id = sa.subject_id
    where sa.school_id = p_school_id
      and (p_date_from is null or sa.attendance_date >= p_date_from)
      and (p_date_to is null or sa.attendance_date <= p_date_to)
      and (p_class_name is null or s.class_name = p_class_name)
      and (p_section is null or s.section = p_section)
      and (
        p_student_name is null
        or s.full_name ilike '%' || p_student_name || '%'
        or coalesce(s.roll_number, '') ilike '%' || p_student_name || '%'
        or coalesce(s.father_name, '') ilike '%' || p_student_name || '%'
      )
      and (
        p_batch_filters is null
        or jsonb_array_length(p_batch_filters) = 0
        or exists (
          select 1
          from jsonb_to_recordset(p_batch_filters) as bf(class_name text, section text)
          where s.class_name = bf.class_name
            and (bf.section is null or bf.section = '' or s.section = bf.section)
        )
      )
  )
  select
    scoped_rows.id,
    scoped_rows.student_id,
    scoped_rows.student_name,
    scoped_rows.roll_no,
    scoped_rows.batch_id,
    scoped_rows.class_name,
    scoped_rows.section,
    scoped_rows.attendance_date::timestamptz as date,
    scoped_rows.subject_id,
    coalesce(scoped_rows.subject_name, '') as subject_name,
    scoped_rows.status,
    scoped_rows.absence_reason,
    scoped_rows.marked_by,
    scoped_rows.metadata,
    scoped_rows.created_at
  from scoped_rows
  order by scoped_rows.attendance_date desc, scoped_rows.created_at desc, scoped_rows.id desc
  offset greatest(p_skip, 0)
  limit greatest(p_limit, 1);
$$;

comment on function public.attendance_student_report_rows(uuid, text, text, text, date, date, integer, integer, jsonb)
is 'Optimized attendance report reader with DB-side filtering, joins, pagination, and batch_id for Python-side batch name resolution.';

commit;
