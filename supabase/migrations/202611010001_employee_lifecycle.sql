begin;

-- Acquire every table needed for DDL before making changes. Fail immediately
-- if a live request holds a conflicting lock, rather than holding one table
-- while waiting for another in the opposite order to an Auth/attendance call.
set local lock_timeout = '3s';
lock table auth.users in share row exclusive mode nowait;
lock table public.attendance, public.employee_profiles in access exclusive mode nowait;

alter table public.employee_profiles
  add column revision bigint not null default 0,
  add column terminated_at timestamptz,
  add column termination_reason text,
  add column termination_details text,
  add column employment_start_date date,
  add column access_reset_at timestamptz,
  add column access_generation bigint not null default 0,
  add column auth_sync_pending boolean not null default false,
  add column last_termination_id uuid,
  add constraint terminated_employee_inactive check (terminated_at is null or not is_active);
update public.employee_profiles set employment_start_date = (created_at at time zone 'UTC')::date;

alter table public.attendance
  add column end_reason text not null default 'clock_out'
    check (end_reason in ('clock_out', 'terminated')),
  add constraint terminated_shift_has_end check (end_reason <> 'terminated' or clock_out is not null);

create table public.admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_name text not null,
  employee_id uuid not null,
  employee_name text not null,
  action text not null,
  reason text,
  before_data jsonb not null default '{}',
  after_data jsonb not null default '{}',
  occurred_at timestamptz not null default clock_timestamp()
);
create index admin_activity_recent on public.admin_activity_log (occurred_at desc, id);
create index admin_activity_employee on public.admin_activity_log (employee_id, occurred_at desc);
alter table public.admin_activity_log enable row level security;
revoke all on public.admin_activity_log from public, anon, authenticated, service_role;
grant select on public.admin_activity_log to authenticated, service_role;
create policy super_admin_reads_activity on public.admin_activity_log for select to authenticated
  using ((select public.is_super_administrator()));

create function app_private.immutable_activity_log()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Activity records cannot be edited or deleted' using errcode = '42501';
end;
$$;
create trigger protect_activity_log before update or delete on public.admin_activity_log
  for each row execute function app_private.immutable_activity_log();
revoke all on function app_private.immutable_activity_log() from public, anon, authenticated;

create function app_private.bump_employee_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger employee_revision before update on public.employee_profiles
  for each row execute function app_private.bump_employee_revision();
revoke all on function app_private.bump_employee_revision() from public, anon, authenticated;

-- Rehiring never makes a pre-termination session valid again, even when its
-- JWT has not expired. Read Auth's session table; never write to Auth tables.
create function app_private.employee_session_allowed(employee_id uuid, session_id uuid, allow_temporary boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employee_profiles p
    join auth.sessions s on s.user_id = p.id and s.id = session_id
    where p.id = employee_id and p.is_active and p.terminated_at is null
      and (allow_temporary or not p.must_change_password)
      and (p.access_reset_at is null or s.created_at > p.access_reset_at)
      and not exists (select 1 from public.admin_users a where a.id = p.id)
  );
$$;
revoke all on function app_private.employee_session_allowed(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app_private.employee_session_allowed(uuid, uuid, boolean) to authenticated;

create function public.employee_session_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, true);
$$;
revoke all on function public.employee_session_allowed() from public, anon, authenticated;
grant execute on function public.employee_session_allowed() to authenticated;

-- A minimal status channel lets devices receive revocation without retaining
-- permission to read the terminated employee's personal profile or attendance.
create table public.employee_account_access (
  id uuid primary key references public.employee_profiles(id) on delete cascade,
  enabled boolean not null,
  terminated boolean not null,
  generation bigint not null,
  changed_at timestamptz not null default clock_timestamp()
);
alter table public.employee_account_access enable row level security;
revoke all on public.employee_account_access from public, anon, authenticated, service_role;
grant select on public.employee_account_access to authenticated, service_role;
create policy employee_reads_access_status on public.employee_account_access for select to authenticated
  using (id = (select auth.uid()));
