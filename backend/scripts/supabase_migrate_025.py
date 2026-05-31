#!/usr/bin/env python3
"""
Supabase migration runner for 20260531_025_dashboard_performance.sql.

Usage:
    # Option 1: Run via Supabase Dashboard SQL Editor (recommended):
    #   1. Open https://supabase.com/dashboard/project/fdmbpzknpwobpzrpjtor/sql/new
    #   2. Paste the contents of this file's SQL (or the original migration file)
    #   3. Run

    # Option 2: Run via direct Postgres connection (requires DATABASE_URL):
    python backend/scripts/supabase_migrate_025.py

    # Option 3: Just print the SQL to stdout:
    python backend/scripts/supabase_migrate_025.py --print
"""

import argparse
import os
import sys

_MIGRATION_SQL = r"""

begin;

-- rooms summary: query filters on (school_id, is_active)
create index if not exists idx_rooms_school_active
  on public.rooms (school_id, is_active);

-- attendance holidays: query filters on (school_id, is_active) ORDER BY holiday_date
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
create index if not exists idx_material_items_school_active_stock
  on inventory.material_items (school_id, is_active, current_stock, low_stock_threshold);

-- subjects: index for list_subjects query (school_id, is_active)
create index if not exists idx_subjects_school_active
  on public.subjects (school_id, is_active);

-- RPC: get_dashboard_metrics — returns everything in ONE database call
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

"""


def main():
    parser = argparse.ArgumentParser(description="Apply Supabase migration 025 (dashboard performance)")
    parser.add_argument("--print", action="store_true", help="Only print SQL to stdout, don't execute")
    parser.add_argument("--database-url", help="PostgreSQL connection URL (default: from DATABASE_URL env)")
    args = parser.parse_args()

    if args.print:
        print("-- Supabase Migration: 20260531_025_dashboard_performance")
        print("-- Copy and paste this into Supabase Dashboard SQL Editor")
        print(_MIGRATION_SQL)
        return 0

    database_url = args.database_url or os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        print("ERROR: No database URL provided. Set DATABASE_URL or SUPABASE_DATABASE_URL env var.")
        print("")
        print("Alternatively, run with --print to output SQL for manual execution.")
        print("")
        print("To get your Supabase database URL:")
        print("  1. Go to https://supabase.com/dashboard/project/fdmbpzknpwobpzrpjtor/settings/database")
        print("  2. Copy the Connection string under 'Connection pooling' / 'URI'")
        print("  3. Set it as: $env:DATABASE_URL = 'postgresql://...'")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 is required for direct execution. Install with: pip install psycopg2-binary")
        return 1

    print(f"Connecting to database...")
    conn = psycopg2.connect(database_url, connect_timeout=10)
    conn.autocommit = True
    cur = conn.cursor()

    print("Applying migration...")
    cur.execute(_MIGRATION_SQL)
    print("Migration applied successfully!")

    # Verify indexes
    print("\nVerifying indexes...")
    cur.execute("""
        SELECT indexname, tablename, schemaname
        FROM pg_indexes
        WHERE indexname IN (
            'idx_rooms_school_active',
            'idx_attendance_holidays_school_active_date',
            'idx_staff_members_school_active',
            'idx_stock_in_school',
            'idx_stock_out_school',
            'idx_student_issue_school',
            'idx_material_items_school_active_stock',
            'idx_subjects_school_active'
        )
        ORDER BY indexname
    """)
    for row in cur.fetchall():
        print(f"  ✅ {row.schemaname}.{row.tablename}.{row.indexname}")

    # Verify RPC
    cur.execute("""
        SELECT proname, proargnames, prosrc::varchar(80)
        FROM pg_proc
        WHERE proname = 'get_dashboard_metrics' AND pronamespace = 'public'::regnamespace
    """)
    if cur.fetchone():
        print("  ✅ public.get_dashboard_metrics(p_school_id uuid)")
    else:
        print("  ❌ public.get_dashboard_metrics RPC NOT FOUND")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
