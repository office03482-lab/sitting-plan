begin;

create extension if not exists pg_trgm;

create schema if not exists scheduling;

create index if not exists idx_sched_timetable_entries_school_day_active_start
on scheduling.timetable_entries (school_id, day_of_week, is_active, start_time, id);

create index if not exists idx_sched_timetable_entries_school_day_teacher_active
on scheduling.timetable_entries (school_id, day_of_week, staff_member_id, is_active, start_time);

create index if not exists idx_sched_timetable_entries_class_name_trgm
on scheduling.timetable_entries using gin (class_name gin_trgm_ops);

create index if not exists idx_subjects_school_active_class_name
on public.subjects (school_id, is_active, class_name, name);

create index if not exists idx_batches_school_active_class_section
on public.batches (school_id, is_active, class_name, section);

create table if not exists scheduling.timetable_entry_batches (
    timetable_entry_id uuid not null references scheduling.timetable_entries(id) on delete cascade,
    school_id uuid not null,
    class_name text not null,
    section text not null,
    created_at timestamptz not null default now(),
    primary key (timetable_entry_id, class_name, section)
);

create index if not exists idx_sched_timetable_entry_batches_lookup
on scheduling.timetable_entry_batches (school_id, class_name, section, timetable_entry_id);

with expanded as (
    select
        te.id as timetable_entry_id,
        te.school_id,
        trim(batch_name) as raw_batch_name
    from scheduling.timetable_entries te
    cross join lateral regexp_split_to_table(coalesce(te.class_name, ''), '\s*,\s*') as batch_name
    where coalesce(trim(batch_name), '') <> ''
),
normalized as (
    select
        timetable_entry_id,
        school_id,
        trim(
            case
                when position('|' in raw_batch_name) > 0 then split_part(raw_batch_name, '|', 1)
                when position('-' in raw_batch_name) > 0 then split_part(raw_batch_name, '-', 1)
                else raw_batch_name
            end
        ) as class_name,
        trim(
            case
                when position('|' in raw_batch_name) > 0 then split_part(raw_batch_name, '|', 2)
                when position('-' in raw_batch_name) > 0 then split_part(raw_batch_name, '-', 2)
                else 'A'
            end
        ) as section
    from expanded
)
insert into scheduling.timetable_entry_batches (timetable_entry_id, school_id, class_name, section)
select
    timetable_entry_id,
    school_id,
    nullif(class_name, '') as class_name,
    coalesce(nullif(section, ''), 'A') as section
from normalized
where nullif(class_name, '') is not null
on conflict do nothing;

analyze scheduling.timetable_entries;
analyze scheduling.timetable_entry_batches;
analyze public.subjects;
analyze public.batches;

commit;