insert into public.employee_account_access (id, enabled, terminated, generation)
  select id, is_active, terminated_at is not null, access_generation from public.employee_profiles;
create function app_private.publish_employee_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.employee_account_access (id, enabled, terminated, generation)
    values (new.id, new.is_active, new.terminated_at is not null, new.access_generation)
    on conflict (id) do update set enabled = excluded.enabled, terminated = excluded.terminated,
      generation = excluded.generation, changed_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function app_private.publish_employee_access() from public, anon, authenticated;
create trigger publish_new_employee_access after insert on public.employee_profiles
  for each row execute function app_private.publish_employee_access();
create trigger publish_changed_employee_access after update on public.employee_profiles
  for each row when (old.is_active is distinct from new.is_active or old.access_generation is distinct from new.access_generation)
  execute function app_private.publish_employee_access();
alter publication supabase_realtime add table public.employee_account_access;

drop policy employee_reads_own_profile on public.employee_profiles;
create policy employee_reads_own_profile on public.employee_profiles for select to authenticated
  using (id = (select auth.uid()) and terminated_at is null and (not is_active or
    (select app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, true))));

drop policy active_employee_reads_own_attendance on public.attendance;
create policy active_employee_reads_own_attendance on public.attendance for select to authenticated
  using (user_id = (select auth.uid()) and
    (select app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid)));
drop policy employee_updates_own_phone on public.employee_profiles;
create policy employee_updates_own_phone on public.employee_profiles for update to authenticated
  using (id = (select auth.uid()) and
    (select app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid)))
  with check (id = (select auth.uid()) and is_active and terminated_at is null and
    not must_change_password and phone_number ~ '^\+[1-9][0-9]{6,14}$');

create or replace function public.clock_in_shift()
returns public.attendance language plpgsql volatile security definer set search_path = '' as $$
declare shift public.attendance;
begin
  -- Use the same lock order as termination: employee first, then attendance.
  perform 1 from public.employee_profiles where id = auth.uid() for update;
  if not app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;
  insert into public.attendance (user_id, clock_in) values (auth.uid(), clock_timestamp()) returning * into shift;
  return shift;
exception when unique_violation then
  raise exception 'An active shift already exists' using errcode = '23505';
end;
$$;
create or replace function public.clock_out_shift_if_current(expected_shift_id uuid)
returns public.attendance language plpgsql volatile security definer set search_path = '' as $$
declare shift public.attendance;
begin
  perform 1 from public.employee_profiles where id = auth.uid() for update;
  if not app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;
  update public.attendance set clock_out = greatest(clock_in, clock_timestamp()), end_reason = 'clock_out'
    where id = expected_shift_id and user_id = auth.uid() and clock_out is null returning * into shift;
  if shift.id is null then raise exception 'Active shift changed; refresh and try again' using errcode = 'P0002'; end if;
  return shift;
end;
$$;

