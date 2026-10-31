begin;
set local lock_timeout = '3s';
lock table auth.users in share row exclusive mode nowait;
lock table public.employee_profiles, public.admin_users in access exclusive mode nowait;

alter table public.admin_users add column access_reset_at timestamptz;

-- Revoked JWTs must not regain administrator permissions after a reset.
create function app_private.admin_session_allowed(account_id uuid, session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a
    join auth.sessions s on s.user_id = a.id and s.id = session_id
    where a.id = account_id and (a.access_reset_at is null or s.created_at > a.access_reset_at));
$$;
revoke all on function app_private.admin_session_allowed(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.admin_session_allowed(uuid, uuid) to authenticated;

create function public.admin_session_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.admin_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid);
$$;
revoke all on function public.admin_session_allowed() from public, anon, authenticated;
grant execute on function public.admin_session_allowed() to authenticated;

create or replace function public.is_super_administrator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a where a.id = auth.uid()
    and a.role = 'super_admin' and not a.must_change_password)
    and public.admin_session_allowed();
$$;
create or replace function app_private.admin_can_read_employee(employee_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users a where a.id = auth.uid()
    and a.role = 'admin' and not a.must_change_password)
    and public.admin_session_allowed()
    and not exists (select 1 from public.admin_users a where a.id = employee_id);
$$;

-- Requests contain identifiers only, never a password or password hash.
create table app_private.password_reset_requests (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null,
  target_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz
);
revoke all on app_private.password_reset_requests from public, anon, authenticated, service_role;
create function public.request_account_password_reset(actor_id uuid, target_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if actor_id = target_id or not exists (select 1 from public.admin_users a
    where a.id = actor_id and a.role = 'super_admin' and not a.must_change_password) then
    raise exception 'Super administrator access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employee_profiles p where p.id = target_id)
    and not exists (select 1 from public.admin_users a where a.id = target_id and a.role = 'admin') then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  delete from app_private.password_reset_requests where created_at < clock_timestamp() - interval '10 minutes';
  insert into app_private.password_reset_requests (actor_id, target_id)
    values (actor_id, target_id) returning id into request_id;
  return request_id;
end;
$$;
revoke all on function public.request_account_password_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_account_password_reset(uuid, uuid) to service_role;

-- Execute inside Auth's password transaction: reset flags, session cutoffs and
-- audit success are committed only if Auth actually changes the password.
create function app_private.apply_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reset app_private.password_reset_requests; target_name text; changed_at timestamptz := clock_timestamp();
begin
  if old.encrypted_password is not distinct from new.encrypted_password then return new; end if;
  -- Serialize password changes with termination and other profile actions.
  perform 1 from public.employee_profiles where id = new.id for update;
  if new.raw_user_meta_data ? 'tlc_password_reset_request' then
    select * into reset from app_private.password_reset_requests r
      where r.id::text = new.raw_user_meta_data->>'tlc_password_reset_request'
        and r.target_id = new.id and r.consumed_at is null
        and r.created_at > changed_at - interval '2 minutes' for update;
    if reset.id is null or not exists (select 1 from public.admin_users a
      where a.id = reset.actor_id and a.role = 'super_admin' and not a.must_change_password) then
      raise exception 'Invalid password reset request' using errcode = '42501';
    end if;
    update app_private.password_reset_requests set consumed_at = changed_at where id = reset.id;
    new.raw_user_meta_data := new.raw_user_meta_data - 'tlc_password_reset_request';
  elsif exists (select 1 from public.employee_profiles p where p.id = new.id and p.terminated_at is not null)
    and not exists (select 1 from public.admin_users a where a.id = new.id) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;
  update public.admin_users set must_change_password = (reset.id is not null), access_reset_at = changed_at
    where id = new.id returning case when role = 'super_admin' then 'Super Administrator' else username end into target_name;
  update public.employee_profiles set must_change_password = (reset.id is not null), access_reset_at = changed_at,
    access_generation = access_generation + 1 where id = new.id;
  if target_name is null then select full_name into target_name from public.employee_profiles where id = new.id; end if;
  if reset.id is not null then
    insert into public.admin_activity_log (actor_id, actor_name, employee_id, employee_name, action, after_data)
      values (reset.actor_id, 'Super Administrator', new.id, coalesce(target_name, 'Account'),
        'reset-password', '{"password_reset":true,"must_change_password":true}'::jsonb);
  end if;
  return new;
end;
$$;
revoke all on function app_private.apply_password_change() from public, anon, authenticated;
-- BEFORE trigger runs ahead of the existing termination guard; authorized
-- password resets remain possible without reactivating a terminated account.
create trigger apply_account_password_change before update of encrypted_password on auth.users
  for each row execute function app_private.apply_password_change();

-- Keep the existing termination guard for email/phone/metadata. Password
-- authorization is now enforced atomically by apply_account_password_change.
create or replace function app_private.guard_terminated_auth_updates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare employee public.employee_profiles;
begin
  select * into employee from public.employee_profiles where id = new.id for update;
  if employee.terminated_at is not null and (
    old.phone is distinct from new.phone or old.raw_user_meta_data is distinct from new.raw_user_meta_data
    or (old.email is distinct from new.email and not exists (
      select 1 from public.admin_activity_log requested
      where requested.employee_id = new.id and requested.action = 'email-change-requested'
        and requested.after_data->>'email' = new.email
        and requested.occurred_at > clock_timestamp() - interval '2 minutes'
        and not exists (select 1 from public.admin_activity_log completed
          where completed.after_data->>'requestId' = requested.id::text)
    ))) then raise exception 'Employee access required' using errcode = '42501'; end if;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
