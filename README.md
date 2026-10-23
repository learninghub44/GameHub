# GameHub Africa

GameHub Africa is a mobile-first gaming community application built with vanilla JavaScript, Supabase and Cloudflare Pages.

## Included workflows

- Public landing, player/game/community/live/tournament/marketplace discovery, and About, Terms, Privacy and Community Guidelines pages.
- Supabase email/password authentication, Google OAuth entry, password recovery and onboarding with unique usernames.
- Editable profiles, avatars, privacy settings, gamer preferences, player discovery, follows, friend requests, blocks and reports.
- Community creation, membership, posts and comments; teams, captain invitations and team-based tournament registration.
- Stream submissions, game filtering/search, creator follows, moderator review, YouTube/Twitch embeds, GameHub live chat and moderation.
- LiveKit-backed private one-to-one voice/video calls, group voice calls, public voice rooms, incoming-call states and user call privacy. Call media uses WebRTC; the app never sends media through chat or Supabase Realtime.
- Tournament creation, individual/team registration, organizer brackets, results and audit history.
- Marketplace catalog and order history; new marketplace checkout is disabled and displays “coming soon”. Previously started payments can still be verified and settled.
- Moderator tools for reports, stream review, prize claims and marketplace product management; personal-data export and account-deletion request/execution.
- Public About, Safety, Community Guidelines, searchable FAQ/help, Contact, Terms, Privacy, Cookies and Refund draft pages; authenticated support tickets, privacy requests and moderation appeals.
- Support-agent queues with requester/staff message separation, internal ticket notes, audited status/reply workflows, policy version publishing and help-content management.
- Row-level security, server-side rate limits and Supabase Realtime policies.

## Database and Prisma decision

Supabase PostgreSQL SQL migrations are the schema and migration source of truth. The schema uses Supabase Auth identities, RLS, Storage policies, Realtime publication and PostgreSQL security-definer functions/triggers; introducing Prisma migrations would create a second writer for that schema and risk desynchronizing those Supabase-specific features. The Cloudflare Pages Functions also use the Supabase REST/Auth APIs and do not maintain a long-lived PostgreSQL connection, so a Prisma client/adapter would add complexity without improving this runtime.

Apply `supabase/migrations/202610220001_initial_schema.sql`, then `202610220002_workflows.sql`, `202610220003_public_discovery.sql`, `202610220004_voice_calls.sql` and `202610220005_support_center.sql` to a development database in that order. Review each migration before applying it to production. The SQL files are the version-controlled migration history; there are no Prisma migrations and no automatic production schema changes.

## Local development

Requirements: Node.js 20.19+ or 22.12+. `npm install` installs Vite, Cloudflare Wrangler and the process runner.

1. Use a dedicated Supabase **development** project. In the Supabase SQL Editor, apply all five migrations above in order. Do not run development tests or resets against production.
2. Configure a LiveKit project (Cloud or a maintained self-hosted deployment), then copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_LIVEKIT_URL`. The Supabase values and LiveKit WebSocket URL are public browser values. Do not put service-role, LiveKit API secrets or payment secrets here.
3. Copy `.dev.vars.example` to `.dev.vars` and set the server-side values below. Keep the real file private; it is git-ignored.
4. Run `npm install`, then `npm run dev:full`. This builds the frontend, starts Vite with hot reload on `http://localhost:5173`, starts local Cloudflare Pages Functions on port 8788, and proxies `/api` calls to the functions server. Stop both with Ctrl+C. Run `npm test` and `npm run build` for validation.

The frontend-only `npm run dev` command also works, but payment/account Pages Functions require the Pages server (`npm run dev:pages`) and a prior build. `npm run preview` previews only the built frontend.

### Support center, legal documents and privacy

