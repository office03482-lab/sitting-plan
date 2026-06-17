-- Add missing index on student_issue_entries.material_item_id to prevent
-- sequential scans during _batch_material_stock queries (used by current_inventory report).

create index if not exists idx_inventory_student_issue_material
  on inventory.student_issue_entries (school_id, material_item_id);

notify pgrst, 'reload schema';
