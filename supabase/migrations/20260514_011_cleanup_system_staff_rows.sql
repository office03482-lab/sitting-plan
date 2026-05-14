begin;

delete from public.staff_members
where staff_type = 'teaching'
  and (
    upper(trim(coalesce(full_name, ''))) in ('__BREAK_SESSION__', '__SELF_STUDY_SESSION__')
    or lower(trim(coalesce(full_name, ''))) in ('break session', 'break time', 'self study session', 'self study')
    or lower(trim(coalesce(department, ''))) = 'system'
    or lower(trim(coalesce(metadata->>'subject', ''))) = 'system'
  );

commit;
