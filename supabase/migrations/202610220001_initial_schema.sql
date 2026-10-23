create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text not null default 'Player' check (char_length(trim(display_name)) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 240),
  country_code text not null default 'KE' check (country_code ~ '^[A-Z_]{2,5}$'),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'sw')),
  terms_accepted_at timestamptz,
  onboarding_completed_at timestamptz,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username is null or (
    username ~ '^[a-z0-9_]{3,24}$'
    and username not in ('admin', 'administrator', 'gamehub', 'support', 'moderator', 'staff', 'system')
  )),
  constraint profiles_username_required_for_onboarding check (onboarding_completed_at is null or (username is not null and terms_accepted_at is not null))
);

create unique index profiles_username_ci_unique on public.profiles (lower(username)) where username is not null;
create index profiles_discovery_idx on public.profiles (created_at desc) where onboarding_completed_at is not null and is_suspended = false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                  split_part(new.email, '@', 1),
                  'Player'), 60)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.complete_onboarding(
  requested_username text,
  requested_display_name text,
  requested_country_code text,
  requested_language text,
  requested_terms_accepted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_username text := lower(trim(requested_username));
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(normalized_username) not between 3 and 24
     or normalized_username !~ '^[a-z0-9_]+$'
     or normalized_username in ('admin', 'administrator', 'gamehub', 'support', 'moderator', 'staff', 'system') then
    raise exception 'Invalid or reserved username' using errcode = '22023';
  end if;
  if char_length(trim(requested_display_name)) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters' using errcode = '22023';
  end if;
  if requested_country_code !~ '^[A-Z_]{2,5}$' then
    raise exception 'Invalid country code' using errcode = '22023';
  end if;
  if requested_language not in ('en', 'sw') then
    raise exception 'Unsupported language' using errcode = '22023';
  end if;
  if requested_terms_accepted is distinct from true then
    raise exception 'Terms and privacy policy acceptance is required' using errcode = '22023';
  end if;

  update public.profiles
  set username = normalized_username,
      display_name = trim(requested_display_name),
      country_code = requested_country_code,
      preferred_language = requested_language,
      terms_accepted_at = now(),
      onboarding_completed_at = now()
  where id = caller_id and is_suspended = false;

  if not found then
    raise exception 'Profile is unavailable' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.complete_onboarding(text, text, text, text, boolean) from public;
grant execute on function public.complete_onboarding(text, text, text, text, boolean) to authenticated;

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create table public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint user_follows_not_self check (follower_id <> followed_id)
);

create index user_follows_followed_idx on public.user_follows (followed_id, created_at desc);

create or replace function public.is_blocked_by_current_user(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = other_user_id)
       or (b.blocker_id = other_user_id and b.blocked_id = (select auth.uid()))
  );
$$;
revoke all on function public.is_blocked_by_current_user(uuid) from public;
grant execute on function public.is_blocked_by_current_user(uuid) to authenticated;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  game text,
  rules text not null default '' check (char_length(rules) <= 5000),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'active' check (status in ('active', 'restricted', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communities_discovery_idx on public.communities (created_at desc) where visibility = 'public' and status = 'active';

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id, joined_at desc);

create or replace function public.add_community_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.community_members (community_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (community_id, user_id) do nothing;
  return new;
end;
$$;
create trigger communities_add_owner
  after insert on public.communities
  for each row execute function public.add_community_owner_membership();

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  game text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('captain', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create or replace function public.add_team_captain_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.captain_id, 'captain')
  on conflict (team_id, user_id) do nothing;
  return new;
end;
$$;
create trigger teams_add_captain
  after insert on public.teams
  for each row execute function public.add_team_captain_membership();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id, conversation_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
alter table public.messages add constraint messages_sender_is_member
  foreign key (conversation_id, sender_id)
  references public.conversation_members (conversation_id, user_id);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);

create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  primary key (message_id, user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('message', 'follow', 'community', 'tournament', 'moderation')),
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create table public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 160),
  game text not null check (char_length(trim(game)) between 1 and 100),
  provider text not null check (provider in ('youtube', 'twitch')),
  url text not null check (
    (provider = 'youtube' and url ~ '^https://(www\.)?(youtube\.com|youtu\.be)/')
    or (provider = 'twitch' and url ~ '^https://(www\.)?twitch\.tv/')
  ),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'unverified' check (status in ('unverified', 'live', 'offline', 'unavailable', 'removed')),
  featured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index streams_live_idx on public.streams (created_at desc) where status = 'live';
