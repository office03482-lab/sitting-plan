begin;

create index if not exists idx_students_school_active
  on public.students (school_id, is_active);

create index if not exists idx_staff_members_school_type_active
  on public.staff_members (school_id, staff_type, is_active);

create index if not exists idx_staff_members_school_active
  on public.staff_members (school_id, is_active);

create index if not exists idx_rooms_school_active
  on public.rooms (school_id, is_active);

create index if not exists idx_batches_school_active
  on public.batches (school_id, is_active);

create index if not exists idx_subjects_school_active
  on public.subjects (school_id, is_active);

create index if not exists idx_attendance_notifications_school_active_created
  on attendance.notifications (school_id, is_active, created_at desc);

create index if not exists idx_attendance_holidays_school_active_date
  on attendance.holidays (school_id, is_active, holiday_date);

create index if not exists idx_attendance_settings_school_active
  on attendance.settings (school_id, is_active);

create index if not exists idx_inventory_material_items_school_active
  on inventory.material_items (school_id, is_active);

create index if not exists idx_inventory_stock_in_school
  on inventory.stock_in_entries (school_id);

create index if not exists idx_inventory_stock_out_school
  on inventory.stock_out_entries (school_id);

create index if not exists idx_inventory_student_issue_school
  on inventory.student_issue_entries (school_id);

create index if not exists idx_finance_fee_structures_school_active
  on finance.fee_structures (school_id, is_active);

create index if not exists idx_finance_fee_assignments_school
  on finance.fee_assignments (school_id);

create index if not exists idx_finance_payments_school_date
  on finance.payments (school_id, payment_date desc, created_at desc);

create or replace function public.get_school_core_counts(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'students_count',
      (
        select count(*)::int
        from public.students
        where school_id = p_school_id and is_active = true
      ),
    'teachers_count',
      (
        select count(*)::int
        from public.staff_members
        where school_id = p_school_id
          and staff_type = 'teaching'
          and is_active = true
      ),
    'staff_count',
      (
        select count(*)::int
        from public.staff_members
        where school_id = p_school_id and is_active = true
      ),
    'rooms_summary',
      (
        select jsonb_build_object(
          'count', count(*)::int,
          'totalCapacity', coalesce(sum(capacity), 0)::int
        )
        from public.rooms
        where school_id = p_school_id and is_active = true
      )
  );
$$;

