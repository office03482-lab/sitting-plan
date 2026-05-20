begin;

create index if not exists idx_staff_attendance_school_staff_date_status
on attendance.staff_attendance (school_id, staff_member_id, attendance_date desc, status);

create index if not exists idx_staff_members_school_active_name
on public.staff_members (school_id, is_active, full_name);

create index if not exists idx_staff_members_school_active_department_designation
on public.staff_members (school_id, is_active, department, designation);

create index if not exists idx_students_school_active_created
on public.students (school_id, is_active, created_at desc);

create or replace function public.attendance_staff_dashboard_summary(
  p_school_id uuid,
  p_department text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  present_count bigint,
  absent_count bigint,
  late_count bigint,
  half_day_count bigint,
  total_count bigint,
  department_summary jsonb
)
language sql
stable
set search_path = public, attendance
as $$
  with filtered_rows as (
    select
      sa.status,
      coalesce(nullif(trim(sm.department), ''), nullif(trim(sm.designation), ''), 'General') as department
    from attendance.staff_attendance sa
    join public.staff_members sm
      on sm.id = sa.staff_member_id
     and sm.school_id = sa.school_id
     and sm.is_active = true
    where sa.school_id = p_school_id
      and (p_date_from is null or sa.attendance_date >= p_date_from)
      and (p_date_to is null or sa.attendance_date <= p_date_to)
      and (
        p_department is null
        or sm.department ilike '%' || p_department || '%'
        or coalesce(sm.designation, '') ilike '%' || p_department || '%'
      )
  ),
  totals as (
    select
      count(*) as total_count,
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) filter (where status = 'half_day') as half_day_count
    from filtered_rows
  ),
  department_totals as (
    select
      department,
      count(*) filter (where status = 'present') as present_count,
      count(*) filter (where status = 'absent') as absent_count,
      count(*) filter (where status = 'late') as late_count,
      count(*) filter (where status = 'half_day') as half_day_count
    from filtered_rows
    group by department
  )
  select
    coalesce(totals.present_count, 0) as present_count,
    coalesce(totals.absent_count, 0) as absent_count,
    coalesce(totals.late_count, 0) as late_count,
    coalesce(totals.half_day_count, 0) as half_day_count,
    coalesce(totals.total_count, 0) as total_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'department', department_totals.department,
            'present', coalesce(department_totals.present_count, 0),
            'absent', coalesce(department_totals.absent_count, 0),
            'late', coalesce(department_totals.late_count, 0),
            'half_day', coalesce(department_totals.half_day_count, 0)
          )
          order by department_totals.department
        )
        from department_totals
      ),
      '[]'::jsonb
    ) as department_summary
  from totals;
$$;

comment on function public.attendance_staff_dashboard_summary(uuid, text, date, date)
is 'Optimized staff dashboard summary with SQL-side aggregation to avoid wide staff roster scans and giant PostgREST IN filters.';

analyze attendance.staff_attendance;
analyze public.staff_members;
analyze public.students;

commit;