create index streams_user_idx on public.streams (user_id, created_at desc);

create table public.stream_follows (
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stream_id, user_id)
);

create table public.stream_chat_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index stream_chat_history_idx on public.stream_chat_messages (stream_id, created_at desc, id desc);

create table public.stream_reports (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  unique (stream_id, reporter_id)
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 3 and 120),
  game text not null check (char_length(trim(game)) between 1 and 100),
  format text not null check (char_length(trim(format)) between 1 and 80),
  rules text not null default '' check (char_length(rules) <= 10000),
  status text not null default 'draft' check (status in ('draft', 'registration_open', 'upcoming', 'in_progress', 'completed', 'cancelled')),
  starts_at timestamptz not null,
  registration_deadline timestamptz,
  participant_limit integer check (participant_limit is null or participant_limit > 0),
  prize_description text check (prize_description is null or char_length(prize_description) <= 500),
  prize_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tournaments_discovery_idx on public.tournaments (starts_at) where status in ('registration_open', 'upcoming', 'in_progress');

create table public.tournament_participants (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'cancelled', 'disqualified')),
  registered_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index tournament_participants_user_idx on public.tournament_participants (user_id, registered_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  resource_type text not null check (resource_type in ('profile', 'community', 'message', 'stream', 'tournament')),
  resource_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete set null,
  resource_type text not null,
  resource_id uuid,
  action text not null,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  created_at timestamptz not null default now()
);

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation_id and cm.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.is_community_member(target_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_members cm
    where cm.community_id = target_community_id and cm.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_community_member(uuid) from public;
grant execute on function public.is_community_member(uuid) to authenticated;

create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team_id and tm.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_team_member(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_follows enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.notifications enable row level security;
alter table public.streams enable row level security;
alter table public.stream_follows enable row level security;
alter table public.stream_chat_messages enable row level security;
alter table public.stream_reports enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;

create policy "Public profiles are discoverable" on public.profiles
  for select to authenticated using (onboarding_completed_at is not null and is_suspended = false);
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id and is_suspended = false)
  with check ((select auth.uid()) = id and is_suspended = false);

create policy "Users manage their own blocks" on public.user_blocks
  for all to authenticated using ((select auth.uid()) = blocker_id)
  with check ((select auth.uid()) = blocker_id);
create policy "Users can view their follows" on public.user_follows
  for select to authenticated using ((select auth.uid()) in (follower_id, followed_id));
create policy "Users can follow other players" on public.user_follows
  for insert to authenticated with check (
    (select auth.uid()) = follower_id
    and not public.is_blocked_by_current_user(followed_id)
  );
create policy "Users can unfollow" on public.user_follows
  for delete to authenticated using ((select auth.uid()) = follower_id);

create policy "Public active communities are visible" on public.communities
  for select to authenticated using (visibility = 'public' and status = 'active');
create policy "Community members can view their communities" on public.communities
  for select to authenticated using (public.is_community_member(id));
create policy "Community owners can create communities" on public.communities
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Community owners can update communities" on public.communities
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Members can read community membership" on public.community_members
  for select to authenticated using (exists (
    select 1 from public.communities c
    where c.id = community_id and (c.visibility = 'public' or public.is_community_member(c.id))
  ));
create policy "Users can join public communities" on public.community_members
  for insert to authenticated with check (
    user_id = (select auth.uid()) and role = 'member' and exists (
      select 1 from public.communities c where c.id = community_id and c.visibility = 'public' and c.status = 'active'
    )
  );
create policy "Users can leave communities" on public.community_members
  for delete to authenticated using (user_id = (select auth.uid()) and role <> 'owner');

create policy "Team members can view teams" on public.teams
  for select to authenticated using (public.is_team_member(id));
create policy "Players can create teams" on public.teams
  for insert to authenticated with check (captain_id = (select auth.uid()));
create policy "Captains can update teams" on public.teams
  for update to authenticated using (captain_id = (select auth.uid()))
  with check (captain_id = (select auth.uid()));
create policy "Team members can read team membership" on public.team_members
  for select to authenticated using (public.is_team_member(team_id));

create policy "Conversation members can read conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id));
create policy "Conversation members can read member lists" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "Conversation members can read messages" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "Conversation members can send messages as themselves" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and public.is_conversation_member(conversation_id)
  );
