begin;
set local lock_timeout = '3s';

-- One statement/snapshot counts people, not paginated attendance records.
-- Reuse the partial open-shift index; historical shifts cannot multiply counts.
create function public.admin_team_availability()
returns table (active_employees bigint, on_duty bigint, off_duty bigint)
language sql stable security invoker set search_path = ''
as $$
  with employees as (
    select exists (
      select 1 from public.attendance a
      where a.user_id = p.id and a.clock_out is null
    ) as working
    from public.employee_profiles p
    where p.is_active and p.terminated_at is null
      and not exists (select 1 from public.admin_users u where u.id = p.id)
  )
  select count(*), count(*) filter (where working), count(*) filter (where not working)
  from employees;
$$;

-- Only admin-api's service client may call this after checking the admin's
-- identity and session. Do not expose organization-wide counts to employees.
revoke all on function public.admin_team_availability() from public, anon, authenticated;
grant execute on function public.admin_team_availability() to service_role;

notify pgrst, 'reload schema';
commit;
