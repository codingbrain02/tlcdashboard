begin;
set local lock_timeout = '3s';
lock table public.employee_profiles in access exclusive mode nowait;

alter table public.employee_profiles
  add column avatar_emoji text not null default '🙂'
  constraint employee_avatar_emoji_allowed check (avatar_emoji in (
    '🙂',
    '😊',
    '😄',
    '😎',
    '🤓',
    '🤩',
    '🥳',
    '😌',
    '😺',
    '🤖',
    '👽',
    '👻',
    '🐼',
    '🐨',
    '🦊',
    '🐯',
    '🐱',
    '🐶',
    '🦁',
    '🐸',
    '🐻',
    '🐰',
    '🐧',
    '🦉',
    '🌻',
    '🌵',
    '🌲',
    '🍀',
    '🌸',
    '🌈',
    '☀️',
    '🌙',
    '⭐',
    '🌊',
    '🍄',
    '🪴',
    '🚀',
    '🎨',
    '🎮',
    '🎧',
    '🎸',
    '📚',
    '💻',
    '⚽',
    '🏀',
    '☕',
    '💡',
    '🛸'
  ));

-- Do not broaden profile UPDATE grants or phone-number policies. This RPC can
-- change only the caller's emoji, and a terminated/revoked/temporary session
-- cannot use it. Share the lifecycle lock order so termination wins atomically.
create function public.set_own_avatar_emoji(emoji text)
returns text language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from public.employee_profiles where id = auth.uid() for update;
  if not app_private.employee_session_allowed(auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;
  update public.employee_profiles set avatar_emoji = emoji
    where id = auth.uid() and avatar_emoji is distinct from emoji;
  return emoji;
end;
$$;
revoke all on function public.set_own_avatar_emoji(text) from public, anon, authenticated;
grant execute on function public.set_own_avatar_emoji(text) to authenticated;

notify pgrst, 'reload schema';
commit;