create policy "Recipients can read their message receipts" on public.message_receipts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Recipients can update their message receipts" on public.message_receipts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can read their notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can mark their notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Live streams are visible" on public.streams
  for select to authenticated using (
    status = 'live' or user_id = (select auth.uid())
  );
create policy "Players can submit their streams" on public.streams
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'unverified');
create policy "Creators can update their own streams" on public.streams
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status in ('unverified', 'offline', 'unavailable'));
create policy "Users can view their stream follows" on public.stream_follows
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can follow streams" on public.stream_follows
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can unfollow streams" on public.stream_follows
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "Live chat is visible to authenticated users" on public.stream_chat_messages
  for select to authenticated using (exists (
    select 1 from public.streams s where s.id = stream_id and s.status = 'live'
  ));
create policy "Users can send live chat as themselves" on public.stream_chat_messages
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.streams s where s.id = stream_id and s.status = 'live'
        and not public.is_blocked_by_current_user(s.user_id)
    )
  );
create policy "Users can submit stream reports" on public.stream_reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "Users can see their own stream reports" on public.stream_reports
  for select to authenticated using (reporter_id = (select auth.uid()));

create policy "Published tournaments are visible" on public.tournaments
  for select to authenticated using (status <> 'draft');
create policy "Organizers can view their drafts" on public.tournaments
  for select to authenticated using (organizer_id = (select auth.uid()));
create policy "Players can create tournaments" on public.tournaments
  for insert to authenticated with check (organizer_id = (select auth.uid()) and status = 'draft');
create policy "Organizers can update their tournaments" on public.tournaments
  for update to authenticated using (organizer_id = (select auth.uid()))
  with check (organizer_id = (select auth.uid()) and (
    prize_description is null or prize_verified_at is not null
  ));
create policy "Participants can view tournament registrations" on public.tournament_participants
  for select to authenticated using (
    user_id = (select auth.uid()) or exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.organizer_id = (select auth.uid())
    )
  );
create policy "Players can register for open tournaments" on public.tournament_participants
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.status = 'registration_open'
        and (t.registration_deadline is null or t.registration_deadline > now())
        and (t.participant_limit is null or (
          select count(*) from public.tournament_participants p
          where p.tournament_id = t.id and p.status = 'registered'
        ) < t.participant_limit)
    )
  );
create policy "Players can cancel their registration" on public.tournament_participants
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status = 'cancelled');
create policy "Users can submit reports" on public.reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "Users can view their reports" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, bio, country_code, preferred_language) on public.profiles to authenticated;
grant select, insert, delete on public.user_blocks, public.user_follows to authenticated;
grant select, insert, update on public.communities to authenticated;
grant select, insert, delete on public.community_members to authenticated;
grant select, insert, update on public.teams to authenticated;
grant select on public.team_members to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert on public.message_receipts to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update on public.streams to authenticated;
grant select, insert, delete on public.stream_follows to authenticated;
grant select, insert on public.stream_chat_messages to authenticated;
grant select, insert on public.stream_reports to authenticated;
grant select, insert, update on public.tournaments to authenticated;
revoke insert, update on public.tournaments from authenticated;
grant select on public.tournaments to authenticated;
grant insert (organizer_id, name, game, format, rules, status, starts_at, registration_deadline, participant_limit, prize_description) on public.tournaments to authenticated;
grant update (name, game, format, rules, status, starts_at, registration_deadline, participant_limit, prize_description) on public.tournaments to authenticated;
grant select, insert, update on public.tournament_participants to authenticated;
grant select, insert on public.reports to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.is_blocked_by_current_user(uuid) to authenticated;
