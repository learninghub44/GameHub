alter table public.user_preferences
  add column call_privacy text not null default 'everyone'
    check (call_privacy in ('everyone', 'followers', 'nobody'));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'follow', 'community', 'tournament', 'moderation', 'friend_request', 'team_invitation', 'call'));

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  room_name text not null unique,
  call_type text not null check (call_type in ('voice', 'video', 'group_voice', 'voice_room')),
  title text not null check (char_length(trim(title)) between 1 and 100),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  status text not null check (status in ('ringing', 'active', 'declined', 'cancelled', 'missed', 'ended')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  check ((call_type = 'voice_room' and visibility = 'public') or (call_type <> 'voice_room' and visibility = 'private'))
);
create index call_sessions_public_rooms_idx on public.call_sessions (created_at desc)
  where call_type = 'voice_room' and status = 'active';

create table public.call_participants (
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  participant_status text not null check (participant_status in ('outgoing', 'ringing', 'accepted', 'declined', 'cancelled', 'missed', 'ended')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index call_participants_user_history_idx on public.call_participants (user_id, invited_at desc);

alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;

create or replace function public.is_call_participant(target_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.call_participants cp
    where cp.call_id = target_call_id and cp.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_call_participant(uuid) from public;
grant execute on function public.is_call_participant(uuid) to authenticated;

create policy "Participants can view their calls" on public.call_sessions
  for select to authenticated using (
    public.is_call_participant(id)
    or (call_type = 'voice_room' and visibility = 'public' and status = 'active')
  );
create policy "Participants can view call members" on public.call_participants
  for select to authenticated using (
    user_id = (select auth.uid())
    or public.is_call_participant(call_id)
  );

grant select on public.call_sessions, public.call_participants to authenticated;
revoke insert, update, delete on public.call_sessions, public.call_participants from authenticated;

create or replace function public.start_call(requested_user_id uuid, requested_call_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_call_id uuid;
  target_profile public.profiles%rowtype;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if requested_call_type is null or requested_call_type not in ('voice', 'video')
     or requested_user_id is null or requested_user_id = caller_id then
    raise exception 'Invalid call type or participant' using errcode = '22023';
  end if;
  select * into target_profile from public.profiles p
  where p.id = requested_user_id and p.onboarding_completed_at is not null
    and p.is_suspended = false and p.profile_visibility = 'public';
  if target_profile.id is null then
    raise exception 'This player is not available for calls' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id in (caller_id, requested_user_id)
      and cp.participant_status in ('outgoing', 'ringing', 'accepted')
      and cs.status in ('ringing', 'active')
  ) then
    raise exception 'One of these players is already in a call' using errcode = '42501';
  end if;
  if public.is_blocked_by_current_user(requested_user_id) then
    raise exception 'Calls are unavailable for these accounts' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_preferences p
    where p.user_id = requested_user_id and p.call_privacy = 'nobody'
  ) then
    raise exception 'This player is not accepting calls' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_preferences p
    where p.user_id = requested_user_id and p.call_privacy = 'followers'
  ) and not exists (
    select 1 from public.user_follows f
    where f.follower_id = caller_id and f.followed_id = requested_user_id
  ) then
    raise exception 'Follow this player before calling' using errcode = '42501';
  end if;

  perform public.enforce_user_rate_limit('call_start', 10, 60);
  insert into public.call_sessions (call_type, title, status, created_by, room_name)
  values (requested_call_type, 'Private call', 'ringing', caller_id, 'gh-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into new_call_id;
  insert into public.call_participants (call_id, user_id, participant_status)
  values (new_call_id, caller_id, 'outgoing'), (new_call_id, requested_user_id, 'ringing');
  perform public.create_in_app_notification(requested_user_id, caller_id, 'call', new_call_id);
  return new_call_id;
end;
$$;
revoke all on function public.start_call(uuid, text) from public;
grant execute on function public.start_call(uuid, text) to authenticated;

create or replace function public.create_group_call(requested_user_ids uuid[], requested_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_call_id uuid;
  target_id uuid;
  distinct_count integer;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if requested_user_ids is null or cardinality(requested_user_ids) < 2 or cardinality(requested_user_ids) > 7
     or requested_title is null or char_length(trim(requested_title)) not between 1 and 100 then
    raise exception 'Group calls need a title and between two and seven invitees' using errcode = '22023';
  end if;
  select count(distinct user_id) into distinct_count from unnest(requested_user_ids) as invitees(user_id);
  if distinct_count <> cardinality(requested_user_ids) or caller_id = any(requested_user_ids) then
    raise exception 'Group call participants must be unique and cannot include the caller' using errcode = '22023';
  end if;

  foreach target_id in array requested_user_ids loop
    if not exists (
      select 1 from public.profiles p
      where p.id = target_id and p.onboarding_completed_at is not null
        and p.is_suspended = false and p.profile_visibility = 'public'
    ) or public.is_blocked_by_current_user(target_id) then
      raise exception 'One or more players are unavailable for calls' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.call_participants cp
      join public.call_sessions cs on cs.id = cp.call_id
      where cp.user_id in (caller_id, target_id)
        and cp.participant_status in ('outgoing', 'ringing', 'accepted')
        and cs.status in ('ringing', 'active')
    ) then
      raise exception 'One or more players are already in a call' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.user_preferences p where p.user_id = target_id and p.call_privacy = 'nobody'
    ) or (
      exists (select 1 from public.user_preferences p where p.user_id = target_id and p.call_privacy = 'followers')
      and not exists (
        select 1 from public.user_follows f where f.follower_id = caller_id and f.followed_id = target_id
      )
    ) then
      raise exception 'One or more players are not accepting calls from you' using errcode = '42501';
    end if;
  end loop;

  perform public.enforce_user_rate_limit('call_start', 10, 60);
  insert into public.call_sessions (call_type, title, status, created_by, room_name)
  values ('group_voice', trim(requested_title), 'ringing', caller_id, 'gh-' || replace(gen_random_uuid()::text, '-', ''))
  returning id into new_call_id;
  insert into public.call_participants (call_id, user_id, participant_status, joined_at)
  values (new_call_id, caller_id, 'accepted', now());
  foreach target_id in array requested_user_ids loop
    insert into public.call_participants (call_id, user_id, participant_status)
    values (new_call_id, target_id, 'ringing');
    perform public.create_in_app_notification(target_id, caller_id, 'call', new_call_id);
  end loop;
  return new_call_id;
end;
$$;
revoke all on function public.create_group_call(uuid[], text) from public;
grant execute on function public.create_group_call(uuid[], text) to authenticated;

create or replace function public.create_voice_room(requested_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_call_id uuid;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if requested_title is null or char_length(trim(requested_title)) not between 1 and 100 then
    raise exception 'Enter a room name between 1 and 100 characters' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id = caller_id and cp.participant_status in ('outgoing', 'ringing', 'accepted')
      and cs.status in ('ringing', 'active')
  ) then
    raise exception 'Leave your current call before creating a voice room' using errcode = '42501';
  end if;
  perform public.enforce_user_rate_limit('voice_room_create', 5, 3600);
  insert into public.call_sessions (call_type, title, visibility, status, created_by, room_name, accepted_at)
  values ('voice_room', trim(requested_title), 'public', 'active', caller_id,
    'gh-' || replace(gen_random_uuid()::text, '-', ''), now())
  returning id into new_call_id;
  insert into public.call_participants (call_id, user_id, participant_status, joined_at)
  values (new_call_id, caller_id, 'accepted', now());
  return new_call_id;
end;
$$;
revoke all on function public.create_voice_room(text) from public;
grant execute on function public.create_voice_room(text) to authenticated;

create or replace function public.join_voice_room(requested_call_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_call public.call_sessions%rowtype;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select * into target_call from public.call_sessions c
  where c.id = requested_call_id and c.call_type = 'voice_room' and c.status = 'active'
  for update;
  if target_call.id is null then
    raise exception 'This voice room is no longer available' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id = caller_id and cp.call_id <> target_call.id
      and cp.participant_status in ('outgoing', 'ringing', 'accepted')
      and cs.status in ('ringing', 'active')
  ) then
    raise exception 'Leave your current call before joining a voice room' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.call_participants cp
    where cp.call_id = target_call.id and cp.participant_status = 'accepted'
      and public.is_blocked_by_current_user(cp.user_id)
  ) then
    raise exception 'This room is unavailable for your account' using errcode = '42501';
  end if;
  insert into public.call_participants (call_id, user_id, participant_status, joined_at)
  values (target_call.id, caller_id, 'accepted', now())
  on conflict (call_id, user_id) do update
    set participant_status = 'accepted', joined_at = now(), left_at = null;
