-- ============================================================================
-- PRODUCTION_RECOVERY.sql
-- Idempotent, safe, transactional recovery script.
-- Repairs all confirmed missing objects between repository and production.
-- Can be run multiple times without side effects.
-- ============================================================================
-- Generated: 2026-07-03
-- Source: Production Schema Consistency Audit (PRODUCTION_SCHEMA_DIFF.md)
-- ============================================================================

begin;

-- ============================================================================
-- PART 1: Missing Public Tables
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1.1 public.platform_notifications
-- Defined in: 20260628_066_platform_control_plane.sql
--             20260703_067_ensure_platform_notifications.sql
-- Missing: Table, Index, Trigger
-- --------------------------------------------------------------------------

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  notification_type text not null,
  severity text not null default 'info',
  audience_scope text not null default 'school',
  school_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint platform_notifications_type_check check (
    notification_type in ('maintenance', 'subscription', 'system_alert', 'security_notice')
  ),
  constraint platform_notifications_severity_check check (
    severity in ('info', 'warning', 'critical')
  ),
  constraint platform_notifications_audience_scope_check check (
    audience_scope in ('school', 'multiple', 'all')
  )
);

create index if not exists platform_notifications_created_idx
  on public.platform_notifications (created_at desc);

drop trigger if exists set_updated_at_platform_notifications on public.platform_notifications;
create trigger set_updated_at_platform_notifications
before update on public.platform_notifications
for each row execute function public.set_updated_at();

