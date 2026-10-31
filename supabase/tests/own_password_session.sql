do $$
declare
  owner_id uuid; employee uuid := gen_random_uuid(); administrator uuid := gen_random_uuid();
  account_id uuid; accounts uuid[]; current_session uuid; other_session uuid; request_id uuid;
  old_cutoff timestamptz := clock_timestamp() - interval '1 hour'; old_generation bigint;
begin
  insert into auth.users (id,email) values (employee,'stay-employee-' || employee || '@example.invalid'),
    (administrator,'stay-admin-' || administrator || '@example.invalid');
  insert into public.admin_users (id,username,role) values (administrator,'stay_' || left(replace(administrator::text,'-',''),20),'admin');
  update public.employee_profiles set is_active=true where id=employee;
  accounts := array[employee,administrator];
  -- The real owner is never mutated during hosted checks. The isolated runner
  -- also exercises its synthetic Super Administrator fixture through this loop.
  if current_setting('app.test_isolated_super',true) = 'true' then
    select id into owner_id from public.admin_users where role='super_admin';
    accounts := array_append(accounts,owner_id);
  end if;
  foreach account_id in array accounts loop
    current_session := gen_random_uuid(); other_session := gen_random_uuid();
    update public.employee_profiles set access_reset_at=old_cutoff,must_change_password=true where id=account_id;
    update public.admin_users set access_reset_at=old_cutoff,must_change_password=true where id=account_id;
    insert into auth.sessions (id,user_id,created_at) values
      (current_session,account_id,clock_timestamp()),(other_session,account_id,clock_timestamp());
    select access_generation into old_generation from public.employee_profiles where id=account_id;
    request_id := public.request_own_password_change(account_id);
    update auth.users set raw_app_meta_data=jsonb_build_object('tlc_password_change_request',request_id) where id=account_id;
    update auth.users set encrypted_password='synthetic-preserved-session-password' where id=account_id;
    if exists (select 1 from public.employee_profiles where id=account_id and
      (access_reset_at is distinct from old_cutoff or access_generation<>old_generation or must_change_password)) then
      raise exception 'Self-service invalidated its current session or left setup required'; end if;
    if exists (select 1 from public.admin_users where id=account_id and
      (access_reset_at is distinct from old_cutoff or must_change_password)) then raise exception 'Administrator self-service invalidated its current session'; end if;
    -- Model Auth's LogoutAllExceptMe, which happens in the password transaction.
    delete from auth.sessions where user_id=account_id and id<>current_session;
    if account_id=employee then
      if not app_private.employee_session_allowed(account_id,current_session) then raise exception 'Employee current session was rejected'; end if;
      if app_private.employee_session_allowed(account_id,other_session) then raise exception 'Employee other session survived'; end if;
    else
      if not app_private.admin_session_allowed(account_id,current_session) then raise exception 'Administrator current session was rejected'; end if;
      if app_private.admin_session_allowed(account_id,other_session) then raise exception 'Administrator other session survived'; end if;
    end if;
  end loop;
end;
$$;
select 'Own password changes preserve the current session and revoke other sessions' as result;
