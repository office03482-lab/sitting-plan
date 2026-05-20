begin;

update public.students
set
    created_at = coalesce(created_at, updated_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null
   or updated_at is null;

update public.staff_members
set
    created_at = coalesce(created_at, updated_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null
   or updated_at is null;

update public.subjects
set
    created_at = coalesce(created_at, updated_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null
   or updated_at is null;

alter table public.students
    alter column created_at set default now(),
    alter column updated_at set default now();

alter table public.staff_members
    alter column created_at set default now(),
    alter column updated_at set default now();

alter table public.subjects
    alter column created_at set default now(),
    alter column updated_at set default now();

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    if new.created_at is null then
        new.created_at = now();
    end if;
    return new;
end;
$$;

drop trigger if exists trg_students_set_updated_at on public.students;
create trigger trg_students_set_updated_at
before update on public.students
for each row
execute function public.set_row_updated_at();

drop trigger if exists trg_staff_members_set_updated_at on public.staff_members;
create trigger trg_staff_members_set_updated_at
before update on public.staff_members
for each row
execute function public.set_row_updated_at();

drop trigger if exists trg_subjects_set_updated_at on public.subjects;
create trigger trg_subjects_set_updated_at
before update on public.subjects
for each row
execute function public.set_row_updated_at();

commit;
