-- Dashboard performance: missing indexes + combined RPC function.
-- Target: first render < 2s instead of 8-27s.

begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Missing indexes
-- ══════════════════════════════════════════════════════════════════════════════

-- rooms summary: query filters on (school_id, is_active)
create index if not exists idx_rooms_school_active
  on public.rooms (school_id, is_active);

-- attendance holidays: query filters on (school_id, is_active) ORDER BY holiday_date
-- Existing index has is_active *third*, making it useless for is_active filter.
drop index if exists attendance_attendance_holidays_school_date_idx;
create index if not exists idx_attendance_holidays_school_active_date
  on attendance.holidays (school_id, is_active, holiday_date);

-- staff_members department query: no staff_type filter, only (school_id, is_active)
create index if not exists idx_staff_members_school_active
  on public.staff_members (school_id, is_active);

-- inventory stock movement sum queries: only filter on school_id
create index if not exists idx_stock_in_school
  on inventory.stock_in_entries (school_id);
create index if not exists idx_stock_out_school
  on inventory.stock_out_entries (school_id);
create index if not exists idx_student_issue_school
  on inventory.student_issue_entries (school_id);

-- material_items: covering index for low-stock dashboard query
-- Filters: school_id, is_active=true, current_stock <= low_stock_threshold
create index if not exists idx_material_items_school_active_stock
  on inventory.material_items (school_id, is_active, current_stock, low_stock_threshold);

-- subjects: index for list_subjects query (school_id, is_active)
create index if not exists idx_subjects_school_active
  on public.subjects (school_id, is_active);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: get_dashboard_metrics — returns everything in ONE database call
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_dashboard_metrics(p_school_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  result json;
begin
  select json_build_object(
    'students_count', (
      select count(*)::int
      from public.students
      where school_id = p_school_id and is_active = true
    ),
    'teachers_count', (
      select count(*)::int
      from public.staff_members
      where school_id = p_school_id and staff_type = 'teaching' and is_active = true
    ),
    'rooms_summary', (
      select json_build_object(
        'count', count(*)::int,
        'totalCapacity', coalesce(sum(capacity), 0)::int
      )
      from public.rooms
      where school_id = p_school_id and is_active = true
    ),
    'attendance_overview', (
      select json_build_object(
        'student_count', (select count(*)::int from public.students where school_id = p_school_id and is_active = true),
        'staff_count', (select count(*)::int from public.staff_members where school_id = p_school_id and is_active = true),
        'class_options', (
          select coalesce(json_agg(distinct b.class_name order by b.class_name), '[]'::json)
          from public.batches b
          where b.school_id = p_school_id and b.is_active = true and b.class_name is not null
        ),
        'section_options', (
          select coalesce(json_agg(distinct b.section order by b.section), '[]'::json)
          from public.batches b
          where b.school_id = p_school_id and b.is_active = true and b.section is not null
        ),
        'notifications', (
          select coalesce(json_agg(row_to_json(n) order by n.created_at desc), '[]'::json)
          from (
            select id, school_id, profile_id, title, message, notification_type, is_read, created_at
            from attendance.notifications
            where school_id = p_school_id and is_active = true
            order by created_at desc
            limit 8
          ) n
        ),
        'holidays', (
          select coalesce(json_agg(row_to_json(h) order by h.holiday_date), '[]'::json)
          from (
            select id, school_id, title, holiday_date, description, is_active, created_at
            from attendance.holidays
            where school_id = p_school_id and is_active = true
            order by holiday_date
          ) h
        ),
        'settings', (
          select coalesce(
            row_to_json(s),
            json_build_object(
              'minimum_attendance_threshold', 75.0,
              'working_hours_start', '09:00',
              'working_hours_end', '17:00'
            )
          )
          from (
            select
              minimum_attendance_threshold,
              working_hours_start::text,
              working_hours_end::text,
              updated_at
            from attendance.settings
            where school_id = p_school_id and is_active = true
            limit 1
          ) s
        ),
        'department_options', (
          select coalesce(json_agg(distinct d order by d), '[]'::json)
          from (
            select coalesce(nullif(trim(department), ''), nullif(trim(designation), '')) as d
            from public.staff_members
            where school_id = p_school_id and is_active = true
          ) sub
          where d is not null
        )
      )
    ),
    'inventory_dashboard', (
      select json_build_object(
        'total_materials_registered', count(*)::int,
        'current_stock_available', coalesce(sum(current_stock), 0)::int,
        'low_stock_alert_count', count(*) filter (
          where is_active = true and current_stock <= low_stock_threshold
        )::int,
        'total_books_in_inventory', (
          select coalesce(sum(quantity_received), 0)::int
          from inventory.stock_in_entries
          where school_id = p_school_id
        ),
        'total_books_distributed', (
          select coalesce(sum(quantity_issued), 0)::int
          from (
            select quantity_issued from inventory.stock_out_entries where school_id = p_school_id
            union all
            select quantity_issued from inventory.student_issue_entries where school_id = p_school_id
          ) sub
        ),
        'low_stock_items', (
          select coalesce(json_agg(m order by m.name), '[]'::json)
          from (
            select
              id, name, school_id, subject_id, current_stock, low_stock_threshold,
              unit_price, unit_type, description, is_active, created_at, updated_at,
              metadata, category_id, item_code, class_name
            from inventory.material_items
            where school_id = p_school_id
              and is_active = true
              and current_stock <= low_stock_threshold
            order by name
            limit 20
          ) m
        )
      )
      from inventory.material_items
      where school_id = p_school_id
    ),
    'batch_options', (
      select coalesce(json_agg(row_to_json(b) order by b.name), '[]'::json)
      from (
        select id, name, class_name, section
        from public.batches
        where school_id = p_school_id and is_active = true
        order by name
      ) b
    ),
    'subject_options', (
      select coalesce(json_agg(row_to_json(s) order by s.class_name, s.name), '[]'::json)
      from (
        select id, school_id, name, class_name, is_active, created_at, updated_at
        from public.subjects
        where school_id = p_school_id and is_active = true
        order by class_name, name
      ) s
    )
  ) into result;
  return result;
end;
$$;

commit;