-- ============================================================================
-- PART 2: Missing Public Views for Custom Schema Tables
-- These are created conditionally — only if the underlying tables exist.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 academic schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'guardians'
  ) then
    create or replace view public.academic_guardians
      with (security_invoker = true)
      as select * from academic.guardians;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'student_guardians'
  ) then
    create or replace view public.academic_student_guardians
      with (security_invoker = true)
      as select * from academic.student_guardians;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'staff_subject_assignments'
  ) then
    create or replace view public.academic_staff_subject_assignments
      with (security_invoker = true)
      as select * from academic.staff_subject_assignments;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'live_class_sessions'
  ) then
    create or replace view public.academic_live_class_sessions
      with (security_invoker = true)
      as select * from academic.live_class_sessions;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'live_class_attendance'
  ) then
    create or replace view public.academic_live_class_attendance
      with (security_invoker = true)
      as select * from academic.live_class_attendance;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'live_class_chat'
  ) then
    create or replace view public.academic_live_class_chat
      with (security_invoker = true)
      as select * from academic.live_class_chat;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'academic' and table_name = 'live_class_recordings'
  ) then
    create or replace view public.academic_live_class_recordings
      with (security_invoker = true)
      as select * from academic.live_class_recordings;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.2 attendance schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'settings'
  ) then
    create or replace view public.attendance_settings
      with (security_invoker = true)
      as select * from attendance.settings;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'holidays'
  ) then
    create or replace view public.attendance_holidays
      with (security_invoker = true)
      as select * from attendance.holidays;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'leave_requests'
  ) then
    create or replace view public.attendance_leave_requests
      with (security_invoker = true)
      as select * from attendance.leave_requests;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'student_attendance'
  ) then
    create or replace view public.attendance_student_attendance
      with (security_invoker = true)
      as select * from attendance.student_attendance;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'staff_attendance'
  ) then
    create or replace view public.attendance_staff_attendance
      with (security_invoker = true)
      as select * from attendance.staff_attendance;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'attendance' and table_name = 'notifications'
  ) then
    create or replace view public.attendance_notifications
      with (security_invoker = true)
      as select * from attendance.notifications;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.3 exam schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'room_desks'
  ) then
    create or replace view public.exam_room_desks
      with (security_invoker = true)
      as select * from exam.room_desks;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'room_seats'
  ) then
    create or replace view public.exam_room_seats
      with (security_invoker = true)
      as select * from exam.room_seats;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'exams'
  ) then
    create or replace view public.exam_exams
      with (security_invoker = true)
      as select * from exam.exams;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'exam_registrations'
  ) then
    create or replace view public.exam_exam_registrations
      with (security_invoker = true)
      as select * from exam.exam_registrations;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'seating_plans'
  ) then
    create or replace view public.exam_seating_plans
      with (security_invoker = true)
      as select * from exam.seating_plans;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'seating_assignments'
  ) then
    create or replace view public.exam_seating_assignments
      with (security_invoker = true)
      as select * from exam.seating_assignments;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'exam' and table_name = 'invigilator_assignments'
  ) then
    create or replace view public.exam_invigilator_assignments
      with (security_invoker = true)
      as select * from exam.invigilator_assignments;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.4 finance schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'fee_structures'
  ) then
    create or replace view public.finance_fee_structures
      with (security_invoker = true)
      as select * from finance.fee_structures;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'fee_assignments'
  ) then
    create or replace view public.finance_fee_assignments
      with (security_invoker = true)
      as select * from finance.fee_assignments;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'payments'
  ) then
    create or replace view public.finance_payments
      with (security_invoker = true)
      as select * from finance.payments;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'orders'
  ) then
    create or replace view public.finance_orders
      with (security_invoker = true)
      as select * from finance.orders;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'order_items'
  ) then
    create or replace view public.finance_order_items
      with (security_invoker = true)
      as select * from finance.order_items;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'invoices'
  ) then
    create or replace view public.finance_invoices
      with (security_invoker = true)
      as select * from finance.invoices;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'products'
  ) then
    create or replace view public.finance_products
      with (security_invoker = true)
      as select * from finance.products;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'subscriptions'
  ) then
    create or replace view public.finance_subscriptions
      with (security_invoker = true)
      as select * from finance.subscriptions;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'coupons'
  ) then
    create or replace view public.finance_coupons
      with (security_invoker = true)
      as select * from finance.coupons;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'affiliates'
  ) then
    create or replace view public.finance_affiliates
      with (security_invoker = true)
      as select * from finance.affiliates;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'referrals'
  ) then
    create or replace view public.finance_referrals
      with (security_invoker = true)
      as select * from finance.referrals;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'payouts'
  ) then
    create or replace view public.finance_payouts
      with (security_invoker = true)
      as select * from finance.payouts;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'payment_refunds'
  ) then
    create or replace view public.finance_payment_refunds
      with (security_invoker = true)
      as select * from finance.payment_refunds;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'payment_webhook_events'
  ) then
    create or replace view public.finance_payment_webhook_events
      with (security_invoker = true)
      as select * from finance.payment_webhook_events;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'finance' and table_name = 'payment_idempotency_keys'
  ) then
    create or replace view public.finance_payment_idempotency_keys
      with (security_invoker = true)
      as select * from finance.payment_idempotency_keys;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.5 hostel schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'hostel' and table_name = 'hostels'
  ) then
    create or replace view public.hostel_hostels
      with (security_invoker = true)
      as select * from hostel.hostels;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'hostel' and table_name = 'hostel_rooms'
  ) then
    create or replace view public.hostel_hostel_rooms
      with (security_invoker = true)
      as select * from hostel.hostel_rooms;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'hostel' and table_name = 'hostel_requests'
  ) then
    create or replace view public.hostel_hostel_requests
      with (security_invoker = true)
      as select * from hostel.hostel_requests;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'hostel' and table_name = 'hostel_allocations'
  ) then
    create or replace view public.hostel_hostel_allocations
      with (security_invoker = true)
      as select * from hostel.hostel_allocations;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.6 inventory schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'suppliers'
  ) then
    create or replace view public.inventory_suppliers
      with (security_invoker = true)
      as select * from inventory.suppliers;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'material_categories'
  ) then
    create or replace view public.inventory_material_categories
      with (security_invoker = true)
      as select * from inventory.material_categories;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'material_items'
  ) then
    create or replace view public.inventory_material_items
      with (security_invoker = true)
      as select * from inventory.material_items;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'stock_in_entries'
  ) then
    create or replace view public.inventory_stock_in_entries
      with (security_invoker = true)
      as select * from inventory.stock_in_entries;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'stock_out_entries'
  ) then
    create or replace view public.inventory_stock_out_entries
      with (security_invoker = true)
      as select * from inventory.stock_out_entries;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'inventory' and table_name = 'student_issue_entries'
  ) then
    create or replace view public.inventory_student_issue_entries
      with (security_invoker = true)
      as select * from inventory.student_issue_entries;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.7 scheduling schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'scheduling' and table_name = 'timetable_entries'
  ) then
    create or replace view public.scheduling_timetable_entries
      with (security_invoker = true)
      as select * from scheduling.timetable_entries;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'scheduling' and table_name = 'timetable_entry_batches'
  ) then
    create or replace view public.scheduling_timetable_entry_batches
      with (security_invoker = true)
      as select * from scheduling.timetable_entry_batches;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.8 workflow schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'workflow' and table_name = 'bulk_action_requests'
  ) then
    create or replace view public.workflow_bulk_action_requests
      with (security_invoker = true)
      as select * from workflow.bulk_action_requests;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'workflow' and table_name = 'bulk_action_events'
  ) then
    create or replace view public.workflow_bulk_action_events
      with (security_invoker = true)
      as select * from workflow.bulk_action_events;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.9 reporting schema public views
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'reporting' and table_name = 'generated_reports'
  ) then
    create or replace view public.reporting_generated_reports
      with (security_invoker = true)
      as select * from reporting.generated_reports;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2.10 warehouse schema public views (duplicates public.warehouse_* tables)
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'dim_course'
  ) then
    create or replace view public.warehouse_dim_course
      with (security_invoker = true)
      as select * from warehouse.dim_course;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'dim_date'
  ) then
    create or replace view public.warehouse_dim_date
      with (security_invoker = true)
      as select * from warehouse.dim_date;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'dim_school'
  ) then
    create or replace view public.warehouse_dim_school
      with (security_invoker = true)
      as select * from warehouse.dim_school;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'dim_staff'
  ) then
    create or replace view public.warehouse_dim_staff
      with (security_invoker = true)
      as select * from warehouse.dim_staff;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'dim_student'
  ) then
    create or replace view public.warehouse_dim_student
      with (security_invoker = true)
      as select * from warehouse.dim_student;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_attendance'
  ) then
    create or replace view public.warehouse_fact_attendance
      with (security_invoker = true)
      as select * from warehouse.fact_attendance;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_finance'
  ) then
    create or replace view public.warehouse_fact_finance
      with (security_invoker = true)
      as select * from warehouse.fact_finance;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_live_classes'
  ) then
    create or replace view public.warehouse_fact_live_classes
      with (security_invoker = true)
      as select * from warehouse.fact_live_classes;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_lms'
  ) then
    create or replace view public.warehouse_fact_lms
      with (security_invoker = true)
      as select * from warehouse.fact_lms;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_operations'
  ) then
    create or replace view public.warehouse_fact_operations
      with (security_invoker = true)
      as select * from warehouse.fact_operations;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_platform_usage'
  ) then
    create or replace view public.warehouse_fact_platform_usage
      with (security_invoker = true)
      as select * from warehouse.fact_platform_usage;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_students'
  ) then
    create or replace view public.warehouse_fact_students
      with (security_invoker = true)
      as select * from warehouse.fact_students;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'fact_tests'
  ) then
    create or replace view public.warehouse_fact_tests
      with (security_invoker = true)
      as select * from warehouse.fact_tests;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'report_definitions'
  ) then
    create or replace view public.warehouse_report_definitions
      with (security_invoker = true)
      as select * from warehouse.report_definitions;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'warehouse' and table_name = 'report_schedules'
  ) then
    create or replace view public.warehouse_report_schedules
      with (security_invoker = true)
      as select * from warehouse.report_schedules;
  end if;
end $$;

-- ============================================================================
-- PART 3: Ensure Critical Infrastructure Exists
-- ============================================================================

-- --------------------------------------------------------------------------
-- 3.1 set_updated_at() function (required by all triggers)
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ============================================================================
-- PART 4: Notify PostgREST to reload schema cache
-- ============================================================================

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Post-Apply Verification
-- ============================================================================
-- Run these checks after applying:
--
-- 1. Verify platform_notifications:
--    SELECT EXISTS (
--      SELECT 1 FROM information_schema.tables
--      WHERE table_schema = 'public' AND table_name = 'platform_notifications'
--    );
--
-- 2. Verify created views:
--    SELECT table_name FROM information_schema.views
--    WHERE table_schema = 'public'
--    ORDER BY table_name;
--
-- 3. Verify triggers:
--    SELECT trigger_name, event_object_table
--    FROM information_schema.triggers
--    WHERE trigger_schema = 'public'
--    ORDER BY event_object_table, trigger_name;
-- ============================================================================
