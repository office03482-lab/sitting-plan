begin;

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('online_tests', 'online_tests', null, 'Access online tests workspace.', true),
  ('online_tests.view', 'online_tests', 'view', 'View online tests and results.', true),
  ('online_tests.manage', 'online_tests', 'manage', 'Create and manage online tests.', true),
  ('online_tests.attempt', 'online_tests', 'attempt', 'Attempt assigned online tests.', true),
  ('online_tests.grade', 'online_tests', 'grade', 'Evaluate and publish online test results.', true),
  ('online_tests.reports', 'online_tests', 'reports', 'View online test analytics and reports.', true),
  ('offline_exams', 'offline_exams', null, 'Access offline exams workspace.', true),
  ('offline_exams.view', 'offline_exams', 'view', 'View offline exams and schedules.', true),
  ('offline_exams.manage', 'offline_exams', 'manage', 'Create and manage offline exams.', true),
  ('offline_exams.reports', 'offline_exams', 'reports', 'View offline exam reports and analytics.', true)
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
    'online_tests',
    'online_tests.view',
    'online_tests.manage',
    'online_tests.grade',
    'online_tests.reports',
    'offline_exams',
    'offline_exams.view',
    'offline_exams.manage',
    'offline_exams.reports'
  )
where r.role_key in ('school_admin', 'platform_admin', 'teacher')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select distinct r.id, p.id
from public.roles r
join public.permissions p
  on p.permission_key in (
    'online_tests.view',
    'online_tests.attempt',
    'offline_exams.view'
  )
where r.role_key in ('student', 'parent', 'viewer')
on conflict do nothing;

commit;
