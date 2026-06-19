begin;

alter table if exists lms.lesson_resources
  drop constraint if exists lms_lesson_resources_type_check;

alter table if exists lms.lesson_resources
  add constraint lms_lesson_resources_type_check
  check (resource_type in ('video', 'pdf', 'note', 'assignment', 'link', 'docx', 'zip', 'mp4', 'image', 'recording', 'notes'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lms-videos', 'lms-videos', true, 1073741824, array['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream']),
  ('lms-documents', 'lms-documents', true, 104857600, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
  ('lms-notes', 'lms-notes', true, 52428800, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/octet-stream']),
  ('lms-assignments', 'lms-assignments', true, 104857600, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-zip-compressed', 'image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']),
  ('assignment-submissions', 'assignment-submissions', true, 104857600, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-zip-compressed', 'image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']),
  ('online-test-images', 'online-test-images', true, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream']),
  ('live-class-recordings', 'live-class-recordings', true, 1073741824, array['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists lms_videos_public_read on storage.objects;
create policy lms_videos_public_read on storage.objects for select to public using (bucket_id = 'lms-videos');
drop policy if exists lms_videos_authenticated_insert on storage.objects;
create policy lms_videos_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'lms-videos');
drop policy if exists lms_videos_authenticated_update on storage.objects;
create policy lms_videos_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'lms-videos') with check (bucket_id = 'lms-videos');
drop policy if exists lms_videos_authenticated_delete on storage.objects;
create policy lms_videos_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'lms-videos');

drop policy if exists lms_documents_public_read on storage.objects;
create policy lms_documents_public_read on storage.objects for select to public using (bucket_id = 'lms-documents');
drop policy if exists lms_documents_authenticated_insert on storage.objects;
create policy lms_documents_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'lms-documents');
drop policy if exists lms_documents_authenticated_update on storage.objects;
create policy lms_documents_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'lms-documents') with check (bucket_id = 'lms-documents');
drop policy if exists lms_documents_authenticated_delete on storage.objects;
create policy lms_documents_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'lms-documents');

drop policy if exists lms_notes_public_read on storage.objects;
create policy lms_notes_public_read on storage.objects for select to public using (bucket_id = 'lms-notes');
drop policy if exists lms_notes_authenticated_insert on storage.objects;
create policy lms_notes_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'lms-notes');
drop policy if exists lms_notes_authenticated_update on storage.objects;
create policy lms_notes_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'lms-notes') with check (bucket_id = 'lms-notes');
drop policy if exists lms_notes_authenticated_delete on storage.objects;
create policy lms_notes_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'lms-notes');

drop policy if exists lms_assignments_public_read on storage.objects;
create policy lms_assignments_public_read on storage.objects for select to public using (bucket_id = 'lms-assignments');
drop policy if exists lms_assignments_authenticated_insert on storage.objects;
create policy lms_assignments_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'lms-assignments');
drop policy if exists lms_assignments_authenticated_update on storage.objects;
create policy lms_assignments_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'lms-assignments') with check (bucket_id = 'lms-assignments');
drop policy if exists lms_assignments_authenticated_delete on storage.objects;
create policy lms_assignments_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'lms-assignments');

drop policy if exists assignment_submissions_public_read on storage.objects;
create policy assignment_submissions_public_read on storage.objects for select to public using (bucket_id = 'assignment-submissions');
drop policy if exists assignment_submissions_authenticated_insert on storage.objects;
create policy assignment_submissions_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'assignment-submissions');
drop policy if exists assignment_submissions_authenticated_update on storage.objects;
create policy assignment_submissions_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'assignment-submissions') with check (bucket_id = 'assignment-submissions');
drop policy if exists assignment_submissions_authenticated_delete on storage.objects;
create policy assignment_submissions_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'assignment-submissions');

drop policy if exists online_test_images_public_read on storage.objects;
create policy online_test_images_public_read on storage.objects for select to public using (bucket_id = 'online-test-images');
drop policy if exists online_test_images_authenticated_insert on storage.objects;
create policy online_test_images_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'online-test-images');
drop policy if exists online_test_images_authenticated_update on storage.objects;
create policy online_test_images_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'online-test-images') with check (bucket_id = 'online-test-images');
drop policy if exists online_test_images_authenticated_delete on storage.objects;
create policy online_test_images_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'online-test-images');

drop policy if exists live_class_recordings_public_read on storage.objects;
create policy live_class_recordings_public_read on storage.objects for select to public using (bucket_id = 'live-class-recordings');
drop policy if exists live_class_recordings_authenticated_insert on storage.objects;
create policy live_class_recordings_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'live-class-recordings');
drop policy if exists live_class_recordings_authenticated_update on storage.objects;
create policy live_class_recordings_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'live-class-recordings') with check (bucket_id = 'live-class-recordings');
drop policy if exists live_class_recordings_authenticated_delete on storage.objects;
create policy live_class_recordings_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'live-class-recordings');

commit;
