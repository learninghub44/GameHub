create table public.support_agents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_manage_legal boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create or replace function public.is_support_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_suspended = false and p.platform_role = 'admin'
  ) or exists (
    select 1 from public.support_agents a
    join public.profiles p on p.id = a.user_id
    where a.user_id = (select auth.uid()) and a.enabled and p.is_suspended = false
  );
$$;
revoke all on function public.is_support_staff() from public;
grant execute on function public.is_support_staff() to authenticated;

create or replace function public.can_manage_legal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_suspended = false and p.platform_role = 'admin'
  ) or exists (
    select 1 from public.support_agents a
    join public.profiles p on p.id = a.user_id
    where a.user_id = (select auth.uid()) and a.enabled and a.can_manage_legal and p.is_suspended = false
  );
$$;
revoke all on function public.can_manage_legal() from public;
grant execute on function public.can_manage_legal() to authenticated;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('technical', 'account', 'payments', 'tournaments', 'safety', 'privacy', 'general')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')),
  subject text not null check (char_length(trim(subject)) between 4 and 160),
  transaction_reference text check (transaction_reference is null or char_length(transaction_reference) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index support_tickets_requester_idx on public.support_tickets (requester_id, updated_at desc);
create index support_tickets_queue_idx on public.support_tickets (status, priority, updated_at desc);
create trigger support_tickets_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 8000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index support_ticket_messages_idx on public.support_ticket_messages (ticket_id, created_at);

create table public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  category text not null check (category in ('general', 'technical', 'partnerships', 'creator', 'tournament', 'payments', 'privacy')),
  subject text not null check (char_length(trim(subject)) between 4 and 160),
  message text not null check (char_length(trim(message)) between 10 and 5000),
  rate_key text not null check (rate_key ~ '^[a-f0-9]{64}$'),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')),
  staff_response text check (staff_response is null or char_length(staff_response) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_submissions_created_idx on public.contact_submissions (created_at desc);
create index contact_submissions_rate_idx on public.contact_submissions (rate_key, created_at desc);
create index contact_submissions_queue_idx on public.contact_submissions (status, updated_at desc);
create trigger contact_submissions_updated_at before update on public.contact_submissions
  for each row execute function public.set_updated_at();

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('access', 'correction', 'deletion', 'privacy_question', 'complaint')),
  details text not null check (char_length(trim(details)) between 5 and 3000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')),
  staff_response text check (staff_response is null or char_length(staff_response) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index privacy_requests_requester_idx on public.privacy_requests (requester_id, created_at desc);
create index privacy_requests_queue_idx on public.privacy_requests (status, created_at desc);
create trigger privacy_requests_updated_at before update on public.privacy_requests
  for each row execute function public.set_updated_at();

create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.moderation_actions(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  details text not null check (char_length(trim(details)) between 20 and 3000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'upheld', 'overturned', 'closed')),
  staff_response text check (staff_response is null or char_length(staff_response) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, requester_id)
);
create index moderation_appeals_queue_idx on public.moderation_appeals (status, created_at desc);
create trigger moderation_appeals_updated_at before update on public.moderation_appeals
  for each row execute function public.set_updated_at();

create table public.support_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  resource_type text not null check (resource_type in ('ticket', 'contact_submission', 'privacy_request', 'appeal', 'legal_document', 'support_agent')),
  resource_id uuid,
  action text not null check (char_length(action) between 1 and 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index support_audit_logs_created_idx on public.support_audit_logs (created_at desc);

create table public.legal_documents (
  id text primary key check (id in ('terms', 'privacy', 'cookies', 'refunds', 'community-guidelines')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  current_version text not null,
  effective_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.legal_document_versions (
  document_id text not null references public.legal_documents(id) on delete cascade,
  version text not null,
  body text not null check (char_length(body) between 1 and 50000),
  published boolean not null default false,
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, version)
);
create table public.user_policy_acceptances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id, version),
  foreign key (document_id, version) references public.legal_document_versions(document_id, version) on delete restrict
);
insert into public.legal_documents (id, title, current_version) values
  ('terms', 'Terms of Service', '2026-10-draft'),
  ('privacy', 'Privacy Policy', '2026-10-draft'),
  ('cookies', 'Cookie Policy', '2026-10-draft'),
  ('refunds', 'Refund and Cancellation Policy', '2026-10-draft'),
  ('community-guidelines', 'Community Guidelines', '2026-10-draft');
insert into public.legal_document_versions (document_id, version, body, published)
select id, current_version, 'Draft publication pending owner and qualified legal review. See the public policy page for the current draft.', false
from public.legal_documents;

create table public.help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,100}$'),
  title text not null check (char_length(trim(title)) between 3 and 160),
  category text not null check (char_length(trim(category)) between 2 and 80),
  tags text[] not null default '{}',
  body text not null check (char_length(body) between 10 and 12000),
  published boolean not null default false,
  helpful_count integer not null default 0 check (helpful_count >= 0),
  not_helpful_count integer not null default 0 check (not_helpful_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index help_articles_public_idx on public.help_articles (category, updated_at desc) where published;

create table public.help_article_feedback (
  article_id uuid not null references public.help_articles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
create or replace function public.refresh_help_article_feedback_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_article_id uuid;
begin
  if tg_op = 'DELETE' then target_article_id := old.article_id;
  else target_article_id := new.article_id;
  end if;
  update public.help_articles set
    helpful_count = (select count(*)::integer from public.help_article_feedback where article_id = target_article_id and helpful),
    not_helpful_count = (select count(*)::integer from public.help_article_feedback where article_id = target_article_id and not helpful)
  where id = target_article_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger help_article_feedback_counts
  after insert or update or delete on public.help_article_feedback
  for each row execute function public.refresh_help_article_feedback_counts();

create table public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(trim(question)) between 5 and 300),
  answer text not null check (char_length(trim(answer)) between 5 and 5000),
  category text not null check (char_length(trim(category)) between 2 and 80),
  sort_order integer not null default 0,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index faq_entries_public_idx on public.faq_entries (category, sort_order) where published;

alter table public.support_agents enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.contact_submissions enable row level security;
alter table public.privacy_requests enable row level security;
alter table public.moderation_appeals enable row level security;
alter table public.support_audit_logs enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_document_versions enable row level security;
alter table public.user_policy_acceptances enable row level security;
alter table public.help_articles enable row level security;
alter table public.help_article_feedback enable row level security;
alter table public.faq_entries enable row level security;

create policy "Support agents can view their assignment" on public.support_agents
  for select to authenticated using (user_id = (select auth.uid()) or public.can_manage_legal());
create policy "Legal managers can manage support agents" on public.support_agents
  for all to authenticated using (public.can_manage_legal()) with check (public.can_manage_legal());
create policy "Requesters and support staff can view tickets" on public.support_tickets
  for select to authenticated using (requester_id = (select auth.uid()) or public.is_support_staff());
create policy "Requesters and support staff can view public ticket replies" on public.support_ticket_messages
  for select to authenticated using (
    public.is_support_staff()
    or (not is_internal and exists (
      select 1 from public.support_tickets t where t.id = ticket_id and t.requester_id = (select auth.uid())
    ))
  );
create policy "Staff can read contact submissions" on public.contact_submissions
  for select to authenticated using (public.is_support_staff());
create policy "Users and support staff can view privacy requests" on public.privacy_requests
  for select to authenticated using (requester_id = (select auth.uid()) or public.is_support_staff());
create policy "Users and support staff can view appeals" on public.moderation_appeals
  for select to authenticated using (requester_id = (select auth.uid()) or public.is_support_staff());
create policy "Users can view moderation actions against themselves" on public.moderation_actions
  for select to authenticated using (target_user_id = (select auth.uid()));
create policy "Support staff can view support audit logs" on public.support_audit_logs
  for select to authenticated using (public.is_support_staff());
create policy "Published legal documents are public" on public.legal_documents
  for select to anon, authenticated using (true);
create policy "Legal managers can update legal documents" on public.legal_documents
  for update to authenticated using (public.can_manage_legal()) with check (public.can_manage_legal());
create policy "Published legal versions are public" on public.legal_document_versions
  for select to anon, authenticated using (published or public.can_manage_legal());
create policy "Legal managers can manage versions" on public.legal_document_versions
  for all to authenticated using (public.can_manage_legal()) with check (public.can_manage_legal());
create policy "Users can view their policy acceptances" on public.user_policy_acceptances
  for select to authenticated using (user_id = (select auth.uid()) or public.can_manage_legal());
create policy "Published help articles are public" on public.help_articles
  for select to anon, authenticated using (published or public.can_manage_legal());
create policy "Legal managers can manage help articles" on public.help_articles
  for all to authenticated using (public.can_manage_legal()) with check (public.can_manage_legal());
create policy "Published FAQs are public" on public.faq_entries
  for select to anon, authenticated using (published or public.can_manage_legal());
create policy "Legal managers can manage FAQs" on public.faq_entries
  for all to authenticated using (public.can_manage_legal()) with check (public.can_manage_legal());
create policy "Users can manage their help article feedback" on public.help_article_feedback
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.support_agents, public.support_tickets, public.support_ticket_messages,
  public.contact_submissions, public.privacy_requests, public.moderation_appeals, public.support_audit_logs,
  public.legal_documents, public.legal_document_versions, public.user_policy_acceptances,
  public.help_articles, public.help_article_feedback, public.faq_entries to authenticated;
grant select on public.legal_documents, public.legal_document_versions, public.help_articles, public.faq_entries to anon;
revoke insert, update, delete on public.support_agents, public.support_tickets, public.support_ticket_messages,
  public.contact_submissions, public.privacy_requests, public.moderation_appeals, public.support_audit_logs,
  public.user_policy_acceptances from anon, authenticated;
revoke insert, update, delete on public.legal_documents, public.legal_document_versions,
  public.help_articles, public.faq_entries from anon, authenticated;
grant insert, update, delete on public.legal_documents, public.legal_document_versions,
  public.help_articles, public.faq_entries to authenticated;
grant insert, update, delete on public.help_article_feedback to authenticated;

create or replace function public.set_support_agent(
  requested_user_id uuid,
  requested_can_manage_legal boolean,
  requested_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.can_manage_legal() then
    raise exception 'Legal management permissions are required' using errcode = '42501';
  end if;
  if requested_user_id is null or requested_can_manage_legal is null or requested_enabled is null then
    raise exception 'Choose an existing user and explicit staff permissions' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = requested_user_id and is_suspended = false) then
    raise exception 'Choose an active GameHub user' using errcode = '22023';
  end if;
  insert into public.support_agents (user_id, can_manage_legal, enabled, created_by)
  values (requested_user_id, requested_can_manage_legal, requested_enabled, caller_id)
  on conflict (user_id) do update set
    can_manage_legal = excluded.can_manage_legal,
    enabled = excluded.enabled,
    created_by = excluded.created_by;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action, details)
  values (caller_id, 'support_agent', requested_user_id, 'support_agent_updated',
    jsonb_build_object('can_manage_legal', requested_can_manage_legal, 'enabled', requested_enabled));
end;
$$;
revoke all on function public.set_support_agent(uuid, boolean, boolean) from public;
grant execute on function public.set_support_agent(uuid, boolean, boolean) to authenticated;

create or replace function public.create_support_ticket(
  requested_category text,
  requested_subject text,
  requested_body text,
  requested_priority text default 'normal',
  requested_transaction_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_ticket_id uuid;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'Sign in to contact support' using errcode = '42501';
  end if;
  if requested_category is null or requested_category not in ('technical', 'account', 'payments', 'tournaments', 'safety', 'privacy', 'general')
    or requested_priority is null or requested_priority not in ('low', 'normal', 'high') then
    raise exception 'Choose a valid support category and priority' using errcode = '22023';
  end if;
  if requested_subject is null or requested_body is null
    or char_length(trim(requested_subject)) not between 4 and 160
    or char_length(trim(requested_body)) not between 10 and 8000
    or (requested_transaction_reference is not null and char_length(requested_transaction_reference) > 120) then
    raise exception 'Check the subject, message and transaction reference lengths' using errcode = '22023';
  end if;
  perform public.enforce_user_rate_limit('support_ticket', 5, 3600);
  insert into public.support_tickets (requester_id, category, subject, priority, transaction_reference)
  values (caller_id, requested_category, trim(requested_subject),
    case when requested_category = 'safety' and requested_priority = 'high' then 'urgent' else requested_priority end,
    nullif(trim(requested_transaction_reference), ''))
  returning id into new_ticket_id;
  insert into public.support_ticket_messages (ticket_id, author_id, body)
  values (new_ticket_id, caller_id, trim(requested_body));
  return new_ticket_id;
end;
$$;
revoke all on function public.create_support_ticket(text, text, text, text, text) from public;
grant execute on function public.create_support_ticket(text, text, text, text, text) to authenticated;

create or replace function public.reply_to_support_ticket(requested_ticket_id uuid, requested_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_ticket public.support_tickets%rowtype;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'Sign in to reply to support' using errcode = '42501';
  end if;
  if requested_body is null or char_length(trim(requested_body)) not between 1 and 8000 then
    raise exception 'Your reply must be between 1 and 8,000 characters' using errcode = '22023';
  end if;
  select * into target_ticket from public.support_tickets where id = requested_ticket_id for update;
  if target_ticket.id is null or (target_ticket.requester_id <> caller_id and not public.is_support_staff()) then
    raise exception 'Ticket not found or access denied' using errcode = '42501';
  end if;
  if target_ticket.status in ('closed', 'resolved') and not public.is_support_staff() then
    raise exception 'This ticket is closed. Open a new ticket or contact support to request a review.' using errcode = '22023';
  end if;
  perform public.enforce_user_rate_limit('support_reply', 20, 3600);
  insert into public.support_ticket_messages (ticket_id, author_id, body)
  values (requested_ticket_id, caller_id, trim(requested_body));
  update public.support_tickets set last_message_at = now(),
    status = case when caller_id = target_ticket.requester_id then 'open' else 'waiting_for_user' end,
    updated_at = now()
  where id = requested_ticket_id;
  if caller_id <> target_ticket.requester_id then
    insert into public.support_audit_logs (actor_id, resource_type, resource_id, action)
    values (caller_id, 'ticket', requested_ticket_id, 'reply_sent');
  end if;
end;
$$;
revoke all on function public.reply_to_support_ticket(uuid, text) from public;
grant execute on function public.reply_to_support_ticket(uuid, text) to authenticated;

create or replace function public.update_support_ticket(
  requested_ticket_id uuid,
  requested_status text,
  requested_priority text default null,
  requested_assignee uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  old_ticket public.support_tickets%rowtype;
begin
  if caller_id is null or not public.is_support_staff() then
    raise exception 'Support staff permissions are required' using errcode = '42501';
  end if;
  if requested_status is null or requested_status not in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')
    or (requested_priority is not null and requested_priority not in ('low', 'normal', 'high', 'urgent')) then
    raise exception 'Choose a valid ticket status and priority' using errcode = '22023';
  end if;
  select * into old_ticket from public.support_tickets where id = requested_ticket_id for update;
  if old_ticket.id is null then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if requested_assignee is not null and not exists (
    select 1 from public.support_agents where user_id = requested_assignee and enabled
  ) and not exists (select 1 from public.profiles where id = requested_assignee and platform_role = 'admin') then
    raise exception 'Assign the ticket to an active support agent' using errcode = '22023';
  end if;
  update public.support_tickets set status = requested_status,
    priority = coalesce(requested_priority, priority),
    assigned_to = requested_assignee
  where id = requested_ticket_id;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action, details)
  values (caller_id, 'ticket', requested_ticket_id, 'ticket_updated',
    jsonb_build_object('from_status', old_ticket.status, 'to_status', requested_status,
      'from_priority', old_ticket.priority, 'to_priority', coalesce(requested_priority, old_ticket.priority),
      'from_assignee', old_ticket.assigned_to, 'to_assignee', requested_assignee));
end;
$$;
revoke all on function public.update_support_ticket(uuid, text, text, uuid) from public;
grant execute on function public.update_support_ticket(uuid, text, text, uuid) to authenticated;

create or replace function public.add_support_internal_note(requested_ticket_id uuid, requested_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_support_staff() then
    raise exception 'Support staff permissions are required' using errcode = '42501';
  end if;
  if requested_body is null or char_length(trim(requested_body)) not between 1 and 8000 then
    raise exception 'Internal note must be between 1 and 8,000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.support_tickets where id = requested_ticket_id) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  insert into public.support_ticket_messages (ticket_id, author_id, body, is_internal)
  values (requested_ticket_id, caller_id, trim(requested_body), true);
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action)
  values (caller_id, 'ticket', requested_ticket_id, 'internal_note_added');
end;
$$;
revoke all on function public.add_support_internal_note(uuid, text) from public;
grant execute on function public.add_support_internal_note(uuid, text) to authenticated;

create or replace function public.update_privacy_request(
  requested_request_id uuid,
  requested_status text,
  requested_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_support_staff() then
    raise exception 'Support staff permissions are required' using errcode = '42501';
  end if;
  if requested_status is null or requested_status not in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')
    or char_length(coalesce(requested_response, '')) > 3000 then
    raise exception 'Choose a valid status and response up to 3,000 characters' using errcode = '22023';
  end if;
  update public.privacy_requests set status = requested_status,
    staff_response = nullif(trim(coalesce(requested_response, '')), '')
  where id = requested_request_id;
  if not found then raise exception 'Privacy request not found' using errcode = 'P0002'; end if;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action)
  values (caller_id, 'privacy_request', requested_request_id, 'privacy_request_updated');
end;
$$;
revoke all on function public.update_privacy_request(uuid, text, text) from public;
grant execute on function public.update_privacy_request(uuid, text, text) to authenticated;

create or replace function public.update_moderation_appeal(
  requested_appeal_id uuid,
  requested_status text,
  requested_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_support_staff() then
    raise exception 'Support staff permissions are required' using errcode = '42501';
  end if;
  if requested_status is null or requested_status not in ('in_progress', 'upheld', 'overturned', 'closed')
    or char_length(coalesce(requested_response, '')) > 3000 then
    raise exception 'Choose a valid appeal status and response up to 3,000 characters' using errcode = '22023';
  end if;
  update public.moderation_appeals set status = requested_status,
    staff_response = nullif(trim(coalesce(requested_response, '')), '')
  where id = requested_appeal_id;
  if not found then raise exception 'Appeal not found' using errcode = 'P0002'; end if;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action)
  values (caller_id, 'appeal', requested_appeal_id, 'appeal_updated');
end;
$$;
revoke all on function public.update_moderation_appeal(uuid, text, text) from public;
grant execute on function public.update_moderation_appeal(uuid, text, text) to authenticated;

create or replace function public.update_contact_submission(
  requested_submission_id uuid,
  requested_status text,
  requested_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_support_staff() then
    raise exception 'Support staff permissions are required' using errcode = '42501';
  end if;
  if requested_status is null or requested_status not in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')
    or char_length(coalesce(requested_response, '')) > 3000 then
    raise exception 'Choose a valid status and response up to 3,000 characters' using errcode = '22023';
  end if;
  update public.contact_submissions set status = requested_status,
    staff_response = nullif(trim(coalesce(requested_response, '')), '')
  where id = requested_submission_id;
  if not found then raise exception 'Contact submission not found' using errcode = 'P0002'; end if;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action)
  values (caller_id, 'contact_submission', requested_submission_id, 'contact_submission_updated');
end;
$$;
revoke all on function public.update_contact_submission(uuid, text, text) from public;
grant execute on function public.update_contact_submission(uuid, text, text) to authenticated;

create or replace function public.submit_contact_request(
  requested_name text,
  requested_email text,
  requested_category text,
  requested_subject text,
  requested_message text,
  requested_rate_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_submission_id uuid;
begin
  if requested_name is null or requested_email is null or requested_subject is null
    or requested_message is null
    or char_length(trim(requested_name)) not between 1 and 100
    or char_length(trim(requested_email)) not between 3 and 254
    or requested_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or requested_category is null or requested_category not in ('general', 'technical', 'partnerships', 'creator', 'tournament', 'payments', 'privacy')
    or char_length(trim(requested_subject)) not between 4 and 160
    or char_length(trim(requested_message)) not between 10 and 5000
    or requested_rate_key is null or requested_rate_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Check your contact details and message fields' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_rate_key, 0));
  if (select count(*) from public.contact_submissions
      where rate_key = requested_rate_key and created_at > now() - interval '1 hour') >= 5
    or exists (select 1 from public.contact_submissions
      where rate_key = requested_rate_key and created_at > now() - interval '1 minute') then
    raise exception 'Please wait before sending another contact request' using errcode = 'P0001';
  end if;
  insert into public.contact_submissions (requester_id, name, email, category, subject, message, rate_key)
  values ((select auth.uid()), trim(requested_name), lower(trim(requested_email)),
    requested_category, trim(requested_subject), trim(requested_message), requested_rate_key)
  returning id into new_submission_id;
  return new_submission_id;
end;
$$;
revoke all on function public.submit_contact_request(text, text, text, text, text, text) from public;
grant execute on function public.submit_contact_request(text, text, text, text, text, text) to anon, authenticated;

create or replace function public.submit_privacy_request(requested_type text, requested_details text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_request_id uuid;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'Sign in to submit a privacy request' using errcode = '42501';
  end if;
  if requested_type is null or requested_type not in ('access', 'correction', 'deletion', 'privacy_question', 'complaint')
    or requested_details is null
    or char_length(trim(requested_details)) not between 5 and 3000 then
    raise exception 'Choose a request type and provide between 5 and 3,000 characters of detail' using errcode = '22023';
  end if;
  perform public.enforce_user_rate_limit('privacy_request', 5, 86400);
  insert into public.privacy_requests (requester_id, request_type, details)
  values (caller_id, requested_type, trim(requested_details))
  returning id into new_request_id;
  return new_request_id;
end;
$$;
revoke all on function public.submit_privacy_request(text, text) from public;
grant execute on function public.submit_privacy_request(text, text) to authenticated;

create or replace function public.submit_moderation_appeal(requested_action_id uuid, requested_details text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  new_appeal_id uuid;
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'Sign in to appeal a moderation decision' using errcode = '42501';
  end if;
  if requested_details is null or char_length(trim(requested_details)) not between 20 and 3000 then
    raise exception 'Explain your appeal in 20 to 3,000 characters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.moderation_actions a
    where a.id = requested_action_id and a.target_user_id = caller_id
  ) then
    raise exception 'Moderation action not found or access denied' using errcode = '42501';
  end if;
  perform public.enforce_user_rate_limit('moderation_appeal', 3, 86400);
  insert into public.moderation_appeals (action_id, requester_id, details)
  values (requested_action_id, caller_id, trim(requested_details))
  returning id into new_appeal_id;
  return new_appeal_id;
exception when unique_violation then
  raise exception 'You have already submitted an appeal for this decision' using errcode = '23505';
end;
$$;
revoke all on function public.submit_moderation_appeal(uuid, text) from public;
grant execute on function public.submit_moderation_appeal(uuid, text) to authenticated;

create or replace function public.accept_policy_version(requested_document_id text, requested_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.is_current_user_active() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.legal_document_versions v
    join public.legal_documents d on d.id = v.document_id and d.current_version = v.version
    where v.document_id = requested_document_id and v.version = requested_version and v.published
  ) then
    raise exception 'This published policy version is unavailable' using errcode = '22023';
  end if;
  insert into public.user_policy_acceptances (user_id, document_id, version)
  values (caller_id, requested_document_id, requested_version)
  on conflict do nothing;
end;
$$;
revoke all on function public.accept_policy_version(text, text) from public;
grant execute on function public.accept_policy_version(text, text) to authenticated;

create or replace function public.publish_legal_version(requested_document_id text, requested_version text, requested_effective_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or not public.can_manage_legal() then
    raise exception 'Legal management permissions are required' using errcode = '42501';
  end if;
  if requested_effective_at is null
    or requested_effective_at < now() - interval '1 minute'
    or requested_effective_at > now() + interval '1 minute' then
    raise exception 'Scheduled publication is not supported. Choose a date and time close to now.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.legal_document_versions
    where document_id = requested_document_id and version = requested_version
  ) then
    raise exception 'Legal document version not found' using errcode = 'P0002';
  end if;
  update public.legal_document_versions set published = false where document_id = requested_document_id;
  update public.legal_document_versions set published = true, published_at = now(), published_by = caller_id
  where document_id = requested_document_id and version = requested_version;
  update public.legal_documents set current_version = requested_version, effective_at = requested_effective_at
  where id = requested_document_id;
  insert into public.support_audit_logs (actor_id, resource_type, resource_id, action, details)
  values (caller_id, 'legal_document', null, 'legal_version_published',
    jsonb_build_object('document_id', requested_document_id, 'version', requested_version,
      'effective_at', requested_effective_at));
end;
$$;
revoke all on function public.publish_legal_version(text, text, timestamptz) from public;
grant execute on function public.publish_legal_version(text, text, timestamptz) to authenticated;

create or replace function public.record_help_article_feedback(requested_article_id uuid, requested_helpful boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null or requested_helpful is null then
    raise exception 'Sign in and choose a feedback response' using errcode = '42501';
  end if;
  if not exists (select 1 from public.help_articles where id = requested_article_id and published) then
    raise exception 'Help article not found' using errcode = 'P0002';
  end if;
  insert into public.help_article_feedback (article_id, user_id, helpful)
  values (requested_article_id, caller_id, requested_helpful)
  on conflict (article_id, user_id) do update set helpful = excluded.helpful, created_at = now();
end;
$$;
revoke all on function public.record_help_article_feedback(uuid, boolean) from public;
grant execute on function public.record_help_article_feedback(uuid, boolean) to authenticated;

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
  if caller_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if requested_username is null or requested_display_name is null or requested_country_code is null
    or requested_language is null
    or char_length(normalized_username) not between 3 and 24
    or normalized_username !~ '^[a-z0-9_]+$'
    or normalized_username in ('admin', 'administrator', 'gamehub', 'support', 'moderator', 'staff', 'system') then
    raise exception 'Invalid or reserved username' using errcode = '22023';
  end if;
  if char_length(trim(requested_display_name)) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters' using errcode = '22023';
  end if;
  if requested_country_code !~ '^[A-Z_]{2,5}$' or requested_language not in ('en', 'sw') then
    raise exception 'Invalid country or language selection' using errcode = '22023';
  end if;
  if requested_terms_accepted is distinct from true then
    raise exception 'Terms and privacy policy acceptance is required' using errcode = '22023';
  end if;
  update public.profiles set username = normalized_username, display_name = trim(requested_display_name),
    country_code = requested_country_code, preferred_language = requested_language,
    terms_accepted_at = now(), onboarding_completed_at = now()
  where id = caller_id and is_suspended = false;
  if not found then raise exception 'Profile is unavailable' using errcode = '42501'; end if;
  insert into public.user_policy_acceptances (user_id, document_id, version)
  select caller_id, d.id, d.current_version
  from public.legal_documents d
  join public.legal_document_versions v on v.document_id = d.id and v.version = d.current_version and v.published
  where d.id in ('terms', 'privacy')
  on conflict do nothing;
end;
$$;
revoke all on function public.complete_onboarding(text, text, text, text, boolean) from public;
grant execute on function public.complete_onboarding(text, text, text, text, boolean) to authenticated;
