alter table public.profiles
  add column avatar_path text,
  add column banner_path text,
  add column profile_visibility text not null default 'public'
    check (profile_visibility in ('public', 'private')),
  add column platform_role text not null default 'player'
    check (platform_role in ('player', 'moderator', 'admin'));

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  discover_communities_first boolean not null default true,
  message_privacy text not null default 'everyone'
    check (message_privacy in ('everyone', 'followers', 'nobody')),
  email_notifications boolean not null default false,
  in_app_notifications boolean not null default true,
  timezone text not null default 'Africa/Nairobi',
  updated_at timestamptz not null default now()
);

create table public.user_game_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (char_length(trim(game)) between 1 and 100),
  platform text check (platform in ('pc', 'playstation', 'xbox', 'mobile', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, game)
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (sender_id <> recipient_id),
  unique (sender_id, recipient_id)
);
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message', 'follow', 'community', 'tournament', 'moderation', 'friend_request', 'team_invitation'));
create index friend_requests_recipient_idx on public.friend_requests (recipient_id, created_at desc)
  where status = 'pending';

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_posts_feed_idx on public.community_posts (community_id, created_at desc, id desc);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index community_comments_post_idx on public.community_comments (post_id, created_at asc);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint team_invitation_not_self check (inviter_id <> invitee_id)
);
create unique index team_invitations_pending_unique
  on public.team_invitations (team_id, invitee_id) where status = 'pending';

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_number integer not null check (match_number > 0),
  participant_one uuid references public.profiles(id) on delete set null,
  participant_two uuid references public.profiles(id) on delete set null,
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'disputed')),
  created_at timestamptz not null default now(),
  unique (tournament_id, round_number, match_number)
);
create table public.tournament_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.tournament_matches(id) on delete cascade,
  winner_id uuid references public.profiles(id) on delete set null,
  result_details text not null check (char_length(trim(result_details)) between 1 and 2000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.tournament_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index tournament_audit_history_idx on public.tournament_audit_logs (tournament_id, created_at desc);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.account_deletion_requests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'cancelled'))
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  product_type text not null check (product_type in ('cosmetic', 'credit_pack')),
  price_minor integer not null check (price_minor > 0),
  currency_code text not null default 'KES' check (currency_code ~ '^[A-Z]{3}$'),
  credit_amount integer check (credit_amount is null or credit_amount > 0),
  entitlement_key text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  check (
    (product_type = 'credit_pack' and credit_amount is not null and entitlement_key is null)
    or (product_type = 'cosmetic' and credit_amount is null and entitlement_key is not null)
  )
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'cancelled')),
  total_minor integer not null check (total_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index orders_user_created_idx on public.orders (user_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity = 1),
  unit_price_minor integer not null check (unit_price_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$')
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  provider text not null check (provider = 'paystack'),
  reference text not null unique,
  provider_transaction_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  authorization_url text,
  amount_minor integer not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  entitlement_key text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, product_id, order_id)
);
create table public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  entry_type text not null check (entry_type in ('purchase', 'refund', 'spend', 'reversal')),
  amount integer not null check (amount <> 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger_entries (user_id, created_at desc);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null check (event_name in ('registration_complete', 'onboarding_complete', 'stream_view', 'tournament_registration')),
  created_at timestamptz not null default now()
);
create index analytics_event_name_created_idx on public.analytics_events (event_name, created_at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_lookup_idx on public.rate_limit_events (user_id, action, created_at desc);

alter table public.tournament_participants add column team_id uuid references public.teams(id) on delete set null;
create unique index tournament_participants_team_unique
  on public.tournament_participants (tournament_id, team_id) where team_id is not null;

drop policy "Public profiles are discoverable" on public.profiles;
create policy "Public profiles are discoverable" on public.profiles
  for select to authenticated using (
    onboarding_completed_at is not null and is_suspended = false and profile_visibility = 'public'
  );
create policy "Users can manage their own profile privacy" on public.profiles
  for update to authenticated using ((select auth.uid()) = id and is_suspended = false)
  with check ((select auth.uid()) = id and is_suspended = false);

create or replace function public.is_platform_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.platform_role in ('moderator', 'admin') and p.is_suspended = false
  );
$$;
revoke all on function public.is_platform_moderator() from public;
grant execute on function public.is_platform_moderator() to authenticated;

create or replace function public.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_suspended = false
  );
$$;
revoke all on function public.is_current_user_active() from public;
grant execute on function public.is_current_user_active() to authenticated;

create or replace function public.create_in_app_notification(
  target_user_id uuid,
  source_user_id uuid,
  notification_kind text,
  notification_resource_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, kind, resource_id)
  select target_user_id, source_user_id, notification_kind, notification_resource_id
  where not exists (
    select 1 from public.user_preferences p
    where p.user_id = target_user_id and p.in_app_notifications = false
  );
end;
$$;
revoke all on function public.create_in_app_notification(uuid, uuid, text, uuid) from public;

create or replace function public.audit_moderator_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_id uuid;
  old_record jsonb;
  new_record jsonb;
begin
  resource_id := new.id;
  if tg_op <> 'INSERT' then
    old_record := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_record := to_jsonb(new);
  end if;
  if public.is_platform_moderator() then
    insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
    values (
      (select auth.uid()),
      lower(tg_op),
      tg_table_name,
      resource_id,
      jsonb_build_object('old', old_record, 'new', new_record)
    );
  end if;
  return null;
end;
$$;
revoke all on function public.audit_moderator_change() from public;
create trigger audit_moderator_stream_changes after insert or update on public.streams
  for each row execute function public.audit_moderator_change();
create trigger audit_moderator_tournament_changes after insert or update on public.tournaments
  for each row execute function public.audit_moderator_change();
create trigger audit_moderator_product_changes after insert or update on public.products
  for each row execute function public.audit_moderator_change();

drop policy "Community owners can update communities" on public.communities;
create policy "Community owners can update communities" on public.communities
  for update to authenticated using (owner_id = (select auth.uid()) and public.is_current_user_active())
  with check (owner_id = (select auth.uid()) and public.is_current_user_active());
drop policy "Captains can update teams" on public.teams;
create policy "Captains can update teams" on public.teams
  for update to authenticated using (captain_id = (select auth.uid()) and public.is_current_user_active())
  with check (captain_id = (select auth.uid()) and public.is_current_user_active());
