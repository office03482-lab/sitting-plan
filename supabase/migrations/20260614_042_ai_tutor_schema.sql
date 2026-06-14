begin;

create schema if not exists ai;

create table if not exists ai.ai_learning_context (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  role_key text not null default 'student',
  topic text not null,
  mode text not null default 'chat',
  class_level text,
  weak_topic_match boolean not null default false,
  context_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_learning_context_mode_check check (mode in ('chat', 'explain', 'practice', 'revision')),
  constraint ai_learning_context_role_check check (role_key in ('student', 'teacher', 'school_admin', 'platform_admin', 'parent', 'viewer'))
);

create index if not exists ai_learning_context_scope_idx
  on ai.ai_learning_context (school_id, role_key, topic, created_at desc)
  where deleted_at is null;

create index if not exists ai_learning_context_student_idx
  on ai.ai_learning_context (school_id, student_id, created_at desc)
  where deleted_at is null;

create table if not exists ai.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  context_id uuid references ai.ai_learning_context (id) on delete cascade,
  recommendation_type text not null default 'lesson',
  title text not null,
  summary text,
  priority integer not null default 3,
  recommendation_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_recommendations_type_check check (recommendation_type in ('lesson', 'recording', 'assignment', 'test', 'planner', 'flash_cards', 'formula_sheet', 'revision'))
);

create index if not exists ai_recommendations_scope_idx
  on ai.ai_recommendations (school_id, student_id, recommendation_type, created_at desc)
  where deleted_at is null;

create table if not exists ai.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  context_id uuid references ai.ai_learning_context (id) on delete set null,
  recommendation_id uuid references ai.ai_recommendations (id) on delete set null,
  role_key text not null default 'student',
  mode text not null default 'chat',
  topic text not null,
  user_prompt text not null,
  response_text text not null,
  attachments jsonb not null default '[]'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  teacher_prompt text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_conversations_mode_check check (mode in ('chat', 'explain', 'practice', 'revision')),
  constraint ai_conversations_role_check check (role_key in ('student', 'teacher', 'school_admin', 'platform_admin', 'parent', 'viewer'))
);

create index if not exists ai_conversations_scope_idx
  on ai.ai_conversations (school_id, role_key, mode, created_at desc)
  where deleted_at is null;

create index if not exists ai_conversations_student_idx
  on ai.ai_conversations (school_id, student_id, created_at desc)
  where deleted_at is null;

create trigger set_updated_at_ai_learning_context
before update on ai.ai_learning_context
for each row execute function public.set_updated_at();

create trigger set_updated_at_ai_recommendations
before update on ai.ai_recommendations
for each row execute function public.set_updated_at();

create trigger set_updated_at_ai_conversations
before update on ai.ai_conversations
for each row execute function public.set_updated_at();

alter table ai.ai_learning_context enable row level security;
alter table ai.ai_recommendations enable row level security;
alter table ai.ai_conversations enable row level security;

create policy ai_learning_context_select_scope
on ai.ai_learning_context
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or profile_id = public.current_profile_id()
);

create policy ai_learning_context_manage_scope
on ai.ai_learning_context
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
);

create policy ai_recommendations_select_scope
on ai.ai_recommendations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or profile_id = public.current_profile_id()
);

create policy ai_recommendations_manage_scope
on ai.ai_recommendations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
);

create policy ai_conversations_select_scope
on ai.ai_conversations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or profile_id = public.current_profile_id()
);

create policy ai_conversations_manage_scope
on ai.ai_conversations
for all
to authenticated
using (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
)
with check (
  public.is_platform_admin()
  or public.is_school_admin(school_id)
  or public.has_permission(school_id, 'ai_tutor.review')
  or public.has_permission(school_id, 'ai_tutor.manage')
  or (public.has_permission(school_id, 'ai_tutor.chat') and profile_id = public.current_profile_id())
);

insert into public.permissions (permission_key, module_key, action_key, description, is_active)
values
  ('ai_tutor', 'ai_tutor', null, 'Access AI tutor module.', true),
  ('ai_tutor.chat', 'ai_tutor', 'chat', 'Use personalized AI tutor conversations.', true),
  ('ai_tutor.review', 'ai_tutor', 'review', 'Review AI tutor conversations and recommendations.', true),
  ('ai_tutor.manage', 'ai_tutor', 'manage', 'Manage AI tutor prompts and assignment generation.', true)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'ai_tutor',
  'ai_tutor.chat',
  'ai_tutor.review',
  'ai_tutor.manage'
)
where r.role_key in ('platform_admin', 'school_admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'ai_tutor',
  'ai_tutor.chat',
  'ai_tutor.review',
  'ai_tutor.manage'
)
where r.role_key = 'teacher'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.permission_key in (
  'ai_tutor',
  'ai_tutor.chat'
)
where r.role_key = 'student'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
