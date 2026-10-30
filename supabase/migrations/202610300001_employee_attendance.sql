-- Fresh employee-only attendance schema. Apply once through Supabase SQL Editor.
-- Create login accounts through Supabase Auth, never by inserting into auth.users.
begin;

create table public.employee_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  position text check (char_length(position) <= 120),
  phone_number text check (char_length(phone_number) <= 40),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_clock_order check (clock_out is null or clock_out >= clock_in)
);

create unique index attendance_one_open_shift_per_employee
  on public.attendance (user_id) where clock_out is null;
create index attendance_employee_recent
  on public.attendance (user_id, clock_in desc);

alter table public.employee_profiles enable row level security;
alter table public.attendance enable row level security;
revoke all on table public.employee_profiles from public, anon, authenticated;
revoke all on table public.attendance from public, anon, authenticated;
grant select on table public.employee_profiles to authenticated;
grant select on table public.attendance to authenticated;

create policy employee_reads_own_profile
  on public.employee_profiles for select to authenticated
  using (id = (select auth.uid()));

create policy active_employee_reads_own_attendance
  on public.attendance for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.employee_profiles p
      where p.id = (select auth.uid()) and p.is_active
    )
  );

-- All Auth accounts begin inactive; an administrator must activate employees.
create function public.create_employee_profile()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.employee_profiles (id, full_name, phone_number)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    left(coalesce(new.raw_user_meta_data ->> 'phone', new.phone, ''), 40)
  ) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_employee_profile() from public, anon, authenticated;
create trigger on_auth_user_created_employee_profile
  after insert on auth.users
  for each row execute function public.create_employee_profile();

-- Also cover accounts created before the migration.
insert into public.employee_profiles (id, full_name, phone_number)
select u.id,
  left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 120),
  left(coalesce(u.raw_user_meta_data ->> 'phone', u.phone, ''), 40)
from auth.users u
on conflict (id) do nothing;

-- The client supplies no user ID or timestamp. The server records the event.
create function public.clock_in_shift()
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
    where p.id = employee_id and p.is_active
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

create function public.clock_out_shift()
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
    where p.id = employee_id and p.is_active
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

create function public.attendance_server_time()
returns timestamptz
language sql volatile security invoker set search_path = ''
as $$ select pg_catalog.clock_timestamp(); $$;

revoke execute on function public.clock_in_shift() from public, anon, authenticated;
revoke execute on function public.clock_out_shift() from public, anon, authenticated;
revoke execute on function public.attendance_server_time() from public, anon, authenticated;
grant execute on function public.clock_in_shift() to authenticated;
grant execute on function public.clock_out_shift() to authenticated;
grant execute on function public.attendance_server_time() to authenticated;

commit;