drop policy "Creators can update their own streams" on public.streams;
create policy "Creators can update their own streams" on public.streams
  for update to authenticated using (user_id = (select auth.uid()) and public.is_current_user_active())
  with check (user_id = (select auth.uid()) and status in ('unverified', 'offline', 'unavailable')
    and public.is_current_user_active());
drop policy "Organizers can update their tournaments" on public.tournaments;
create policy "Organizers can update their tournaments" on public.tournaments
  for update to authenticated using (organizer_id = (select auth.uid()) and public.is_current_user_active())
  with check (organizer_id = (select auth.uid()) and public.is_current_user_active() and (
    prize_description is null or prize_verified_at is not null
  ));

create or replace function public.moderate_report(requested_report_id uuid, requested_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.reports%rowtype;
  caller_id uuid := (select auth.uid());
  affected_rows integer;
begin
  if not public.is_platform_moderator() then
    raise exception 'Moderator permission required' using errcode = '42501';
  end if;
  select * into report_row from public.reports r where r.id = requested_report_id and r.status = 'open' for update;
  if report_row.id is null then
    raise exception 'Report is no longer open' using errcode = '22023';
  end if;

  if requested_action = 'review' then
    update public.reports set status = 'reviewed' where id = report_row.id;
  elsif requested_action = 'dismiss' then
    update public.reports set status = 'dismissed' where id = report_row.id;
  elsif requested_action = 'action' then
    if report_row.resource_type = 'profile' and report_row.reported_user_id is not null then
      update public.profiles set is_suspended = true where id = report_row.reported_user_id;
      get diagnostics affected_rows = row_count;
    elsif report_row.resource_type = 'stream' then
      update public.streams set status = 'removed' where id = report_row.resource_id;
      get diagnostics affected_rows = row_count;
    elsif report_row.resource_type = 'community' then
      update public.communities set status = 'restricted' where id = report_row.resource_id;
      get diagnostics affected_rows = row_count;
    elsif report_row.resource_type = 'message' then
      delete from public.messages where id = report_row.resource_id;
      get diagnostics affected_rows = row_count;
    elsif report_row.resource_type = 'tournament' then
      update public.tournaments set status = 'cancelled' where id = report_row.resource_id;
      get diagnostics affected_rows = row_count;
    else
      raise exception 'This report type cannot be actioned automatically' using errcode = '22023';
    end if;
    if affected_rows = 0 then
      raise exception 'The reported resource no longer exists' using errcode = '22023';
    end if;
    update public.reports set status = 'actioned' where id = report_row.id;
  else
    raise exception 'Unsupported moderation action' using errcode = '22023';
  end if;

  insert into public.moderation_actions (moderator_id, target_user_id, resource_type, resource_id, action, reason)
  values (caller_id, report_row.reported_user_id, report_row.resource_type, report_row.resource_id, requested_action, report_row.reason);
  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (caller_id, 'report_' || requested_action, report_row.resource_type, report_row.resource_id,
    jsonb_build_object('report_id', report_row.id));
end;
$$;
revoke all on function public.moderate_report(uuid, text) from public;
grant execute on function public.moderate_report(uuid, text) to authenticated;

create or replace function public.moderate_stream_report(requested_report_id uuid, requested_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.stream_reports%rowtype;
  stream_owner_id uuid;
  caller_id uuid := (select auth.uid());
  affected_rows integer;
begin
  if not public.is_platform_moderator() then
    raise exception 'Moderator permission required' using errcode = '42501';
  end if;
  select * into report_row from public.stream_reports r where r.id = requested_report_id and r.status = 'open' for update;
  if report_row.id is null then
    raise exception 'Stream report is no longer open' using errcode = '22023';
  end if;

  if requested_action = 'review' then
    update public.stream_reports set status = 'reviewed' where id = report_row.id;
  elsif requested_action = 'dismiss' then
    update public.stream_reports set status = 'dismissed' where id = report_row.id;
  elsif requested_action = 'remove' then
    update public.streams set status = 'removed' where id = report_row.stream_id returning user_id into stream_owner_id;
    get diagnostics affected_rows = row_count;
    if affected_rows = 0 then
      raise exception 'The reported stream no longer exists' using errcode = '22023';
    end if;
    update public.stream_reports set status = 'actioned' where id = report_row.id;
  else
    raise exception 'Unsupported stream moderation action' using errcode = '22023';
  end if;

  insert into public.moderation_actions (moderator_id, target_user_id, resource_type, resource_id, action, reason)
  values (caller_id, stream_owner_id, 'stream', report_row.stream_id, requested_action, report_row.reason);
  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (caller_id, 'stream_report_' || requested_action, 'stream', report_row.stream_id,
    jsonb_build_object('report_id', report_row.id));
end;
$$;
revoke all on function public.moderate_stream_report(uuid, text) from public;
grant execute on function public.moderate_stream_report(uuid, text) to authenticated;

create or replace function public.enforce_user_rate_limit(
  requested_action text,
  maximum_events integer,
  window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  recent_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = caller_id and p.is_suspended = false
  ) then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || requested_action, 0));
  select count(*) into recent_count
  from public.rate_limit_events r
  where r.user_id = caller_id and r.action = requested_action
    and r.created_at > now() - make_interval(secs => window_seconds);
  if recent_count >= maximum_events then
    raise exception 'Rate limit exceeded. Please wait before trying again.'
      using errcode = 'P0001';
  end if;
  insert into public.rate_limit_events (user_id, action) values (caller_id, requested_action);
end;
$$;
revoke all on function public.enforce_user_rate_limit(text, integer, integer) from public;

create or replace function public.require_active_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_suspended = false
  ) then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.require_active_profile() from public;

create trigger active_user_follows before insert on public.user_follows
  for each row execute function public.require_active_profile();
create trigger active_user_blocks before insert on public.user_blocks
  for each row execute function public.require_active_profile();
create trigger active_friend_requests before insert on public.friend_requests
  for each row execute function public.require_active_profile();
create trigger active_communities before insert on public.communities
  for each row execute function public.require_active_profile();
create trigger active_community_members before insert on public.community_members
  for each row execute function public.require_active_profile();
create trigger active_teams before insert on public.teams
  for each row execute function public.require_active_profile();
