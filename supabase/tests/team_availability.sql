-- Isolated PGlite fixtures only. The runner rolls back all changes.
do $$
declare ids uuid[] := array[]::uuid[]; employee uuid; inactive uuid := gen_random_uuid();
  terminated uuid := gen_random_uuid(); administrator uuid := gen_random_uuid();
  owner_id uuid; totals record; n integer;
begin
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (0::bigint,0::bigint,0::bigint)
    then raise exception 'Isolated empty team did not return zero counts'; end if;
  if has_function_privilege('anon','public.admin_team_availability()','execute')
    or has_function_privilege('authenticated','public.admin_team_availability()','execute')
    or not has_function_privilege('service_role','public.admin_team_availability()','execute')
    then raise exception 'Team availability function grants are incorrect'; end if;

  for n in 1..25 loop
    employee := gen_random_uuid(); ids := array_append(ids,employee);
    insert into auth.users(id,email) values(employee,'team-'||employee||'@example.invalid');
    update public.employee_profiles set is_active=true,must_change_password=false where id=employee;
    insert into public.attendance(user_id,clock_in,clock_out)
      select employee,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'
      from generate_series(1,3);
  end loop;
  insert into auth.users(id,email) values
    (inactive,'team-inactive-'||inactive||'@example.invalid'),
    (terminated,'team-terminated-'||terminated||'@example.invalid'),
    (administrator,'team-admin-'||administrator||'@example.invalid');
  update public.employee_profiles set terminated_at=clock_timestamp() where id=terminated;
  update public.employee_profiles set is_active=true where id=administrator;
  insert into public.admin_users(id,username,role)
    values(administrator,'team_'||left(replace(administrator::text,'-',''),20),'admin');
  select id into owner_id from public.admin_users where role='super_admin';
  update public.employee_profiles set is_active=true where id=owner_id;
  -- Even deliberately anomalous open shifts on excluded accounts must not count.
  insert into public.attendance(user_id,clock_in) values
    (ids[1],clock_timestamp()-interval '2 hours'),(ids[25],clock_timestamp()-interval '1 hour'),
    (inactive,clock_timestamp()),(terminated,clock_timestamp()),
    (administrator,clock_timestamp()),(owner_id,clock_timestamp());

  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (25::bigint,2::bigint,23::bigint)
    then raise exception 'Counts include history, excluded accounts, or only one result page'; end if;
  update public.attendance set clock_out=clock_timestamp() where user_id=ids[1] and clock_out is null;
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (25::bigint,1::bigint,24::bigint)
    then raise exception 'Clock-out did not update team availability'; end if;
  insert into public.attendance(user_id,clock_in) values(ids[2],clock_timestamp());
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (25::bigint,2::bigint,23::bigint)
    then raise exception 'Clock-in did not update team availability'; end if;
  update public.attendance set clock_out=clock_timestamp(),end_reason='terminated'
    where user_id=ids[2] and clock_out is null;
  update public.employee_profiles set is_active=false,terminated_at=clock_timestamp() where id=ids[2];
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (24::bigint,1::bigint,23::bigint)
    then raise exception 'Termination was not excluded'; end if;
  update public.employee_profiles set is_active=true,terminated_at=null where id=ids[2];
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (25::bigint,1::bigint,24::bigint)
    then raise exception 'Restoration incorrectly resumed an old shift'; end if;
  delete from auth.users where id=ids[25];
  select * into totals from public.admin_team_availability();
  if (totals.active_employees,totals.on_duty,totals.off_duty) is distinct from (24::bigint,0::bigint,24::bigint)
    then raise exception 'Deleted employee remained in the totals'; end if;
end;
$$;

set local role authenticated;
do $$ begin
  begin
    perform public.admin_team_availability();
    raise exception 'Browser role directly accessed organization-wide counts';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

set local role service_role;
do $$ declare totals record; begin
  select * into totals from public.admin_team_availability();
  if totals.active_employees<>24 or totals.on_duty<>0 or totals.off_duty<>24
    then raise exception 'Service client cannot read complete team availability'; end if;
end; $$;
reset role;

select 'Team availability: global people counts, live transitions, exclusions and service-only permissions passed' as result;
