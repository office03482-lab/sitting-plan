begin;

create or replace function public.get_dashboard_metrics(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with
    core_counts as (
      select public.get_school_core_counts(p_school_id) as data
    ),
    attendance_overview as (
      select public.get_attendance_overview(p_school_id) as data
    ),
    inventory_summary as (
      select public.get_inventory_dashboard_summary(p_school_id) as data
    ),
    edupay_summary as (
      select public.get_edupay_dashboard_summary(p_school_id) as data
    ),
    batch_rows as (
      select id, name, class_name, section
      from public.batches
      where school_id = p_school_id and is_active = true
      order by name
    )
  select jsonb_build_object(
    'students_count', coalesce((core_counts.data->>'students_count')::int, 0),
    'teachers_count', coalesce((core_counts.data->>'teachers_count')::int, 0),
    'rooms_summary', coalesce(core_counts.data->'rooms_summary', '{}'::jsonb),
    'attendance_overview', coalesce(attendance_overview.data, '{}'::jsonb),
    'inventory_dashboard', coalesce(inventory_summary.data, '{}'::jsonb),
    'inventory_summary', coalesce(inventory_summary.data, '{}'::jsonb),
    'edupay_summary', coalesce(edupay_summary.data, '{}'::jsonb),
    'batch_options',
      coalesce(
        (select jsonb_agg(to_jsonb(batch_rows)) from batch_rows),
        '[]'::jsonb
      ),
    'subject_options', coalesce(attendance_overview.data->'subject_options', '[]'::jsonb)
  )
  from core_counts, attendance_overview, inventory_summary, edupay_summary;
$$;

commit;
