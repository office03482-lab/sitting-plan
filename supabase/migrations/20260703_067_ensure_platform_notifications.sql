begin;

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  notification_type text not null,
  severity text not null default 'info',
  audience_scope text not null default 'school',
  school_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint platform_notifications_type_check check (
    notification_type in ('maintenance', 'subscription', 'system_alert', 'security_notice')
  ),
  constraint platform_notifications_severity_check check (
    severity in ('info', 'warning', 'critical')
  ),
  constraint platform_notifications_audience_scope_check check (
    audience_scope in ('school', 'multiple', 'all')
  )
);

create index if not exists platform_notifications_created_idx
  on public.platform_notifications (created_at desc);

drop trigger if exists set_updated_at_platform_notifications on public.platform_notifications;
create trigger set_updated_at_platform_notifications
before update on public.platform_notifications
for each row execute function public.set_updated_at();

commit;
