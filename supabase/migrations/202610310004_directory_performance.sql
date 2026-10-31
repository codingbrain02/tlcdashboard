begin;

-- These views are used only by the server-side admin-api service client.
-- Exclude administrators before counting, sorting, and paginating results.
create or replace view public.admin_employee_directory
with (security_invoker = true) as
select p.id, p.full_name, p.email, p.position, p.phone_number,
       p.is_active, p.created_at
from public.employee_profiles p
where not exists (
  select 1 from public.admin_users a where a.id = p.id
);

create or replace view public.admin_attendance_directory
with (security_invoker = true) as
select a.id, a.user_id, p.full_name, a.clock_in, a.clock_out
from public.attendance a
join public.employee_profiles p on p.id = a.user_id
where not exists (
  select 1 from public.admin_users administrator
  where administrator.id = a.user_id
);

revoke all on public.admin_employee_directory, public.admin_attendance_directory
  from public, anon, authenticated;
grant select on public.employee_profiles, public.attendance, public.admin_users
  to service_role;
grant select on public.admin_employee_directory, public.admin_attendance_directory
  to service_role;

create index if not exists employee_profiles_added_recent
  on public.employee_profiles (created_at desc, id);
create index if not exists employee_profiles_name_order
  on public.employee_profiles (full_name, id);
create index if not exists employee_profiles_position_name_order
  on public.employee_profiles (position, full_name, id);
create index if not exists attendance_global_recent
  on public.attendance (clock_in desc, id);

-- Substring search needs trigram indexes; the operator class can live in
-- either public or extensions depending on how pg_trgm was first installed.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$
declare
  trigram_schema name;
begin
  select n.nspname into trigram_schema
  from pg_catalog.pg_opclass o
  join pg_catalog.pg_namespace n on n.oid = o.opcnamespace
  where o.opcname = 'gin_trgm_ops'
  limit 1;
  if trigram_schema is null then
    raise exception 'pg_trgm GIN operator class is unavailable';
  end if;
  execute pg_catalog.format(
    'create index if not exists employee_profiles_name_search on public.employee_profiles using gin (full_name %I.gin_trgm_ops)',
    trigram_schema
  );
  execute pg_catalog.format(
    'create index if not exists employee_profiles_position_search on public.employee_profiles using gin (position %I.gin_trgm_ops)',
    trigram_schema
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
