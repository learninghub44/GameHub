grant usage on schema public to anon;

grant select (id, username, display_name, bio, country_code, avatar_path)
  on public.profiles to anon;
grant select (id, owner_id, name, description, game, rules, visibility, status, created_at)
  on public.communities to anon;
grant select (id, user_id, title, game, provider, url, description, status, created_at)
  on public.streams to anon;
grant select (
  id, organizer_id, name, game, format, rules, status, starts_at,
  registration_deadline, participant_limit, prize_description, prize_verified_at
) on public.tournaments to anon;
grant select (id, name, description, product_type, price_minor, currency_code, credit_amount, created_at)
  on public.products to anon;

create policy "Anonymous players can discover public profiles" on public.profiles
  for select to anon using (
    onboarding_completed_at is not null
    and is_suspended = false
    and profile_visibility = 'public'
  );
create policy "Anonymous players can discover active communities" on public.communities
  for select to anon using (visibility = 'public' and status = 'active');
create policy "Anonymous players can discover live streams" on public.streams
  for select to anon using (status = 'live');
create policy "Anonymous players can discover published tournaments" on public.tournaments
  for select to anon using (status <> 'draft');
create policy "Anonymous players can browse active products" on public.products
  for select to anon using (active = true);
