-- Parent portal RLS fix: allow a parent (guardian) to read their own student links.
--
-- Root cause: academic.student_guardians_select_scope (20260513_004) only granted
-- SELECT to platform admins / school members. Parents are linked via
-- academic.guardians.profile_id and normally have no school_membership row (or the
-- membership may be absent for legacy/bulk-provisioned parents), so the parent
-- portal bootstrap query
--     select student_id from academic.student_guardians where guardian_id = ...
-- returned [] and the frontend threw "No linked students found for this parent account."
--
-- The analogous academic.guardians_select_scope policy already has a
-- "profile_id = auth.uid()" clause; add the matching owner clause here.

begin;

drop policy if exists student_guardians_select_scope on academic.student_guardians;

create policy student_guardians_select_scope
on academic.student_guardians
for select
to authenticated
using (
  public.is_platform_admin()
  or public.same_school_membership(school_id)
  or exists (
    select 1
    from academic.guardians g
    where g.id = student_guardians.guardian_id
      and g.profile_id = auth.uid()
      and g.is_active = true
  )
);

commit;
