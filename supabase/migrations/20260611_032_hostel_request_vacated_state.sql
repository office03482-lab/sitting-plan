begin;

alter table hostel.hostel_requests
  add column if not exists vacated_at timestamptz,
  add column if not exists vacated_by_profile_id uuid references public.profiles (id) on delete set null;

alter table hostel.hostel_requests
  drop constraint if exists hostel_requests_status_check;

alter table hostel.hostel_requests
  add constraint hostel_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled', 'vacated')
  );

create index if not exists hostel_requests_school_status_created_idx
  on hostel.hostel_requests (school_id, status, created_at desc);

commit;
