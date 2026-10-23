create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  auth_user auth.users%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into auth_user from auth.users where id = caller_id;
  if not found then
    raise exception 'Authenticated user is unavailable' using errcode = '42501';
  end if;

  insert into public.profiles (id, display_name)
  values (
    caller_id,
    left(coalesce(
      nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(auth_user.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'Player'
    ), 60)
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;
