begin;

alter table scheduling.timetable_entries
  add column if not exists start_date date,
  add column if not exists end_date date;

create index if not exists idx_timetable_entries_date_range
  on scheduling.timetable_entries (school_id, day_of_week, start_date, end_date);

comment on column scheduling.timetable_entries.start_date is 'Optional: entry is only visible on or after this date';
comment on column scheduling.timetable_entries.end_date is 'Optional: entry is only visible on or before this date';

commit;
