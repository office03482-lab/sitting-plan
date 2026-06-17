begin;

-- Report filters repeatedly constrain inventory movement tables by school,
-- material, batch, and descending date windows. These composite indexes keep
-- the report paths off full-table scans during current inventory rollups and
-- stock movement exports.

create index if not exists idx_inventory_stock_in_school_material
  on inventory.stock_in_entries (school_id, material_item_id);

create index if not exists idx_inventory_stock_out_school_material
  on inventory.stock_out_entries (school_id, material_item_id);

create index if not exists idx_inventory_stock_in_school_entry_date
  on inventory.stock_in_entries (school_id, entry_date desc, id desc);

create index if not exists idx_inventory_stock_out_school_entry_date
  on inventory.stock_out_entries (school_id, entry_date desc, id desc);

create index if not exists idx_inventory_stock_out_school_batch_date
  on inventory.stock_out_entries (school_id, batch_id, entry_date desc, id desc);

create index if not exists idx_inventory_student_issue_school_issue_date
  on inventory.student_issue_entries (school_id, issue_date desc, id desc);

create index if not exists idx_inventory_student_issue_school_batch_date
  on inventory.student_issue_entries (school_id, batch_id, issue_date desc, id desc);

notify pgrst, 'reload schema';

commit;