create or replace function public.get_attendance_overview(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with batch_rows as (
    select name, class_name, section
    from public.batches
    where school_id = p_school_id and is_active = true
  ),
  notification_rows as (
    select id, school_id, profile_id, title, message, notification_type, is_read, created_at
    from attendance.notifications
    where school_id = p_school_id and is_active = true
    order by created_at desc
    limit 8
  ),
  holiday_rows as (
    select id, school_id, title, holiday_date, description, is_active, created_at
    from attendance.holidays
    where school_id = p_school_id and is_active = true
    order by holiday_date
  ),
  subject_rows as (
    select id, school_id, name, class_name, batch_id, is_active, created_at, updated_at, metadata
    from public.subjects
    where school_id = p_school_id and is_active = true
    order by class_name, name
  )
  select jsonb_build_object(
    'student_count',
      (
        select count(*)::int
        from public.students
        where school_id = p_school_id and is_active = true
      ),
    'staff_count',
      (
        select count(*)::int
        from public.staff_members
        where school_id = p_school_id and is_active = true
      ),
    'class_options',
      coalesce(
        (
          select jsonb_agg(class_name order by class_name)
          from (
            select distinct nullif(trim(class_name), '') as class_name
            from batch_rows
          ) classes
          where class_name is not null
        ),
        '[]'::jsonb
      ),
    'section_options',
      coalesce(
        (
          select jsonb_agg(section order by section)
          from (
            select distinct nullif(trim(section), '') as section
            from batch_rows
          ) sections
          where section is not null
        ),
        '[]'::jsonb
      ),
    'subject_options',
      coalesce((select jsonb_agg(to_jsonb(subject_rows)) from subject_rows), '[]'::jsonb),
    'department_options',
      coalesce(
        (
          select jsonb_agg(option_value order by option_value)
          from (
            select distinct coalesce(nullif(trim(department), ''), nullif(trim(designation), '')) as option_value
            from public.staff_members
            where school_id = p_school_id and is_active = true
          ) department_values
          where option_value is not null
        ),
        '[]'::jsonb
      ),
    'notifications',
      coalesce((select jsonb_agg(to_jsonb(notification_rows)) from notification_rows), '[]'::jsonb),
    'holidays',
      coalesce((select jsonb_agg(to_jsonb(holiday_rows)) from holiday_rows), '[]'::jsonb),
    'settings',
      coalesce(
        (
          select to_jsonb(settings_row)
          from (
            select
              minimum_attendance_threshold,
              working_hours_start,
              working_hours_end,
              updated_at
            from attendance.settings
            where school_id = p_school_id and is_active = true
            limit 1
          ) settings_row
        ),
        jsonb_build_object(
          'minimum_attendance_threshold', 75.0,
          'working_hours_start', '09:00:00',
          'working_hours_end', '17:00:00'
        )
      )
  );
$$;

create or replace function public.get_inventory_dashboard_summary(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with materials as (
    select *
    from inventory.material_items
    where school_id = p_school_id
  ),
  low_stock as (
    select *
    from inventory.material_items
    where school_id = p_school_id
      and is_active = true
      and current_stock <= low_stock_threshold
    order by name
    limit 20
  )
  select jsonb_build_object(
    'total_materials_registered', (select count(*)::int from materials),
    'total_books_in_inventory',
      (
        select coalesce(sum(quantity_received), 0)::int
        from inventory.stock_in_entries
        where school_id = p_school_id
      ),
    'total_books_distributed',
      (
        select coalesce(sum(quantity_issued), 0)::int
        from (
          select quantity_issued from inventory.stock_out_entries where school_id = p_school_id
          union all
          select quantity_issued from inventory.student_issue_entries where school_id = p_school_id
        ) issued
      ),
    'current_stock_available',
      (
        select coalesce(sum(current_stock), 0)::int
        from materials
      ),
    'low_stock_alert_count',
      (
        select count(*)::int
        from materials
        where is_active = true and current_stock <= low_stock_threshold
      ),
    'low_stock_items',
      coalesce((select jsonb_agg(to_jsonb(low_stock)) from low_stock), '[]'::jsonb)
  );
$$;

create or replace function public.get_edupay_dashboard_summary(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with assignment_rows as (
    select *
    from finance.fee_assignments
    where school_id = p_school_id
  ),
  payment_rows as (
    select *
    from finance.payments
    where school_id = p_school_id
  ),
  recent_payments as (
    select *
    from finance.payments
    where school_id = p_school_id
    order by payment_date desc, created_at desc
    limit 5
  )
  select jsonb_build_object(
    'total_collected',
      round(coalesce((select sum(amount)::numeric from payment_rows), 0), 2),
    'pending_amount',
      round(
        coalesce(
          (
            select sum(greatest(coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0), 0))::numeric
            from assignment_rows
            where coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0) > 0
              and (due_date is null or due_date >= current_date)
          ),
          0
        ),
        2
      ),
    'overdue_amount',
      round(
        coalesce(
          (
            select sum(greatest(coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0), 0))::numeric
            from assignment_rows
            where coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0) > 0
              and due_date < current_date
          ),
          0
        ),
        2
      ),
    'upcoming_dues',
      (
        select count(*)::int
        from assignment_rows
        where coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0) > 0
          and due_date between current_date and (current_date + interval '15 day')
      ),
    'total_students',
      (
        select count(*)::int
        from public.students
        where school_id = p_school_id and is_active = true
      ),
    'active_fee_structures',
      (
        select count(*)::int
        from finance.fee_structures
        where school_id = p_school_id and is_active = true
      ),
    'reminders_queued',
      (
        select least(count(*), 3)::int
        from assignment_rows
        where coalesce(amount_due, 0) + coalesce(late_fee_applied, 0) - coalesce(amount_paid, 0) > 0
      ),
    'recent_payments',
      coalesce((select jsonb_agg(to_jsonb(recent_payments)) from recent_payments), '[]'::jsonb)
  );
$$;

create or replace function public.get_dashboard_metrics(p_school_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'students_count', (public.get_school_core_counts(p_school_id)->>'students_count')::int,
    'teachers_count', (public.get_school_core_counts(p_school_id)->>'teachers_count')::int,
    'rooms_summary', public.get_school_core_counts(p_school_id)->'rooms_summary',
    'attendance_overview', public.get_attendance_overview(p_school_id),
    'inventory_dashboard', public.get_inventory_dashboard_summary(p_school_id),
    'inventory_summary', public.get_inventory_dashboard_summary(p_school_id),
    'edupay_summary', public.get_edupay_dashboard_summary(p_school_id),
    'batch_options',
      coalesce(
        (
          select jsonb_agg(to_jsonb(batch_rows))
          from (
            select id, name, class_name, section
            from public.batches
            where school_id = p_school_id and is_active = true
            order by name
          ) batch_rows
        ),
        '[]'::jsonb
      ),
    'subject_options', public.get_attendance_overview(p_school_id)->'subject_options'
  );
$$;

commit;
