do $$
declare
  owner_id uuid; administrator uuid := gen_random_uuid(); employee uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid(); next_session uuid := gen_random_uuid(); request_id uuid;
begin
  select id into owner_id from public.admin_users where role = 'super_admin';
  insert into auth.users (id,email) values (administrator,'pw-admin-' || administrator || '@example.invalid'),
    (employee,'pw-employee-' || employee || '@example.invalid');
  insert into public.admin_users (id,username,role) values (administrator,'pw_' || left(replace(administrator::text,'-',''),20),'admin');
  update public.employee_profiles set is_active = true, must_change_password = false where id = employee;
  insert into auth.sessions (id,user_id,created_at) values (session_id,employee,clock_timestamp());
  insert into public.attendance (user_id,clock_in) values (employee,clock_timestamp());
  begin
    perform public.request_account_password_reset(administrator,employee);
    raise exception 'Regular administrator reset another account';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_account_password_reset(employee,administrator);
    raise exception 'Employee reset another account';
  exception when insufficient_privilege then null; end;
  request_id := public.request_account_password_reset(owner_id,employee);
  if exists (select 1 from public.employee_profiles where id = employee and must_change_password) then
    raise exception 'Preparing a reset changed account state before Auth succeeded'; end if;
  begin
    perform public.request_account_password_reset(owner_id,employee);
    raise exception 'Concurrent password operation allowed';
  exception when serialization_failure then null; end;
  -- Model the real Auth API: metadata and encrypted_password are separate SQL writes.
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
  update auth.users set encrypted_password = 'synthetic-reset-hash' where id = employee;
  if not exists (select 1 from public.employee_profiles where id = employee and must_change_password and access_reset_at is not null) then
    raise exception 'Reset did not require password change'; end if;
  if app_private.employee_session_allowed(employee,session_id,true) then raise exception 'Old employee session survived reset'; end if;
  if not exists (select 1 from public.attendance where user_id = employee and clock_out is null) then
    raise exception 'Password reset stopped attendance'; end if;
  if not exists (select 1 from public.admin_activity_log where employee_id = employee and action = 'reset-password' and actor_id = owner_id) then
    raise exception 'Reset audit missing'; end if;
  if exists (select 1 from auth.users where id = employee and raw_app_meta_data ? 'tlc_password_change_request') then
    raise exception 'Reset marker retained'; end if;
  begin
    update auth.users set encrypted_password = 'replayed-reset',raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
    raise exception 'Consumed reset request reused';
  exception when insufficient_privilege then null; end;
  insert into auth.sessions (id,user_id,created_at) values (next_session,employee,clock_timestamp());
  if not app_private.employee_session_allowed(employee,next_session,true) then raise exception 'New session cannot change temporary password'; end if;
  update auth.users set encrypted_password = 'synthetic-auth-rehash' where id = employee;
  if not exists (select 1 from public.employee_profiles where id = employee and must_change_password) then raise exception 'Auth rehash cleared setup requirement'; end if;
  request_id := public.request_own_password_change(employee);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
  update auth.users set encrypted_password = 'synthetic-self-change' where id = employee;
  if exists (select 1 from public.employee_profiles where id = employee and must_change_password) then raise exception 'Self change did not clear temporary requirement'; end if;
  update public.employee_profiles set is_active = false,terminated_at = clock_timestamp() where id = employee;
  begin
    update auth.users set encrypted_password = 'terminated-self-change' where id = employee;
    raise exception 'Terminated employee changed own password';
  exception when insufficient_privilege then null; end;
  request_id := public.request_account_password_reset(owner_id,employee);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
  update auth.users set encrypted_password = 'terminated-super-reset' where id = employee;
  if not exists (select 1 from public.employee_profiles where id = employee and terminated_at is not null and not is_active) then
    raise exception 'Password reset reactivated terminated employee'; end if;
  insert into auth.sessions (id,user_id,created_at) values (gen_random_uuid(),administrator,clock_timestamp()) returning id into session_id;
  if not app_private.admin_session_allowed(administrator,session_id) then raise exception 'Valid admin session denied'; end if;
  request_id := public.request_account_password_reset(owner_id,administrator);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = administrator;
  update auth.users set encrypted_password = 'admin-reset' where id = administrator;
  if app_private.admin_session_allowed(administrator,session_id) then raise exception 'Old admin session survived reset'; end if;
  if not exists (select 1 from public.admin_users where id = administrator and must_change_password) then raise exception 'Admin temporary password flag missing'; end if;
  request_id := public.request_own_password_change(administrator);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = administrator;
  update auth.users set encrypted_password = 'admin-self-change' where id = administrator;
  if exists (select 1 from public.admin_users where id = administrator and must_change_password) then raise exception 'Admin cannot finish password setup'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',administrator,'role','authenticated','session_id',session_id)::text,true);
  execute 'set local role authenticated';
  if exists (select 1 from public.employee_profiles where id = employee) then raise exception 'Revoked administrator JWT read employee details'; end if;
  begin
    perform public.request_account_password_reset(owner_id,employee);
    raise exception 'Client impersonated the Super Administrator';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  begin
    update auth.users set encrypted_password = 'forged-reset', raw_app_meta_data = jsonb_build_object('tlc_password_change_request',gen_random_uuid()) where id = administrator;
    raise exception 'Forged reset accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.request_account_password_reset(uuid,uuid)','execute') then
    raise exception 'Client can bypass server authorization'; end if;
end;
$$;
select 'Password management database tests passed' as result;
