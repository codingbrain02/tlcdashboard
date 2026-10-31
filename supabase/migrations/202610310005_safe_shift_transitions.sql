begin;

-- A stale browser tab must never close a newer shift started elsewhere.
create function public.clock_out_shift_if_current(expected_shift_id uuid)
returns public.attendance
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  employee_id uuid := (select auth.uid());
  shift public.attendance;
begin
  if employee_id is null or expected_shift_id is null or not exists (
    select 1 from public.employee_profiles p
    where p.id = employee_id and p.is_active and not p.must_change_password
      and not exists (select 1 from public.admin_users a where a.id = employee_id)
  ) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;

  update public.attendance a
  set clock_out = greatest(a.clock_in, pg_catalog.clock_timestamp())
  where a.id = expected_shift_id
    and a.user_id = employee_id
    and a.clock_out is null
  returning * into shift;

  if shift.id is null then
    raise exception 'Active shift changed; refresh and try again' using errcode = 'P0002';
  end if;
  return shift;
end;
$$;

revoke execute on function public.clock_out_shift_if_current(uuid)
  from public, anon, authenticated;
grant execute on function public.clock_out_shift_if_current(uuid)
  to authenticated;

-- Prevent a manually misconfigured administrator profile from clocking in.
create or replace function public.clock_in_shift()
returns public.attendance
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  employee_id uuid := (select auth.uid());
  shift public.attendance;
begin
  if employee_id is null or not exists (
    select 1 from public.employee_profiles p
    where p.id = employee_id and p.is_active and not p.must_change_password
      and not exists (select 1 from public.admin_users a where a.id = employee_id)
  ) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;

  insert into public.attendance (user_id, clock_in)
  values (employee_id, pg_catalog.clock_timestamp())
  returning * into shift;
  return shift;
exception when unique_violation then
  raise exception 'An active shift already exists' using errcode = '23505';
end;
$$;

notify pgrst, 'reload schema';
commit;
