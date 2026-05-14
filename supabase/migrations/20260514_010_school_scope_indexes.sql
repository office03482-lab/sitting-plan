begin;

create index if not exists idx_students_school_batch
on public.students (school_id, batch_id);

create index if not exists idx_staff_school
on public.staff_members (school_id);

create index if not exists idx_rooms_school
on public.rooms (school_id);

commit;
