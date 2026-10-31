-- Run after the migration inside a transaction and ROLLBACK afterward.
-- All mutated accounts are synthetic. No Auth API calls or emails are made.
do $$
declare
  employee uuid := gen_random_uuid();
  other_employee uuid := gen_random_uuid();
  administrator uuid := gen_random_uuid();
  owner_id uuid;
  old_session uuid := gen_random_uuid();
  new_session uuid := gen_random_uuid();
  shift public.attendance;
  profile public.employee_profiles;
  event_count integer;
  email_request jsonb;
begin
  select id into owner_id from public.admin_users where role = 'super_admin';
  if owner_id is null then raise exception 'Test requires the provisioned Super Administrator'; end if;
  insert into auth.users (id, email, aud, role) values
    (employee, 'lifecycle-' || employee || '@example.invalid', 'authenticated', 'authenticated'),
    (other_employee, 'lifecycle-' || other_employee || '@example.invalid', 'authenticated', 'authenticated'),
    (administrator, 'lifecycle-' || administrator || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.admin_users (id, username, role) values (administrator, 'qa_' || left(replace(administrator::text, '-', ''), 20), 'admin');
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
    values (old_session, employee, clock_timestamp(), clock_timestamp(), 'aal1');
  perform public.admin_employee_command(administrator, employee, 'create-employee',
    '{"fullName":"Lifecycle Test","position":"Developer","phoneNumber":"+639171234567"}', 0);
  if not exists (select 1 from public.admin_activity_log where employee_id = employee and actor_id = administrator and action = 'create-employee') then raise exception 'Creation audit missing'; end if;
  update public.employee_profiles set must_change_password = false where id = employee;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', employee, 'role', 'authenticated', 'session_id', old_session)::text, true);
  if not public.employee_session_allowed() then raise exception 'Valid employee session denied'; end if;
  select * into shift from public.clock_in_shift();
  begin
    perform public.clock_in_shift(); raise exception 'Duplicate clock-in allowed';
  exception when unique_violation then null; end;
  select * into profile from public.employee_profiles where id = employee;
  begin
    perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"Other"}', profile.revision);
    raise exception 'Other without details allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"Misconduct"}', null);
    raise exception 'Missing revision allowed';
  exception when serialization_failure then null; end;
  perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"Other","reason":"Synthetic test"}', profile.revision);
  if not exists (select 1 from public.attendance where id = shift.id and clock_out is not null and end_reason = 'terminated') then raise exception 'Termination did not close the correct shift'; end if;
  if public.employee_session_allowed() then raise exception 'Terminated session allowed'; end if;
  begin
    update auth.users set email = 'blocked-' || employee || '@example.invalid' where id = employee;
    raise exception 'Terminated employee changed Auth email';
  exception when insufficient_privilege then null; end;
  begin
    update auth.users set encrypted_password = 'blocked-test-value' where id = employee;
    raise exception 'Terminated employee changed password';
  exception when insufficient_privilege then null; end;
  begin
    perform public.clock_in_shift(); raise exception 'Terminated employee clocked in';
  exception when insufficient_privilege then null; end;
  begin
    perform public.clock_out_shift_if_current(shift.id); raise exception 'Terminated employee clocked out';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_employee_command(administrator, employee, 'rehire', jsonb_build_object('startDate', current_date), profile.revision);
    raise exception 'Stale confirmation accepted';
  exception when serialization_failure then null; end;
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(administrator, employee, 'reverse-termination', '{"reason":"Accidental termination"}', profile.revision);
  if public.employee_session_allowed() then raise exception 'Reversal revived old session'; end if;
  if exists (select 1 from public.attendance where user_id = employee and clock_out is null) then raise exception 'Reversal restarted timer'; end if;
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (new_session, employee, clock_timestamp(), clock_timestamp(), 'aal1');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', employee, 'role', 'authenticated', 'session_id', new_session)::text, true);
  if not public.employee_session_allowed() then raise exception 'Fresh sign-in denied'; end if;
  select * into profile from public.employee_profiles where id = employee;
  begin
    perform public.admin_employee_command(administrator, employee, 'update-profile', '{"fullName":"Unauthorized","position":"Developer","phoneNumber":"+639171234567"}', profile.revision);
    raise exception 'Regular admin edited details';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_employee_command(administrator, employee, 'update-attendance', '{}', profile.revision);
    raise exception 'Regular admin edited attendance';
  exception when insufficient_privilege then null; end;
  perform public.admin_employee_command(owner_id, employee, 'update-profile', '{"fullName":"Edited Test","position":"Developer","phoneNumber":"+639171234568"}', profile.revision);
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"End of contract"}', profile.revision);
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(administrator, employee, 'rehire', jsonb_build_object('startDate', current_date), profile.revision);
  if (select count(*) from public.attendance where user_id = employee) <> 1 then raise exception 'Rehire changed history'; end if;
  if not exists (select 1 from public.employee_profiles where id = employee and is_active and terminated_at is null and employment_start_date = current_date) then raise exception 'Rehire did not restore the same account'; end if;
  if public.employee_session_allowed() then raise exception 'Rehire revived old session'; end if;
  if not exists (select 1 from public.employee_account_access where id = employee and enabled and generation = 4) then raise exception 'Access notification state did not track lifecycle'; end if;
  select count(*) into event_count from public.admin_activity_log where employee_id = employee;
  if event_count <> 6 then raise exception 'Expected 6 successful events, found %', event_count; end if;
  select * into shift from public.attendance where user_id = employee;
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(owner_id, employee, 'update-attendance', jsonb_build_object(
    'shiftId', shift.id, 'clockIn', shift.clock_in - interval '1 minute', 'clockOut', shift.clock_out,
    'endReason', 'terminated', 'expectedClockIn', shift.clock_in, 'expectedClockOut', shift.clock_out,
    'expectedEndReason', shift.end_reason, 'reason', 'Correct the start time'
  ), profile.revision);
  if not exists (select 1 from public.admin_activity_log where employee_id = employee and action = 'update-attendance'
    and before_data->>'clock_in' <> after_data->>'clock_in') then raise exception 'Attendance correction did not audit before/after'; end if;
  begin
    perform public.admin_employee_command(owner_id, employee, 'update-attendance', jsonb_build_object(
      'shiftId', shift.id, 'clockIn', shift.clock_in, 'clockOut', shift.clock_out,
      'endReason', 'terminated', 'expectedClockIn', shift.clock_in, 'expectedClockOut', shift.clock_out,
      'expectedEndReason', shift.end_reason, 'reason', 'Stale correction'
    ), profile.revision);
    raise exception 'Stale shift correction accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_employee_command(administrator, administrator, 'terminate', '{"category":"Misconduct"}', 0);
    raise exception 'Employee controls targeted an administrator';
  exception when no_data_found then null; end;
  begin
    update public.admin_activity_log set reason = 'tampered' where employee_id = employee; raise exception 'Editable audit';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.admin_activity_log where employee_id = employee; raise exception 'Deletable audit';
  exception when insufficient_privilege then null; end;
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"Misconduct"}', profile.revision);
  select * into profile from public.employee_profiles where id = employee;
  email_request := public.admin_employee_command(owner_id, employee, 'email-change-requested',
    jsonb_build_object('email', 'edited-' || employee || '@example.invalid'), profile.revision);
  update auth.users set email = 'edited-' || employee || '@example.invalid' where id = employee;
  perform public.admin_employee_command(owner_id, employee, 'email-changed',
    jsonb_build_object('email', 'edited-' || employee || '@example.invalid', 'requestId', email_request->>'eventId'), profile.revision);
  if not exists (select 1 from public.employee_profiles where id = employee and email = 'edited-' || employee || '@example.invalid') then raise exception 'Confirmed Super Admin email edit did not synchronize'; end if;
  select * into profile from public.employee_profiles where id = employee;
  perform public.admin_employee_command(administrator, employee, 'reverse-termination', '{"reason":"Test complete"}', profile.revision);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', administrator, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.admin_activity_log) then raise exception 'Regular admin read audit'; end if;
  begin
    perform public.admin_employee_command(administrator, employee, 'terminate', '{"category":"Misconduct"}', 0);
    raise exception 'Browser spoofed service actor';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', employee, 'role', 'authenticated', 'session_id', new_session)::text, true);
  if exists (select 1 from public.attendance where user_id = employee) then raise exception 'Old session read attendance'; end if;
  if exists (select 1 from public.employee_profiles where id = employee) then raise exception 'Old session read personal profile after rehire'; end if;
  update public.employee_profiles set phone_number = '+639171234569' where id = employee;
  if found then raise exception 'Old session updated phone'; end if;
  if exists (select 1 from public.employee_profiles where id = other_employee) then raise exception 'Employee read another profile'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.admin_activity_log where employee_id = employee) then raise exception 'Super Admin could not read audit'; end if;
  execute 'reset role';
end;
$$;
select 'Lifecycle, session, permissions and immutable audit checks passed' as result;