- The Contact form posts to `functions/api/contact.js`; Pages must have `SUPABASE_URL` and `SUPABASE_ANON_KEY` configured. Submissions use the database RPC and a SHA-256 rate key derived from Cloudflare's client-IP header and normalized email. This is abuse throttling, not identity verification or a guarantee against direct anonymous RPC abuse; apply provider-level protections and monitor submissions before public launch.
- Authenticated players can open private support tickets, track replies, submit privacy requests and appeal moderation actions. Authorized staff use `/admin/support`; database RPC checks and RLS are the security boundary. Internal ticket notes are excluded from requester reads. Support/contact forms do not accept file attachments.
- Admins and explicitly assigned legal managers can publish help/FAQ content and legal-document versions. Publishing is immediate; scheduled publication is not implemented. New versions are displayed only when the version is published and matches the document's current version.
- Bootstrap the first administrator only through a trusted Supabase SQL Editor session after verifying the account ID: `update public.profiles set platform_role = 'admin' where id = '<verified-auth-user-uuid>';`. Never expose admin promotion through a public form or client-side role update. That administrator can grant and revoke support-agent and legal-manager access from the staff workspace; those changes are audited.
- The Contact page lists CHRIS TECH and `support@christech.co.ke`, as supplied by the operator. The visible Terms, Privacy, Refunds and Cookie pages remain drafts: no final approved text was supplied, the legal entity/address and governing-law details are unresolved, age/eligibility rules are missing, and “30 days” has not been scoped to specific data categories or exceptions. Do not treat current text as a legal compliance determination or publish it as final until these facts and counsel-approved wording are supplied.
- The UI supports current policy version publication and records current published Terms/Privacy versions during onboarding. Users who onboard while no versions are published are not recorded as having accepted an unpublished draft. Require review and explicit re-acceptance workflows before materially changing production terms.
- No support/privacy/appeal data is transferred to a separate helpdesk or email provider. Staff need to monitor the database queues directly; no notification, SLA, email delivery or attachment integration is implied.

Required local/server-side values in `.dev.vars`:

```text
SUPABASE_URL=https://your-development-project.supabase.co
SUPABASE_ANON_KEY=your-development-project-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-development-project-service-role-key
PAYSTACK_SECRET_KEY=your-Paystack-test-secret-key
GAMEHUB_ORIGIN=http://localhost:5173
LIVEKIT_URL=wss://your-livekit-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
MARKETPLACE_PURCHASES_ENABLED=false
```

The service-role key and LiveKit API secret are only consumed by local Cloudflare Functions. Keep `LIVEKIT_URL` identical to `VITE_LIVEKIT_URL`; production LiveKit URLs must use secure WebSockets (`wss://`). Never expose server secrets through Vite, the browser, or a committed file. Paystack's test secret is needed only when exercising checkout; do not use a live secret or real transactions during development.

Calls require a working LiveKit service and camera/microphone access from a secure context (HTTPS in production; localhost is allowed for local development). The token endpoint authorizes the signed-in participant against Supabase before issuing a room-scoped token that expires after ten minutes. LiveKit handles media transport; Supabase persists call state, permissions and history. Calls are not recorded by GameHub. No call UI simulates a successful connection: missing configuration, denied permissions or provider/network failures remain visible errors. Browser reconnection is attempted automatically by LiveKit and a manual reconnect control requests a fresh authorized token.

Before enabling calls for users, test with at least two separate development accounts and real devices/browser media permissions: verify incoming, accept, decline, cancel, missed and ended states; microphone mute/unmute; optional video; group invites; voice-room join/leave; blocking and each call-privacy preference; reconnect after a network interruption; and sign-out during a call. Confirm actual two-way media, HTTPS configuration, firewall/NAT connectivity and provider limits. For self-hosting, follow LiveKit's deployment guidance for signaling, ICE/TURN, UDP/TCP firewall access and TLS; the app does not configure or operate media infrastructure. This repository does not include configured provider credentials or claim that real media connections have been tested.

The codebase does not include fabricated seed records. Create test users/content in the development project through the app or Supabase dashboard. The public discovery pages query actual published rows; a fresh database correctly shows empty states.

### Local Supabase alternative