create trigger active_team_members before insert on public.team_members
  for each row execute function public.require_active_profile();
create trigger active_team_invitations before insert on public.team_invitations
  for each row execute function public.require_active_profile();
create trigger active_community_comments before insert on public.community_comments
  for each row execute function public.require_active_profile();
create trigger active_tournaments before insert on public.tournaments
  for each row execute function public.require_active_profile();
create trigger active_tournament_participants before insert on public.tournament_participants
  for each row execute function public.require_active_profile();
create trigger active_stream_follows before insert on public.stream_follows
  for each row execute function public.require_active_profile();
create trigger active_stream_reports before insert on public.stream_reports
  for each row execute function public.require_active_profile();

revoke insert on public.notifications from authenticated;

create or replace function public.create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  first_id uuid;
  second_id uuid;
  existing_id uuid;
  new_conversation_id uuid;
begin
  if caller_id is null or caller_id = other_user_id then
    raise exception 'Invalid conversation participant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = caller_id and p.is_suspended = false) then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = other_user_id and p.onboarding_completed_at is not null
      and p.is_suspended = false and p.profile_visibility = 'public'
  ) then
    raise exception 'This profile is not available for messaging' using errcode = '42501';
  end if;
  if public.is_blocked_by_current_user(other_user_id) then
    raise exception 'Messaging is unavailable for these accounts' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_preferences pref
    where pref.user_id = other_user_id and pref.message_privacy = 'nobody'
  ) then
    raise exception 'This player is not accepting messages' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_preferences pref where pref.user_id = other_user_id
      and pref.message_privacy = 'followers'
  ) and not exists (
    select 1 from public.user_follows f where f.follower_id = caller_id and f.followed_id = other_user_id
  ) then
    raise exception 'Follow this player before sending a message' using errcode = '42501';
  end if;
  first_id := least(caller_id, other_user_id);
  second_id := greatest(caller_id, other_user_id);

  perform pg_advisory_xact_lock(hashtextextended(first_id::text || ':' || second_id::text, 0));
  select c.id into existing_id
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.user_id = first_id
  join public.conversation_members b on b.conversation_id = c.id and b.user_id = second_id
  where (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations (created_by) values (caller_id) returning id into new_conversation_id;
  insert into public.conversation_members (conversation_id, user_id)
  values (new_conversation_id, first_id), (new_conversation_id, second_id);
  return new_conversation_id;
end;
$$;
revoke all on function public.create_direct_conversation(uuid) from public;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function public.register_for_tournament(requested_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.tournaments%rowtype;
  active_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = caller_id and p.is_suspended = false) then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  perform 1 from public.tournaments t where t.id = requested_tournament_id for update;
  select * into target from public.tournaments t where t.id = requested_tournament_id;
  if target.id is null or target.status <> 'registration_open'
     or (target.registration_deadline is not null and target.registration_deadline <= now()) then
    raise exception 'Registration is closed' using errcode = '22023';
  end if;
  select count(*) into active_count from public.tournament_participants p
  where p.tournament_id = target.id and p.status = 'registered';
  if target.participant_limit is not null and active_count >= target.participant_limit
     and not exists (
       select 1 from public.tournament_participants p
       where p.tournament_id = target.id and p.user_id = caller_id and p.status = 'registered'
     ) then
    raise exception 'This tournament is full' using errcode = 'P0001';
  end if;
  insert into public.tournament_participants (tournament_id, user_id, status)
  values (target.id, caller_id, 'registered')
  on conflict (tournament_id, user_id) do update
    set status = 'registered', registered_at = now();
  insert into public.tournament_audit_logs (tournament_id, actor_id, action)
  values (target.id, caller_id, 'participant_registered');
  insert into public.analytics_events (user_id, event_name)
  values (caller_id, 'tournament_registration');
end;
$$;
revoke all on function public.register_for_tournament(uuid) from public;
grant execute on function public.register_for_tournament(uuid) to authenticated;

create or replace function public.register_team_for_tournament(requested_tournament_id uuid, requested_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target public.tournaments%rowtype;
  active_count integer;
begin
  if caller_id is null or not exists (
    select 1 from public.teams t where t.id = requested_team_id and t.captain_id = caller_id
  ) then
    raise exception 'Only the team captain can register this team' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = caller_id and p.is_suspended = false) then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  perform 1 from public.tournaments t where t.id = requested_tournament_id for update;
  select * into target from public.tournaments t where t.id = requested_tournament_id;
  if target.id is null or target.status <> 'registration_open'
     or (target.registration_deadline is not null and target.registration_deadline <= now()) then
    raise exception 'Registration is closed' using errcode = '22023';
  end if;
  select count(*) into active_count from public.tournament_participants p
  where p.tournament_id = target.id and p.status = 'registered';
  if target.participant_limit is not null and active_count >= target.participant_limit
     and not exists (
       select 1 from public.tournament_participants p
       where p.tournament_id = target.id and p.team_id = requested_team_id and p.status = 'registered'
     ) then
    raise exception 'This tournament is full' using errcode = 'P0001';
  end if;
  insert into public.tournament_participants (tournament_id, user_id, team_id, status)
  values (target.id, caller_id, requested_team_id, 'registered')
  on conflict (tournament_id, team_id) where team_id is not null do update
    set status = 'registered', registered_at = now(), user_id = caller_id;
  insert into public.tournament_audit_logs (tournament_id, actor_id, action, details)
  values (target.id, caller_id, 'team_registered', jsonb_build_object('team_id', requested_team_id));
  insert into public.analytics_events (user_id, event_name)
  values (caller_id, 'tournament_registration');
end;
$$;
revoke all on function public.register_team_for_tournament(uuid, uuid) from public;
grant execute on function public.register_team_for_tournament(uuid, uuid) to authenticated;

create or replace function public.invite_team_member(requested_team_id uuid, requested_invitee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  invitation_id uuid;
begin
  if not public.is_current_user_active() or not exists (
    select 1 from public.teams t where t.id = requested_team_id and t.captain_id = caller_id
  ) or requested_invitee_id = caller_id or not exists (
    select 1 from public.profiles p where p.id = requested_invitee_id
      and p.onboarding_completed_at is not null and p.is_suspended = false
  ) then
    raise exception 'Only the team captain can invite an eligible player' using errcode = '42501';
  end if;
  insert into public.team_invitations (team_id, inviter_id, invitee_id)
  values (requested_team_id, caller_id, requested_invitee_id)
  returning id into invitation_id;
  return invitation_id;
end;
$$;
revoke all on function public.invite_team_member(uuid, uuid) from public;
grant execute on function public.invite_team_member(uuid, uuid) to authenticated;

create or replace function public.respond_to_team_invitation(requested_invitation_id uuid, accept_invitation boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.team_invitations%rowtype;
begin
  if not public.is_current_user_active() then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  select * into invitation from public.team_invitations i
  where i.id = requested_invitation_id and i.invitee_id = (select auth.uid())
    and i.status = 'pending' for update;
  if invitation.id is null then
    raise exception 'Invitation is no longer available' using errcode = '22023';
  end if;
  if accept_invitation then
    insert into public.team_members (team_id, user_id, role)
    values (invitation.team_id, invitation.invitee_id, 'member')
    on conflict (team_id, user_id) do nothing;
  end if;
  update public.team_invitations
  set status = case when accept_invitation then 'accepted' else 'declined' end,
      responded_at = now()
  where id = requested_invitation_id;
end;
$$;
revoke all on function public.respond_to_team_invitation(uuid, boolean) from public;
grant execute on function public.respond_to_team_invitation(uuid, boolean) to authenticated;

create or replace function public.respond_to_friend_request(requested_request_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.friend_requests%rowtype;
begin
  if not public.is_current_user_active() then
    raise exception 'This account is restricted' using errcode = '42501';
  end if;
  select * into request_row from public.friend_requests f
  where f.id = requested_request_id and f.recipient_id = (select auth.uid())
    and f.status = 'pending' for update;
  if request_row.id is null then
    raise exception 'Friend request is no longer available' using errcode = '22023';
  end if;
  if public.is_blocked_by_current_user(request_row.sender_id) then
    update public.friend_requests set status = 'cancelled', responded_at = now()
    where id = requested_request_id;
    return;
  end if;
  update public.friend_requests
  set status = case when accept_request then 'accepted' else 'declined' end,
      responded_at = now()
  where id = requested_request_id;
  perform public.create_in_app_notification(
    request_row.sender_id,
    (select auth.uid()),
    'friend_request',
    requested_request_id
  );
end;
$$;
revoke all on function public.respond_to_friend_request(uuid, boolean) from public;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

create or replace function public.finalize_paystack_payment(
  requested_reference text,
  requested_transaction_id text,
  requested_amount_minor integer,
  requested_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  item_row public.order_items%rowtype;
  product_row public.products%rowtype;
begin
  select * into payment_row from public.payments p
  where p.reference = requested_reference for update;
  if payment_row.id is null then
    raise exception 'Payment reference not found' using errcode = '22023';
  end if;
  if payment_row.status = 'paid' then
    return false;
  end if;
  if payment_row.status <> 'pending'
     or payment_row.amount_minor <> requested_amount_minor
     or payment_row.currency_code <> requested_currency then
    raise exception 'Payment details do not match the pending order' using errcode = '22023';
  end if;
  update public.payments
    set status = 'paid', provider_transaction_id = requested_transaction_id, verified_at = now()
    where id = payment_row.id;
  update public.orders set status = 'paid', updated_at = now() where id = payment_row.order_id;
  select * into item_row from public.order_items i where i.order_id = payment_row.order_id limit 1;
  select * into product_row from public.products p where p.id = item_row.product_id;
  if item_row.id is null or product_row.id is null then
    raise exception 'Payment order item is unavailable' using errcode = '22023';
  end if;
  if product_row.product_type = 'credit_pack' then
    insert into public.credit_ledger_entries (user_id, order_id, entry_type, amount, idempotency_key)
    select o.user_id, o.id, 'purchase', product_row.credit_amount, 'paystack:' || requested_reference
    from public.orders o where o.id = payment_row.order_id
    on conflict (idempotency_key) do nothing;
  else
    insert into public.entitlements (user_id, product_id, order_id, entitlement_key)
    select o.user_id, product_row.id, o.id, product_row.entitlement_key
    from public.orders o where o.id = payment_row.order_id
    on conflict (user_id, product_id, order_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.finalize_paystack_payment(text, text, integer, text) from public;
grant execute on function public.finalize_paystack_payment(text, text, integer, text) to service_role;

create or replace function public.finalize_paystack_refund(
  requested_reference text,
  requested_refund_id text,
  requested_amount_minor integer,
  requested_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  item_row public.order_items%rowtype;
  product_row public.products%rowtype;
  buyer_id uuid;
begin
  select * into payment_row from public.payments p
  where p.reference = requested_reference for update;
  if payment_row.id is not null and payment_row.status = 'refunded' then
    return false;
  end if;
  if payment_row.id is null or payment_row.status <> 'paid'
     or payment_row.amount_minor <> requested_amount_minor
     or payment_row.currency_code <> requested_currency then
    raise exception 'Refund does not match a paid transaction' using errcode = '22023';
  end if;
  update public.payments set status = 'refunded' where id = payment_row.id;
  update public.orders set status = 'refunded', updated_at = now() where id = payment_row.order_id;
  select o.user_id into buyer_id from public.orders o where o.id = payment_row.order_id;
  select * into item_row from public.order_items i where i.order_id = payment_row.order_id limit 1;
  select * into product_row from public.products p where p.id = item_row.product_id;
  if buyer_id is not null and product_row.product_type = 'credit_pack' then
    insert into public.credit_ledger_entries (user_id, order_id, entry_type, amount, idempotency_key)
    values (buyer_id, payment_row.order_id, 'refund', -product_row.credit_amount, 'paystack-refund:' || requested_refund_id)
    on conflict (idempotency_key) do nothing;
  elsif buyer_id is not null then
    update public.entitlements set revoked_at = now()
    where order_id = payment_row.order_id and user_id = buyer_id and revoked_at is null;
  end if;
  return true;
end;
$$;
revoke all on function public.finalize_paystack_refund(text, text, integer, text) from public;
grant execute on function public.finalize_paystack_refund(text, text, integer, text) to service_role;

create or replace function public.enforce_checkout_rate_limit(requested_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = requested_user_id and p.is_suspended = false) then
    raise exception 'Account is not eligible for checkout' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text || ':checkout', 0));
  select count(*) into recent_count from public.rate_limit_events r
  where r.user_id = requested_user_id and r.action = 'checkout'
    and r.created_at > now() - interval '1 hour';
  if recent_count >= 5 then
    raise exception 'Checkout rate limit exceeded' using errcode = 'P0001';
  end if;
  insert into public.rate_limit_events (user_id, action) values (requested_user_id, 'checkout');
end;
$$;
revoke all on function public.enforce_checkout_rate_limit(uuid) from public;
grant execute on function public.enforce_checkout_rate_limit(uuid) to service_role;

create or replace function public.create_checkout_order(
  requested_user_id uuid,
  requested_product_id uuid,
  requested_idempotency_key text
)
returns table (
  order_id uuid,
  payment_reference text,
  amount_minor integer,
  currency_code text,
  authorization_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.products%rowtype;
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  payment_row public.payments%rowtype;
  created_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = requested_user_id and p.is_suspended = false
  ) then
    raise exception 'Account is not eligible for checkout' using errcode = '42501';
  end if;
  if requested_idempotency_key !~ '^[a-zA-Z0-9_-]{16,100}$' then
    raise exception 'Invalid checkout idempotency key' using errcode = '22023';
  end if;
  select * into product_row from public.products p
  where p.id = requested_product_id and p.active = true for share;
  if product_row.id is null or product_row.currency_code <> 'KES' then
    raise exception 'Product is unavailable for checkout' using errcode = '22023';
  end if;

  insert into public.orders (user_id, status, total_minor, currency_code, idempotency_key)
  values (requested_user_id, 'pending', product_row.price_minor, product_row.currency_code, requested_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into created_id;

  if created_id is null then
    select * into order_row from public.orders o
    where o.user_id = requested_user_id and o.idempotency_key = requested_idempotency_key
    for update;
    select * into item_row from public.order_items i where i.order_id = order_row.id limit 1;
    if item_row.id is null or item_row.product_id <> product_row.id then
      raise exception 'Checkout key is already in use' using errcode = '22023';
    end if;
    select * into payment_row from public.payments p where p.order_id = order_row.id;
    if payment_row.id is not null then
      if payment_row.status <> 'pending' then
        raise exception 'This checkout has already been processed' using errcode = '22023';
      end if;
      return query select order_row.id, payment_row.reference, payment_row.amount_minor,
        payment_row.currency_code, payment_row.authorization_url;
      return;
    end if;
    if order_row.status <> 'pending' then
      raise exception 'This checkout is no longer active' using errcode = '22023';
    end if;
  else
    order_row.id := created_id;
    order_row.status := 'pending';
    order_row.total_minor := product_row.price_minor;
    order_row.currency_code := product_row.currency_code;
    perform public.enforce_checkout_rate_limit(requested_user_id);
    insert into public.order_items (order_id, product_id, unit_price_minor, currency_code)
    values (created_id, product_row.id, product_row.price_minor, product_row.currency_code);
  end if;

  insert into public.payments (order_id, provider, reference, amount_minor, currency_code)
  values (order_row.id, 'paystack', 'GH_' || replace(gen_random_uuid()::text, '-', ''), product_row.price_minor, product_row.currency_code)
  returning * into payment_row;
  return query select order_row.id, payment_row.reference, payment_row.amount_minor,
    payment_row.currency_code, payment_row.authorization_url;
end;
$$;
revoke all on function public.create_checkout_order(uuid, uuid, text) from public;
grant execute on function public.create_checkout_order(uuid, uuid, text) to service_role;

create or replace function public.export_account_data()
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

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = caller_id),
    'preferences', (select to_jsonb(p) from public.user_preferences p where p.user_id = caller_id),
    'game_preferences', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.user_game_preferences where user_id = caller_id) x), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.user_blocks where blocker_id = caller_id or blocked_id = caller_id) x), '[]'::jsonb),
    'follows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.user_follows where follower_id = caller_id or followed_id = caller_id) x), '[]'::jsonb),
    'friend_requests', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.friend_requests where sender_id = caller_id or recipient_id = caller_id) x), '[]'::jsonb),
    'community_memberships', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.community_members where user_id = caller_id) x), '[]'::jsonb),
    'communities_owned', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.communities where owner_id = caller_id) x), '[]'::jsonb),
    'community_posts', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.community_posts where author_id = caller_id) x), '[]'::jsonb),
    'community_comments', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.community_comments where author_id = caller_id) x), '[]'::jsonb),
    'teams_captained', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.teams where captain_id = caller_id) x), '[]'::jsonb),
    'team_memberships', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.team_members where user_id = caller_id) x), '[]'::jsonb),
    'team_invitations', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.team_invitations where inviter_id = caller_id or invitee_id = caller_id) x), '[]'::jsonb),
    'conversation_memberships', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.conversation_members where user_id = caller_id) x), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select m.* from public.messages m where m.sender_id = caller_id or exists (
        select 1 from public.conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = caller_id
      )
    ) x), '[]'::jsonb),
    'message_receipts', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.message_receipts where user_id = caller_id) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.notifications where user_id = caller_id) x), '[]'::jsonb),
    'streams', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.streams where user_id = caller_id) x), '[]'::jsonb),
    'stream_follows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.stream_follows where user_id = caller_id) x), '[]'::jsonb),
    'stream_chat_messages', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.stream_chat_messages where user_id = caller_id) x), '[]'::jsonb),
    'stream_reports', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.stream_reports where reporter_id = caller_id) x), '[]'::jsonb),
    'tournament_registrations', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.tournament_participants where user_id = caller_id) x), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.reports where reporter_id = caller_id or reported_user_id = caller_id) x), '[]'::jsonb),
    'moderation_actions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.moderation_actions where target_user_id = caller_id) x), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.orders where user_id = caller_id) x), '[]'::jsonb),
    'order_items', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select i.* from public.order_items i join public.orders o on o.id = i.order_id where o.user_id = caller_id
    ) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select p.* from public.payments p join public.orders o on o.id = p.order_id where o.user_id = caller_id
    ) x), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.entitlements where user_id = caller_id) x), '[]'::jsonb),
    'credit_ledger', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.credit_ledger_entries where user_id = caller_id) x), '[]'::jsonb),
    'analytics_events', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.analytics_events where user_id = caller_id) x), '[]'::jsonb),
    'account_deletion_requests', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.account_deletion_requests where user_id = caller_id) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.export_account_data() from public;
