do $$
declare
  owner_id uuid; administrator uuid := gen_random_uuid(); employee uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid(); next_session uuid := gen_random_uuid(); request_id uuid;
begin
  select id into owner_id from public.admin_users where role = 'super_admin';
  insert into auth.users (id,email) values (administrator,'direct-admin-' || administrator || '@example.invalid'),
    (employee,'direct-employee-' || employee || '@example.invalid');
  insert into public.admin_users (id,username,role,must_change_password)
    values (administrator,'direct_' || left(replace(administrator::text,'-',''),20),'admin',true);
  update public.employee_profiles set is_active = true,must_change_password = true where id = employee;
  insert into auth.sessions (id,user_id,created_at) values (session_id,employee,clock_timestamp());
  insert into public.attendance (user_id,clock_in) values (employee,clock_timestamp());
  begin
    perform public.request_account_password_set(administrator,employee);
    raise exception 'Regular administrator changed another password';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_account_password_set(employee,administrator);
    raise exception 'Employee changed another password';
  exception when insufficient_privilege then null; end;
  request_id := public.request_account_password_set(owner_id,employee);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
  update auth.users set encrypted_password = 'synthetic-direct-password' where id = employee;
  if exists (select 1 from public.employee_profiles where id = employee and must_change_password) then
    raise exception 'Direct password change forced temporary-password setup'; end if;
  if app_private.employee_session_allowed(employee,session_id,true) then raise exception 'Old session survived direct password change'; end if;
  insert into auth.sessions (id,user_id,created_at) values (next_session,employee,clock_timestamp());
  if not app_private.employee_session_allowed(employee,next_session,false) then raise exception 'Direct password needs another change before use'; end if;
  if not exists (select 1 from public.attendance where user_id = employee and clock_out is null) then raise exception 'Direct change stopped attendance'; end if;
  if not exists (select 1 from public.admin_activity_log where employee_id = employee and actor_id = owner_id
    and action = 'set-password' and after_data = '{"password_changed":true,"must_change_password":false}'::jsonb) then
    raise exception 'Direct password change audit missing or contains unexpected data'; end if;
  request_id := public.request_account_password_set(owner_id,administrator);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = administrator;
  update auth.users set encrypted_password = 'synthetic-direct-admin-password' where id = administrator;
  if exists (select 1 from public.admin_users where id = administrator and must_change_password) then raise exception 'Admin direct password was temporary'; end if;
  update public.employee_profiles set is_active = false,terminated_at = clock_timestamp() where id = employee;
  request_id := public.request_account_password_set(owner_id,employee);
  update auth.users set raw_app_meta_data = jsonb_build_object('tlc_password_change_request',request_id) where id = employee;
  update auth.users set encrypted_password = 'synthetic-terminated-direct-password' where id = employee;
  if not exists (select 1 from public.employee_profiles where id = employee and not is_active and terminated_at is not null) then
    raise exception 'Direct password change reactivated a terminated account'; end if;
  if has_function_privilege('authenticated','public.request_account_password_set(uuid,uuid)','execute') then raise exception 'Client can bypass direct password authorization'; end if;
end;
$$;
select 'Direct Super Administrator password checks passed' as result;
