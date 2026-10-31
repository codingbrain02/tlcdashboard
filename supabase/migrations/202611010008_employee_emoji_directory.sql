begin;
set local lock_timeout = '3s';
-- Keep view replacement separate from the table ALTER to preserve the live
-- directory's view-first lock order. Append the new column without reordering.
create or replace view public.admin_employee_directory with (security_invoker = true) as
select p.id, p.full_name, p.email, p.position, p.phone_number, p.is_active, p.created_at,
  p.terminated_at, p.termination_reason, p.termination_details, p.employment_start_date,
  p.revision, p.access_generation, p.auth_sync_pending, p.avatar_emoji
from public.employee_profiles p where not exists (select 1 from public.admin_users a where a.id = p.id);

notify pgrst, 'reload schema';
commit;
