begin;

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('offline_exams', 'offline_exams', null, 'Access offline exams workspace.', true),
  ('offline_exams.view', 'offline_exams', 'view', 'View offline exams, schedules, hall tickets, attendance, results, and seating.', true),
  ('offline_exams.manage', 'offline_exams', 'manage', 'Manage offline exams across the module.', true),
  ('offline_exams.create', 'offline_exams', 'create', 'Create offline exams and draft papers.', true),
  ('offline_exams.edit', 'offline_exams', 'edit', 'Edit offline exams, questions, and evaluation settings.', true),
  ('offline_exams.delete', 'offline_exams', 'delete', 'Delete offline exams and exam questions.', true),
  ('offline_exams.reports', 'offline_exams', 'reports', 'View offline exam analytics, reports, and published results.', true)
on conflict (permission_key) do update
set
  module_key = excluded.module_key,
  action_key = excluded.action_key,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.permissions p
  on p.permission_key in (
    'offline_exams',
    'offline_exams.view',
    'offline_exams.manage',
    'offline_exams.create',
    'offline_exams.edit',
    'offline_exams.delete',
    'offline_exams.reports'
  )
where r.role_key in ('school_admin', 'platform_admin', 'teacher')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.permissions p
  on p.permission_key in (
    'offline_exams.view'
  )
where r.role_key in ('student', 'parent', 'viewer')
on conflict do nothing;

commit;
