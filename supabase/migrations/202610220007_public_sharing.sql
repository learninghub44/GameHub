alter table public.communities
  add column share_code text not null default encode(gen_random_bytes(6), 'hex');
alter table public.communities
  add constraint communities_share_code_unique unique (share_code);

alter table public.teams
  add column share_code text not null default encode(gen_random_bytes(6), 'hex'),
  add column visibility text not null default 'public'
    check (visibility in ('public', 'private'));
alter table public.teams
  add constraint teams_share_code_unique unique (share_code);

alter table public.tournaments
  add column share_code text not null default encode(gen_random_bytes(6), 'hex');
alter table public.tournaments
  add constraint tournaments_share_code_unique unique (share_code);

grant select (share_code) on public.communities to anon;
grant select (share_code, visibility) on public.teams to anon;
grant select (share_code) on public.tournaments to anon;
grant select (captain_id, name, description, game, share_code, visibility, created_at)
  on public.teams to anon;

create policy "Anonymous players can discover public teams" on public.teams
  for select to anon using (visibility = 'public');
create policy "Authenticated players can discover public teams" on public.teams
  for select to authenticated using (visibility = 'public');