end;
$$;
revoke all on function public.join_voice_room(uuid) from public;
grant execute on function public.join_voice_room(uuid) to authenticated;

create or replace function public.respond_to_call(requested_call_id uuid, requested_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_call public.call_sessions%rowtype;
  caller_participant public.call_participants%rowtype;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if requested_action is null or requested_action not in ('accept', 'decline', 'cancel', 'missed', 'end', 'leave') then
    raise exception 'Unsupported call action' using errcode = '22023';
  end if;
  select * into target_call from public.call_sessions c
  where c.id = requested_call_id for update;
  select * into caller_participant from public.call_participants p
  where p.call_id = requested_call_id and p.user_id = caller_id for update;
  if target_call.id is null or caller_participant.call_id is null then
    raise exception 'Call not found or access denied' using errcode = '42501';
  end if;

  if requested_action = 'accept' then
    if caller_participant.participant_status <> 'ringing' or target_call.status not in ('ringing', 'active') then
      raise exception 'This call is no longer ringing' using errcode = '22023';
    end if;
    if now() - target_call.created_at >= interval '35 seconds' then
      raise exception 'This call has expired' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.call_participants cp
      join public.call_sessions cs on cs.id = cp.call_id
      where cp.user_id = caller_id and cp.call_id <> requested_call_id
        and cp.participant_status in ('outgoing', 'ringing', 'accepted')
        and cs.status in ('ringing', 'active')
    ) then
      raise exception 'Leave your current call before accepting another' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.call_participants cp
      where cp.call_id = requested_call_id and cp.user_id <> caller_id
        and public.is_blocked_by_current_user(cp.user_id)
    ) then
      raise exception 'Calls are unavailable for these accounts' using errcode = '42501';
    end if;
    update public.call_participants set participant_status = 'accepted', joined_at = now(), left_at = null
    where call_id = requested_call_id and user_id = caller_id;
    update public.call_sessions set status = 'active', accepted_at = coalesce(accepted_at, now()), ended_at = null
    where id = requested_call_id;
  elsif requested_action = 'decline' then
    if caller_participant.participant_status <> 'ringing' then
      raise exception 'Only a ringing participant can decline' using errcode = '42501';
    end if;
    update public.call_participants set participant_status = 'declined', left_at = now()
    where call_id = requested_call_id and user_id = caller_id;
    if not exists (
      select 1 from public.call_participants cp
      where cp.call_id = requested_call_id and cp.participant_status in ('ringing', 'accepted')
    ) then
      update public.call_sessions set status = 'declined', ended_at = now() where id = requested_call_id;
    end if;
    if target_call.call_type = 'group_voice' and not exists (
      select 1 from public.call_participants cp
      where cp.call_id = requested_call_id and cp.user_id <> target_call.created_by
        and cp.participant_status in ('ringing', 'outgoing', 'accepted')
    ) then
      update public.call_sessions set status = 'declined', ended_at = now() where id = requested_call_id;
      update public.call_participants set participant_status = 'ended', left_at = now()
      where call_id = requested_call_id and user_id = target_call.created_by and participant_status = 'accepted';
    end if;
  elsif requested_action = 'cancel' then
    if target_call.created_by <> caller_id or target_call.status not in ('ringing', 'active') then
      raise exception 'Only the caller can cancel a call that has not ended' using errcode = '42501';
    end if;
    update public.call_participants set participant_status = 'cancelled', left_at = now()
    where call_id = requested_call_id and participant_status in ('outgoing', 'ringing', 'accepted');
    update public.call_sessions set status = 'cancelled', ended_at = now() where id = requested_call_id;
  elsif requested_action = 'missed' then
    if now() - target_call.created_at < interval '35 seconds'
       or target_call.status not in ('ringing', 'active') then
      raise exception 'This call cannot be marked missed yet' using errcode = '22023';
    end if;
    if target_call.call_type in ('voice', 'video') and caller_participant.participant_status = 'ringing' then
      if target_call.status <> 'ringing' then
        raise exception 'This call is no longer ringing' using errcode = '22023';
      end if;
      update public.call_participants set participant_status = 'missed', left_at = now()
      where call_id = requested_call_id and user_id = caller_id;
      update public.call_participants set participant_status = 'missed', left_at = now()
      where call_id = requested_call_id and participant_status = 'outgoing';
      update public.call_sessions set status = 'missed', ended_at = now() where id = requested_call_id;
    elsif target_call.call_type in ('voice', 'video') and caller_participant.participant_status = 'outgoing'
      and target_call.created_by = caller_id and target_call.status = 'ringing' then
      update public.call_participants set participant_status = 'missed', left_at = now()
      where call_id = requested_call_id and participant_status in ('outgoing', 'ringing');
      update public.call_sessions set status = 'missed', ended_at = now() where id = requested_call_id;
    elsif target_call.call_type = 'group_voice' and caller_participant.participant_status = 'ringing' then
      update public.call_participants set participant_status = 'missed', left_at = now()
      where call_id = requested_call_id and user_id = caller_id;
    elsif target_call.call_type = 'group_voice' and target_call.created_by = caller_id
      and caller_participant.participant_status = 'accepted' and target_call.status = 'ringing' then
      update public.call_participants set participant_status = 'missed', left_at = now()
      where call_id = requested_call_id and participant_status = 'ringing';
      update public.call_participants set participant_status = 'ended', left_at = now()
      where call_id = requested_call_id and user_id = target_call.created_by and participant_status = 'accepted';
    else
      raise exception 'This call cannot be marked missed by your account' using errcode = '42501';
    end if;
    if target_call.call_type = 'group_voice' and not exists (
      select 1 from public.call_participants cp
      where cp.call_id = requested_call_id and cp.user_id <> target_call.created_by
        and cp.participant_status in ('ringing', 'outgoing', 'accepted')
    ) then
      update public.call_sessions set status = case
        when exists (
          select 1 from public.call_participants cp
          where cp.call_id = requested_call_id and cp.user_id <> target_call.created_by and cp.joined_at is not null
        ) then 'ended' else 'missed' end,
        ended_at = now()
      where id = requested_call_id;
      update public.call_participants set participant_status = 'ended', left_at = now()
      where call_id = requested_call_id and user_id = target_call.created_by and participant_status = 'accepted';
    end if;
  elsif requested_action = 'leave' and target_call.call_type in ('voice_room', 'group_voice') then
    if caller_participant.participant_status <> 'accepted' then
      raise exception 'You are not in this voice room' using errcode = '42501';
    end if;
    update public.call_participants set participant_status = 'ended', left_at = now()
    where call_id = requested_call_id and user_id = caller_id;
    if target_call.call_type = 'voice_room' and not exists (
      select 1 from public.call_participants cp where cp.call_id = requested_call_id and cp.participant_status = 'accepted'
    ) then
      update public.call_sessions set status = 'ended', ended_at = now() where id = requested_call_id;
    elsif target_call.call_type = 'group_voice' and not exists (
      select 1 from public.call_participants cp
      where cp.call_id = requested_call_id and cp.user_id <> target_call.created_by
        and cp.participant_status in ('ringing', 'outgoing', 'accepted')
    ) then
      update public.call_sessions set status = 'ended', ended_at = now() where id = requested_call_id;
      update public.call_participants set participant_status = 'ended', left_at = now()
      where call_id = requested_call_id and user_id = target_call.created_by and participant_status = 'accepted';
    end if;
  else
    if caller_participant.participant_status not in ('outgoing', 'ringing', 'accepted') then
      raise exception 'This call has already ended for your account' using errcode = '22023';
    end if;
    update public.call_participants set participant_status = 'ended', left_at = now()
    where call_id = requested_call_id and participant_status in ('outgoing', 'ringing', 'accepted');
    update public.call_sessions set status = 'ended', ended_at = now() where id = requested_call_id;
  end if;