grant execute on function public.export_account_data() to authenticated;

create or replace function public.record_account_deletion_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.account_deletion_requests (user_id)
  values ((select auth.uid()))
  on conflict (user_id) do update
    set requested_at = now(), status = 'requested', completed_at = null;
end;
$$;
revoke all on function public.record_account_deletion_request() from public;
grant execute on function public.record_account_deletion_request() to authenticated;

create or replace function public.prepare_account_deletion()
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
  insert into public.account_deletion_requests (user_id)
  values (caller_id)
  on conflict (user_id) do update set requested_at = now(), status = 'processing';

  delete from public.messages where sender_id = caller_id;
  delete from public.community_posts where author_id = caller_id;
  delete from public.community_comments where author_id = caller_id;
  delete from public.stream_chat_messages where user_id = caller_id;
  delete from public.reports where reporter_id = caller_id;
  delete from public.stream_reports where reporter_id = caller_id;
  delete from public.user_follows where follower_id = caller_id or followed_id = caller_id;
  delete from public.user_blocks where blocker_id = caller_id or blocked_id = caller_id;
  delete from public.friend_requests where sender_id = caller_id or recipient_id = caller_id;
  delete from public.team_invitations where inviter_id = caller_id or invitee_id = caller_id;
  delete from public.tournament_participants where user_id = caller_id;
  delete from public.entitlements where user_id = caller_id;
  update public.communities set owner_id = null where owner_id = caller_id;
  update public.teams set captain_id = null where captain_id = caller_id;
  update public.tournaments set organizer_id = null where organizer_id = caller_id;
