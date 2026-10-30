begin;

-- Realtime applies the subscriber's SELECT policies before sending a change.
-- Employees retain access only to their own shifts; only the super
-- administrator can subscribe to changes for the whole organization.
create policy super_admin_reads_attendance
  on public.attendance for select to authenticated
  using ((select public.is_super_administrator()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table public.attendance;
  end if;
end;
$$;

commit;
