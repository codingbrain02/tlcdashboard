begin;

-- Keep view DDL in a separate transaction from table ALTERs. Live directory
-- queries acquire a view lock before its underlying table locks; changing both
-- in the opposite order in one transaction can deadlock with those readers.
create or replace view public.admin_employee_directory with (security_invoker = true) as
select p.id, p.full_name, p.email, p.position, p.phone_number, p.is_active, p.created_at,
  p.terminated_at, p.termination_reason, p.termination_details, p.employment_start_date,
  p.revision, p.access_generation, p.auth_sync_pending
from public.employee_profiles p where not exists (select 1 from public.admin_users a where a.id = p.id);
create or replace view public.admin_attendance_directory with (security_invoker = true) as
select a.id, a.user_id, p.full_name, a.clock_in, a.clock_out, a.end_reason
from public.attendance a join public.employee_profiles p on p.id = a.user_id
where not exists (select 1 from public.admin_users administrator where administrator.id = a.user_id);

notify pgrst, 'reload schema';
commit;