end;
$$;
revoke all on function public.prepare_account_deletion() from public;
grant execute on function public.prepare_account_deletion() to authenticated;

alter table public.messages drop constraint messages_sender_is_member;
alter table public.messages alter column sender_id drop not null;
alter table public.communities alter column owner_id drop not null;
alter table public.teams alter column captain_id drop not null;
alter table public.tournaments alter column organizer_id drop not null;
alter table public.community_posts alter column author_id drop not null;
alter table public.community_comments alter column author_id drop not null;
alter table public.moderation_actions alter column moderator_id drop not null;
alter table public.admin_audit_logs alter column actor_id drop not null;
alter table public.tournament_audit_logs alter column actor_id drop not null;
alter table public.tournament_results alter column recorded_by drop not null;
alter table public.reports alter column reporter_id drop not null;
alter table public.reports alter column reported_user_id drop not null;
alter table public.stream_reports alter column reporter_id drop not null;
alter table public.orders alter column user_id drop not null;
alter table public.credit_ledger_entries alter column user_id drop not null;

alter table public.messages drop constraint messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete set null;
alter table public.communities drop constraint communities_owner_id_fkey;
alter table public.communities add constraint communities_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;
alter table public.teams drop constraint teams_captain_id_fkey;
alter table public.teams add constraint teams_captain_id_fkey
  foreign key (captain_id) references public.profiles(id) on delete set null;
