begin;

-- Employees may change only their own phone number. Email changes go through
-- Supabase Auth's confirmation flow, and every other profile field stays
-- administrator-managed.
grant update (phone_number) on public.employee_profiles to authenticated;

create policy employee_updates_own_phone
  on public.employee_profiles for update to authenticated
  using (
    id = (select auth.uid())
    and is_active
    and not must_change_password
  )
  with check (
    id = (select auth.uid())
    and is_active
    and not must_change_password
    and phone_number ~ '^\+[1-9][0-9]{6,14}$'
  );

commit;
