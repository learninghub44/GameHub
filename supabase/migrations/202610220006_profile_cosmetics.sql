alter table public.profiles
  add column profile_cosmetic_key text not null default 'classic',
  add constraint profiles_profile_cosmetic_key_check check (
    profile_cosmetic_key in (
      'classic',
      'accent-cyan',
      'accent-violet',
      'accent-amber',
      'frame-ember',
      'frame-gold',
      'frame-neon'
    )
  );

grant select (profile_cosmetic_key) on public.profiles to anon;

create index entitlements_active_cosmetic_lookup_idx
  on public.entitlements (user_id, entitlement_key)
  where revoked_at is null;

create or replace function public.equip_profile_cosmetic(requested_cosmetic_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if requested_cosmetic_key not in (
    'classic',
    'accent-cyan',
    'accent-violet',
    'accent-amber',
    'frame-ember',
    'frame-gold',
    'frame-neon'
  ) then
    raise exception 'Unsupported profile style' using errcode = '22023';
  end if;

  if requested_cosmetic_key in ('frame-ember', 'frame-gold', 'frame-neon')
     and not exists (
       select 1
       from public.entitlements e
       where e.user_id = caller_id
         and e.entitlement_key = requested_cosmetic_key
         and e.revoked_at is null
     ) then
    raise exception 'This profile frame has not been unlocked' using errcode = '42501';
  end if;

  update public.profiles
  set profile_cosmetic_key = requested_cosmetic_key
  where id = caller_id;

  if not found then
    raise exception 'Profile is unavailable' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.equip_profile_cosmetic(text) from public, anon;
grant execute on function public.equip_profile_cosmetic(text) to authenticated;

create or replace function public.reset_revoked_profile_cosmetic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null
     and new.entitlement_key in ('frame-ember', 'frame-gold', 'frame-neon')
     and not exists (
       select 1
       from public.entitlements e
       where e.user_id = new.user_id
         and e.entitlement_key = new.entitlement_key
         and e.revoked_at is null
         and e.id <> new.id
     ) then
    update public.profiles
    set profile_cosmetic_key = 'classic'
    where id = new.user_id
      and profile_cosmetic_key = new.entitlement_key;
  end if;
  return new;
end;
$$;

create trigger reset_revoked_profile_cosmetic
  after update of revoked_at on public.entitlements
  for each row execute function public.reset_revoked_profile_cosmetic();
