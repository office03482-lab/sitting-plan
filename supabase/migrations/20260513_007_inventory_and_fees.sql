begin;

create schema if not exists inventory;
create schema if not exists finance;

create table if not exists inventory.suppliers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  supplier_code text,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists suppliers_school_supplier_code_key
  on inventory.suppliers (school_id, lower(supplier_code))
  where supplier_code is not null;

create index if not exists suppliers_school_active_idx
  on inventory.suppliers (school_id, is_active);

create table if not exists inventory.material_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  category_code text not null,
  name text not null,
  parent_category_id uuid references inventory.material_categories (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (school_id, category_code)
);

create table if not exists inventory.material_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  category_id uuid references inventory.material_categories (id) on delete set null,
  item_code text not null,
  name text not null,
  unit_type text not null default 'unit',
  subject_id uuid references public.subjects (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  class_name text,
  description text,
  low_stock_threshold integer not null default 10,
  current_stock integer not null default 0,
  unit_price numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint material_items_unit_type_check check (
    unit_type in ('book', 'copy', 'set', 'unit')
  )
);

create unique index if not exists material_items_school_item_code_key
  on inventory.material_items (school_id, lower(item_code));

create index if not exists material_items_school_active_idx
  on inventory.material_items (school_id, is_active);

create table if not exists inventory.stock_in_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  material_item_id uuid not null references inventory.material_items (id) on delete cascade,
  supplier_id uuid references inventory.suppliers (id) on delete set null,
  entry_date date not null,
  quantity_received integer not null,
  unit_price numeric(12,2) not null default 0,
  entry_type text not null default 'purchase',
  added_by_profile_id uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint stock_in_entries_quantity_check check (quantity_received > 0),
  constraint stock_in_entries_type_check check (
    entry_type in ('purchase', 'donation', 'return', 'adjustment')
  )
);

create index if not exists stock_in_entries_school_material_date_idx
  on inventory.stock_in_entries (school_id, material_item_id, entry_date);

create table if not exists inventory.stock_out_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  material_item_id uuid not null references inventory.material_items (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  issued_to_staff_member_id uuid references public.staff_members (id) on delete set null,
  entry_date date not null,
  quantity_issued integer not null,
  issued_by_profile_id uuid references public.profiles (id) on delete set null,
  remarks text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint stock_out_entries_quantity_check check (quantity_issued > 0)
);

create index if not exists stock_out_entries_school_material_date_idx
  on inventory.stock_out_entries (school_id, material_item_id, entry_date);

create table if not exists inventory.student_issue_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  material_item_id uuid not null references inventory.material_items (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  issue_date date not null,
  quantity_issued integer not null,
  issued_by_profile_id uuid references public.profiles (id) on delete set null,
  remarks text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint student_issue_entries_quantity_check check (quantity_issued > 0)
);

create index if not exists student_issue_entries_school_student_date_idx
  on inventory.student_issue_entries (school_id, student_id, issue_date);

create table if not exists finance.fee_structures (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  fee_code text not null,
  name text not null,
  fee_type text not null,
  class_name text,
  batch_id uuid references public.batches (id) on delete set null,
  installment_plan text not null default 'monthly',
  total_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  late_fee_rule text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fee_structures_installment_plan_check check (
    installment_plan in ('monthly', 'quarterly', 'yearly', 'custom')
  )
);

create unique index if not exists fee_structures_school_fee_code_key
  on finance.fee_structures (school_id, lower(fee_code));

create table if not exists finance.fee_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  fee_structure_id uuid not null references finance.fee_structures (id) on delete cascade,
  installment_label text not null,
  due_date date not null,
  amount_due numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  late_fee_applied numeric(12,2) not null default 0,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fee_assignments_status_check check (
    status in ('pending', 'partial', 'paid', 'overdue', 'cancelled')
  )
);

create index if not exists fee_assignments_school_student_status_idx
  on finance.fee_assignments (school_id, student_id, status);

create table if not exists finance.payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  fee_assignment_id uuid not null references finance.fee_assignments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  received_by_profile_id uuid references public.profiles (id) on delete set null,
  amount numeric(12,2) not null,
  payment_method text not null default 'upi',
  payment_date date not null,
  transaction_reference text,
  receipt_number text not null,
  verification_status text not null default 'pending',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payments_method_check check (
    payment_method in ('upi', 'cash', 'card', 'bank_transfer', 'wallet')
  ),
  constraint payments_verification_status_check check (
    verification_status in ('pending', 'verified', 'failed', 'reversed')
  )
);

create unique index if not exists payments_school_receipt_number_key
  on finance.payments (school_id, lower(receipt_number));

create index if not exists payments_school_student_date_idx
  on finance.payments (school_id, student_id, payment_date);

create trigger set_updated_at_suppliers
before update on inventory.suppliers
for each row
execute function public.set_updated_at();

create trigger set_updated_at_material_categories
before update on inventory.material_categories
for each row
execute function public.set_updated_at();

create trigger set_updated_at_material_items
before update on inventory.material_items
for each row
execute function public.set_updated_at();

create trigger set_updated_at_stock_in_entries
before update on inventory.stock_in_entries
for each row
execute function public.set_updated_at();

create trigger set_updated_at_stock_out_entries
before update on inventory.stock_out_entries
for each row
execute function public.set_updated_at();

create trigger set_updated_at_student_issue_entries
before update on inventory.student_issue_entries
for each row
execute function public.set_updated_at();

create trigger set_updated_at_fee_structures
before update on finance.fee_structures
for each row
execute function public.set_updated_at();

create trigger set_updated_at_fee_assignments
before update on finance.fee_assignments
for each row
execute function public.set_updated_at();

create trigger set_updated_at_payments
before update on finance.payments
for each row
execute function public.set_updated_at();

alter table inventory.suppliers enable row level security;
alter table inventory.material_categories enable row level security;
alter table inventory.material_items enable row level security;
alter table inventory.stock_in_entries enable row level security;
alter table inventory.stock_out_entries enable row level security;
alter table inventory.student_issue_entries enable row level security;
alter table finance.fee_structures enable row level security;
alter table finance.fee_assignments enable row level security;
alter table finance.payments enable row level security;

create policy suppliers_scope
on inventory.suppliers
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.suppliers')
);

create policy material_categories_scope
on inventory.material_categories
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.materials')
);

create policy material_items_scope
on inventory.material_items
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.materials')
);

create policy stock_in_entries_scope
on inventory.stock_in_entries
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.stock_in')
);

create policy stock_out_entries_scope
on inventory.stock_out_entries
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.stock_out')
);

create policy student_issue_entries_scope
on inventory.student_issue_entries
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'inventory.stock_out')
);

create policy fee_structures_scope
on finance.fee_structures
for all
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.fees')
);

create policy fee_assignments_select_scope
on finance.fee_assignments
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.students s
    where s.id = fee_assignments.student_id
      and s.profile_id = auth.uid()
  )
);

create policy fee_assignments_manage_scope
on finance.fee_assignments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.students')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.students')
);

create policy payments_select_scope
on finance.payments
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1 from public.students s
    where s.id = payments.student_id
      and s.profile_id = auth.uid()
  )
);

create policy payments_manage_scope
on finance.payments
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'edupay.payments')
);

commit;
