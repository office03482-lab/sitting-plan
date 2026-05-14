begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'student-photos',
    'student-photos',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'staff-photos',
    'staff-photos',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists student_photos_public_read on storage.objects;
create policy student_photos_public_read
on storage.objects
for select
to public
using (bucket_id = 'student-photos');

drop policy if exists student_photos_authenticated_insert on storage.objects;
create policy student_photos_authenticated_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'student-photos');

drop policy if exists student_photos_authenticated_update on storage.objects;
create policy student_photos_authenticated_update
on storage.objects
for update
to authenticated
using (bucket_id = 'student-photos')
with check (bucket_id = 'student-photos');

drop policy if exists student_photos_authenticated_delete on storage.objects;
create policy student_photos_authenticated_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'student-photos');

drop policy if exists staff_photos_public_read on storage.objects;
create policy staff_photos_public_read
on storage.objects
for select
to public
using (bucket_id = 'staff-photos');

drop policy if exists staff_photos_authenticated_insert on storage.objects;
create policy staff_photos_authenticated_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'staff-photos');

drop policy if exists staff_photos_authenticated_update on storage.objects;
create policy staff_photos_authenticated_update
on storage.objects
for update
to authenticated
using (bucket_id = 'staff-photos')
with check (bucket_id = 'staff-photos');

drop policy if exists staff_photos_authenticated_delete on storage.objects;
create policy staff_photos_authenticated_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'staff-photos');

commit;
