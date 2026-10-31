begin;
set local lock_timeout = '3s';
lock table auth.users in share row exclusive mode nowait;
lock table public.employee_profiles, public.admin_users in access exclusive mode nowait;

alter table app_private.password_reset_requests add column kind text not null default 'reset' check (kind in ('reset','change'));
-- One password operation per account at a time, including its Auth API calls.
create unique index password_request_in_flight on app_private.password_reset_requests (target_id) where consumed_at is null;

create or replace function public.request_account_password_reset(actor_id uuid, target_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if actor_id = target_id or not exists (select 1 from public.admin_users a
    where a.id = actor_id and a.role = 'super_admin' and not a.must_change_password) then
    raise exception 'Super administrator access required' using errcode = '42501'; end if;
  if not exists (select 1 from public.employee_profiles p where p.id = target_id)
    and not exists (select 1 from public.admin_users a where a.id = target_id and a.role = 'admin') then
    raise exception 'Account not found' using errcode = 'P0002'; end if;
  delete from app_private.password_reset_requests where created_at < clock_timestamp() - interval '2 minutes';
  insert into app_private.password_reset_requests (actor_id,target_id,kind) values (actor_id,target_id,'reset') returning id into request_id;
  return request_id;
exception when unique_violation then
  raise exception 'A password update is already in progress. Please retry shortly.' using errcode = '40001';
end;
$$;
create function public.request_own_password_change(account_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if not exists (select 1 from public.admin_users a where a.id = account_id)
    and not exists (select 1 from public.employee_profiles p where p.id = account_id and p.is_active and p.terminated_at is null) then
    raise exception 'Account access required' using errcode = '42501'; end if;
  delete from app_private.password_reset_requests where created_at < clock_timestamp() - interval '2 minutes';
  insert into app_private.password_reset_requests (actor_id,target_id,kind) values (account_id,account_id,'change') returning id into request_id;
  return request_id;
exception when unique_violation then
  raise exception 'A password update is already in progress. Please retry shortly.' using errcode = '40001';
end;
$$;
create function public.cancel_password_request(request_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from app_private.password_reset_requests where id = request_id and consumed_at is null;
$$;
revoke all on function public.request_own_password_change(uuid), public.cancel_password_request(uuid) from public,anon,authenticated;
grant execute on function public.request_own_password_change(uuid), public.cancel_password_request(uuid) to service_role;

-- Auth writes encrypted_password BEFORE user_metadata in admin updates.
-- Use a separate, server-only app_metadata marker established first. Never
-- trust client-editable user_metadata to authorize an account reset.
create or replace function app_private.apply_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare intent app_private.password_reset_requests; target_name text; changed_at timestamptz := clock_timestamp();
begin
  if old.encrypted_password is not distinct from new.encrypted_password then return new; end if;
  perform 1 from public.employee_profiles where id = new.id for update;
  if new.raw_app_meta_data ? 'tlc_password_change_request' then
    select * into intent from app_private.password_reset_requests r
      where r.id::text = new.raw_app_meta_data->>'tlc_password_change_request'
        and r.target_id = new.id and r.consumed_at is null
        and r.created_at > changed_at - interval '2 minutes' for update;
    if intent.id is null or (intent.kind = 'reset' and not exists (select 1 from public.admin_users a
      where a.id = intent.actor_id and a.role = 'super_admin' and not a.must_change_password)) then
      raise exception 'Invalid password operation' using errcode = '42501'; end if;
    update app_private.password_reset_requests set consumed_at = changed_at where id = intent.id;
    new.raw_app_meta_data := new.raw_app_meta_data - 'tlc_password_change_request';
  end if;
  if coalesce(intent.kind,'') <> 'reset' and exists (select 1 from public.employee_profiles p where p.id = new.id and p.terminated_at is not null)
    and not exists (select 1 from public.admin_users a where a.id = new.id) then
    raise exception 'Employee access required' using errcode = '42501'; end if;
  -- Auth may rehash a password during sign-in. An unmarked hash update must
  -- never clear mandatory setup flags or invalidate that sign-in's session.
  if intent.id is null then return new; end if;
  update public.admin_users set must_change_password = (intent.kind = 'reset'),access_reset_at = changed_at
    where id = new.id returning case when role = 'super_admin' then 'Super Administrator' else username end into target_name;
  update public.employee_profiles set must_change_password = (intent.kind = 'reset'),access_reset_at = changed_at,
    access_generation = access_generation + 1 where id = new.id;
  if target_name is null then select full_name into target_name from public.employee_profiles where id = new.id; end if;
  if intent.kind = 'reset' then
    insert into public.admin_activity_log (actor_id,actor_name,employee_id,employee_name,action,after_data)
      values (intent.actor_id,'Super Administrator',new.id,coalesce(target_name,'Account'),
        'reset-password','{"password_reset":true,"must_change_password":true}'::jsonb);
  end if;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
