begin;

create or replace function public.attendance_student_dashboard_summary(
  p_school_id uuid,
  p_date date default null,
  p_class_name text default null,
  p_batch_name text default null,
  p_scope text default null
)
returns table (
  present_count bigint,
  absent_count bigint,
  late_count bigint,
  total_count bigint,
  class_summary jsonb,
  batch_summary jsonb,
  date_summary jsonb
)
language sql
stable
set search_path = public, attendance
as $$
  with base_rows as (
    select
      sa.status,
      sa.attendance_date::date as attendance_date,
      coalesce(nullif(trim(coalesce(sa.metadata ->> 'class_name', s.class_name)), ''), '') as effective_class_name,
      coalesce(nullif(trim(coalesce(sa.metadata ->> 'section', s.section)), ''), '') as effective_section,
      s.batch_id,
      nullif(trim(b.name), '') as student_batch_name
    from attendance.student_attendance sa
    join public.students s
      on s.id = sa.student_id
     and s.school_id = sa.school_id
     and s.is_active = true
    left join public.batches b
      on b.id = s.batch_id
     and b.school_id = sa.school_id
     and b.is_active = true
    where sa.school_id = p_school_id
      and (p_date is null or sa.attendance_date = p_date)
  ),
  enriched_rows as (
    select
      br.status,
      br.attendance_date,
      br.effective_class_name,
      br.effective_section,
      trim(concat_ws(' | ', br.effective_class_name, br.effective_section)) as class_label,
      coalesce(
        br.student_batch_name,
        derived_batch.batch_name,
        trim(concat_ws(' | ', br.effective_class_name, br.effective_section))
      ) as effective_batch_name
    from base_rows br
    left join lateral (
      select nullif(trim(b2.name), '') as batch_name
      from public.batches b2
      where b2.school_id = p_school_id
        and b2.is_active = true
        and nullif(trim(b2.class_name), '') = br.effective_class_name
        and (
          br.effective_section = ''
          or nullif(trim(b2.section), '') = br.effective_section
        )
      order by
        case when br.batch_id is not null and b2.id = br.batch_id then 0 else 1 end,
        b2.name
      limit 1
    ) as derived_batch on true
  ),
  filtered_rows as (
    select *
    from enriched_rows er
    where
      (
        coalesce(p_scope, '') = 'batch'
        and (
          p_batch_name is null
          or er.effective_batch_name = p_batch_name
          or er.class_label = p_batch_name
        )
      )
      or (
        coalesce(p_scope, '') = 'class'
        and (
          p_class_name is null
          or er.effective_class_name = p_class_name
        )
      )
      or (
        coalesce(p_scope, '') not in ('batch', 'class')
        and (p_class_name is null or er.effective_class_name = p_class_name)
        and (
          p_batch_name is null
          or er.effective_batch_name = p_batch_name
          or er.class_label = p_batch_name
        )
      )
  ),
  totals as (
    select
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) as total_count
    from filtered_rows
  ),
  class_totals as (
    select
      effective_class_name as class_name,
      effective_section as section,
      class_label,
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) as total_count
    from filtered_rows
    group by effective_class_name, effective_section, class_label
  ),
  batch_totals as (
    select
      effective_batch_name as batch_name,
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) as total_count
    from filtered_rows
    group by effective_batch_name
  ),
  date_totals as (
    select
      attendance_date,
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) as total_count
    from filtered_rows
    group by attendance_date
  )
  select
    coalesce(totals.present_count, 0) as present_count,
    coalesce(totals.absent_count, 0) as absent_count,
    coalesce(totals.late_count, 0) as late_count,
    coalesce(totals.total_count, 0) as total_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'label', class_totals.class_label,
            'class_name', class_totals.class_name,
            'section', class_totals.section,
            'present', coalesce(class_totals.present_count, 0),
            'absent', coalesce(class_totals.absent_count, 0),
            'late', coalesce(class_totals.late_count, 0),
            'total', coalesce(class_totals.total_count, 0)
          )
          order by class_totals.class_label
        )
        from class_totals
      ),
      '[]'::jsonb
    ) as class_summary,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'label', batch_totals.batch_name,
            'batch_name', batch_totals.batch_name,
            'present', coalesce(batch_totals.present_count, 0),
            'absent', coalesce(batch_totals.absent_count, 0),
            'late', coalesce(batch_totals.late_count, 0),
            'total', coalesce(batch_totals.total_count, 0)
          )
          order by batch_totals.batch_name
        )
        from batch_totals
      ),
      '[]'::jsonb
    ) as batch_summary,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date', date_totals.attendance_date,
            'present', coalesce(date_totals.present_count, 0),
            'absent', coalesce(date_totals.absent_count, 0),
            'late', coalesce(date_totals.late_count, 0),
            'total', coalesce(date_totals.total_count, 0)
          )
          order by date_totals.attendance_date
        )
        from date_totals
      ),
      '[]'::jsonb
    ) as date_summary
  from totals;
$$;

comment on function public.attendance_student_dashboard_summary(uuid, date, text, text, text)
is 'Student attendance dashboard summary aggregated directly from attendance.student_attendance with SQL-side totals for overall, class, batch, and date views.';

commit;