alter table public.conversations drop constraint conversations_created_by_fkey;
alter table public.conversations alter column created_by drop not null;
alter table public.conversations add constraint conversations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.tournaments drop constraint tournaments_organizer_id_fkey;
alter table public.tournaments add constraint tournaments_organizer_id_fkey
  foreign key (organizer_id) references public.profiles(id) on delete set null;
alter table public.community_posts drop constraint community_posts_author_id_fkey;
alter table public.community_posts add constraint community_posts_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.community_comments drop constraint community_comments_author_id_fkey;
alter table public.community_comments add constraint community_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.moderation_actions drop constraint moderation_actions_moderator_id_fkey;
alter table public.moderation_actions add constraint moderation_actions_moderator_id_fkey
  foreign key (moderator_id) references public.profiles(id) on delete set null;
alter table public.admin_audit_logs drop constraint admin_audit_logs_actor_id_fkey;
alter table public.admin_audit_logs add constraint admin_audit_logs_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.tournament_audit_logs drop constraint tournament_audit_logs_actor_id_fkey;
alter table public.tournament_audit_logs add constraint tournament_audit_logs_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.tournament_results drop constraint tournament_results_recorded_by_fkey;
alter table public.tournament_results add constraint tournament_results_recorded_by_fkey
  foreign key (recorded_by) references public.profiles(id) on delete set null;
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete set null;
alter table public.reports drop constraint reports_reported_user_id_fkey;
alter table public.reports add constraint reports_reported_user_id_fkey
  foreign key (reported_user_id) references public.profiles(id) on delete set null;
alter table public.stream_reports drop constraint stream_reports_reporter_id_fkey;
alter table public.stream_reports add constraint stream_reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete set null;
alter table public.orders drop constraint orders_user_id_fkey;
alter table public.orders add constraint orders_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
alter table public.credit_ledger_entries drop constraint credit_ledger_entries_user_id_fkey;
alter table public.credit_ledger_entries add constraint credit_ledger_entries_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

create or replace function public.record_tournament_result_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament uuid;
begin
  select m.tournament_id into tournament from public.tournament_matches m where m.id = new.match_id;
  insert into public.tournament_audit_logs (tournament_id, actor_id, action, details)
  values (tournament, new.recorded_by, 'result_recorded', jsonb_build_object('match_id', new.match_id));
  return new;
end;
$$;
create trigger tournament_result_audit after insert on public.tournament_results
  for each row execute function public.record_tournament_result_audit();

create or replace function public.notify_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row record;
begin
  for member_row in
    select cm.user_id from public.conversation_members cm
    where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
  loop
    perform public.create_in_app_notification(member_row.user_id, new.sender_id, 'message', new.conversation_id);
  end loop;
  return new;
end;
$$;
create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function public.notify_message_recipient();

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_in_app_notification(new.followed_id, new.follower_id, 'follow', new.follower_id);
  return new;
end;
$$;
create trigger follows_notify_recipient after insert on public.user_follows
  for each row execute function public.notify_new_follower();

create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_in_app_notification(new.recipient_id, new.sender_id, 'friend_request', new.id);
  return new;
