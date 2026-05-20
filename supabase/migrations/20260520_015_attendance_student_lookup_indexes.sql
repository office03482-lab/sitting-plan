begin;

create extension if not exists pg_trgm;

create index if not exists idx_students_school_active_name
on public.students (school_id, is_active, full_name);

create index if not exists idx_students_school_active_class_section
on public.students (school_id, is_active, class_name, section);

create index if not exists idx_students_school_active_roll
on public.students (school_id, is_active, roll_number);

create index if not exists idx_students_full_name_trgm
on public.students using gin (full_name gin_trgm_ops);

create index if not exists idx_students_roll_number_trgm
on public.students using gin (roll_number gin_trgm_ops);

create index if not exists idx_students_father_name_trgm
on public.students using gin (father_name gin_trgm_ops);

commit;
