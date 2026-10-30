begin;

-- Regular administrators may read employee records, but never another
-- administrator's profile (including the Super Administrator's email).
-- Keep this helper outside the schemas exposed through the Data API.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create function app_private.admin_can_read_employee(employee_id uuid)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users actor
    where actor.id = (select auth.uid())
      and actor.role = 'admin'
      and not actor.must_change_password
  ) and not exists (
    select 1 from public.admin_users protected_account
    where protected_account.id = employee_id
  );
$$;

revoke execute on function app_private.admin_can_read_employee(uuid) from public, anon, authenticated;
grant execute on function app_private.admin_can_read_employee(uuid) to authenticated;

create policy admin_reads_employee_profiles
  on public.employee_profiles for select to authenticated
  using (app_private.admin_can_read_employee(id));

create policy admin_reads_employee_attendance
  on public.attendance for select to authenticated
  using (app_private.admin_can_read_employee(user_id));

commit;