end;
$$;
create trigger friend_requests_notify_recipient after insert on public.friend_requests
  for each row execute function public.notify_friend_request();

create or replace function public.notify_team_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_in_app_notification(new.invitee_id, new.inviter_id, 'team_invitation', new.id);
  return new;
end;
$$;
create trigger team_invitations_notify_recipient after insert on public.team_invitations
  for each row execute function public.notify_team_invitation();

create or replace function public.create_message_receipts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_receipts (message_id, user_id)
  select new.id, cm.user_id
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;
create trigger messages_create_receipts after insert on public.messages
  for each row execute function public.create_message_receipts();

create or replace function public.notify_tournament_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer uuid;
begin
  select t.organizer_id into organizer from public.tournaments t where t.id = new.tournament_id;
  if organizer is not null and organizer <> new.user_id then
    perform public.create_in_app_notification(organizer, new.user_id, 'tournament', new.tournament_id);
  end if;
  return new;
end;
$$;
create trigger tournament_registration_notify after insert on public.tournament_participants
  for each row execute function public.notify_tournament_registration();

create or replace function public.remove_social_edges_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_follows
  where (follower_id = new.blocker_id and followed_id = new.blocked_id)
     or (follower_id = new.blocked_id and followed_id = new.blocker_id);
  update public.friend_requests set status = 'cancelled', responded_at = now()
  where status = 'pending'
    and ((sender_id = new.blocker_id and recipient_id = new.blocked_id)
      or (sender_id = new.blocked_id and recipient_id = new.blocker_id));
  return new;
end;
$$;
create trigger user_blocks_remove_social_edges after insert on public.user_blocks
  for each row execute function public.remove_social_edges_on_block();

create or replace function public.limit_message_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('private_message', 20, 60);
  return new;
end;
$$;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.limit_message_rate();

create or replace function public.limit_stream_chat_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('stream_chat', 8, 30);
  return new;
end;
$$;
create trigger stream_chat_rate_limit before insert on public.stream_chat_messages
  for each row execute function public.limit_stream_chat_rate();

create or replace function public.limit_stream_submission_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('stream_submission', 5, 3600);
  return new;
end;
$$;
create trigger streams_rate_limit before insert on public.streams
  for each row execute function public.limit_stream_submission_rate();

create or replace function public.limit_report_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('report_submission', 5, 3600);
  return new;
end;
$$;
create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.limit_report_rate();

create or replace function public.limit_community_post_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_user_rate_limit('community_post', 10, 300);
  return new;
end;
$$;
create trigger community_posts_rate_limit before insert on public.community_posts
  for each row execute function public.limit_community_post_rate();

alter table public.user_preferences enable row level security;
alter table public.user_game_preferences enable row level security;
alter table public.friend_requests enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.team_invitations enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_results enable row level security;
alter table public.tournament_audit_logs enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.account_deletion_requests enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.entitlements enable row level security;
alter table public.credit_ledger_entries enable row level security;
alter table public.analytics_events enable row level security;
alter table public.rate_limit_events enable row level security;

create policy "Users manage their preferences" on public.user_preferences
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users manage their game preferences" on public.user_game_preferences
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Participants can read their friend requests" on public.friend_requests
  for select to authenticated using ((select auth.uid()) in (sender_id, recipient_id));
create policy "Users can send friend requests" on public.friend_requests
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and status = 'pending'
    and not public.is_blocked_by_current_user(recipient_id)
  );
create policy "Recipients can respond to friend requests" on public.friend_requests
  for update to authenticated using (recipient_id = (select auth.uid()) and status = 'pending')
  with check (recipient_id = (select auth.uid()) and status in ('accepted', 'declined'));
create policy "Senders can cancel friend requests" on public.friend_requests
  for update to authenticated using (sender_id = (select auth.uid()) and status = 'pending')
  with check (sender_id = (select auth.uid()) and status = 'cancelled');

create policy "Members can read community posts" on public.community_posts
  for select to authenticated using (
    public.is_community_member(community_id)
    or exists (select 1 from public.communities c where c.id = community_id and c.visibility = 'public' and c.status = 'active')
  );
create policy "Members can publish community posts" on public.community_posts
  for insert to authenticated with check (
    author_id = (select auth.uid()) and public.is_community_member(community_id)
  );
create policy "Authors can edit their posts" on public.community_posts
  for update to authenticated using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy "Authors and moderators can remove posts" on public.community_posts
  for delete to authenticated using (
    author_id = (select auth.uid()) or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_id and cm.user_id = (select auth.uid()) and cm.role in ('owner', 'moderator')
    )
  );
create policy "Community members can read comments" on public.community_comments
  for select to authenticated using (exists (
    select 1 from public.community_posts cp where cp.id = post_id
      and (public.is_community_member(cp.community_id) or exists (
        select 1 from public.communities c where c.id = cp.community_id and c.visibility = 'public' and c.status = 'active'
      ))
  ));
create policy "Members can comment on community posts" on public.community_comments
  for insert to authenticated with check (
    author_id = (select auth.uid()) and exists (
      select 1 from public.community_posts cp where cp.id = post_id and public.is_community_member(cp.community_id)
    )
  );
create policy "Authors can remove their comments" on public.community_comments
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "Invited players can view team invitations" on public.team_invitations
  for select to authenticated using (invitee_id = (select auth.uid()) or inviter_id = (select auth.uid()));

drop policy "Participants can view tournament registrations" on public.tournament_participants;
create policy "Participants can view tournament registrations" on public.tournament_participants
  for select to authenticated using (
    user_id = (select auth.uid()) or exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.organizer_id = (select auth.uid())
    ) or (team_id is not null and public.is_team_member(team_id))
  );

create policy "Tournament participants can see matches" on public.tournament_matches
  for select to authenticated using (exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.status <> 'draft'
  ));
create policy "Tournament organizers can create matches" on public.tournament_matches
  for insert to authenticated with check (public.is_current_user_active() and exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.organizer_id = (select auth.uid())
  ));
create policy "Tournament organizers can manage matches" on public.tournament_matches
  for update to authenticated using (public.is_current_user_active() and exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.organizer_id = (select auth.uid())
  )) with check (public.is_current_user_active() and exists (
    select 1 from public.tournaments t where t.id = tournament_id and t.organizer_id = (select auth.uid())
  ));
