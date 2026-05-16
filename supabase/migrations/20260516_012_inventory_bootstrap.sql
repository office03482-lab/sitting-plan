begin;

create schema if not exists inventory;

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

alter table inventory.suppliers
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table inventory.material_categories
  add column if not exists parent_category_id uuid references inventory.material_categories (id) on delete set null,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table inventory.material_items
  add column if not exists category_id uuid references inventory.material_categories (id) on delete set null,
  add column if not exists unit_type text not null default 'unit',
  add column if not exists subject_id uuid references public.subjects (id) on delete set null,
  add column if not exists batch_id uuid references public.batches (id) on delete set null,
  add column if not exists class_name text,
  add column if not exists description text,
  add column if not exists low_stock_threshold integer not null default 10,
  add column if not exists current_stock integer not null default 0,
  add column if not exists unit_price numeric(12,2) not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table inventory.stock_in_entries
  add column if not exists unit_price numeric(12,2) not null default 0,
  add column if not exists entry_type text not null default 'purchase',
  add column if not exists added_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table inventory.stock_out_entries
  add column if not exists batch_id uuid references public.batches (id) on delete set null,
  add column if not exists issued_to_staff_member_id uuid references public.staff_members (id) on delete set null,
  add column if not exists issued_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists remarks text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table inventory.student_issue_entries
  add column if not exists batch_id uuid references public.batches (id) on delete set null,
  add column if not exists issued_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists remarks text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists suppliers_school_supplier_code_key
  on inventory.suppliers (school_id, lower(supplier_code))
  where supplier_code is not null;

create index if not exists suppliers_school_active_idx
  on inventory.suppliers (school_id, is_active);

create index if not exists material_categories_school_parent_active_idx
  on inventory.material_categories (school_id, parent_category_id, is_active, name);

create unique index if not exists material_items_school_item_code_key
  on inventory.material_items (school_id, lower(item_code));

create index if not exists material_items_school_active_idx
  on inventory.material_items (school_id, is_active);

create index if not exists material_items_school_category_idx
  on inventory.material_items (school_id, category_id, is_active);

create index if not exists stock_in_entries_school_material_date_idx
  on inventory.stock_in_entries (school_id, material_item_id, entry_date);

create index if not exists stock_in_entries_school_supplier_date_idx
  on inventory.stock_in_entries (school_id, supplier_id, entry_date);

create index if not exists stock_out_entries_school_material_date_idx
  on inventory.stock_out_entries (school_id, material_item_id, entry_date);

create index if not exists stock_out_entries_school_batch_date_idx
  on inventory.stock_out_entries (school_id, batch_id, entry_date);

create index if not exists student_issue_entries_school_student_date_idx
  on inventory.student_issue_entries (school_id, student_id, issue_date);

create index if not exists student_issue_entries_school_batch_date_idx
  on inventory.student_issue_entries (school_id, batch_id, issue_date);

create or replace function inventory.recalculate_material_current_stock(
  p_school_id uuid,
  p_material_item_id uuid default null
)
returns void
language sql
as $$
  update inventory.material_items as material
  set current_stock = greatest(
    0,
    coalesce(stock_in.total_in, 0)
    - coalesce(stock_out.total_out, 0)
    - coalesce(student_issue.total_issue, 0)
  )
  from (
    select item.id
    from inventory.material_items item
    where item.school_id = p_school_id
      and (p_material_item_id is null or item.id = p_material_item_id)
  ) as scope
  left join (
    select material_item_id, sum(quantity_received)::integer as total_in
    from inventory.stock_in_entries
    where school_id = p_school_id
      and (p_material_item_id is null or material_item_id = p_material_item_id)
    group by material_item_id
  ) as stock_in
    on stock_in.material_item_id = scope.id
  left join (
    select material_item_id, sum(quantity_issued)::integer as total_out
    from inventory.stock_out_entries
    where school_id = p_school_id
      and (p_material_item_id is null or material_item_id = p_material_item_id)
    group by material_item_id
  ) as stock_out
    on stock_out.material_item_id = scope.id
  left join (
    select material_item_id, sum(quantity_issued)::integer as total_issue
    from inventory.student_issue_entries
    where school_id = p_school_id
      and (p_material_item_id is null or material_item_id = p_material_item_id)
    group by material_item_id
  ) as student_issue
    on student_issue.material_item_id = scope.id
  where material.id = scope.id;
$$;

create or replace function inventory.sync_material_stock_on_entry_change()
returns trigger
language plpgsql
as $$
declare
  v_school_id uuid;
  v_material_id uuid;
begin
  v_school_id := coalesce(new.school_id, old.school_id);
  v_material_id := coalesce(new.material_item_id, old.material_item_id);

  if v_school_id is not null and v_material_id is not null then
    perform inventory.recalculate_material_current_stock(v_school_id, v_material_id);
  end if;

  return coalesce(new, old);
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_suppliers'
  ) then
    create trigger set_updated_at_inventory_suppliers
    before update on inventory.suppliers
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_material_categories'
  ) then
    create trigger set_updated_at_inventory_material_categories
    before update on inventory.material_categories
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_material_items'
  ) then
    create trigger set_updated_at_inventory_material_items
    before update on inventory.material_items
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_stock_in_entries'
  ) then
    create trigger set_updated_at_inventory_stock_in_entries
    before update on inventory.stock_in_entries
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_stock_out_entries'
  ) then
    create trigger set_updated_at_inventory_stock_out_entries
    before update on inventory.stock_out_entries
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at_inventory_student_issue_entries'
  ) then
    create trigger set_updated_at_inventory_student_issue_entries
    before update on inventory.student_issue_entries
    for each row
    execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'recalculate_stock_after_stock_in'
  ) then
    create trigger recalculate_stock_after_stock_in
    after insert or update or delete on inventory.stock_in_entries
    for each row
    execute function inventory.sync_material_stock_on_entry_change();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'recalculate_stock_after_stock_out'
  ) then
    create trigger recalculate_stock_after_stock_out
    after insert or update or delete on inventory.stock_out_entries
    for each row
    execute function inventory.sync_material_stock_on_entry_change();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'recalculate_stock_after_student_issue'
  ) then
    create trigger recalculate_stock_after_student_issue
    after insert or update or delete on inventory.student_issue_entries
    for each row
    execute function inventory.sync_material_stock_on_entry_change();
  end if;
end $$;

alter table inventory.suppliers enable row level security;
alter table inventory.material_categories enable row level security;
alter table inventory.material_items enable row level security;
alter table inventory.stock_in_entries enable row level security;
alter table inventory.stock_out_entries enable row level security;
alter table inventory.student_issue_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'suppliers' and policyname = 'suppliers_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'material_categories' and policyname = 'material_categories_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'material_items' and policyname = 'material_items_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'stock_in_entries' and policyname = 'stock_in_entries_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'stock_out_entries' and policyname = 'stock_out_entries_scope'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'inventory' and tablename = 'student_issue_entries' and policyname = 'student_issue_entries_scope'
  ) then
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
  end if;
end $$;

commit;
