begin;
set local lock_timeout = '3s';
lock table auth.users in share row exclusive mode nowait;
lock table public.employee_profiles, public.admin_users in access exclusive mode nowait;

alter table app_private.password_reset_requests drop constraint password_reset_requests_kind_check;
alter table app_private.password_reset_requests add constraint password_reset_requests_kind_check check (kind in ('reset','change','set'));

-- Reuse the existing server-only role/target checks and per-account lease.
create function public.request_account_password_set(actor_id uuid, target_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  request_id := public.request_account_password_reset(actor_id,target_id);
  update app_private.password_reset_requests set kind = 'set' where id = request_id;
  return request_id;
end;
$$;
revoke all on function public.request_account_password_set(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_account_password_set(uuid,uuid) to service_role;

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
    if intent.id is null or (intent.kind in ('reset','set') and not exists (select 1 from public.admin_users a
      where a.id = intent.actor_id and a.role = 'super_admin' and not a.must_change_password)) then
      raise exception 'Invalid password operation' using errcode = '42501'; end if;
    update app_private.password_reset_requests set consumed_at = changed_at where id = intent.id;
    new.raw_app_meta_data := new.raw_app_meta_data - 'tlc_password_change_request';
  end if;
  if coalesce(intent.kind,'') not in ('reset','set') and exists (select 1 from public.employee_profiles p where p.id = new.id and p.terminated_at is not null)
    and not exists (select 1 from public.admin_users a where a.id = new.id) then
    raise exception 'Employee access required' using errcode = '42501'; end if;
  if intent.id is null then return new; end if;
  update public.admin_users set must_change_password = (intent.kind = 'reset'),access_reset_at = changed_at
    where id = new.id returning case when role = 'super_admin' then 'Super Administrator' else username end into target_name;
  update public.employee_profiles set must_change_password = (intent.kind = 'reset'),access_reset_at = changed_at,
    access_generation = access_generation + 1 where id = new.id;
  if target_name is null then select full_name into target_name from public.employee_profiles where id = new.id; end if;
  if intent.kind in ('reset','set') then
    insert into public.admin_activity_log (actor_id,actor_name,employee_id,employee_name,action,after_data)
      values (intent.actor_id,'Super Administrator',new.id,coalesce(target_name,'Account'),
        case when intent.kind = 'set' then 'set-password' else 'reset-password' end,
        jsonb_build_object('password_changed',true,'must_change_password',intent.kind = 'reset'));
  end if;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