create policy "Tournament results are public" on public.tournament_results
  for select to authenticated using (true);
create policy "Organizers can record results" on public.tournament_results
  for insert to authenticated with check (recorded_by = (select auth.uid()) and public.is_current_user_active() and exists (
    select 1 from public.tournament_matches m join public.tournaments t on t.id = m.tournament_id
    where m.id = match_id and t.organizer_id = (select auth.uid())
  ));
create policy "Tournament audit visible to participants and organizer" on public.tournament_audit_logs
  for select to authenticated using (exists (
    select 1 from public.tournaments t where t.id = tournament_id and (
      t.organizer_id = (select auth.uid()) or exists (
        select 1 from public.tournament_participants p
        where p.tournament_id = t.id and p.user_id = (select auth.uid())
      )
    )
  ));
create policy "Moderators can view administrative audit" on public.admin_audit_logs
  for select to authenticated using (public.is_platform_moderator());
create policy "Users can request account deletion" on public.account_deletion_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Moderators can inspect deletion requests" on public.account_deletion_requests
  for select to authenticated using (public.is_platform_moderator());
create policy "Published products are visible" on public.products
  for select to authenticated using (active = true or public.is_platform_moderator());
create policy "Moderators manage products" on public.products
  for all to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());
create policy "Users can view their orders" on public.orders
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can view their order items" on public.order_items
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())
  ));
create policy "Users can view their payments" on public.payments
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())
  ));
create policy "Users can view their entitlements" on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can view their credit ledger" on public.credit_ledger_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can submit permitted analytics" on public.analytics_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Moderators can review reports" on public.reports
  for select to authenticated using (public.is_platform_moderator());
create policy "Recipients can mark messages read" on public.message_receipts
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Moderators can update reports" on public.reports
  for update to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());
create policy "Moderators can review stream reports" on public.stream_reports
  for select to authenticated using (public.is_platform_moderator());
create policy "Moderators can update stream reports" on public.stream_reports
  for update to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());
create policy "Moderators can moderate streams" on public.streams
  for select to authenticated using (public.is_platform_moderator());
create policy "Moderators can update streams" on public.streams
  for update to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());
create policy "Creators can remove their streams" on public.streams
  for delete to authenticated using (user_id = (select auth.uid()) and status <> 'live');
create policy "Moderators can moderate profiles" on public.profiles
  for update to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());
create policy "Moderators can record actions" on public.moderation_actions
  for insert to authenticated with check (moderator_id = (select auth.uid()) and public.is_platform_moderator());
create policy "Moderators can review actions" on public.moderation_actions
  for select to authenticated using (public.is_platform_moderator());
create policy "Moderators can record admin audit" on public.admin_audit_logs
  for insert to authenticated with check (actor_id = (select auth.uid()) and public.is_platform_moderator());
create policy "Moderators can review tournaments" on public.tournaments
  for select to authenticated using (public.is_platform_moderator());
create policy "Moderators can verify tournament prizes" on public.tournaments
  for update to authenticated using (public.is_platform_moderator())
  with check (public.is_platform_moderator());

grant update (avatar_path, banner_path, profile_visibility) on public.profiles to authenticated;
grant delete on public.streams to authenticated;
grant insert, update, delete on public.reports, public.stream_reports to authenticated;
grant insert, select on public.moderation_actions to authenticated;
grant insert on public.admin_audit_logs to authenticated;
grant update (status) on public.reports, public.stream_reports to authenticated;
grant update (prize_verified_at) on public.tournaments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gamehub-avatars', 'gamehub-avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can view avatar images" on storage.objects
  for select to public using (bucket_id = 'gamehub-avatars');
create policy "Users upload avatars to their own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'gamehub-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users update avatars in their own folder" on storage.objects
  for update to authenticated using (
    bucket_id = 'gamehub-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'gamehub-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users delete avatars in their own folder" on storage.objects
  for delete to authenticated using (
    bucket_id = 'gamehub-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

grant select, insert, update on public.user_preferences, public.user_game_preferences to authenticated;
grant delete on public.user_game_preferences to authenticated;
grant select, insert on public.friend_requests to authenticated;
revoke update on public.friend_requests from authenticated;
grant select, insert, delete on public.community_posts, public.community_comments to authenticated;
revoke update on public.community_posts, public.community_comments from authenticated;
grant select on public.team_invitations to authenticated;
revoke insert, update on public.tournament_participants from authenticated;
grant update (status) on public.tournament_participants to authenticated;
grant select, insert, update on public.tournament_matches, public.tournament_results to authenticated;
grant select on public.tournament_audit_logs, public.admin_audit_logs to authenticated;
grant select on public.account_deletion_requests to authenticated;
grant select on public.products to authenticated;
grant insert, update on public.products to authenticated;
grant select on public.orders, public.order_items, public.payments, public.entitlements, public.credit_ledger_entries to authenticated;
grant insert on public.analytics_events to authenticated;
grant execute on function public.is_platform_moderator() to authenticated;
grant execute on function public.moderate_report(uuid, text) to authenticated;
grant execute on function public.moderate_stream_report(uuid, text) to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.export_account_data() to authenticated;
grant execute on function public.register_for_tournament(uuid) to authenticated;
grant execute on function public.register_team_for_tournament(uuid, uuid) to authenticated;
grant execute on function public.invite_team_member(uuid, uuid) to authenticated;
grant execute on function public.respond_to_team_invitation(uuid, boolean) to authenticated;
grant execute on function public.record_account_deletion_request() to authenticated;
grant execute on function public.prepare_account_deletion() to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.message_receipts from authenticated;
grant update (read_at) on public.message_receipts to authenticated;

drop policy "Conversation members can send messages as themselves" on public.messages;
create policy "Conversation members can send messages as themselves" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and public.is_conversation_member(conversation_id)
    and not exists (
      select 1 from public.conversation_members recipient
      where recipient.conversation_id = messages.conversation_id
        and recipient.user_id <> (select auth.uid())
        and public.is_blocked_by_current_user(recipient.user_id)
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stream_chat_messages') then
      alter publication supabase_realtime add table public.stream_chat_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_posts') then
      alter publication supabase_realtime add table public.community_posts;
    end if;
  end if;
end;
$$;