end;
$$;
revoke all on function public.respond_to_call(uuid, text) from public;
grant execute on function public.respond_to_call(uuid, text) to authenticated;

create or replace function public.authorize_call_token(requested_call_id uuid)
returns table (room_name text, call_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_call public.call_sessions%rowtype;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select * into target_call from public.call_sessions c where c.id = requested_call_id;
  if target_call.id is null or target_call.status not in ('ringing', 'active')
     or not exists (
       select 1 from public.call_participants cp
       where cp.call_id = target_call.id and cp.user_id = caller_id
         and cp.participant_status in ('outgoing', 'accepted')
     ) then
    raise exception 'Call access denied or call has ended' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.call_participants cp
    where cp.call_id = target_call.id and cp.user_id <> caller_id
      and cp.participant_status in ('outgoing', 'ringing', 'accepted')
      and public.is_blocked_by_current_user(cp.user_id)
  ) then
    raise exception 'Calls are unavailable for these accounts' using errcode = '42501';
  end if;
  return query select target_call.room_name, target_call.call_type;
end;
$$;
revoke all on function public.authorize_call_token(uuid) from public;
grant execute on function public.authorize_call_token(uuid) to authenticated;

create or replace function public.export_voice_call_data()
returns jsonb
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'call', to_jsonb(c),
      'participant', to_jsonb(cp)
    ) order by cp.invited_at desc)
    from public.call_participants cp
    join public.call_sessions c on c.id = cp.call_id
    where cp.user_id = caller_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.export_voice_call_data() from public;
grant execute on function public.export_voice_call_data() to authenticated;

create or replace function public.close_empty_voice_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.call_participants cp
    where cp.call_id = old.call_id and cp.participant_status = 'accepted'
  ) then
    update public.call_sessions set status = 'ended', ended_at = now()
    where id = old.call_id and call_type = 'voice_room' and status = 'active';
  end if;
  return old;
end;
$$;
revoke all on function public.close_empty_voice_room() from public;
create trigger close_voice_room_after_account_deletion after delete on public.call_participants
  for each row execute function public.close_empty_voice_room();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_sessions') then
      alter publication supabase_realtime add table public.call_sessions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_participants') then
      alter publication supabase_realtime add table public.call_participants;
    end if;
  end if;
end;
$$;
