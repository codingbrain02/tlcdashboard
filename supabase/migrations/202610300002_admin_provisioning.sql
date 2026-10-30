begin;

alter table public.employee_profiles
  add column must_change_password boolean not null default false;

create table public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  role text not null check (role in ('super_admin', 'admin')),
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  constraint admin_username_format check (username ~ '^[a-z][a-z0-9_]{2,31}$')
);
create unique index admin_one_super_administrator
  on public.admin_users ((true)) where role = 'super_admin';

-- The first Auth user is created privately in Authentication > Users, never
-- through an unrestricted signup or a client-side service key.
do $$
declare
  owner_id uuid;
begin
  select id into owner_id from auth.users
  where lower(email) = 'codingbrain02@gmail.com'
    and email_confirmed_at is not null;
  if owner_id is null then
    raise exception 'Create and confirm codingbrain02@gmail.com in Supabase Auth before this migration';
  end if;
  insert into public.admin_users (id, username, role)
  values (owner_id, 'super_administrator', 'super_admin');
end;
$$;

-- Admins may see only their own role. Other administrators never receive the
-- super administrator's email or Auth record through this table.
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
grant select on public.admin_users to authenticated;
create policy admin_reads_self on public.admin_users for select to authenticated
  using (id = (select auth.uid()));

create function public.is_super_administrator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = (select auth.uid())
      and a.role = 'super_admin' and not a.must_change_password
  );
$$;
revoke execute on function public.is_super_administrator() from public, anon, authenticated;
grant execute on function public.is_super_administrator() to authenticated;
create policy super_admin_reads_admin_directory
  on public.admin_users for select to authenticated
  using ((select public.is_super_administrator()));

drop policy active_employee_reads_own_attendance on public.attendance;
create policy active_employee_reads_own_attendance
  on public.attendance for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.employee_profiles p
      where p.id = (select auth.uid())
        and p.is_active and not p.must_change_password
    )
  );

create or replace function public.clock_in_shift()
returns public.attendance
language plpgsql volatile security definer set search_path = ''
as $$
declare
  employee_id uuid := (select auth.uid());
  shift public.attendance;
begin
  if employee_id is null or not exists (
    select 1 from public.employee_profiles p
    where p.id = employee_id and p.is_active and not p.must_change_password
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

create or replace function public.clock_out_shift()
returns public.attendance
language plpgsql volatile security definer set search_path = ''
as $$
declare
  employee_id uuid := (select auth.uid());
  shift public.attendance;
begin
  if employee_id is null or not exists (
    select 1 from public.employee_profiles p
    where p.id = employee_id and p.is_active and not p.must_change_password
  ) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;

  update public.attendance a
  set clock_out = greatest(a.clock_in, pg_catalog.clock_timestamp())
  where a.user_id = employee_id and a.clock_out is null
  returning * into shift;

  if shift.id is null then
    raise exception 'No active shift to clock out' using errcode = 'P0002';
  end if;
  return shift;
end;
$$;

-- No public bootstrap endpoint or ordinary-admin path can assign this role.
commit;
