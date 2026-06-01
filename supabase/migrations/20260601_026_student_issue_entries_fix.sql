-- Fix student_issue_entries column mismatches:
--   code inserts student_name, batch_name but columns were missing
--   code references issue_date but column was entry_date (not possible — column IS issue_date, code was wrong)
--   code references issued_by but column is issued_by_profile_id

begin;

alter table inventory.student_issue_entries
  add column if not exists student_name text not null default '',
  add column if not exists batch_name text not null default '';

commit;
