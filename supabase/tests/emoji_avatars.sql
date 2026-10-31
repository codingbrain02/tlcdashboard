-- Synthetic accounts only; the runner/hosted verification wraps this in ROLLBACK.
do $$
declare employee uuid := gen_random_uuid(); colleague uuid := gen_random_uuid(); administrator uuid := gen_random_uuid();
  employee_session uuid := gen_random_uuid(); admin_session uuid := gen_random_uuid();
begin
  insert into auth.users (id,email) values
    (employee,'emoji-' || employee || '@example.invalid'),
    (colleague,'emoji-' || colleague || '@example.invalid'),
    (administrator,'emoji-admin-' || administrator || '@example.invalid');
  update public.employee_profiles set is_active=true,must_change_password=false where id in (employee,colleague,administrator);
  insert into public.admin_users (id,username,role,must_change_password)
    values (administrator,'emoji_' || left(replace(administrator::text,'-',''),20),'admin',false);
  insert into auth.sessions (id,user_id,created_at) values
    (employee_session,employee,clock_timestamp()),(admin_session,administrator,clock_timestamp());
  perform set_config('app.emoji.employee',employee::text,true);
  perform set_config('app.emoji.colleague',colleague::text,true);
  perform set_config('app.emoji.admin',administrator::text,true);
  perform set_config('app.emoji.session',employee_session::text,true);
  perform set_config('app.emoji.admin_session',admin_session::text,true);
  if has_function_privilege('anon','public.set_own_avatar_emoji(text)','EXECUTE') then raise exception 'Anonymous avatar writes allowed'; end if;
  if has_column_privilege('authenticated','public.employee_profiles','avatar_emoji','UPDATE') then raise exception 'Unrestricted direct avatar writes allowed'; end if;
  if exists (select 1 from public.employee_profiles where id in (employee,colleague) and avatar_emoji<>'🙂') then raise exception 'Default emoji missing'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',employee,'session_id',employee_session)::text,true);
end;
$$;

set local role authenticated;
do $$
declare invalid text; before_revision bigint;
begin
  if public.set_own_avatar_emoji('🐼') <> '🐼' then raise exception 'Emoji did not save'; end if;
  if not exists (select 1 from public.employee_profiles where id=auth.uid() and avatar_emoji='🐼') then raise exception 'Saved emoji not readable by owner'; end if;
  select revision into before_revision from public.employee_profiles where id=auth.uid();
  perform public.set_own_avatar_emoji('🐼');
  if exists (select 1 from public.employee_profiles where id=auth.uid() and revision<>before_revision) then raise exception 'Unchanged emoji caused a write'; end if;
  if exists (select 1 from public.employee_profiles where id=current_setting('app.emoji.colleague')::uuid) then raise exception 'Colleague profile exposed'; end if;
  foreach invalid in array array['https://example.com/photo.png','data:image/png;base64,AAA','<img src=x onerror=alert(1)>','hello','🐼🐼','',null] loop
    begin
      perform public.set_own_avatar_emoji(invalid);
      raise exception 'Non-catalog avatar accepted: %',invalid;
    exception when check_violation or not_null_violation then null;
    end;
  end loop;
  begin
    update public.employee_profiles set avatar_emoji='🦊' where id=auth.uid();
    raise exception 'Direct UPDATE bypassed avatar RPC';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.set_own_avatar_emoji('🦊'); raise exception 'Missing session accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('app.emoji.colleague'),'session_id',current_setting('app.emoji.session'))::text,true);
  begin
    perform public.set_own_avatar_emoji('🦊'); raise exception 'Another employee session accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('app.emoji.admin'),'session_id',current_setting('app.emoji.admin_session'))::text,true);
  if not exists (select 1 from public.employee_profiles where id=current_setting('app.emoji.employee')::uuid and avatar_emoji='🐼') then raise exception 'Administrator could not read saved emoji'; end if;
  begin
    perform public.set_own_avatar_emoji('🦊'); raise exception 'Administrator used employee avatar RPC';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

-- Directory listings are service-only after the Edge Function authorizes the
-- admin. Do not grant browser roles direct access to this service view.
do $$ begin
  if not exists (select 1 from public.admin_employee_directory where id=current_setting('app.emoji.employee')::uuid and avatar_emoji='🐼') then raise exception 'Service directory did not include saved emoji'; end if;
end; $$;

do $$
declare state text; employee uuid := current_setting('app.emoji.employee')::uuid;
begin
  foreach state in array array['temporary','inactive','terminated','revoked'] loop
    update public.employee_profiles set
      is_active=state not in ('inactive','terminated'), must_change_password=state='temporary',
      terminated_at=case when state='terminated' then clock_timestamp() else null end,
      access_reset_at=case when state='revoked' then clock_timestamp() else null end
      where id=employee;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',employee,'session_id',current_setting('app.emoji.session'))::text,true);
    execute 'set local role authenticated';
    begin
      perform public.set_own_avatar_emoji('🦊');
      raise exception 'Ineligible employee avatar change allowed: %',state;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
  if not exists (select 1 from public.employee_profiles where id=employee and avatar_emoji='🐼') then raise exception 'Rejected avatar change mutated the profile'; end if;
  if not exists (select 1 from public.employee_profiles where id=current_setting('app.emoji.colleague')::uuid and avatar_emoji='🙂') then raise exception 'Colleague emoji was changed'; end if;
end;
$$;
select 'Emoji avatars: persistence, allowlist, employee/session isolation and admin visibility passed' as result;
