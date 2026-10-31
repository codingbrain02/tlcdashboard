begin;

-- Apply only after the employee frontend using clock_out_shift_if_current is live.
-- The old no-argument RPC can close a newer shift from a stale browser tab.
revoke execute on function public.clock_out_shift() from public, anon, authenticated;
drop function public.clock_out_shift();

notify pgrst, 'reload schema';
commit;
