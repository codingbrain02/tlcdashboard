begin;

-- Keep the Auth email readable to its employee and the super administrator
-- through the existing RLS-protected profile table. Auth remains the source
-- of truth; clients cannot write this column.
alter table public.employee_profiles add column email text;

update public.employee_profiles p
set email = u.email
from auth.users u
where p.id = u.id;

create or replace function public.create_employee_profile()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.employee_profiles (id, full_name, phone_number, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    left(coalesce(new.raw_user_meta_data ->> 'phone', new.phone, ''), 40),
    new.email
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create function public.sync_employee_profile_email()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.employee_profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_employee_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_employee_profile_email();

create policy super_admin_reads_employee_profiles
  on public.employee_profiles for select to authenticated
  using ((select public.is_super_administrator()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_profiles'
  ) then
    alter publication supabase_realtime add table public.employee_profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_users'
  ) then
    alter publication supabase_realtime add table public.admin_users;
  end if;
end;
$$;

commit;