The simplest supported workflow is the dedicated remote development Supabase project above. Supabase Auth, RLS, Realtime, Storage and the Pages functions then use the same development services. A fully local Supabase stack is also possible with the Supabase CLI and Docker installed: start the local stack, apply the same SQL migrations to its database, and put its local API URL/anon/service-role keys in `.env.local` and `.dev.vars`. Local Supabase requires Docker and is not required for ordinary frontend development; the project does not currently provide a generated local `supabase/config.toml`.

### Google OAuth setup

1. In Supabase Dashboard → Authentication → Providers, enable Google and configure the Google OAuth client ID and secret.
2. In Google Cloud Console, enable the OAuth consent screen and add the exact callback URI shown by Supabase (normally `https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI.
3. In Supabase Authentication → URL Configuration, set the production Site URL and add `http://localhost:5173` plus the production origin to Redirect URLs.
4. Verify sign-in, email confirmation and password recovery with a development account before production.

## Cloudflare Pages and Paystack

- Build command: `npm run build`
- Build output directory: `dist`
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Pages build variables.
- These `VITE_*` values are compiled into the browser bundle at build time. Add them in the Pages project's build environment variables for Production (and Preview if needed), then create a fresh deployment; changing Functions runtime secrets or adding variables after a deployment does not update an already-built frontend.
- Configure these server-side Pages Function secrets/variables for each environment:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PAYSTACK_SECRET_KEY`
  - `GAMEHUB_ORIGIN` (the exact public site origin)
  - `LIVEKIT_URL`
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET` (secret)
- Set `VITE_LIVEKIT_URL` as a Pages build variable to the matching LiveKit secure WebSocket URL. Keep the API key/secret out of `VITE_*` variables.
- Set the Cloudflare Pages server-side variable `MARKETPLACE_PURCHASES_ENABLED` to `false` (or leave it unset). This disables only new marketplace checkout; it does not turn off unrelated services or existing payment verification/webhooks.
- Configure Paystack's webhook URL as `https://<your-domain>/api/payments/webhook`.
- Configure Supabase Auth redirect origins and apply all five reviewed migrations before publishing the frontend.

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, or `LIVEKIT_API_SECRET` to browser code or commit them. Marketplace checkout is disabled unless the server-side `MARKETPLACE_PURCHASES_ENABLED` value is exactly `true`. Keep it unset or `false` until marketplace terms/refunds and the production payment configuration are approved. Payment verification and webhook handling remain active for previously initialized transactions; this gate only blocks creation of new marketplace checkout sessions.

## Operational setup and limitations

- Assign moderator/admin roles through a trusted database operation; never grant platform roles from the client.
- Configure Supabase Storage, Auth mail, Google OAuth, Cloudflare secrets and the Paystack webhook in the matching environment.
- Production Pages secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and the exact production `GAMEHUB_ORIGIN`. Frontend build variables remain `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_LIVEKIT_URL`.
- Set Supabase Auth Site URL and redirect allow-list to the production HTTPS origin; configure the Pages custom domain and Paystack webhook before enabling purchases.
- Account deletion removes the Auth account through a server-side Pages Function and retains/anonymizes certain financial and audit records as required for transaction integrity.
- Livestreaming Phase 1 uses supported YouTube/Twitch links and embeds only. Submissions remain status-unknown until manual moderation; "moderator-checked live" is not a provider API check and does not guarantee that an external stream remains live. Unavailable and offline statuses remain distinct. Native video ingestion, recording and delivery are out of scope. Stream URLs are restricted to supported provider hosts, and the app constructs embeds from parsed provider IDs rather than accepting embed HTML.
- Configure LiveKit usage alerts/limits and monitor room minutes, participant concurrency, bandwidth/egress, TURN usage and any provider plan charges in the provider dashboard. LiveKit pricing and limits depend on the selected plan and deployment; basic calls and voice rooms have no GameHub user charge, but provider infrastructure is not inherently cost-free. Apply provider-side quotas and review usage before public launch.
- The project has not been tested against a live Supabase, Google, Paystack or LiveKit project. SQL syntax and RLS still require migration application and end-to-end verification in a development/staging project before launch.