-- Only the verified Edge Function service client may supply an actor ID.
-- The actor is independently checked here and never comes from browser input.
create function public.admin_employee_command(actor_id uuid, employee_id uuid, command text, details jsonb, expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  operator public.admin_users;
  employee public.employee_profiles;
  previous jsonb;
  event_id uuid := gen_random_uuid();
  reason_text text := nullif(btrim(details->>'reason'), '');
  changed_at timestamptz;
  shift public.attendance;
  next_in timestamptz;
  next_out timestamptz;
begin
  select * into operator from public.admin_users a where a.id = actor_id;
  if operator.id is null or operator.must_change_password then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if command not in ('terminate', 'reverse-termination', 'rehire', 'update-profile', 'update-attendance', 'create-employee', 'email-change-requested', 'email-changed', 'email-change-failed') then
    raise exception 'Invalid employee command' using errcode = '22023';
  end if;
  if command in ('update-profile', 'update-attendance', 'email-change-requested', 'email-changed', 'email-change-failed') and operator.role <> 'super_admin' then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;
  select * into employee from public.employee_profiles p where p.id = employee_id for update;
  if employee.id is null or exists (select 1 from public.admin_users a where a.id = employee_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if command not in ('email-changed', 'email-change-failed') and employee.revision is distinct from expected_revision then
    raise exception 'Employee changed. Refresh and review before confirming again.' using errcode = '40001';
  end if;
  changed_at := clock_timestamp();
  previous := to_jsonb(employee);
  if length(coalesce(reason_text, '')) > 1500 then raise exception 'Reason is too long' using errcode = '22023'; end if;

  if command = 'terminate' then
    if not employee.is_active or employee.terminated_at is not null then raise exception 'Employee is not active' using errcode = '22023'; end if;
    if details->>'category' not in ('Performance', 'Attendance', 'Misconduct', 'Policy violation', 'End of contract', 'Redundancy', 'Other')
      or details->>'category' is null or (details->>'category' = 'Other' and reason_text is null) then
      raise exception 'Select a termination reason and provide details for Other' using errcode = '22023';
    end if;
    update public.attendance set clock_out = greatest(clock_in, changed_at), end_reason = 'terminated'
      where user_id = employee_id and clock_out is null;
    update public.employee_profiles set is_active = false, terminated_at = changed_at,
      termination_reason = details->>'category', termination_details = reason_text,
      access_reset_at = changed_at, access_generation = access_generation + 1,
      auth_sync_pending = true, last_termination_id = event_id where id = employee_id;
    reason_text := concat_ws(': ', details->>'category', reason_text);
  elsif command in ('reverse-termination', 'rehire') then
    if employee.terminated_at is null then raise exception 'Employee is not terminated' using errcode = '22023'; end if;
    if command = 'reverse-termination' and reason_text is null then raise exception 'Explain why the termination is being reversed' using errcode = '22023'; end if;
    if command = 'rehire' and ((details->>'startDate')::date is null or (details->>'startDate')::date > (changed_at at time zone 'UTC')::date + 1) then
      raise exception 'Choose a current or past rehire date' using errcode = '22023';
    end if;
    update public.employee_profiles set is_active = true, terminated_at = null,
      termination_reason = null, termination_details = null, last_termination_id = null,
      employment_start_date = case when command = 'rehire' then (details->>'startDate')::date else employment_start_date end,
      access_reset_at = changed_at, access_generation = access_generation + 1, auth_sync_pending = true
      where id = employee_id;
  elsif command = 'create-employee' then
    if employee.is_active or employee.terminated_at is not null then raise exception 'Employee is already set up' using errcode = '22023'; end if;
    update public.employee_profiles set full_name = btrim(details->>'fullName'), position = btrim(details->>'position'),
      phone_number = details->>'phoneNumber', is_active = true, must_change_password = true,
      employment_start_date = (changed_at at time zone 'UTC')::date
      where id = employee_id;
  elsif command = 'update-profile' then
    if nullif(btrim(details->>'fullName'), '') is null or nullif(btrim(details->>'position'), '') is null or
      coalesce(details->>'phoneNumber', '') !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Check the employee details' using errcode = '22023';
    end if;
    if (details->>'registeredAt')::timestamptz > changed_at or (details->>'startDate')::date > (changed_at at time zone 'UTC')::date + 1 then
      raise exception 'Registration and employment dates cannot be in the future' using errcode = '22023';
    end if;
    update public.employee_profiles set full_name = btrim(details->>'fullName'), position = btrim(details->>'position'),
      phone_number = details->>'phoneNumber',
      created_at = coalesce((details->>'registeredAt')::timestamptz, created_at),
      employment_start_date = coalesce((details->>'startDate')::date, employment_start_date)
      where id = employee_id;
  elsif command = 'update-attendance' then
    if reason_text is null then raise exception 'Explain the attendance correction' using errcode = '22023'; end if;
    select * into shift from public.attendance a where a.id = (details->>'shiftId')::uuid and a.user_id = employee_id for update;
    if shift.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
    if shift.clock_in is distinct from (details->>'expectedClockIn')::timestamptz
      or shift.clock_out is distinct from (details->>'expectedClockOut')::timestamptz
      or shift.end_reason is distinct from details->>'expectedEndReason' then
      raise exception 'Shift changed. Refresh and review the correction again.' using errcode = '40001';
    end if;
    next_in := (details->>'clockIn')::timestamptz;
    next_out := (details->>'clockOut')::timestamptz;
    if next_in is null or next_in > changed_at or next_out > changed_at or next_out < next_in
      or (next_out is null and (not employee.is_active or details->>'endReason' = 'terminated'))
      or coalesce(details->>'endReason', '') not in ('clock_out', 'terminated') then
      raise exception 'Invalid shift times or status' using errcode = '22023';
    end if;
    if exists (select 1 from public.attendance a where a.user_id = employee_id and a.id <> shift.id
      and a.clock_in < coalesce(next_out, 'infinity'::timestamptz)
      and coalesce(a.clock_out, 'infinity'::timestamptz) > next_in) then
      raise exception 'The corrected shift overlaps another shift' using errcode = '22023';
    end if;
    previous := to_jsonb(shift);
    update public.attendance set clock_in = next_in, clock_out = next_out, end_reason = details->>'endReason'
      where id = shift.id returning * into shift;
  elsif command = 'email-change-requested' then
    if coalesce(details->>'email', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or length(details->>'email') > 254 then raise exception 'Invalid email' using errcode = '22023'; end if;
  end if;

  select * into employee from public.employee_profiles p where p.id = employee_id;
  insert into public.admin_activity_log (id, actor_id, actor_name, employee_id, employee_name, action, reason, before_data, after_data)
  values (event_id, actor_id, case when operator.role = 'super_admin' then 'Super Administrator' else operator.username end,
    employee_id, employee.full_name, command, reason_text, previous,
    case when command = 'update-attendance' then to_jsonb(shift)
      when command like 'email-%' then jsonb_build_object('email', details->>'email', 'requestId', details->>'requestId')
      else to_jsonb(employee) end);
  return jsonb_build_object('employee', to_jsonb(employee), 'eventId', event_id);
end;
$$;
revoke all on function public.admin_employee_command(uuid, uuid, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.admin_employee_command(uuid, uuid, text, jsonb, bigint) to service_role;

-- Serialize sensitive Auth changes with termination, including requests that
-- began just before an administrator clicked Terminate. Auth remains managed
-- by its API; this trigger only validates updates, it never writes Auth data.
create function app_private.guard_terminated_auth_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare employee public.employee_profiles;
begin
  select * into employee from public.employee_profiles where id = new.id for update;
  if employee.terminated_at is not null then
    if old.encrypted_password is distinct from new.encrypted_password
      or old.phone is distinct from new.phone
      or old.raw_user_meta_data is distinct from new.raw_user_meta_data
      or (old.email is distinct from new.email and not exists (
        select 1 from public.admin_activity_log requested
        where requested.employee_id = new.id and requested.action = 'email-change-requested'
          and requested.after_data->>'email' = new.email
          and requested.occurred_at > clock_timestamp() - interval '2 minutes'
          and not exists (select 1 from public.admin_activity_log completed
            where completed.after_data->>'requestId' = requested.id::text)
      )) then
      raise exception 'Employee access required' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_terminated_auth_updates() from public, anon, authenticated;
create trigger block_terminated_auth_changes before update of email, encrypted_password, phone, raw_user_meta_data on auth.users
  for each row execute function app_private.guard_terminated_auth_updates();


alter publication supabase_realtime add table public.admin_activity_log;
notify pgrst, 'reload schema';
commit;
