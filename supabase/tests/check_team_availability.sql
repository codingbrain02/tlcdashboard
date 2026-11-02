-- Read-only hosted verification. Returns totals and permissions, no personal data.
select totals.*,
  totals.active_employees = totals.on_duty + totals.off_duty as consistent_total,
  not has_function_privilege('anon', 'public.admin_team_availability()', 'execute') as anonymous_blocked,
  not has_function_privilege('authenticated', 'public.admin_team_availability()', 'execute') as browser_roles_blocked,
  has_function_privilege('service_role', 'public.admin_team_availability()', 'execute') as service_allowed
from public.admin_team_availability() totals;
