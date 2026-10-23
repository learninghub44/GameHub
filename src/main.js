import { isSupabaseConfigured, supabase } from "./lib/supabase.js";
import { normalizeUsername, safeExternalUrl, streamDetails, validateUsername } from "./lib/validation.js";

const app = document.querySelector("#app");
const announcer = document.querySelector("#announcer");
let currentUser = null;
let currentProfile = null;
let activePage = "home";
let selectedCommunityId = null;
let selectedConversationId = null;
let currentPageCleanup = () => {};
let activeLiveKitRoom = null;
let activeCallId = null;
let activeCallType = null;
let activeCallVideo = false;
let activeCallMicrophoneEnabled = true;
let activeLiveKitTrack = null;
let activeCallNames = new Map();
let globalCallAlertsChannel = null;
const liveKitServerUrl = import.meta.env.VITE_LIVEKIT_URL || "";
const missedCallTimers = new Map();

const icons = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  discover: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4M9 11l2-2 2 2-2 2z"/></svg>',
  games: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12a3 3 0 0 1 2.8 2l1.3 5.3A2.2 2.2 0 0 1 18.2 18l-2.4-2H8.2l-2.4 2a2.2 2.2 0 0 1-3.9-2.7L3.2 10A3 3 0 0 1 6 8Z"/><path d="M7 10v4m-2-2h4m7-1h.01M18 13h.01"/></svg>',
  live: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="m10 10 5 2.5-5 2.5z"/></svg>',
  tournaments: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4"/></svg>',
  communities: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm13-9a3 3 0 1 0 0-6m2 15v-1a6 6 0 0 0-3-5"/></svg>',
  messages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 9 9 0 0 1-4-.9L4 20l1.3-3.6A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/></svg>',
  teams: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20a6 6 0 0 1 12 0m1-4a5 5 0 0 1 7 4"/></svg>',
  marketplace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1 12H5L4 8Zm4 0a4 4 0 1 1 8 0"/></svg>',
  calls: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 3a14 14 0 0 1-5-3l-3-5 3-2-2-5Z"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9L16 20h-3l-.3-1.9a8 8 0 0 1-1.6-.9l-1.7.7L8 15.5l1.4-1.1a8 8 0 0 1 0-1.8L8 11.5l1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9L13 7h3l.3 1.9a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.2 2.4Z"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function announce(message) {
  announcer.textContent = message;
}

function setNotice(element, message, type = "error") {
  element.textContent = message;
  element.className = `notice ${type}`;
  element.hidden = !message;
}

function button(label, action, kind = "primary") {
  return `<button class="button ${kind}" type="button" data-action="${action}">${label}</button>`;
}

function renderLoading(message = "Getting your space ready") {
  app.innerHTML = `<main class="loading-screen"><div class="brand-mark">G<span>.</span></div><div class="spinner" aria-hidden="true"></div><p>${escapeHtml(message)}</p></main>`;
}

function renderAuth() {
  const pathPage = publicPathPages[window.location.pathname.replace(/\/+$/, "") || "/"];
  if (["sign-in", "register"].includes(pageFromLocation()) && pathPage && pathPage !== "home") {
    sessionStorage.setItem("gamehub-auth-return", pathPage);
  }
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-aside">
        <a class="brand" href="/" aria-label="GameHub Africa home"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB<span class="brand-region">AFRICA</span></span></a>
        <div class="aside-copy"><p class="eyebrow">YOUR GAME. YOUR PEOPLE.</p><h1>Find your<br /><span>next level.</span></h1><p class="muted">A home for the people you play with, the games you love and the communities you build.</p></div>
        <div class="aside-foot"><span class="live-dot"></span> Made for players, built in Africa</div>
      </section>
      <section class="auth-panel">
        <div class="mobile-brand"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB AFRICA</span></div>
        <div class="auth-card">
          <p class="eyebrow">WELCOME TO THE HUB</p><h2 id="auth-title">Your people are here.</h2>
          <p class="muted" id="auth-subtitle">Sign in or create your free account to get started.</p>
          <div id="auth-notice" class="notice" role="alert" hidden></div>
          <button class="button google-button" type="button" data-action="google"><span class="google-g">G</span>Continue with Google</button>
          <div class="divider"><span>or continue with email</span></div>
          <form id="auth-form">
            <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
            <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters" required />
            <button class="button primary full" id="auth-submit" type="submit">Continue with email</button>
          </form>
          <div class="auth-links"><button class="text-button" type="button" data-action="toggle-auth">New here? Create account</button><button class="text-button" type="button" data-action="reset-password">Forgot password?</button></div>
          <p class="legal">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p>
          <a class="public-return" href="#home">Explore GameHub Africa</a>
        </div>
        <p class="auth-bottom">A free community. Always.</p>
      </section>
    </main>`;
  bindAuthForm();
}

let isSignUp = false;

function bindAuthForm() {
  document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const submit = document.querySelector("#auth-submit");
    const notice = document.querySelector("#auth-notice");
    submit.disabled = true;
    submit.textContent = isSignUp ? "Creating account…" : "Signing in…";
    setNotice(notice, "");
    let result;
    try {
      result = isSignUp
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
        : await supabase.auth.signInWithPassword({ email, password });
    } catch (error) {
      result = { error };
    }
    submit.disabled = false;
    submit.textContent = isSignUp ? "Create account" : "Continue with email";
    if (result.error) {
      setNotice(notice, authErrorMessage(result.error));
      return;
    }
    if (isSignUp && !result.data.session) {
      setNotice(notice, "Check your inbox for a verification link, then return here to sign in.", "success");
    }
  });
}

function authErrorMessage(error) {
  if (/invalid login credentials/i.test(error.message)) return "That email and password combination was not recognized. Check them and try again.";
  if (/email not confirmed/i.test(error.message)) return "Please verify your email using the link we sent before signing in.";
  if (/already registered/i.test(error.message)) return "An account already exists for this email. Try signing in instead.";
  if (/rate limit|too many requests/i.test(error.message)) return "Too many attempts. Please wait a little and try again.";
  return error.message || "We couldn't complete that request. Please try again.";
}

function renderOnboarding() {
  const suggested = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || "";
  app.innerHTML = `
    <main class="onboarding-wrap">
      <a class="brand onboarding-brand" href="/" aria-label="GameHub Africa home"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB AFRICA</span></a>
      <section class="onboarding-card">
        <p class="eyebrow">MAKE IT YOURS · 01 / 01</p><h1>Choose your gamer identity.</h1>
        <p class="muted">A few details and you’re in. You can change these later.</p>
        <div id="onboarding-notice" class="notice" role="alert" hidden></div>
        <form id="onboarding-form">
          <label for="username">Username</label><div class="input-prefix"><span>@</span><input id="username" name="username" maxlength="24" minlength="3" pattern="[A-Za-z0-9_]+" autocomplete="username" placeholder="your_gamer_tag" required /></div><small>3–24 letters, numbers or underscores. Usernames are public.</small>
          <label for="display-name">Display name</label><input id="display-name" name="display_name" maxlength="60" value="${escapeHtml(suggested)}" placeholder="How should we call you?" required />
          <label for="country">Country</label><select id="country" name="country"><option value="KE">Kenya</option><option value="UG">Uganda</option><option value="TZ">Tanzania</option><option value="NG">Nigeria</option><option value="ZA">South Africa</option><option value="OTHER">Other</option></select>
          <label for="language">Preferred language</label><select id="language" name="language"><option value="en">English</option><option value="sw">Kiswahili</option></select>
          <label class="check-label"><input name="terms" type="checkbox" required /><span>I agree to the <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</span></label>
          <button class="button primary full" type="submit">Create my profile ${icons.arrow}</button>
        </form>
      </section>
    </main>`;
  document.querySelector("#onboarding-form").addEventListener("submit", saveProfile);
}

async function saveProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = normalizeUsername(form.get("username"));
  const invalid = validateUsername(username);
  const notice = document.querySelector("#onboarding-notice");
  if (invalid) {
    setNotice(notice, invalid);
    return;
  }
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Saving your profile…";
  let result;
  try {
    result = await supabase.rpc("complete_onboarding", {
      requested_username: username,
      requested_display_name: String(form.get("display_name")).trim(),
      requested_country_code: String(form.get("country")),
      requested_language: String(form.get("language")),
      requested_terms_accepted: form.get("terms") === "on",
    });
  } catch (error) {
    result = { error };
  }
  const { error } = result;
  if (error) {
    submit.disabled = false;
    submit.innerHTML = `Create my profile ${icons.arrow}`;
    if (error.code === "23505") {
      setNotice(notice, "That username is already taken. Try another one.");
    } else {
      setNotice(notice, `We couldn't save your profile: ${error.message}`);
    }
    return;
  }
  await loadProfile();
  if (currentProfile.is_suspended) {
    app.innerHTML = `<main class="loading-screen"><div class="notice error">This account is currently restricted. Contact support if you believe this is a mistake.</div><button class="button secondary" data-action="signout">Sign out</button></main>`;
    app.querySelector('[data-action="signout"]').addEventListener("click", signOut);
    return;
  }
  announce("Profile created");
  const authReturnPage = sessionStorage.getItem("gamehub-auth-return");
  if (authReturnPage) {
    sessionStorage.removeItem("gamehub-auth-return");
    activePage = authReturnPage;
    renderPublicRoute();
    return;
  }
  renderApp();
}

const publicNavigation = [
  ["home", "Home"], ["discover", "Players"], ["games", "Games"], ["communities", "Communities"],
  ["teams", "Teams"], ["live", "Live"], ["tournaments", "Tournaments"], ["marketplace", "Marketplace"],
];

const publicPages = {
  about: {
    eyebrow: "OUR COMMUNITY",
    title: "About GameHub Africa",
    paragraphs: [
      "GameHub Africa is a place for players to meet, organize, share streams and find their next competition.",
      "The platform is designed around player-created communities and real activity. Listings come from GameHub accounts; empty directories are shown honestly rather than filled with sample users or events.",
      "Create an account to build your profile, join communities, message other players and participate in the features available in your region.",
    ],
  },
  terms: {
    eyebrow: "PLEASE READ",
    title: "Terms of use",
    paragraphs: [
      "This draft describes the intended rules for using GameHub Africa and must be reviewed by qualified counsel before public launch.",
      "Use GameHub respectfully and lawfully. You are responsible for your account credentials, content you submit, and ensuring you have rights to share that content. Do not harass, threaten, impersonate, exploit or unlawfully discriminate against other players.",
      "Do not attempt to bypass access controls, interfere with the service, submit malicious links, or manipulate tournaments, payments or other users' accounts. We may restrict or remove content and accounts to protect the community and comply with law.",
      "Digital purchases, where enabled, are processed by the configured payment provider. GameHub only grants an item after server-side payment verification. Refund rights and obligations depend on applicable law and provider terms.",
      "The service and community content are provided as available. Features may change, and third-party services, streams and links are outside GameHub's control. GameHub Africa is operated by CHRIS TECH. Contact support@christech.co.ke for support or questions about these draft terms.",
    ],
  },
  privacy: {
    eyebrow: "YOUR DATA",
    title: "Privacy notice",
    paragraphs: [
      "This draft privacy notice must be completed before launch. GameHub Africa is operated by CHRIS TECH and can be contacted at support@christech.co.ke. The operator's exact legal entity/address, governing law, age policy and category-specific retention periods and exceptions still need to be stated.",
      "GameHub processes account and profile information you provide, such as your email through Supabase Auth, username, display name, country, language, avatar and game preferences. The service also stores content and activity you choose to create, including follows, messages, community posts, tournament registrations, stream submissions, reports and notifications.",
      "We use this information to operate accounts, connect players, deliver the features you request, enforce safety rules, respond to support needs and, when purchasing is enabled, process orders and maintain transaction records. Private messages are available only to their conversation participants and authorized service operations under database access policies.",
      "Private voice and video calls use LiveKit for real-time media. GameHub stores call participation and status history but does not record or store call audio or video by default. LiveKit processes media traffic under its own terms and privacy notice. Opening a YouTube or Twitch stream may also load third-party content and expose connection data to that provider.",
      "GameHub uses Supabase for authentication, database, realtime and avatar storage, Cloudflare for hosting and server functions, LiveKit for calls, and Paystack for payments when configured. These providers process data to provide the service under their respective terms and privacy notices.",
      "You can adjust profile visibility and notification preferences in settings, export available account data, and request account deletion. Some financial and audit records may be retained where needed for legal, security or transaction-integrity purposes.",
      "Do not upload sensitive personal information or content you do not have permission to share. Contact support@christech.co.ke with privacy questions or requests. The final privacy notice must explain the applicable rights and handling timelines for each launch jurisdiction.",
    ],
  },
  guidelines: {
    eyebrow: "PLAY FAIR",
    title: "Community guidelines",
    paragraphs: [
      "Treat players as people. Be welcoming across backgrounds, skill levels and locations.",
      "No harassment, hate speech, threats, doxxing, impersonation, spam, scams, or sharing another person's private information.",
      "Share only streams and content you are allowed to publish. Do not use GameHub links to distribute malware, phishing pages or deceptive promotions.",
      "Compete honestly. Follow tournament rules, do not falsify results, and report suspected misconduct with enough context for moderators to review.",
      "Use the report and block tools when needed. Moderators may review reports, remove content or restrict accounts. Do not retaliate against people who raise good-faith concerns.",
    ],
  },
};

const publicPathPages = {
  "/": "home",
  "/about": "about",
  "/contact": "contact",
  "/community-guidelines": "guidelines",
  "/safety": "safety",
  "/faq": "faq",
  "/privacy": "privacy",
  "/terms": "terms",
  "/refunds": "refunds",
  "/cookies": "cookies",
  "/support": "support",
  "/report": "report",
  "/appeals": "appeals",
  "/support/payments": "support-payments",
  "/support/account": "support-account",
  "/settings/privacy": "privacy-center",
  "/admin/support": "admin-support",
};

const helpArticles = [
  { category: "Account", title: "Verify your email and secure your account", tags: "verification password login", body: "Use the verification link sent to your email, then sign in. If it expired, request a fresh link from the sign-in screen. Never share your password or one-time codes." },
  { category: "Profiles", title: "Manage your profile visibility", tags: "privacy discoverability profile", body: "Open Settings to manage profile visibility, message permissions, call permissions, and notification preferences. Private profiles are not available to public discovery." },
  { category: "Community", title: "Block or report a player", tags: "safety abuse report", body: "Use the player's report or block controls. Reports are private to authorized moderation staff. Include specific details and avoid sharing sensitive information." },
  { category: "Messaging", title: "Message delivery and troubleshooting", tags: "chat realtime draft", body: "GameHub confirms message creation in the database; delivery and read indicators are shown only where the app receives confirmation. If sending fails, retain your draft and retry only after checking the conversation." },
  { category: "Calls", title: "Set up voice and video calls", tags: "LiveKit microphone camera WebRTC", body: "Calls require LiveKit configuration, a compatible browser, device permissions and network access. Calls use WebRTC media; GameHub does not record calls by default. If calls are unavailable, contact support with the visible error, not credentials." },
  { category: "Livestreams", title: "Watch YouTube and Twitch streams", tags: "embed creator live status", body: "Phase 1 supports valid YouTube and Twitch links. Embeds may be restricted or removed by providers; use the original platform link when available. A moderator review is not a provider live-status guarantee." },
  { category: "Tournaments", title: "Tournament registration", tags: "competition capacity deadline", body: "Review the organizer's rules, eligibility and registration deadline. Registration can fail if the event is full, closed, cancelled or your account is not eligible." },
  { category: "Payments", title: "Check a pending payment", tags: "Paystack pending purchase transaction", body: "A redirect or receipt alone does not confirm fulfillment. Wait for server-side provider verification and check transaction history before retrying a purchase. Never share full card information with GameHub support." },
  { category: "Privacy", title: "Export or delete your account", tags: "data access deletion privacy", body: "Use Settings → Privacy to download supported account data or request deletion. Some transaction, security or moderation records may need to be retained, subject to applicable law and the final retention schedule." },
  { category: "Support", title: "Appeal a moderation action", tags: "suspension appeal decision", body: "Sign in and submit an appeal for a moderation action shown on your account. Appeals are reviewed by authorized staff; submitting an appeal does not guarantee a particular outcome." },
];

const faqItems = [
  ["Account", "How do I create an account?", "Register with email and password or Google when the provider is enabled, verify your email if requested, then choose a unique username. Email verification and Google OAuth depend on Supabase project configuration."],
  ["Account", "I did not receive a verification email. What now?", "Check spam and confirm the address. Request a new verification link or contact support if access is still unavailable."],
  ["Profiles", "Can I change who sees my profile?", "Yes. Use profile visibility settings. Discovery results only show public profiles."],
  ["Community", "Can I find friends, communities and teams?", "Player discovery, follows, friend requests, public communities, teams and invitations are available when signed in."],
  ["Messaging", "Are messages delivered or read?", "The app records messages and supported receipt events. A successful send means the database accepted the message; it does not guarantee another device has displayed it."],
  ["Calls", "Why can't I start a voice or video call?", "Calls require a configured LiveKit URL and server credentials, an authorized participant, browser microphone/camera permission and network access. Provider credentials are not included in the project."],
  ["Calls", "Are calls recorded?", "GameHub does not implement call recording. The selected media provider may process connection metadata under its own terms; verify provider settings before enabling calls."],
  ["Livestreams", "Does the LIVE badge prove a stream is live?", "No. It indicates a moderator-reviewed status in GameHub. External providers may remove streams or change availability after review."],
  ["Tournaments", "Why was my tournament registration rejected?", "The event may be full, past its deadline, cancelled or restricted by its eligibility rules. Review the event details and contact the organizer or support."],
  ["Payments", "My purchase is pending. Should I pay again?", "No. First refresh the existing transaction status and contact support with the Paystack reference if it remains pending. A frontend redirect does not grant an item."],
  ["Payments", "How do refunds work?", "See the draft Refunds policy and submit a payment support ticket. A request is reviewed; it is not automatically a refund."],
  ["Safety", "How do I appeal a suspension?", "Sign in, open the Appeals page and choose the relevant moderation action if available. Contact the support center if you cannot access your account."],
  ["Privacy", "How can I request my data or delete my account?", "Use Settings → Privacy for export and deletion controls. The privacy request queue is also available there."],
  ["Troubleshooting", "The site says the network is unavailable.", "Check your connection and retry when online. Safe read-only screens may reload after connectivity returns; purchases and registrations are not automatically repeated."],
];

const longPublicPages = {
  about: {
    eyebrow: "OUR COMMUNITY", title: "About GameHub Africa", reviewed: false,
    sections: [
      ["What GameHub is", "GameHub Africa is a gaming community platform for discovering games, meeting players, joining communities, forming teams, participating in tournaments and finding creator-submitted livestreams. It begins with a focus on players in Kenya and is intended to serve a wider community over time."],
      ["Mission and vision", "Our mission is to make it easier for players to find their people and organize around games. Our vision is an accessible, safer and fairer place for gaming communities to grow. These are product aims, not claims of measured impact."],
      ["How it works", "Players create profiles and share community content. Available features include discovery, communities, teams, messaging, LiveKit calls when configured, YouTube and Twitch embeds, tournament workflows and moderation tools. Availability depends on project setup and third-party services."],
      ["Free and optional purchases", "Accounts and community features are intended to be free. The marketplace can offer optional digital items where payments are enabled; purchases are not required to participate in core community features."],
      ["Independent platform", "GameHub Africa is not a game publisher, tournament organizer, YouTube, Twitch or an official affiliate of those services. Third-party products, streams and events remain subject to their operators' terms."],
      ["Take part", "Create an account, share feedback or contact support. We do not publish unsupported claims about company history, user counts, sponsors or partnerships."],
    ],
  },
  guidelines: {
    eyebrow: "PLAY FAIR", title: "Community guidelines", reviewed: true,
    sections: [
      ["Respect", "Treat players with respect. Harassment, bullying, hateful conduct, threats and targeted abuse are not acceptable."],
      ["Honesty and fairness", "Do not cheat, impersonate others, scam users, manipulate tournament results or misrepresent prizes and purchases."],
      ["Spam and content", "Do not spam, publish malicious links, upload harmful files or share content you do not have permission to use."],
      ["Voice chat and streams", "Be respectful in calls and livestream chat. Do not record or redistribute another person's voice or video without appropriate permission and legal authority."],
      ["Minors and personal information", "Do not solicit personal information, private contact details or off-platform access from minors. Never publish another person's sensitive or identifying information."],
      ["Reports and moderation", "Use report and block controls or contact support. Authorized staff may review reports and apply proportionate restrictions. Reports are assessed individually and do not guarantee a specific outcome."],
      ["Appeals", "Where an action is appealable, use the Appeals page or contact support. Repeat or severe violations may result in further restrictions, subject to review."],
    ],
  },
  safety: {
    eyebrow: "PLAYER SAFETY", title: "Safety Center", reviewed: false,
    sections: [
      ["Control contact", "Use Settings to choose who may message or call you. Block accounts that you do not want to interact with."],
      ["Report concerns", "Report profiles, messages, communities, streams or tournaments using available report tools. Appeals and support submissions are visible only to you and authorized staff."],
      ["Protect personal details", "Do not share passwords, one-time codes, home addresses, financial credentials or private information in profiles, messages or streams."],
      ["Recognize suspicious links", "Check the domain before signing in or paying. GameHub accepts supported YouTube and Twitch URLs only for stream submissions; never enter credentials on an unfamiliar site."],
      ["Calls and communities", "Calls require an explicit join action and browser permissions. Leave a call or room if you feel unsafe. Community and tournament organizers may set additional rules."],
      ["Urgent threats", "Use local emergency services for immediate threats or danger. Use the platform report or support workflow for service-related concerns; do not rely on GameHub as an emergency service."],
      ["Appeal a moderation action", "Submit an appeal through the Appeals route or open a support ticket. Staff review is not an assurance that an action will be changed."],
    ],
  },
  privacy: {
    eyebrow: "YOUR DATA", title: "Privacy Policy", reviewed: true,
    sections: [
      ["Operator and status", "The legal operator's identity and privacy contact have not been supplied. This is a draft and must not be treated as a final legal notice until the operator fills in those details and obtains qualified legal review."],
      ["Information processed", "The application stores account identities through Supabase Auth; profiles, preferences, follows, messages, community and team activity, tournament registrations, stream submissions, reports, notifications, payment references and call participation/status metadata where those features are used. Support tickets, contact submissions, privacy requests and appeals are stored after migration 202610220005_support_center.sql is applied. Technical logs contain operational event details and request IDs; they should not contain message bodies or credentials."],
      ["Calls and livestreams", "LiveKit handles call media when configured. GameHub does not implement call recording, but LiveKit and network providers may process connection and service metadata under their terms. YouTube and Twitch embeds or outbound links may collect data according to those providers' policies."],
      ["Payments", "Paystack handles checkout when configured. GameHub stores transaction and provider references needed to verify a purchase; it is not designed to store full card numbers or card security codes. Verify Paystack's current role and practices in its own privacy materials."],
      ["Purposes and providers", "Data supports authentication, platform functions, support, moderation, payment verification, abuse prevention and security. Configured providers include Supabase, Cloudflare, LiveKit and Paystack, and external streaming services when opened."],
      ["Legal bases and rights", "Applicable lawful bases and rights depend on the operator, user location and processing purpose. Users in Kenya may have rights under applicable Kenyan data-protection law; users elsewhere may have rights under their local laws. Obtain qualified advice before claiming a specific basis or response deadline."],
      ["Sharing and transfers", "Data is shared with providers needed to operate the service and may be disclosed when legally required. Providers may process information in other countries; the operator must document locations and transfer safeguards before launch."],
      ["Retention", "Account data follows account lifecycle and deletion behaviour. Transaction, moderation and security records may be retained where needed for service integrity or legal obligations. The operator has not supplied final retention periods; configure and publish a schedule before launch."],
      ["Cookies and storage", "Supabase Auth persists session state in browser storage. This codebase does not include configured analytics or advertising tags. Supabase, OAuth providers or embedded YouTube/Twitch content may use cookies or similar technologies; browser and provider behaviour can vary. Manage browser storage and provider settings."],
      ["Security", "The platform uses authentication, database access policies and server-side secrets. These safeguards reduce risk but cannot guarantee absolute security."],
      ["Children", "The product owner has not supplied a final minimum-age or parental-consent policy. Do not launch to minors until eligibility, safeguarding and applicable consent requirements are reviewed and implemented."],
      ["Deletion and changes", "Use Settings → Privacy or the account deletion workflow. Some records linked to other users or legally required transaction/security records may remain or be anonymized. Material policy changes should be versioned and communicated; legal acceptance is recorded for the current terms/privacy version during onboarding."],
      ["Contact", "Use the Contact page or authenticated privacy request center. The verified operator identity and privacy contact must be supplied before production."],
    ],
  },
  terms: {
    eyebrow: "PLEASE READ", title: "Terms of Service", reviewed: true,
    sections: [
      ["Draft and eligibility", "These terms remain a draft until the operator's legal entity/address, governing law and age-eligibility rules for each launch jurisdiction are specified and confirmed in the final approved wording. Users must provide accurate account details and secure their credentials."],
      ["Acceptable use", "Use the service lawfully and respectfully. Do not abuse access controls, harass users, publish harmful content, manipulate competitions or interfere with the service."],
      ["User content", "You retain rights you hold in content you submit. You grant GameHub only the limited permission needed to host, display and distribute that content as part of the service. Do not submit content you lack rights or permission to share."],
      ["Platform materials", "GameHub name, branding, software and platform materials are not granted for reuse except as permitted by law or written permission. No ownership of third-party game or provider materials is claimed."],
      ["Third parties and tournaments", "Games, streams, links, tournament organizers and providers are independent third parties. Their rules and availability apply. Organizers are responsible for event rules, eligibility and fulfillment of prizes they advertise."],
      ["Optional purchases", "Purchases are optional and only available when payment services are enabled. Provider references and server verification determine order fulfillment. Do not treat a redirect as payment confirmation. Refunds are subject to applicable law and the Refunds policy."],
      ["Moderation and appeals", "We may restrict content or accounts to protect the community, comply with law or address abuse. Where supported, users may appeal. No outcome is guaranteed."],
      ["Availability and changes", "The service may experience outages, maintenance or feature changes. Continuous availability is not promised."],
      ["Legal review", "Disclaimers, liability, indemnity, governing law and dispute terms require operator-specific legal advice and must be completed without removing rights users cannot waive."],
      ["Contact", "Use the Contact or Support pages. Verified operator contact information must be supplied before production."],
    ],
  },
  cookies: {
    eyebrow: "BROWSER STORAGE", title: "Cookie Policy", reviewed: false,
    sections: [
      ["Necessary storage", "Supabase Auth persists session information in browser storage to support sign-in and session restoration. This implementation does not currently provide an optional analytics or advertising consent banner."],
      ["Third-party content", "Google OAuth and YouTube/Twitch embedded players may use cookies or similar technologies controlled by those providers. Opening the original provider may transfer information to it."],
      ["Manage preferences", "Sign out to clear the app session, use provider controls, and manage cookies/site storage in your browser settings. The operator should re-check provider behaviour and consent law before enabling optional tracking."],
    ],
  },
  refunds: {
    eyebrow: "PURCHASES", title: "Refund and Cancellation Policy", reviewed: true,
    sections: [
      ["Availability", "This draft applies only when optional purchases are enabled. Core community features are intended to remain free."],
      ["Pending or failed payments", "A pending checkout is not a confirmed purchase. Check the existing transaction status before attempting another payment. Contact support with the provider reference if it remains unresolved."],
      ["Duplicate or unauthorized charges", "Report duplicate or unauthorized transactions promptly through Support → Payments. Do not submit full card details. Paystack may need to investigate or process a provider-side reversal."],
      ["Undelivered items", "If the provider confirms payment but an item is not available, open a support ticket with the transaction reference. Support will verify the purchase before any fulfillment or refund decision."],
      ["Digital goods and rights", "Used or applied digital goods may affect refund eligibility, subject to applicable consumer law. Statutory rights are not limited by this draft."],
      ["Review and timing", "Requests are reviewed by authorized staff. Submitting a request does not automatically mark a payment refunded. Provider processing times can vary; the operator must set a support-response target before launch."],
      ["Contact", "Use the payment support form and include the Paystack transaction reference when available. Do not share card numbers or security codes."],
    ],
  },
};

function renderPublicRoute() {
  const page = pageFromLocation();
  if (["privacy-center", "admin-support"].includes(page) && !currentUser) {
    if (!isSupabaseConfigured) return renderSetupScreen();
    isSignUp = false;
    renderAuth();
    setNotice(document.querySelector("#auth-notice"), "Sign in to continue. Your requested page will open after authentication.");
    return;
  }
  if (page === "sign-in" || page === "register") {
    if (!isSupabaseConfigured) {
      renderSetupScreen();
      return;
    }
    isSignUp = page === "register";
    renderAuth();
    if (isSignUp) {
      document.querySelector("#auth-title").textContent = "Start your free account.";
      document.querySelector("#auth-subtitle").textContent = "Join the community. No payment details needed.";
      document.querySelector("#auth-submit").textContent = "Create account";
      document.querySelector('[data-action="toggle-auth"]').textContent = "Already a member? Sign in";
      document.querySelector("#password").autocomplete = "new-password";
    }
    return;
  }
  if (longPublicPages[page]) {
    renderLongPublicInfo(page);
    return;
  }
  if (publicPages[page]) {
    renderPublicInfo(page);
    return;
  }
  if (page === "faq") return renderFaqPage();
  if (page === "contact") return renderContactPage();
  if (page === "support") return renderSupportPage();
  if (page === "privacy-center") return renderPrivacyCenter();
  if (page === "admin-support") return renderSupportAdmin();
  if (page === "report") return renderReportPage();
  if (page === "appeals") {
    if (!currentUser) return renderAuth();
    return renderAppealsPage();
  }
  if (page === "support-payments" || page === "support-account") {
    if (!currentUser) return renderAuth();
    return renderSupportPage(page === "support-payments" ? "payments" : "account");
  }
  if (page === "home") {
    renderPublicHome();
    return;
  }
  if (publicNavigation.some(([key]) => key === page)) {
    renderPublicListing(page);
    return;
  }
  renderPublicNotFound();
}

function pageFromLocation() {
  if (window.location.hash.length > 1) {
    const hash = window.location.hash.slice(1).split("?")[0];
    return hash === "how-it-works" ? "about" : hash;
  }
  return publicPathPages[window.location.pathname.replace(/\/+$/, "") || "/"] || "not-found";
}

function renderSetupScreen() {
  app.innerHTML = `<main class="setup-screen public-setup"><a class="brand" href="#home"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB AFRICA</span></a><p class="eyebrow">SUPABASE CONFIGURATION MISSING</p><h1>Connect your Supabase project.</h1><p class="muted">This screen appears when the frontend build does not contain both <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. Applying database migrations does not clear this message; they are a separate setup step.</p><section class="setup-instructions"><h2>Running locally</h2><p>In the GameHub project root, create <code>.env.local</code> with those exact variable names and your Supabase project URL and publishable/anon key. Restart Vite after saving the file. If using a production build, build again after setting the variables.</p><h2>Deployed on Cloudflare Pages</h2><p>Add both values as <strong>build environment variables</strong> for the Production environment in your Pages project settings, then trigger a new deployment. Set Preview variables too if you test preview deployments. Cloudflare Functions runtime secrets alone do not configure this browser frontend.</p></section><p class="muted">Only the publishable/anon key belongs in the frontend. Never put a Supabase service-role key here. After configuration, apply the SQL migrations in <code>supabase/migrations</code> in order before enabling account workflows.</p><a class="button secondary" href="#home">Back to GameHub</a></main>`;
}

function renderPublicShell(content, current = "") {
  app.innerHTML = `<div class="public-shell"><header class="public-header"><a class="brand" href="/"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB<span class="brand-region">AFRICA</span></span></a><nav class="public-nav" aria-label="Explore GameHub">${publicNavigation.map(([key, label]) => `<a href="#${key}" ${current === key ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav><div class="public-auth">${currentUser ? `<a class="button secondary compact" href="#home">Open GameHub</a>${currentProfile?.platform_role === "admin" ? `<a class="text-button" href="/admin/support">Staff workspace</a>` : ""}` : `<a class="text-button" href="#sign-in">Sign in</a><a class="button primary compact" href="#register">Join free</a>`}</div></header>${content}<footer class="public-footer"><div class="public-footer-grid"><section><strong>About</strong><a href="/about">About GameHub</a><a href="/about#how-it-works">How it works</a><a href="/community-guidelines">Community Guidelines</a><a href="/safety">Safety Center</a></section><section><strong>Explore</strong><a href="#discover">Discover gamers</a><a href="#communities">Communities</a><a href="#teams">Teams</a><a href="#live">Livestreams</a><a href="#tournaments">Tournaments</a></section><section><strong>Help</strong><a href="/support">Help Center</a><a href="/faq">FAQs</a><a href="/contact">Contact Us</a><a href="/report">Report a problem</a><a href="/appeals">Appeal a decision</a></section><section><strong>Legal</strong><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/cookies">Cookie Policy</a><a href="/refunds">Refund Policy</a></section><section><strong>Account</strong>${currentUser ? `<a href="/settings/privacy">Privacy settings</a><a href="#settings">Account settings</a>` : `<a href="#sign-in">Sign in</a><a href="#register">Create account</a><a href="/settings/privacy">Privacy settings</a>`}</section></div><span>GameHub Africa · Made for players</span></footer></div>`;
}

function renderPublicNotFound() {
  renderPublicShell(`<main class="public-main public-article"><p class="eyebrow">404 · NOT FOUND</p><h1>This page isn't here.</h1><p class="muted">The link may be outdated or the address may be mistyped. Return home or contact support if you expected to find something.</p><div class="card-actions"><a class="button primary" href="/">Return home</a><a class="button secondary" href="/contact">Contact support</a></div></main>`);
}

function renderLongPublicInfo(page) {
  const document = longPublicPages[page];
  const sectionId = (index) => page === "about" && index === 2 ? "how-it-works" : `policy-section-${index + 1}`;
  const toc = document.sections.map(([heading], index) => `<a href="#${sectionId(index)}">${escapeHtml(heading)}</a>`).join("");
  const renderDocument = (publishedBody = "") => {
    const body = publishedBody
      ? `<div class="published-document">${escapeHtml(publishedBody).replace(/\r?\n/g, "<br>")}</div>`
      : `<nav class="document-toc" aria-label="Page contents"><strong>On this page</strong>${toc}</nav>${document.sections.map(([heading, sectionBody], index) => `<section id="${sectionId(index)}" class="document-section"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(sectionBody)}</p></section>`).join("")}`;
    renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">${escapeHtml(document.eyebrow)}</p><h1>${escapeHtml(document.title)}</h1>${document.reviewed ? `<p class="draft-label">Draft · operator and qualified legal review required before launch</p>` : ""}${body}<a class="button secondary" href="/contact">Contact GameHub</a></main>`);
  };
  renderDocument();
  const documentId = page === "guidelines" ? "community-guidelines" : page;
  if (!isSupabaseConfigured || !["terms", "privacy", "cookies", "refunds", "community-guidelines"].includes(documentId)) return;
  void (async () => {
    const { data: metadata, error: metadataError } = await supabase.from("legal_documents").select("current_version").eq("id", documentId).maybeSingle();
    if (metadataError) {
      console.error("Published legal document could not be loaded:", metadataError.code);
      return;
    }
    if (!metadata) return;
    const { data: published, error } = await supabase.from("legal_document_versions").select("version, body").eq("document_id", documentId).eq("version", metadata.current_version).eq("published", true).maybeSingle();
    if (error) {
      console.error("Published legal document version could not be loaded:", error.code);
      return;
    }
    if (published && app.querySelector(".public-article h1")?.textContent === document.title) renderDocument(published.body);
  })();
}

function renderFaqPage() {
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">QUICK ANSWERS</p><h1>Frequently asked questions</h1><label class="sr-only" for="faq-search">Search frequently asked questions</label><input id="faq-search" class="public-search" type="search" maxlength="120" placeholder="Search topics, keywords or questions" /><div id="faq-results" class="faq-results" aria-live="polite"></div><p class="muted">Can't find an answer? <a href="/contact">Contact us</a> or <a href="/support">open a support ticket</a>.</p></main>`, "faq");
  const results = app.querySelector("#faq-results");
  let items = faqItems.map(([category, question, answer]) => ({ category, question, answer }));
  const draw = () => {
    const term = app.querySelector("#faq-search").value.trim().toLowerCase();
    const filtered = items.filter((item) => `${item.category} ${item.question} ${item.answer}`.toLowerCase().includes(term));
    results.innerHTML = filtered.length ? filtered.map((item) => `<details class="faq-item"><summary><span class="faq-category">${escapeHtml(item.category)}</span>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("") : `<div class="empty-state"><p>No matching answer yet.</p><a href="/contact">Contact support</a></div>`;
  };
  app.querySelector("#faq-search").addEventListener("input", draw);
  draw();
  if (isSupabaseConfigured) void supabase.from("faq_entries").select("category, question, answer").eq("published", true).order("sort_order").limit(100).then(({ data, error }) => {
    if (error) {
      console.error("Published FAQs could not be loaded:", error.code);
      return;
    }
    if (data?.length) {
      items = data;
      draw();
    }
  });
}

function renderContactPage() {
  const email = currentUser?.email || "";
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">WE'RE HERE TO HELP</p><h1>Contact GameHub</h1><p class="muted">GameHub Africa is operated by CHRIS TECH. For general support, email <a href="mailto:support@christech.co.ke">support@christech.co.ke</a>. For account-specific or private issues, sign in and use the <a href="/support">Support Center</a>. Do not send passwords, one-time codes, full card numbers or other sensitive credentials.</p><form id="contact-form" class="edit-card form-stack"><div id="contact-notice" class="notice" role="status" hidden></div><label for="contact-name">Your name</label><input id="contact-name" name="name" maxlength="100" autocomplete="name" value="${escapeHtml(currentProfile?.display_name || "")}" required /><label for="contact-email">Email address</label><input id="contact-email" name="email" type="email" maxlength="254" autocomplete="email" value="${escapeHtml(email)}" required /><label for="contact-category">What can we help with?</label><select id="contact-category" name="category"><option value="general">General question</option><option value="technical">Technical issue</option><option value="partnerships">Partnership</option><option value="creator">Creator or stream</option><option value="tournament">Tournament</option><option value="payments">Payment</option><option value="privacy">Privacy</option></select><label for="contact-subject">Subject</label><input id="contact-subject" name="subject" maxlength="160" minlength="4" required /><label for="contact-message">Message</label><textarea id="contact-message" name="message" maxlength="5000" minlength="10" rows="7" required></textarea><button class="button primary" type="submit">Send message</button></form></main>`, "contact");
  app.querySelector("#contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const notice = form.querySelector("#contact-notice");
    const values = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    setNotice(notice, "Sending your message…", "success");
    let response;
    try {
      const headers = { "Content-Type": "application/json" };
      if (currentUser) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          submit.disabled = false;
          return setNotice(notice, "Your sign-in could not be verified. Refresh the page or sign in again.");
        }
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      response = await fetch("/api/contact", { method: "POST", headers, body: JSON.stringify(values) });
    } catch {
      submit.disabled = false;
      return setNotice(notice, "We couldn't connect to contact support. Check your connection and try again.");
    }
    const result = await response.json().catch(() => null);
    submit.disabled = false;
    if (!response.ok) {
      const code = result?.error?.code;
      const message = code === "RATE_LIMITED" ? "Please wait before sending another request."
        : code === "VALIDATION_ERROR" ? "Check the form details and try again."
          : code === "REQUEST_TOO_LARGE" ? "Shorten your message and try again."
            : "Your message could not be sent. Please try again later.";
      return setNotice(notice, `${message}${result?.requestId ? ` Reference: ${result.requestId}` : ""}`);
    }
    form.reset();
    if (currentUser?.email) form.querySelector("#contact-email").value = currentUser.email;
    setNotice(notice, `Your message was sent. Reference: ${result?.data?.reference || "submitted"}.`, "success");
  });
}

function renderSupportPage(category = "") {
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">PLAYER SUPPORT</p><h1>Support Center</h1><p class="muted">Search help articles or open a private ticket. Attachments are not supported; never include passwords, one-time codes or full payment credentials.</p><label class="sr-only" for="help-search">Search help</label><input id="help-search" class="public-search" type="search" maxlength="120" placeholder="Search help articles" /><div id="help-results" class="help-results"></div><div id="support-ticket-area"></div></main>`, "support");
  const helpResults = app.querySelector("#help-results");
  const ticketArea = app.querySelector("#support-ticket-area");
  let articles = helpArticles;
  const drawArticles = () => {
    const term = app.querySelector("#help-search").value.trim().toLowerCase();
    const filtered = articles.filter((article) => (!term || `${article.category} ${article.title} ${article.tags} ${article.body}`.toLowerCase().includes(term)) && (!category || article.category.toLowerCase() === category));
    helpResults.innerHTML = filtered.length ? `<div class="help-card-grid">${filtered.map((item) => `<details class="help-card"><summary><span class="faq-category">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong></summary><p>${escapeHtml(item.body)}</p>${currentUser && item.id ? `<div class="help-feedback"><span>Was this helpful?</span><button type="button" data-helpful="true" data-article-id="${item.id}">Yes</button><button type="button" data-helpful="false" data-article-id="${item.id}">No</button></div><small class="help-feedback-status" role="status"></small>` : ""}</details>`).join("")}</div>` : `<div class="empty-state">No matching articles found. <a href="/contact">Contact us</a>.</div>`;
  };
  app.querySelector("#help-search").addEventListener("input", drawArticles);
  helpResults.addEventListener("click", async (event) => {
    const control = event.target.closest("[data-helpful]");
    if (!control) return;
    control.disabled = true;
    const article = control.closest(".help-card");
    const { error } = await supabase.rpc("record_help_article_feedback", {
      requested_article_id: control.dataset.articleId,
      requested_helpful: control.dataset.helpful === "true",
    });
    control.disabled = false;
    article.querySelector(".help-feedback-status").textContent = error
      ? "Feedback could not be saved. Try again later."
      : "Thanks for your feedback.";
    if (error) console.error("Help feedback could not be saved:", error.code);
  });
  drawArticles();
  if (isSupabaseConfigured) void supabase.from("help_articles").select("id, category, title, tags, body").eq("published", true).order("updated_at", { ascending: false }).limit(100).then(({ data, error }) => {
    if (error) {
      console.error("Published help articles could not be loaded:", error.code);
      return;
    }
    if (data?.length) {
      articles = data.map((item) => ({ ...item, tags: item.tags.join(" ") }));
      drawArticles();
    }
  });
  if (!currentUser) {
    ticketArea.innerHTML = `<section class="edit-card"><h2>Need help with your account?</h2><p>Sign in to submit a private support request and track replies.</p><a class="button primary" href="#sign-in">Sign in</a></section>`;
    return;
  }
  ticketArea.innerHTML = `<section class="edit-card"><h2>Open a support ticket</h2><p class="muted">Your ticket and replies are private to your account and authorized support staff.</p><div id="ticket-notice" class="notice" role="status" hidden></div><form id="ticket-form" class="form-stack"><label for="ticket-category">Category</label><select id="ticket-category"><option value="${category || "general"}">${escapeHtml(category ? category[0].toUpperCase() + category.slice(1) : "General")}</option>${["technical", "account", "payments", "tournaments", "safety", "privacy", "general"].filter((value) => value !== category).map((value) => `<option value="${value}">${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select><label for="ticket-subject">Subject</label><input id="ticket-subject" maxlength="160" minlength="4" required /><label for="ticket-reference">Transaction reference (optional; payments only)</label><input id="ticket-reference" maxlength="120" autocomplete="off" /><label for="ticket-body">How can we help?</label><textarea id="ticket-body" maxlength="8000" minlength="10" rows="6" required></textarea><button class="button primary" type="submit">Create ticket</button></form></section><section class="edit-card"><h2>Your tickets</h2><div id="ticket-list" class="ticket-list" aria-live="polite"></div><div id="ticket-detail"></div></section>`;
  const notice = ticketArea.querySelector("#ticket-notice");
  const list = ticketArea.querySelector("#ticket-list");
  const loadTickets = async () => {
    const { data, error } = await supabase.from("support_tickets").select("id, category, subject, status, priority, created_at, updated_at").eq("requester_id", currentUser.id).order("updated_at", { ascending: false }).limit(50);
    if (error) return renderDataError(list, error, loadTickets);
    list.innerHTML = data.length ? data.map((ticket) => `<button class="ticket-row" type="button" data-ticket-id="${ticket.id}"><span>${escapeHtml(ticket.subject)}</span><span class="status-chip">${escapeHtml(ticket.status.replaceAll("_", " "))}</span><small>${escapeHtml(ticket.category)} · ${datePart(ticket.updated_at, { dateStyle: "medium" })}</small></button>`).join("") : `<p class="muted">No support tickets yet.</p>`;
  };
  void loadTickets();
  ticketArea.querySelector("#ticket-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { data, error } = await supabase.rpc("create_support_ticket", {
      requested_category: ticketArea.querySelector("#ticket-category").value,
      requested_subject: ticketArea.querySelector("#ticket-subject").value.trim(),
      requested_body: ticketArea.querySelector("#ticket-body").value.trim(),
      requested_priority: "normal",
      requested_transaction_reference: ticketArea.querySelector("#ticket-reference").value.trim() || null,
    });
    submit.disabled = false;
    if (error) return setNotice(notice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(notice, "Your private support ticket is open.", "success");
    await loadTickets();
    await loadTicketDetail(data);
  });
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-ticket-id]");
    if (row) void loadTicketDetail(row.dataset.ticketId);
  });
  async function loadTicketDetail(ticketId) {
    const detail = ticketArea.querySelector("#ticket-detail");
    detail.innerHTML = `<p class="muted">Loading replies…</p>`;
    const { data: ticket, error: ticketError } = await supabase.from("support_tickets").select("id, subject, status").eq("id", ticketId).eq("requester_id", currentUser.id).maybeSingle();
    if (ticketError || !ticket) return setNotice(detail, "We couldn't load that ticket. Refresh and try again.");
    const { data: messages, error } = await supabase.from("support_ticket_messages").select("id, body, is_internal, created_at, author_id").eq("ticket_id", ticketId).order("created_at");
    if (error) return setNotice(detail, "We couldn't load ticket replies. Try again.");
    detail.innerHTML = `<div class="ticket-detail"><h3>${escapeHtml(ticket.subject)}</h3><div class="ticket-messages">${messages.filter((message) => !message.is_internal).map((message) => `<article class="ticket-message"><p>${escapeHtml(message.body)}</p><small>${message.author_id === currentUser.id ? "You" : "Support"} · ${datePart(message.created_at, { dateStyle: "medium", timeStyle: "short" })}</small></article>`).join("")}</div>${["closed", "resolved"].includes(ticket.status) ? `<p class="muted">This ticket is ${escapeHtml(ticket.status)}. Open a new ticket if you need more help.</p>` : `<form class="ticket-reply form-stack"><label for="ticket-reply-body">Reply</label><textarea id="ticket-reply-body" maxlength="8000" minlength="1" required rows="3"></textarea><button class="button secondary" type="submit">Send reply</button></form><div class="notice" role="status" hidden></div>`}</div>`;
    detail.querySelector(".ticket-reply")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector('[type="submit"]');
      submit.disabled = true;
      const { error: replyError } = await supabase.rpc("reply_to_support_ticket", { requested_ticket_id: ticketId, requested_body: detail.querySelector("#ticket-reply-body").value.trim() });
      submit.disabled = false;
      if (replyError) return setNotice(detail.querySelector(".notice"), supportErrorMessage(replyError));
      await loadTicketDetail(ticketId);
      await loadTickets();
    });
  }
}

function supportErrorMessage(error) {
  if (error?.code === "42501") return "This request isn't available for this account. Sign in again or contact support.";
  if (error?.code === "22023") return "Some details are missing or outside the allowed limits. Review them and try again.";
  if (error?.code === "23505") return "This request has already been submitted.";
  if (error?.code === "P0002") return "That item could not be found.";
  console.error("Support operation failed:", error?.code || "unknown");
  return "We couldn't complete that request. Check your connection and try again.";
}

async function renderPrivacyCenter() {
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">YOUR PRIVACY</p><h1>Privacy Request Center</h1><p class="muted">Submit a tracked request about your personal data and review its status. Use account settings for direct export or deletion controls. This queue does not replace a legal request deadline.</p><div id="privacy-notice" class="notice" role="status" hidden></div><form id="privacy-request-form" class="edit-card form-stack"><label for="privacy-type">Request type</label><select id="privacy-type"><option value="access">Access or copy of my data</option><option value="correction">Correct my data</option><option value="deletion">Delete my data</option><option value="privacy_question">Privacy question</option><option value="complaint">Privacy complaint</option></select><label for="privacy-details">Details</label><textarea id="privacy-details" rows="6" minlength="5" maxlength="3000" required></textarea><button class="button primary" type="submit">Submit privacy request</button></form><section class="edit-card"><h2>Your requests</h2><div id="privacy-request-list"></div></section><p><a href="#settings">Open account settings</a> · <a href="/privacy">Read the Privacy Policy draft</a></p></main>`);
  const notice = app.querySelector("#privacy-notice");
  const list = app.querySelector("#privacy-request-list");
  const loadRequests = async () => {
    const { data, error } = await supabase.from("privacy_requests").select("id, request_type, details, status, staff_response, created_at, updated_at").eq("requester_id", currentUser.id).order("created_at", { ascending: false }).limit(50);
    if (error) return renderDataError(list, error, loadRequests);
    list.innerHTML = data.length ? data.map((item) => `<article class="ticket-row"><span>${escapeHtml(item.request_type.replaceAll("_", " "))} · ${escapeHtml(item.status.replaceAll("_", " "))}</span><small>${datePart(item.created_at, { dateStyle: "medium" })}</small><p>${escapeHtml(item.details)}</p>${item.staff_response ? `<p class="muted">Support: ${escapeHtml(item.staff_response)}</p>` : ""}</article>`).join("") : `<p class="muted">No privacy requests submitted.</p>`;
  };
  void loadRequests();
  app.querySelector("#privacy-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await supabase.rpc("submit_privacy_request", { requested_type: app.querySelector("#privacy-type").value, requested_details: app.querySelector("#privacy-details").value.trim() });
    submit.disabled = false;
    if (error) return setNotice(notice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(notice, "Your privacy request was submitted.", "success");
    await loadRequests();
  });
}

function renderReportPage() {
  if (!currentUser) {
    renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">COMMUNITY SAFETY</p><h1>Report a problem</h1><p class="muted">Sign in to report a profile. For a general service issue, use Contact Us.</p><a class="button primary" href="#sign-in">Sign in to report</a><a href="/contact">Contact GameHub</a></main>`);
    return;
  }
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">COMMUNITY SAFETY</p><h1>Report a player</h1><p class="muted">Reports are private to you and authorized moderators. Report immediate danger to local emergency services.</p><div id="report-notice" class="notice" role="status" hidden></div><form id="report-form" class="edit-card form-stack"><label for="reported-username">Player username</label><input id="reported-username" maxlength="24" required /><label for="report-reason">What happened?</label><select id="report-reason"><option value="harassment">Harassment or abuse</option><option value="spam">Spam or scams</option><option value="impersonation">Impersonation</option><option value="unsafe">Unsafe content</option><option value="cheating">Cheating or unfair play</option><option value="other">Other</option></select><label for="report-details">Details</label><textarea id="report-details" minlength="5" maxlength="1000" rows="5" required></textarea><button class="button primary" type="submit">Submit report</button></form><section class="edit-card"><h2>Your reports</h2><div id="report-list"></div></section><a href="/appeals">Appeal a moderation decision</a></main>`, "report");
  const notice = app.querySelector("#report-notice");
  const list = app.querySelector("#report-list");
  const loadReports = async () => {
    const { data, error } = await supabase.from("reports").select("id, reason, status, created_at").eq("reporter_id", currentUser.id).order("created_at", { ascending: false }).limit(30);
    if (error) return renderDataError(list, error, loadReports);
    list.innerHTML = data.length ? data.map((item) => `<p class="ticket-row">${escapeHtml(item.status)} · ${datePart(item.created_at, { dateStyle: "medium" })}<br />${escapeHtml(item.reason)}</p>`).join("") : `<p class="muted">No reports submitted.</p>`;
  };
  void loadReports();
  app.querySelector("#report-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const username = app.querySelector("#reported-username").value.trim().replace(/^@/, "").toLowerCase();
    const { data: profile, error: lookupError } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
    if (lookupError || !profile || profile.id === currentUser.id) {
      submit.disabled = false;
      return setNotice(notice, profile?.id === currentUser.id ? "You can't report your own profile." : "We couldn't find that public profile. Check the username and try again.");
    }
    const reason = `${app.querySelector("#report-reason").value}: ${app.querySelector("#report-details").value.trim()}`;
    const { error } = await supabase.from("reports").insert({ reporter_id: currentUser.id, reported_user_id: profile.id, resource_type: "profile", resource_id: profile.id, reason });
    submit.disabled = false;
    if (error) return setNotice(notice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(notice, "Your report was sent to the moderation team.", "success");
    await loadReports();
  });
}

async function renderAppealsPage() {
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">MODERATION REVIEW</p><h1>Appeal a decision</h1><p class="muted">Select an action on your account and explain why you believe it should be reviewed. Appeals are reviewed by authorized staff and do not guarantee a particular outcome.</p><div id="appeal-notice" class="notice" role="status" hidden></div><div id="appeal-area"></div><section class="edit-card"><h2>Your appeals</h2><div id="appeal-list"></div></section></main>`, "appeals");
  const area = app.querySelector("#appeal-area");
  const list = app.querySelector("#appeal-list");
  const [actions, appeals] = await Promise.all([
    supabase.from("moderation_actions").select("id, action, reason, created_at").eq("target_user_id", currentUser.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("moderation_appeals").select("id, action_id, details, status, staff_response, created_at").eq("requester_id", currentUser.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (actions.error || appeals.error) {
    area.innerHTML = `<p class="muted">We couldn't load moderation decisions. Try refreshing or contact support.</p>`;
    console.error("Appeal history could not be loaded:", (actions.error || appeals.error)?.code);
    return;
  }
  const appealedIds = new Set(appeals.data.map((appeal) => appeal.action_id));
  const available = actions.data.filter((action) => !appealedIds.has(action.id));
  area.innerHTML = available.length ? `<form id="appeal-form" class="edit-card form-stack"><label for="appeal-action">Decision</label><select id="appeal-action">${available.map((action) => `<option value="${action.id}">${escapeHtml(action.action)} · ${datePart(action.created_at, { dateStyle: "medium" })} · ${escapeHtml(action.reason)}</option>`).join("")}</select><label for="appeal-details">Why should this decision be reviewed? (20–3,000 characters)</label><textarea id="appeal-details" minlength="20" maxlength="3000" rows="6" required></textarea><button class="button primary" type="submit">Submit appeal</button></form>` : `<p class="muted">There are no moderation actions available to appeal.</p>`;
  list.innerHTML = appeals.data.length ? appeals.data.map((appeal) => `<article class="ticket-row"><strong>${escapeHtml(appeal.status.replaceAll("_", " "))}</strong><small>${datePart(appeal.created_at, { dateStyle: "medium" })}</small><p>${escapeHtml(appeal.details)}</p>${appeal.staff_response ? `<p class="muted">Staff response: ${escapeHtml(appeal.staff_response)}</p>` : ""}</article>`).join("") : `<p class="muted">No appeals submitted.</p>`;
  app.querySelector("#appeal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await supabase.rpc("submit_moderation_appeal", { requested_action_id: app.querySelector("#appeal-action").value, requested_details: app.querySelector("#appeal-details").value.trim() });
    submit.disabled = false;
    if (error) return setNotice(app.querySelector("#appeal-notice"), supportErrorMessage(error));
    await renderAppealsPage();
  });
}

async function renderSupportAdmin() {
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="/">← Back to GameHub</a><p class="eyebrow">STAFF WORKSPACE</p><h1>Support and legal workspace</h1><div id="staff-workspace" class="staff-workspace"><p class="muted">Checking staff permissions…</p></div></main>`);
  const workspace = app.querySelector("#staff-workspace");
  const { data: isStaff, error: staffError } = await supabase.rpc("is_support_staff");
  if (staffError || !isStaff) {
    workspace.innerHTML = `<p class="notice error">This workspace is available only to authorized support staff.</p>`;
    if (staffError) console.error("Support permission check failed:", staffError.code);
    return;
  }
  const { data: canManageLegal, error: legalPermissionError } = await supabase.rpc("can_manage_legal");
  if (legalPermissionError) {
    workspace.innerHTML = `<p class="notice error">Legal-management permissions could not be verified. Refresh and try again.</p>`;
    console.error("Legal permission check failed:", legalPermissionError.code);
    return;
  }
  workspace.innerHTML = `<div class="staff-dashboard"><section class="edit-card"><h2>Ticket queue</h2><label for="ticket-queue-search">Search by subject</label><input id="ticket-queue-search" type="search" maxlength="160" /><label for="ticket-queue-filter">Status</label><select id="ticket-queue-filter"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_for_user">Waiting for user</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><label for="ticket-priority-filter">Priority</label><select id="ticket-priority-filter"><option value="">All priorities</option><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><label for="ticket-age-filter">Created</label><select id="ticket-age-filter"><option value="">Any time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><div id="staff-ticket-list"></div><div id="staff-ticket-detail"></div></section><section class="edit-card"><h2>Privacy requests</h2><div id="staff-privacy-list"></div></section><section class="edit-card"><h2>Moderation appeals</h2><div id="staff-appeal-list"></div></section><section class="edit-card"><h2>Contact submissions</h2><div id="staff-contact-list"></div></section>${canManageLegal ? `<section class="edit-card"><h2>Legal and help management</h2><div id="legal-admin-notice" class="notice" role="status" hidden></div><form id="legal-version-form" class="form-stack"><h3>Draft and publish a policy version</h3><label for="legal-document">Document</label><select id="legal-document">${["terms", "privacy", "cookies", "refunds", "community-guidelines"].map((id) => `<option value="${id}">${id.replaceAll("-", " ")}</option>`).join("")}</select><label for="legal-version">New version label</label><input id="legal-version" maxlength="40" pattern="[A-Za-z0-9._-]+" required /><label for="legal-body">Full policy text</label><textarea id="legal-body" minlength="1" maxlength="50000" rows="10" required></textarea><label for="legal-effective">Publish now (choose a time within one minute)</label><input id="legal-effective" type="datetime-local" required /><button class="button secondary" type="submit">Save and publish version</button></form><form id="faq-admin-form" class="form-stack"><h3>Publish a FAQ answer</h3><label for="faq-admin-category">Category</label><input id="faq-admin-category" maxlength="80" required /><label for="faq-admin-question">Question</label><input id="faq-admin-question" maxlength="300" required /><label for="faq-admin-answer">Answer</label><textarea id="faq-admin-answer" maxlength="5000" rows="4" required></textarea><button class="button secondary" type="submit">Publish FAQ</button></form><form id="article-admin-form" class="form-stack"><h3>Publish a help article</h3><label for="article-admin-title">Title</label><input id="article-admin-title" maxlength="160" required /><label for="article-admin-category">Category</label><input id="article-admin-category" maxlength="80" required /><label for="article-admin-tags">Search tags</label><input id="article-admin-tags" maxlength="500" /><label for="article-admin-body">Article text</label><textarea id="article-admin-body" minlength="10" maxlength="12000" rows="6" required></textarea><button class="button secondary" type="submit">Publish article</button></form><form id="support-agent-form" class="form-stack"><h3>Enable support staff</h3><label for="support-agent-id">Existing user ID</label><input id="support-agent-id" required pattern="[0-9a-fA-F-]{36}" /><label class="check-label"><input id="support-agent-legal" type="checkbox" /><span>May manage legal documents and help content</span></label><button class="button secondary" type="submit">Save staff permissions</button></form><h3>Current support agents</h3><div id="staff-agents-list"></div></section>` : ""}</div>`;
  const fetchList = async (table, host, columns, renderRow) => {
    const { data, error } = await supabase.from(table).select(columns).order("created_at", { ascending: false }).limit(100);
    if (error) {
      host.innerHTML = `<p class="muted">Could not load queue.</p>`;
      console.error(`Support staff ${table} queue failed:`, error.code);
      return;
    }
    host.innerHTML = data.length ? data.map(renderRow).join("") : `<p class="muted">Queue is empty.</p>`;
    if (table === "privacy_requests" || table === "moderation_appeals" || table === "contact_submissions") {
      host.querySelectorAll(".staff-review-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const isAppeal = table === "moderation_appeals";
        const rpcName = table === "contact_submissions"
          ? "update_contact_submission"
          : isAppeal ? "update_moderation_appeal" : "update_privacy_request";
        const idArgument = table === "contact_submissions"
          ? { requested_submission_id: form.dataset.id }
          : isAppeal ? { requested_appeal_id: form.dataset.id } : { requested_request_id: form.dataset.id };
        const { error: updateError } = await supabase.rpc(rpcName, {
          ...idArgument,
          requested_status: form.querySelector("select").value,
          requested_response: form.querySelector("textarea").value.trim(),
        });
        if (updateError) return setNotice(form.querySelector(".notice"), supportErrorMessage(updateError));
        setNotice(form.querySelector(".notice"), "Review saved.", "success");
        await fetchList(table, host, columns, renderRow);
      }));
    }
  };
  const ticketList = workspace.querySelector("#staff-ticket-list");
  const loadTicketQueue = async () => {
    let query = supabase.from("support_tickets").select("id, requester_id, assigned_to, category, subject, status, priority, created_at, updated_at").order("updated_at", { ascending: false }).limit(100);
    const status = workspace.querySelector("#ticket-queue-filter").value;
    if (status) query = query.eq("status", status);
    const priority = workspace.querySelector("#ticket-priority-filter").value;
    if (priority) query = query.eq("priority", priority);
    const age = Number(workspace.querySelector("#ticket-age-filter").value);
    if (age) query = query.gte("created_at", new Date(Date.now() - age * 24 * 60 * 60 * 1000).toISOString());
    const search = workspace.querySelector("#ticket-queue-search").value.trim();
    if (search) query = query.ilike("subject", `%${search}%`);
    const { data, error } = await query;
    if (error) {
      ticketList.innerHTML = `<p class="muted">Could not load tickets.</p>`;
      console.error("Support ticket queue failed:", error.code);
      return;
    }
    ticketList.innerHTML = data.length ? data.map((ticket) => `<button class="ticket-row" data-staff-ticket="${ticket.id}" type="button"><span>${escapeHtml(ticket.subject)}</span><span class="status-chip">${escapeHtml(ticket.status.replaceAll("_", " "))}</span><small>${escapeHtml(ticket.category)} · ${escapeHtml(ticket.priority)} · ${datePart(ticket.updated_at, { dateStyle: "medium" })}</small></button>`).join("") : `<p class="muted">Queue is empty.</p>`;
  };
  ["#ticket-queue-filter", "#ticket-priority-filter", "#ticket-age-filter"].forEach((selector) => workspace.querySelector(selector).addEventListener("change", loadTicketQueue));
  workspace.querySelector("#ticket-queue-search").addEventListener("change", loadTicketQueue);
  void loadTicketQueue();
  ticketList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-staff-ticket]");
    if (!row) return;
    const id = row.dataset.staffTicket;
    const [ticketResult, messageResult] = await Promise.all([
      supabase.from("support_tickets").select("id, subject, status, priority, assigned_to, requester_id").eq("id", id).single(),
      supabase.from("support_ticket_messages").select("body, is_internal, author_id, created_at").eq("ticket_id", id).order("created_at"),
    ]);
    if (ticketResult.error || messageResult.error) return setNotice(workspace.querySelector("#staff-ticket-detail"), "Could not load this ticket.");
    const ticket = ticketResult.data;
    const detail = workspace.querySelector("#staff-ticket-detail");
    detail.innerHTML = `<div class="ticket-detail"><h3>${escapeHtml(ticket.subject)}</h3><div class="ticket-messages">${messageResult.data.map((message) => `<article class="ticket-message ${message.is_internal ? "internal-note" : ""}"><p>${escapeHtml(message.body)}</p><small>${message.is_internal ? "Internal note" : message.author_id === ticket.requester_id ? "Requester" : "Staff"} · ${datePart(message.created_at, { dateStyle: "medium", timeStyle: "short" })}</small></article>`).join("")}</div><form class="staff-ticket-controls form-stack"><label for="staff-status">Status</label><select id="staff-status">${["open", "in_progress", "waiting_for_user", "resolved", "closed"].map((status) => `<option value="${status}" ${status === ticket.status ? "selected" : ""}>${status.replaceAll("_", " ")}</option>`).join("")}</select><label for="staff-priority">Priority</label><select id="staff-priority">${["low", "normal", "high", "urgent"].map((priority) => `<option value="${priority}" ${priority === ticket.priority ? "selected" : ""}>${priority}</option>`).join("")}</select><label for="staff-assignee">Assigned staff user ID (leave blank to unassign)</label><input id="staff-assignee" value="${escapeHtml(ticket.assigned_to || "")}" pattern="[0-9a-fA-F-]{36}" /><button class="button secondary" type="submit">Save ticket</button></form><form class="staff-reply form-stack"><label for="staff-reply-body">Reply to requester</label><textarea id="staff-reply-body" maxlength="8000" rows="3" required></textarea><button class="button primary" type="submit">Send reply</button></form><form class="staff-note form-stack"><label for="staff-note-body">Internal note (staff only)</label><textarea id="staff-note-body" maxlength="8000" rows="3" required></textarea><button class="button secondary" type="submit">Add internal note</button></form><div class="notice" role="status" hidden></div></div>`;
    const notice = detail.querySelector(".notice");
    detail.querySelector(".staff-ticket-controls").addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const { error } = await supabase.rpc("update_support_ticket", { requested_ticket_id: id, requested_status: detail.querySelector("#staff-status").value, requested_priority: detail.querySelector("#staff-priority").value, requested_assignee: detail.querySelector("#staff-assignee").value.trim() || null });
      if (error) return setNotice(notice, supportErrorMessage(error));
      setNotice(notice, "Ticket updated.", "success");
      await loadTicketQueue();
    });
    detail.querySelector(".staff-reply").addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const { error } = await supabase.rpc("reply_to_support_ticket", { requested_ticket_id: id, requested_body: detail.querySelector("#staff-reply-body").value.trim() });
      if (error) return setNotice(notice, supportErrorMessage(error));
      setNotice(notice, "Reply sent.", "success");
      await loadTicketQueue();
      row.click();
    });
    detail.querySelector(".staff-note").addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const { error } = await supabase.rpc("add_support_internal_note", { requested_ticket_id: id, requested_body: detail.querySelector("#staff-note-body").value.trim() });
      if (error) return setNotice(notice, supportErrorMessage(error));
      setNotice(notice, "Internal note added.", "success");
      row.click();
    });
  });
  void fetchList("privacy_requests", workspace.querySelector("#staff-privacy-list"), "id, request_type, details, status, staff_response, created_at", (item) => `<article class="ticket-row"><strong>${escapeHtml(item.request_type.replaceAll("_", " "))} · ${escapeHtml(item.status)}</strong><small>${datePart(item.created_at, { dateStyle: "medium" })}</small><p>${escapeHtml(item.details)}</p><form class="staff-review-form form-stack" data-id="${item.id}"><label>Status</label><select>${["open", "in_progress", "waiting_for_user", "resolved", "closed"].map((status) => `<option ${status === item.status ? "selected" : ""} value="${status}">${status.replaceAll("_", " ")}</option>`).join("")}</select><label>Response to requester</label><textarea maxlength="3000" rows="3">${escapeHtml(item.staff_response || "")}</textarea><button class="button secondary">Save review</button><div class="notice" role="status" hidden></div></form></article>`);
  void fetchList("moderation_appeals", workspace.querySelector("#staff-appeal-list"), "id, details, status, staff_response, created_at", (item) => `<article class="ticket-row"><strong>${escapeHtml(item.status)}</strong><small>${datePart(item.created_at, { dateStyle: "medium" })}</small><p>${escapeHtml(item.details)}</p><form class="staff-review-form form-stack" data-id="${item.id}"><label>Status</label><select>${["in_progress", "upheld", "overturned", "closed"].map((status) => `<option ${status === item.status ? "selected" : ""} value="${status}">${status.replaceAll("_", " ")}</option>`).join("")}</select><label>Response to requester</label><textarea maxlength="3000" rows="3">${escapeHtml(item.staff_response || "")}</textarea><button class="button secondary">Save review</button><div class="notice" role="status" hidden></div></form></article>`);
  void fetchList("contact_submissions", workspace.querySelector("#staff-contact-list"), "id, name, email, category, subject, message, status, staff_response, created_at", (item) => `<article class="ticket-row"><strong>${escapeHtml(item.subject)} · ${escapeHtml(item.status.replaceAll("_", " "))}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.email)} · ${escapeHtml(item.category)} · ${datePart(item.created_at, { dateStyle: "medium" })}</small><p>${escapeHtml(item.message)}</p><form class="staff-review-form form-stack" data-id="${item.id}"><label>Status</label><select>${["open", "in_progress", "waiting_for_user", "resolved", "closed"].map((status) => `<option ${status === item.status ? "selected" : ""} value="${status}">${status.replaceAll("_", " ")}</option>`).join("")}</select><label>Response note (internal only; contact email is not configured)</label><textarea maxlength="3000" rows="3">${escapeHtml(item.staff_response || "")}</textarea><button class="button secondary">Save status</button><div class="notice" role="status" hidden></div></form></article>`);
  if (!canManageLegal) return;
  const legalNotice = workspace.querySelector("#legal-admin-notice");
  workspace.querySelector("#legal-version-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const documentId = workspace.querySelector("#legal-document").value;
    const version = workspace.querySelector("#legal-version").value.trim();
    const body = workspace.querySelector("#legal-body").value.trim();
    const { error: insertError } = await supabase.from("legal_document_versions").insert({ document_id: documentId, version, body, published: false });
    if (insertError) return setNotice(legalNotice, supportErrorMessage(insertError));
    const effectiveDate = new Date(workspace.querySelector("#legal-effective").value);
    if (Number.isNaN(effectiveDate.valueOf())) return setNotice(legalNotice, "Choose a valid effective date.");
    const { error } = await supabase.rpc("publish_legal_version", { requested_document_id: documentId, requested_version: version, requested_effective_at: effectiveDate.toISOString() });
    if (error) return setNotice(legalNotice, supportErrorMessage(error));
    setNotice(legalNotice, "Policy version published. The public page will use this version.", "success");
    event.currentTarget.reset();
  });
  workspace.querySelector("#faq-admin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = workspace.querySelector("#faq-admin-question").value.trim();
    const answer = workspace.querySelector("#faq-admin-answer").value.trim();
    const { error } = await supabase.from("faq_entries").insert({ category: workspace.querySelector("#faq-admin-category").value.trim(), question, answer, published: true });
    if (error) return setNotice(legalNotice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(legalNotice, "FAQ published.", "success");
  });
  workspace.querySelector("#article-admin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = workspace.querySelector("#article-admin-title").value.trim();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
    const { error } = await supabase.from("help_articles").insert({ slug, title, category: workspace.querySelector("#article-admin-category").value.trim(), tags: workspace.querySelector("#article-admin-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean), body: workspace.querySelector("#article-admin-body").value.trim(), published: true });
    if (error) return setNotice(legalNotice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(legalNotice, "Help article published.", "success");
  });
  workspace.querySelector("#support-agent-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = workspace.querySelector("#support-agent-id").value.trim();
    const { error } = await supabase.rpc("set_support_agent", { requested_user_id: userId, requested_can_manage_legal: workspace.querySelector("#support-agent-legal").checked, requested_enabled: true });
    if (error) return setNotice(legalNotice, supportErrorMessage(error));
    event.currentTarget.reset();
    setNotice(legalNotice, "Support permissions saved.", "success");
    await loadSupportAgents();
  });
  const agentsList = workspace.querySelector("#staff-agents-list");
  async function loadSupportAgents() {
    const { data, error } = await supabase.from("support_agents").select("user_id, can_manage_legal, enabled, created_at").order("created_at", { ascending: false }).limit(100);
    if (error) {
      agentsList.innerHTML = `<p class="muted">Could not load staff assignments.</p>`;
      console.error("Support agents could not be loaded:", error.code);
      return;
    }
    agentsList.innerHTML = data.length ? data.map((agent) => `<article class="ticket-row"><span>${escapeHtml(agent.user_id)}</span><small>${agent.enabled ? "Enabled" : "Disabled"} · ${agent.can_manage_legal ? "Legal manager" : "Support agent"}</small>${agent.enabled ? `<button class="button secondary compact" type="button" data-disable-agent="${agent.user_id}">Disable access</button>` : ""}</article>`).join("") : `<p class="muted">No additional agents assigned.</p>`;
    agentsList.querySelectorAll("[data-disable-agent]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      const { error: disableError } = await supabase.rpc("set_support_agent", { requested_user_id: button.dataset.disableAgent, requested_can_manage_legal: false, requested_enabled: false });
      if (disableError) {
        button.disabled = false;
        return setNotice(legalNotice, supportErrorMessage(disableError));
      }
      await loadSupportAgents();
    }));
  }
  void loadSupportAgents();
}
function renderPublicHome() {
  renderPublicShell(`<main class="public-main"><section class="public-hero"><p class="eyebrow">YOUR GAME. YOUR PEOPLE.</p><h1>Find your next<br /><span>good game.</span></h1><p class="public-lead">Meet players, find communities, watch creator streams and discover tournaments across Africa.</p><div class="public-hero-actions"><a class="button primary" href="#register">Join the community ${icons.arrow}</a><a class="button secondary" href="#discover">Explore players</a></div><p class="muted-small">No made-up activity: directories show content shared by real GameHub members.</p><div class="public-hero-art" aria-hidden="true"><span></span><span></span><b>G.</b></div></section><section class="public-section"><p class="eyebrow">EXPLORE THE HUB</p><h2>More than a lobby.</h2><div class="public-feature-grid">${publicNavigation.filter(([key]) => key !== "home").map(([key, label]) => `<a class="public-feature" href="#${key}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(publicFeatureText(key))}</strong><span class="quick-arrow">${icons.arrow}</span></a>`).join("")}</div></section><section class="public-join"><div><p class="eyebrow">READY WHEN YOU ARE</p><h2>Your people are here.</h2><p class="muted">Build your gamer identity and join the conversation.</p></div><a class="button primary" href="#register">Create a free account</a></section></main>`, "home");
}

function publicFeatureText(page) {
  return ({
    discover: "Meet players and find your circle.",
    games: "See what GameHub players are playing.",
    communities: "Explore groups around the games you love.",
    teams: "Find or build your next squad.",
    live: "Watch streams shared by creators.",
    tournaments: "Find competitions and upcoming events.",
    marketplace: "Browse optional digital extras.",
  })[page] || "";
}

function renderPublicInfo(page) {
  const content = publicPages[page];
  renderPublicShell(`<main class="public-main public-article"><a class="back-link" href="#home">← Back to GameHub</a><p class="eyebrow">${escapeHtml(content.eyebrow)}</p><h1>${escapeHtml(content.title)}</h1>${page === "terms" || page === "privacy" ? `<p class="draft-label">Draft notice · requires operator and legal review before launch</p>` : ""}${content.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<a class="button secondary" href="#register">Join GameHub</a></main>`);
}

function renderPublicListing(page) {
  const heading = ({
    discover: ["DISCOVER PLAYERS", "Find your people.", "Browse public GameHub profiles shared by players."],
    games: ["GAME DISCOVERY", "What are we playing?", "Find games that have been shared in public communities, streams and tournaments."],
    communities: ["COMMUNITY DIRECTORY", "Find your corner.", "Explore active public gaming communities."],
    teams: ["SQUAD UP", "Build your team.", "Team membership and invitations are available to signed-in players."],
    live: ["LIVE DIRECTORY", "Watch together.", "Open live streams shared by GameHub creators."],
    tournaments: ["COMPETE", "Play for the win.", "Browse published tournaments and their real registration details."],
    marketplace: ["OPTIONAL EXTRAS", "Marketplace.", "Browse optional digital items. Marketplace purchases are coming soon."],
  })[page];
  const containerId = "public-listing-results";
  renderPublicShell(`<main class="public-main public-directory">${pageHeader(...heading)}<div id="${containerId}" class="public-results"><div class="skeleton-card"></div><div class="skeleton-card"></div></div><p class="muted-small">Showing published information only. Join GameHub to participate.</p></main>`, page);
  if (!isSupabaseConfigured) {
    app.querySelector(`#${containerId}`).innerHTML = page === "marketplace"
      ? `<div class="empty-state"><h2>Marketplace purchases are coming soon</h2><p>Community features remain free. Optional marketplace items will appear here when the catalog is ready.</p></div>`
      : `<div class="empty-state"><h2>Connect a Supabase project to browse live listings</h2><p>Public profiles, communities, streams and tournaments appear here after the setup instructions and database migrations are complete.</p><a class="button secondary" href="#about">Learn about GameHub</a></div>`;
    return;
  }
  if (page === "teams") {
    app.querySelector(`#${containerId}`).innerHTML = `<div class="empty-state"><h2>Teams are member-created</h2><p>Sign in to create a team, accept captain invitations, and see teams available to your account.</p><a class="button primary" href="#sign-in">Sign in to explore teams</a></div>`;
    return;
  }
  if (!isSupabaseConfigured) return;
  if (page === "discover") loadPublicPlayers(app.querySelector(`#${containerId}`));
  else if (page === "games") loadPublicGames(app.querySelector(`#${containerId}`));
  else if (page === "communities") loadPublicCommunities(app.querySelector(`#${containerId}`));
  else if (page === "live") loadPublicStreams(app.querySelector(`#${containerId}`));
  else if (page === "tournaments") loadPublicTournaments(app.querySelector(`#${containerId}`));
  else if (page === "marketplace") loadPublicProducts(app.querySelector(`#${containerId}`));
}

function renderPublicEmpty(container, title, description) {
  container.innerHTML = `<div class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><a class="button primary" href="#register">Join GameHub</a></div>`;
}

async function loadPublicPlayers(container) {
  const { data, error } = await supabase.from("profiles").select("id, username, display_name, bio, country_code, avatar_path").order("username").limit(30);
  if (error) return renderDataError(container, error, () => loadPublicPlayers(container));
  if (!data.length) return renderPublicEmpty(container, "No public profiles yet", "As players join and publish their profiles, they will appear here.");
  container.innerHTML = `<div class="player-grid">${data.map((profile) => {
    const avatar = profile.avatar_path ? supabase.storage.from("gamehub-avatars").getPublicUrl(profile.avatar_path).data.publicUrl : "";
    return `<article class="player-card"><span class="avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" />` : escapeHtml(initials(profile.display_name))}</span><div class="player-card-copy"><h2>${escapeHtml(profile.display_name)}</h2><p class="player-handle">@${escapeHtml(profile.username)}</p><p class="player-bio">${escapeHtml(profile.bio || "Ready to meet fellow gamers.")}</p><small>${escapeHtml(countryName(profile.country_code))}</small><a class="button secondary compact" href="#register">Connect</a></div></article>`;
  }).join("")}</div>`;
}

async function loadPublicCommunities(container) {
  const { data, error } = await supabase.from("communities").select("id, name, description, game, created_at").eq("visibility", "public").eq("status", "active").order("created_at", { ascending: false }).limit(30);
  if (error) return renderDataError(container, error, () => loadPublicCommunities(container));
  if (!data.length) return renderPublicEmpty(container, "No public communities yet", "Public gaming communities will appear here when members create them.");
  container.innerHTML = `<div class="community-grid">${data.map((community) => `<article class="community-card"><small>${escapeHtml(community.game || "Gaming")}</small><h2>${escapeHtml(community.name)}</h2><p>${escapeHtml(community.description || "A community for players.")}</p><a class="button secondary compact" href="#register">Join community</a></article>`).join("")}</div>`;
}

async function loadPublicStreams(container) {
  const { data, error } = await supabase.from("streams").select("id, title, game, provider, url, profiles!streams_user_id_fkey(username, display_name)").eq("status", "live").order("created_at", { ascending: false }).limit(24);
  if (error) return renderDataError(container, error, () => loadPublicStreams(container));
  const streams = data.filter((stream) => {
    const parsed = streamDetails(stream.url, window.location.hostname);
    return parsed && parsed.provider === stream.provider;
  });
  if (!streams.length) return renderPublicEmpty(container, "No live streams right now", "When creators share live streams, they will appear here. No activity is made up.");
  container.innerHTML = `<div class="stream-grid">${streams.map((stream) => `<article class="stream-card"><div class="stream-preview"><span class="live-badge"><span class="live-dot"></span> MODERATOR-CHECKED LIVE</span>${icons.live}</div><div class="stream-copy"><span class="provider-tag">${escapeHtml(stream.provider)}</span><h2>${escapeHtml(stream.title)}</h2><p>${escapeHtml(stream.game)} · ${escapeHtml(stream.profiles?.display_name || stream.profiles?.username || "Creator")}</p><a class="button secondary compact" href="${escapeHtml(stream.url)}" target="_blank" rel="noopener noreferrer">Watch on ${escapeHtml(stream.provider)}</a></div></article>`).join("")}</div>`;
}

async function loadPublicTournaments(container) {
  const { data, error } = await supabase.from("tournaments").select("id, name, game, format, status, starts_at, registration_deadline, participant_limit, prize_description, prize_verified_at, organizer:profiles!tournaments_organizer_id_fkey(username, display_name)").neq("status", "draft").order("starts_at", { ascending: true }).limit(30);
  if (error) return renderDataError(container, error, () => loadPublicTournaments(container));
  if (!data.length) return renderPublicEmpty(container, "No tournaments listed yet", "Published tournament details will appear here when organizers are ready.");
  container.innerHTML = `<div class="tournament-list">${data.map((tournament) => `<article class="tournament-card"><div class="tournament-date"><strong>${datePart(tournament.starts_at, { day: "2-digit" })}</strong><span>${datePart(tournament.starts_at, { month: "short" })}</span></div><div class="tournament-info"><span class="status-tag">${escapeHtml(tournament.status.replaceAll("_", " "))}</span><h2>${escapeHtml(tournament.name)}</h2><p>${escapeHtml(tournament.game)} · ${escapeHtml(tournament.format)} · ${escapeHtml(tournament.organizer?.display_name || "Organizer")}</p><small>${tournament.participant_limit ? `Limit ${tournament.participant_limit} entries` : "Open participant limit"}${tournament.prize_description && tournament.prize_verified_at ? ` · Verified prize: ${escapeHtml(tournament.prize_description)}` : ""}</small><a class="button primary compact" href="#register">Register</a></div></article>`).join("")}</div>`;
}

async function loadPublicProducts(container) {
  const { data, error } = await supabase.from("products").select("id, name, description, product_type, price_minor, currency_code, credit_amount").eq("active", true).order("created_at", { ascending: false }).limit(30);
  if (error) return renderDataError(container, error, () => loadPublicProducts(container));
  if (!data.length) return renderPublicEmpty(container, "No marketplace items yet", "Optional items will appear here when the marketplace is configured.");
  container.innerHTML = `<p class="draft-label">Marketplace purchases are coming soon. No payment will be collected.</p><div class="community-grid">${data.map((product) => `<article class="community-card"><small>${escapeHtml(product.product_type.replaceAll("_", " "))}</small><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description || "Digital item")}</p>${product.credit_amount ? `<p>${product.credit_amount} GH credits</p>` : ""}<strong>${escapeHtml(formatMoney(product.price_minor, product.currency_code))}</strong><button class="button secondary compact" type="button" disabled aria-disabled="true">Coming soon</button></article>`).join("")}</div>`;
}

async function loadPublicGames(container) {
  const [communities, streams, tournaments] = await Promise.all([
    supabase.from("communities").select("game").eq("visibility", "public").eq("status", "active").not("game", "is", null).limit(100),
    supabase.from("streams").select("game").eq("status", "live").limit(100),
    supabase.from("tournaments").select("game").neq("status", "draft").limit(100),
  ]);
  const failure = communities.error || streams.error || tournaments.error;
  if (failure) return renderDataError(container, failure, () => loadPublicGames(container));
  const games = new Map();
  for (const entry of [...communities.data, ...streams.data, ...tournaments.data]) {
    const name = entry.game?.trim();
    if (name) games.set(name.toLowerCase(), name);
  }
  if (!games.size) return renderPublicEmpty(container, "No games listed yet", "Game titles will appear here when players share them in communities, streams or tournaments.");
  container.innerHTML = `<div class="community-grid">${[...games.values()].sort((a, b) => a.localeCompare(b)).map((game) => `<article class="community-card"><span class="quick-icon">${icons.discover}</span><h2>${escapeHtml(game)}</h2><a class="button secondary compact" href="#communities">Explore communities</a></article>`).join("")}</div>`;
}

function renderApp() {
  if (!currentProfile) return renderOnboarding();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand sidebar-brand" href="#" data-page="home"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB<span class="brand-region">AFRICA</span></span></a>
        <p class="nav-caption">MENU</p><nav class="nav-list" aria-label="Main navigation">${navItems()}</nav>
        <div class="sidebar-bottom"><div class="mini-profile"><span class="avatar">${escapeHtml(initials(currentProfile.display_name))}</span><div><strong>${escapeHtml(currentProfile.display_name)}</strong><small>@${escapeHtml(currentProfile.username)}</small></div></div><button class="nav-link signout" data-action="signout">${icons.profile}<span>Sign out</span></button></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div class="mobile-brand"><span class="brand-mark">G<span>.</span></span><span>GAMEHUB</span></div><details class="mobile-more"><summary>More</summary><nav aria-label="More destinations">${navigation.filter(([key]) => ["calls", "communities", "teams", "tournaments", "marketplace", "notifications", "settings"].includes(key)).map(([key, label]) => `<a href="#${key}" data-page="${key}">${icons[key]}${label}</a>`).join("")}${["admin", "moderator"].includes(currentProfile.platform_role) ? `<a href="#admin" data-page="admin">${icons.settings}Moderation</a>` : ""}</nav></details><div class="topbar-right"><button class="nav-link top-notifications" data-page="notifications" aria-label="Notifications">${icons.notifications}<span>Notifications</span></button><span class="status-pill"><span class="live-dot"></span> COMMUNITY</span><button class="avatar avatar-button" data-page="profile" aria-label="Open your profile">${escapeHtml(initials(currentProfile.display_name))}</button></div></header>
        <div id="global-call-alert-host"></div>
        <section class="page-content" id="page-content"></section>
        <nav class="mobile-nav" aria-label="Mobile navigation">${navItems(true)}</nav>
      </main>
      <div id="global-call-stage-host"></div>
    </div>`;
  document.querySelectorAll("[data-page]").forEach((element) => element.addEventListener("click", (event) => {
    event.preventDefault();
    activePage = element.dataset.page;
    renderPage();
  }));
  document.querySelector('[data-action="signout"]').addEventListener("click", signOut);
  setupGlobalCallAlerts();
  renderPage();
}

function stopGlobalCallAlerts() {
  if (globalCallAlertsChannel) supabase.removeChannel(globalCallAlertsChannel);
  globalCallAlertsChannel = null;
  const host = document.querySelector("#global-call-alert-host");
  if (host) host.innerHTML = "";
}

function showIncomingCallAlert(callId) {
  const host = document.querySelector("#global-call-alert-host");
  if (!host || host.querySelector(".call-alert")) return;
  host.dataset.callId = callId;
  host.innerHTML = `<section class="call-alert" role="alert"><div><strong>Incoming call</strong><p>Open Calls to answer or decline.</p></div><div class="card-actions"><button class="button primary compact" data-open-calls>Open Calls</button><button class="button secondary compact" data-dismiss-call-alert>Dismiss</button></div></section>`;
  host.querySelector("[data-open-calls]").addEventListener("click", () => {
    activePage = "calls";
    renderPage();
    host.innerHTML = "";
  });
  host.querySelector("[data-dismiss-call-alert]").addEventListener("click", () => { host.innerHTML = ""; });
  announce("Incoming call. Open Calls to answer or decline.");
}

function setupGlobalCallAlerts() {
  stopGlobalCallAlerts();
  globalCallAlertsChannel = supabase.channel(`incoming-calls-${currentUser.id}`).on("postgres_changes", {
    event: "*", schema: "public", table: "call_participants", filter: `user_id=eq.${currentUser.id}`,
  }, ({ eventType, new: participant }) => {
    if (eventType === "INSERT") {
      if (participant.participant_status === "ringing") showIncomingCallAlert(participant.call_id);
      void supabase.from("call_sessions").select("created_at, call_type, status, created_by").eq("id", participant.call_id).maybeSingle()
        .then(({ data, error }) => {
          if (error) console.warn("Could not schedule incoming-call expiry:", error.message);
          else if (data && isCallTimeoutCandidate(data, participant.participant_status)) scheduleMissedCall(participant.call_id, data.created_at);
        });
    }
    if (eventType === "UPDATE" && participant.participant_status !== "ringing") {
      const timer = missedCallTimers.get(participant.call_id);
      if (timer) clearTimeout(timer);
      missedCallTimers.delete(participant.call_id);
      const host = document.querySelector("#global-call-alert-host");
      if (host?.dataset.callId === participant.call_id) {
        host.innerHTML = "";
        delete host.dataset.callId;
        void supabase.from("call_participants").select("call_id").eq("user_id", currentUser.id)
          .eq("participant_status", "ringing").limit(1).then(({ data, error }) => {
            if (error) console.warn("Could not check for another incoming call:", error.message);
            else if (data?.length) showIncomingCallAlert(data[0].call_id);
          });
      }
    }
  }).subscribe();
  void supabase.from("call_participants").select("call_id, participant_status, call_sessions!inner(id, created_at, call_type, status, created_by)")
    .eq("user_id", currentUser.id).in("participant_status", ["ringing", "outgoing", "accepted"]).limit(20).then(({ data, error }) => {
      if (error) console.warn("Could not check for incoming calls:", error.message);
      else for (const participant of data || []) {
        const call = participant.call_sessions;
        if (participant.participant_status === "ringing" && call.status === "ringing") showIncomingCallAlert(participant.call_id);
        if (isCallTimeoutCandidate(call, participant.participant_status)) scheduleMissedCall(participant.call_id, call.created_at);
      }
    });
}

function isCallTimeoutCandidate(call, participantStatus) {
  if (call.status === "ringing" && ["voice", "video"].includes(call.call_type)) {
    return ["ringing", "outgoing"].includes(participantStatus);
  }
  if (call.call_type === "group_voice") {
    return (call.status === "ringing" && (participantStatus === "ringing"
      || (call.created_by === currentUser.id && participantStatus === "accepted")))
      || (call.status === "active" && participantStatus === "ringing");
  }
  return false;
}

function scheduleMissedCall(callId, createdAt, content = document.querySelector("#page-content")) {
  if (missedCallTimers.has(callId)) return;
  const delay = Math.max(0, 35_000 - (Date.now() - new Date(createdAt).getTime()));
  missedCallTimers.set(callId, setTimeout(async () => {
    missedCallTimers.delete(callId);
    const { error } = await supabase.rpc("respond_to_call", {
      requested_call_id: callId,
      requested_action: "missed",
    });
    if (error && !/cannot be marked missed|no longer ringing/i.test(error.message)) console.warn("Could not mark call missed:", error.message);
    if (content?.isConnected) await refreshCallLists(content);
  }, delay));
}

const navigation = [
  ["home", "Home"], ["discover", "Players"], ["games", "Games"], ["live", "Live"], ["calls", "Calls"], ["communities", "Communities"],
  ["teams", "Teams"], ["tournaments", "Tournaments"], ["marketplace", "Marketplace"],
  ["messages", "Messages"], ["notifications", "Notifications"], ["profile", "My profile"], ["settings", "Settings"],
];

function navItems(mobile = false) {
  const items = mobile ? navigation.filter(([key]) => ["home", "discover", "live", "calls", "messages", "profile"].includes(key)) : [
    ...navigation,
    ...(currentProfile.platform_role === "admin" || currentProfile.platform_role === "moderator" ? [["admin", "Moderation"]] : []),
  ];
  return items.map(([key, label]) => `<a href="#${key}" class="nav-link ${activePage === key ? "active" : ""}" data-page="${key}" ${mobile ? `aria-label="${label}"` : ""}>${icons[key]}<span>${label}</span></a>`).join("");
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "G";
}

function pageHeader(eyebrow, title, description) {
  return `<header class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div></header>`;
}

function renderPage() {
  currentPageCleanup();
  currentPageCleanup = () => {};
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === activePage));
  const content = document.querySelector("#page-content");
  if (!content) return;
  if (activePage === "home") renderHome(content);
  else if (activePage === "profile") renderProfile(content);
  else if (activePage === "discover") renderDiscover(content);
  else if (activePage === "games") renderGames(content);
  else if (activePage === "live") renderLive(content);
  else if (activePage === "calls") renderCalls(content);
  else if (activePage === "tournaments") renderTournaments(content);
  else if (activePage === "communities") renderCommunities(content);
  else if (activePage === "messages") renderMessages(content);
  else if (activePage === "teams") renderTeams(content);
  else if (activePage === "notifications") renderNotifications(content);
  else if (activePage === "settings") renderSettings(content);
  else if (activePage === "marketplace") renderMarketplace(content);
  else if (activePage === "admin") renderAdmin(content);
}

async function renderHome(content) {
  content.innerHTML = `${pageHeader("YOUR SPACE", `Good to have you, ${escapeHtml(currentProfile.display_name)}.`, "Your gaming community starts here.")}<div class="welcome-banner"><div><p class="eyebrow">GAMEHUB AFRICA</p><h2>Find your next<br />good game.</h2><p>Discover gamers, communities and live streams shared by players.</p><button class="button primary" data-page="discover">Explore the hub ${icons.arrow}</button></div><div class="banner-art" aria-hidden="true"><span class="art-ring ring-one"></span><span class="art-ring ring-two"></span><span class="art-cross">✳</span><span class="art-square"></span></div></div><div class="section-heading"><div><p class="eyebrow">GET STARTED</p><h2>Make yourself at home</h2></div></div><div class="quick-grid"><button class="quick-card" data-page="discover"><span class="quick-icon">${icons.discover}</span><strong>Meet gamers</strong><span>Find players and build your circle.</span><span class="quick-arrow">${icons.arrow}</span></button><button class="quick-card" data-page="communities"><span class="quick-icon">${icons.communities}</span><strong>Find your community</strong><span>Explore groups around the games you love.</span><span class="quick-arrow">${icons.arrow}</span></button><button class="quick-card" data-page="live"><span class="quick-icon">${icons.live}</span><strong>Watch live</strong><span>Discover streams shared by creators.</span><span class="quick-arrow">${icons.arrow}</span></button></div><div id="home-error" class="notice" hidden></div>`;
  content.querySelectorAll("[data-page]").forEach((link) => link.addEventListener("click", () => {
    activePage = link.dataset.page;
    renderPage();
  }));
}

function renderProfile(content) {
  const avatarUrl = currentProfile.avatar_path ? supabase.storage.from("gamehub-avatars").getPublicUrl(currentProfile.avatar_path).data.publicUrl : "";
  content.innerHTML = `${pageHeader("PLAYER PROFILE", "Your profile", "The identity other players see on GameHub.")}<div class="profile-card"><div class="profile-cover"></div><div class="profile-details"><span class="avatar profile-avatar">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" />` : escapeHtml(initials(currentProfile.display_name))}</span><div class="profile-name"><h2>${escapeHtml(currentProfile.display_name)}</h2><span>@${escapeHtml(currentProfile.username)}</span></div><p class="profile-bio">${escapeHtml(currentProfile.bio || "Add a bio to tell other players a little about you.")}</p><div class="profile-meta"><span>${escapeHtml(countryName(currentProfile.country_code))}</span><span>${currentProfile.preferred_language === "sw" ? "Kiswahili" : "English"}</span><span>${currentProfile.profile_visibility === "private" ? "Private profile" : "Public profile"}</span></div><button class="button secondary" data-action="edit-profile">Edit profile</button></div></div><div id="profile-editor"></div><div class="section-heading"><div><p class="eyebrow">YOUR GAMING SETUP</p><h2>Favourite games</h2></div></div><div id="profile-games" class="tag-row"></div>`;
  content.querySelector('[data-action="edit-profile"]').addEventListener("click", () => renderProfileEditor(content.querySelector("#profile-editor")));
  loadUserGames(content.querySelector("#profile-games"), currentUser.id);
}

function renderProfileEditor(container) {
  container.innerHTML = `<form id="profile-edit-form" class="edit-card"><h2>Edit your profile</h2><div id="profile-error" class="notice" role="alert" hidden></div><label for="edit-display-name">Display name</label><input id="edit-display-name" name="display_name" maxlength="60" value="${escapeHtml(currentProfile.display_name)}" required /><label for="edit-bio">Bio</label><textarea id="edit-bio" name="bio" maxlength="240" rows="4" placeholder="A little about you…">${escapeHtml(currentProfile.bio || "")}</textarea><label for="edit-country">Country</label><select id="edit-country" name="country_code"><option value="KE" ${currentProfile.country_code === "KE" ? "selected" : ""}>Kenya</option><option value="UG" ${currentProfile.country_code === "UG" ? "selected" : ""}>Uganda</option><option value="TZ" ${currentProfile.country_code === "TZ" ? "selected" : ""}>Tanzania</option><option value="NG" ${currentProfile.country_code === "NG" ? "selected" : ""}>Nigeria</option><option value="ZA" ${currentProfile.country_code === "ZA" ? "selected" : ""}>South Africa</option><option value="OTHER" ${currentProfile.country_code === "OTHER" ? "selected" : ""}>Other</option></select><label for="edit-avatar">Avatar (PNG, JPEG or WebP; up to 5 MB)</label><input id="edit-avatar" type="file" accept="image/png,image/jpeg,image/webp" /><label for="edit-visibility">Profile visibility</label><select id="edit-visibility"><option value="public" ${currentProfile.profile_visibility !== "private" ? "selected" : ""}>Public</option><option value="private" ${currentProfile.profile_visibility === "private" ? "selected" : ""}>Private</option></select><div class="form-actions"><button class="button primary" type="submit">Save changes</button><button class="button secondary" type="button" data-action="cancel-edit">Cancel</button></div></form>`;
  container.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => { container.innerHTML = ""; });
  container.querySelector("#profile-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Saving…";
    const updates = {
      display_name: String(form.get("display_name")).trim(),
      bio: String(form.get("bio")).trim(),
      country_code: String(form.get("country_code")),
      profile_visibility: container.querySelector("#edit-visibility").value,
    };
    const avatar = container.querySelector("#edit-avatar").files[0];
    if (avatar) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(avatar.type) || avatar.size > 5 * 1024 * 1024) {
        submit.disabled = false;
        submit.textContent = "Save changes";
        setNotice(container.querySelector("#profile-error"), "Choose a PNG, JPEG or WebP image smaller than 5 MB.");
        return;
      }
      const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" })[avatar.type];
      const path = `${currentUser.id}/avatar-${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("gamehub-avatars").upload(path, avatar, { contentType: avatar.type, upsert: false });
      if (upload.error) {
        submit.disabled = false;
        submit.textContent = "Save changes";
        setNotice(container.querySelector("#profile-error"), `Avatar upload failed: ${upload.error.message}`);
        return;
      }
      updates.avatar_path = path;
    }
    const { error } = await supabase.from("profiles").update(updates).eq("id", currentUser.id);
    if (error) {
      submit.disabled = false;
      submit.textContent = "Save changes";
      setNotice(container.querySelector("#profile-error"), `We couldn't save your changes: ${error.message}`);
      return;
    }
    await loadProfile();
    renderPage();
    announce("Profile updated");
  });
}

async function loadUserGames(container, userId, editable = false) {
  const { data, error } = await supabase.from("user_game_preferences").select("game, platform").eq("user_id", userId).order("game").limit(20);
  if (error) return renderDataError(container, error, () => loadUserGames(container, userId));
  container.innerHTML = data.length
    ? data.map((item) => `<span class="tag">${escapeHtml(item.game)}${item.platform ? ` · ${escapeHtml(item.platform)}` : ""}${editable ? `<button type="button" data-remove-game="${escapeHtml(item.game)}" aria-label="Remove ${escapeHtml(item.game)}">×</button>` : ""}</span>`).join("")
    : `<span class="muted-small">No games added yet.</span>`;
}

async function renderDiscover(content) {
  content.innerHTML = `${pageHeader("DISCOVER", "Find your people.", "Browse real player profiles from the GameHub community.")}<div class="search-row"><label class="search-box"><span class="sr-only">Search players</span>${icons.discover}<input id="player-search" type="search" placeholder="Search usernames and players" /></label></div><div id="discover-results" class="player-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  const search = content.querySelector("#player-search");
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadPlayers(content.querySelector("#discover-results"), search.value), 250);
  });
  await loadPlayers(content.querySelector("#discover-results"), "");
}

async function loadPlayers(container, search) {
  const base = supabase.from("profiles").select("id, username, display_name, bio, country_code, avatar_path").not("onboarding_completed_at", "is", null).neq("id", currentUser.id).order("created_at", { ascending: false }).limit(24);
  let data;
  let error;
  if (search.trim()) {
  const term = search.trim();
  const [byUsername, byName] = await Promise.all([
    base.ilike("username", `%${term}%`),
    supabase.from("profiles").select("id, username, display_name, bio, country_code, avatar_path").not("onboarding_completed_at", "is", null).neq("id", currentUser.id).ilike("display_name", `%${term}%`).order("created_at", { ascending: false }).limit(24),
  ]);
  error = byUsername.error || byName.error;
  data = [...new Map([...(byUsername.data || []), ...(byName.data || [])].map((profile) => [profile.id, profile])).values()].slice(0, 24);
  } else {
  ({ data, error } = await base);
  }
  if (error) return renderDataError(container, error, () => loadPlayers(container, search));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.discover}</span><h2>${search ? "No players found" : "You’re among the first"}</h2><p>${search ? "Try a different name or username." : "There aren’t any other public profiles yet. Check back as the community grows."}</p></div>`;
    return;
  }
  const [follows, friends, blocks] = await Promise.all([
    supabase.from("user_follows").select("followed_id").eq("follower_id", currentUser.id).in("followed_id", data.map((p) => p.id)),
    supabase.from("friend_requests").select("recipient_id, sender_id, status").or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).eq("status", "pending"),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", currentUser.id),
  ]);
  const socialError = follows.error || friends.error || blocks.error;
  if (socialError) return renderDataError(container, socialError, () => loadPlayers(container, search));
  const followedIds = new Set((follows.data || []).map((row) => row.followed_id));
  const blockedIds = new Set((blocks.data || []).map((row) => row.blocked_id));
  const requestedIds = new Set((friends.data || []).map((row) => row.sender_id === currentUser.id ? row.recipient_id : row.sender_id));
  container.innerHTML = data.map((profile) => {
    const avatar = profile.avatar_path ? supabase.storage.from("gamehub-avatars").getPublicUrl(profile.avatar_path).data.publicUrl : "";
    return `<article class="player-card"><span class="avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : escapeHtml(initials(profile.display_name))}</span><div class="player-card-copy"><h3>${escapeHtml(profile.display_name)}</h3><p class="player-handle">@${escapeHtml(profile.username)}</p><p class="player-bio">${escapeHtml(profile.bio || "Ready to meet fellow gamers.")}</p><small>${escapeHtml(countryName(profile.country_code))}</small><div class="card-actions"><button class="button secondary compact" data-social="follow" data-user="${profile.id}">${followedIds.has(profile.id) ? "Following" : "Follow"}</button><button class="button secondary compact" data-social="friend" data-user="${profile.id}" ${requestedIds.has(profile.id) ? "disabled" : ""}>${requestedIds.has(profile.id) ? "Request sent" : "Add friend"}</button><button class="button secondary compact" data-social="message" data-user="${profile.id}">Message</button><button class="button secondary compact" data-social="call" data-call-type="voice" data-user="${profile.id}" ${liveKitServerUrl ? "" : "disabled"}>Voice call</button><button class="button secondary compact" data-social="call" data-call-type="video" data-user="${profile.id}" ${liveKitServerUrl ? "" : "disabled"}>Video call</button><button class="text-button" data-social="block" data-user="${profile.id}">${blockedIds.has(profile.id) ? "Unblock" : "Block"}</button><button class="text-button" data-social="report" data-user="${profile.id}">Report</button></div></div></article>`;
  }).join("");
  container.querySelectorAll("[data-social]").forEach((control) => control.addEventListener("click", () => handleSocialAction(control, container)));
}

async function handleSocialAction(control, container) {
  const { social, user } = control.dataset;
  control.disabled = true;
  let error = null;
  if (social === "follow") {
    if (control.textContent === "Following") {
      ({ error } = await supabase.from("user_follows").delete().eq("follower_id", currentUser.id).eq("followed_id", user));
    } else {
      ({ error } = await supabase.from("user_follows").insert({ follower_id: currentUser.id, followed_id: user }));
    }
    if (!error) control.textContent = social === "follow" && control.textContent === "Following" ? "Follow" : "Following";
  } else if (social === "friend") {
    ({ error } = await supabase.from("friend_requests").insert({ sender_id: currentUser.id, recipient_id: user }));
    if (!error) control.textContent = "Request sent";
  } else if (social === "message") {
    const result = await supabase.rpc("create_direct_conversation", { other_user_id: user });
    error = result.error;
    if (!error) {
      selectedConversationId = result.data;
      activePage = "messages";
      renderPage();
      return;
    }
  } else if (social === "call") {
    if (!liveKitServerUrl) {
      control.disabled = false;
      return setSocialNotice(container, "Voice and video calls are unavailable until the LiveKit server URL and server credentials are configured.");
    }
    const { error: callError, data: callId } = await supabase.rpc("start_call", {
      requested_user_id: user,
      requested_call_type: control.dataset.callType,
    });
    if (callError) {
      error = callError;
    } else {
      selectedConversationId = null;
      activePage = "calls";
      renderPage();
      await connectToCall(callId, control.dataset.callType === "video", control.dataset.callType);
      return;
    }
  } else if (social === "block") {
    const isBlocked = control.textContent === "Unblock";
    const result = isBlocked
      ? await supabase.from("user_blocks").delete().eq("blocker_id", currentUser.id).eq("blocked_id", user)
      : await supabase.from("user_blocks").insert({ blocker_id: currentUser.id, blocked_id: user });
    error = result.error;
    if (!error) control.textContent = isBlocked ? "Block" : "Unblock";
  } else if (social === "report") {
    const reason = window.prompt("Briefly describe the issue. Reports are reviewed by moderators.");
    if (!reason?.trim()) {
      control.disabled = false;
      return;
    }
    const result = await supabase.from("reports").insert({
      reporter_id: currentUser.id,
      reported_user_id: user,
      resource_type: "profile",
      resource_id: user,
      reason: reason.trim(),
    });
    error = result.error;
    if (!error) control.textContent = "Reported";
  }
  control.disabled = false;
  if (error) {
    console.error("Social action failed:", error);
    setSocialNotice(container, error.message);
  }
}

function setSocialNotice(container, message) {
  let notice = container.querySelector("[data-social-notice]");
  if (!notice) {
    container.insertAdjacentHTML("afterbegin", `<div class="notice error" data-social-notice></div>`);
    notice = container.querySelector("[data-social-notice]");
  }
  setNotice(notice, message);
}

async function renderLive(content) {
  content.innerHTML = `${pageHeader("LIVE DIRECTORY", "Watch together.", "YouTube and Twitch streams shared by GameHub creators.")}<details class="form-disclosure"><summary>Share a stream</summary><form id="stream-form" class="edit-card"><div id="stream-form-error" class="notice" role="alert" hidden></div><label for="stream-title">Stream title</label><input id="stream-title" name="title" maxlength="160" required /><label for="stream-game-name">Game</label><input id="stream-game-name" name="game" maxlength="100" required /><label for="stream-provider">Provider</label><select id="stream-provider" name="provider"><option value="youtube">YouTube</option><option value="twitch">Twitch</option></select><label for="stream-url">Stream or channel URL</label><input id="stream-url" name="url" type="url" placeholder="https://www.youtube.com/watch?v=…" required /><label for="stream-description">Description (optional)</label><textarea id="stream-description" name="description" maxlength="1000" rows="3"></textarea><button class="button primary" type="submit">Submit for review</button></form></details><div class="filter-row"><label for="stream-search">Search live streams</label><input id="stream-search" maxlength="80" placeholder="Title or game" /><label for="stream-game">Game filter</label><input id="stream-game" maxlength="80" placeholder="All games" /><button class="button secondary" data-action="search-streams">Search</button></div><div id="stream-list-error" class="notice" role="alert" hidden></div><div id="stream-results" class="stream-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div><div class="section-heading"><div><p class="eyebrow">CREATOR TOOLS</p><h2>Your submissions</h2></div></div><div id="my-streams" class="stream-grid"></div><div id="stream-detail"></div>`;
  const search = () => loadStreams(content.querySelector("#stream-results"), content.querySelector("#stream-game").value, content.querySelector("#stream-search").value);
  content.querySelector('[data-action="search-streams"]').addEventListener("click", search);
  content.querySelector("#stream-game").addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
  content.querySelector("#stream-search").addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
  content.querySelector("#stream-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = String(form.get("url")).trim();
    const details = streamDetails(url);
    const provider = String(form.get("provider"));
    const notice = content.querySelector("#stream-form-error");
    if (!details || details.provider !== provider) {
      setNotice(notice, "Use a valid HTTPS YouTube video/channel URL or Twitch channel URL that matches the selected provider.");
      return;
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Submitting…";
    const { error } = await supabase.from("streams").insert({
      user_id: currentUser.id,
      title: String(form.get("title")).trim(),
      game: String(form.get("game")).trim(),
      provider,
      url: details.url.href,
      description: String(form.get("description")).trim(),
      status: "unverified",
    });
    if (error) {
      submit.disabled = false;
      submit.textContent = "Submit for review";
      return setNotice(notice, `Could not submit the stream: ${error.message}`);
    }
    event.currentTarget.reset();
    submit.disabled = false;
    submit.textContent = "Submit for review";
    setNotice(notice, "Your stream was submitted for moderation. It will appear in Live after verification.", "success");
    await loadMyStreams(content.querySelector("#my-streams"));
  });
  await search();
  await loadMyStreams(content.querySelector("#my-streams"));
}

async function loadMyStreams(container) {
  const { data, error } = await supabase.from("streams").select("id, title, game, provider, status, created_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(20);
  if (error) return renderDataError(container, error, () => loadMyStreams(container));
  const statusLabels = { unverified: "Status unknown · awaiting review", live: "Moderator-checked live", offline: "Marked offline", unavailable: "Unavailable", removed: "Removed" };
  container.innerHTML = data.length ? data.map((stream) => `<article class="community-card"><span class="status-tag">${escapeHtml(statusLabels[stream.status] || "Status unknown")}</span><h3>${escapeHtml(stream.title)}</h3><p>${escapeHtml(stream.game)} · ${escapeHtml(stream.provider)}</p><button class="button secondary compact" data-remove-stream="${stream.id}">Remove</button></article>`).join("") : `<p class="muted-small">You have not submitted any streams yet.</p>`;
  container.querySelectorAll("[data-remove-stream]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error: removeError } = await supabase.from("streams").delete().eq("id", control.dataset.removeStream).eq("user_id", currentUser.id);
    if (removeError) {
      control.disabled = false;
      return renderDataError(container, removeError, () => loadMyStreams(container));
    }
    await loadMyStreams(container);
  }));
}

async function loadStreams(container, game, searchTerm = "") {
  let query = supabase.from("streams").select("id, title, game, provider, url, description, profiles!streams_user_id_fkey(username, display_name)").eq("status", "live").order("created_at", { ascending: false }).limit(24);
  if (game.trim()) query = query.ilike("game", `%${game.trim()}%`);
  const safeSearch = searchTerm.trim().replace(/[^a-z0-9 _-]/gi, "").slice(0, 80);
  if (safeSearch) query = query.or(`title.ilike.%${safeSearch}%,game.ilike.%${safeSearch}%`);
  const { data, error } = await query;
  if (error) return renderDataError(container, error, () => loadStreams(container, game, searchTerm));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.live}</span><h2>No live streams right now</h2><p>When creators share live streams, they’ll appear here. No viewers or activity are made up.</p></div>`;
    return;
  }
  const { data: follows, error: followsError } = await supabase.from("stream_follows").select("stream_id").eq("user_id", currentUser.id)
    .in("stream_id", data.map((stream) => stream.id));
  if (followsError) return renderDataError(container, followsError, () => loadStreams(container, game, searchTerm));
  const followedIds = new Set(follows.map((follow) => follow.stream_id));
  container.innerHTML = data.map((stream) => {
    const details = streamDetails(stream.url, window.location.hostname);
    if (!details || details.provider !== stream.provider) return "";
    const isFollowed = followedIds.has(stream.id);
    return `<article class="stream-card"><button class="stream-open" data-stream-id="${stream.id}" aria-label="Open ${escapeHtml(stream.title)}"><div class="stream-preview"><span class="live-badge"><span class="live-dot"></span> MODERATOR-CHECKED LIVE</span>${icons.live}</div></button><div class="stream-copy"><span class="provider-tag">${escapeHtml(stream.provider)}</span><h3>${escapeHtml(stream.title)}</h3><p>${escapeHtml(stream.game)} · ${escapeHtml(stream.profiles?.display_name || stream.profiles?.username || "Creator")}</p><div class="card-actions"><button class="text-link" data-stream-id="${stream.id}">Watch together ${icons.arrow}</button><button class="button secondary compact" data-follow-stream="${stream.id}" data-following="${isFollowed}">${isFollowed ? "Following" : "Follow"}</button></div></div></article>`;
  }).join("") || `<div class="empty-state"><h2>No supported streams found</h2><p>Stream links must point to YouTube or Twitch over HTTPS.</p></div>`;
  container.querySelectorAll("[data-stream-id]").forEach((control) => control.addEventListener("click", () => openStream(control.dataset.streamId)));
  container.querySelectorAll("[data-follow-stream]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const result = control.dataset.following === "true"
      ? await supabase.from("stream_follows").delete().eq("stream_id", control.dataset.followStream).eq("user_id", currentUser.id)
      : await supabase.from("stream_follows").insert({ stream_id: control.dataset.followStream, user_id: currentUser.id });
    if (result.error) {
      control.disabled = false;
      return setNotice(document.querySelector("#stream-list-error"), `Could not update stream follow: ${result.error.message}`);
    }
    await loadStreams(container, game, searchTerm);
  }));
}

async function openStream(streamId) {
  const detail = document.querySelector("#stream-detail");
  if (!detail) return;
  const { data: stream, error } = await supabase.from("streams").select("id, title, game, provider, url, description, profiles!streams_user_id_fkey(username, display_name)").eq("id", streamId).eq("status", "live").single();
  if (error) return renderDataError(detail, error, () => openStream(streamId));
  const parsed = streamDetails(stream.url, window.location.hostname);
  if (!parsed) return setNotice(detail, "This stream link is no longer available.");
  detail.innerHTML = `<section class="stream-detail-card"><div class="section-heading"><div><p class="eyebrow">NOW PLAYING</p><h2>${escapeHtml(stream.title)}</h2><p class="muted">${escapeHtml(stream.game)} · ${escapeHtml(stream.profiles?.display_name || "Creator")}</p></div><div class="card-actions"><button class="text-button" data-action="report-stream">Report</button><button class="button secondary compact" data-action="close-stream">Close</button></div></div>${parsed.embedUrl ? `<div class="video-frame"><iframe src="${escapeHtml(parsed.embedUrl)}" title="${escapeHtml(stream.title)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : `<div class="notice">This channel link cannot be embedded. <a href="${escapeHtml(parsed.url.href)}" target="_blank" rel="noopener noreferrer">Open it on YouTube</a>.</div>`}<p class="muted">${escapeHtml(stream.description)}</p><div id="stream-report-notice" class="notice" role="status" hidden></div><div class="chat-panel"><h3>GameHub chat</h3><div id="stream-chat-history" class="chat-history" aria-live="polite"></div><form id="stream-chat-form" class="chat-compose"><label class="sr-only" for="stream-chat-input">Send a chat message</label><input id="stream-chat-input" maxlength="1000" placeholder="Say something kind…" required /><button class="button primary" type="submit">Send</button></form><div id="stream-chat-error" class="notice" role="alert" hidden></div></div></section>`;
  detail.querySelector('[data-action="close-stream"]').addEventListener("click", () => { detail.innerHTML = ""; });
  detail.querySelector('[data-action="report-stream"]').addEventListener("click", async (event) => {
    const reason = window.prompt("Briefly describe the issue with this stream.");
    if (!reason?.trim()) return;
    const control = event.currentTarget;
    control.disabled = true;
    const { error: reportError } = await supabase.from("stream_reports").insert({
      stream_id: stream.id,
      reporter_id: currentUser.id,
      reason: reason.trim(),
    });
    control.disabled = false;
    setNotice(detail.querySelector("#stream-report-notice"), reportError ? `Report not submitted: ${reportError.message}` : "Report sent to moderators.", reportError ? "error" : "success");
  });
  await loadStreamChat(stream.id, detail.querySelector("#stream-chat-history"));
  const channel = supabase.channel(`stream-chat-${stream.id}`).on("postgres_changes", {
    event: "INSERT", schema: "public", table: "stream_chat_messages", filter: `stream_id=eq.${stream.id}`,
  }, async () => loadStreamChat(stream.id, detail.querySelector("#stream-chat-history"))).subscribe();
  currentPageCleanup = () => supabase.removeChannel(channel);
  detail.querySelector("#stream-chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    const submit = event.currentTarget.querySelector("button");
    const body = input.value.trim();
    if (!body) return;
    submit.disabled = true;
    const { error: sendError } = await supabase.from("stream_chat_messages").insert({ stream_id: stream.id, user_id: currentUser.id, body });
    submit.disabled = false;
    if (sendError) {
      setNotice(detail.querySelector("#stream-chat-error"), `Message not sent: ${sendError.message}`);
      return;
    }
    input.value = "";
    await loadStreamChat(stream.id, detail.querySelector("#stream-chat-history"));
  });
}

async function loadStreamChat(streamId, container) {
  const { data, error } = await supabase.from("stream_chat_messages").select("id, body, created_at, profiles!stream_chat_messages_user_id_fkey(username, display_name)").eq("stream_id", streamId).order("created_at", { ascending: false }).limit(50);
  if (error) return renderDataError(container, error, () => loadStreamChat(streamId, container));
  container.innerHTML = data.length ? data.reverse().map((message) => `<p><strong>${escapeHtml(message.profiles?.display_name || message.profiles?.username || "Player")}</strong><span>${escapeHtml(message.body)}</span><time>${escapeHtml(datePart(message.created_at, { hour: "2-digit", minute: "2-digit" }))}</time></p>`).join("") : `<p class="muted-small">Be the first to say hello.</p>`;
  container.scrollTop = container.scrollHeight;
}

async function renderTournaments(content) {
  content.innerHTML = `${pageHeader("COMPETE", "Play for the win.", "Find tournaments and see the details before you sign up.")}<details class="form-disclosure"><summary>Organize a tournament</summary><form id="tournament-form" class="edit-card"><div id="tournament-error" class="notice" role="alert" hidden></div><label for="tournament-name">Tournament name</label><input id="tournament-name" name="name" maxlength="120" required /><label for="tournament-game">Game</label><input id="tournament-game" name="game" maxlength="100" required /><label for="tournament-format">Format</label><input id="tournament-format" name="format" maxlength="80" placeholder="e.g. 1v1 knockout" required /><label for="tournament-start">Start time</label><input id="tournament-start" name="starts_at" type="datetime-local" required /><label for="tournament-deadline">Registration deadline</label><input id="tournament-deadline" name="registration_deadline" type="datetime-local" /><label for="tournament-limit">Participant limit (optional)</label><input id="tournament-limit" name="participant_limit" type="number" min="2" max="10000" /><label for="tournament-rules">Rules</label><textarea id="tournament-rules" name="rules" maxlength="10000" rows="4"></textarea><p class="muted-small">Tournaments start as drafts. Prize claims require moderator verification.</p><button class="button primary" type="submit">Create tournament draft</button></form></details><div id="tournament-results" class="tournament-list"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  content.querySelector("#tournament-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const row = {
      organizer_id: currentUser.id,
      name: String(form.get("name")).trim(),
      game: String(form.get("game")).trim(),
      format: String(form.get("format")).trim(),
      starts_at: new Date(String(form.get("starts_at"))).toISOString(),
      registration_deadline: form.get("registration_deadline") ? new Date(String(form.get("registration_deadline"))).toISOString() : null,
      participant_limit: form.get("participant_limit") ? Number(form.get("participant_limit")) : null,
      rules: String(form.get("rules")).trim(),
      status: "draft",
    };
    const { error: createError } = await supabase.from("tournaments").insert(row);
    submit.disabled = false;
    if (createError) return setNotice(content.querySelector("#tournament-error"), `Could not create tournament: ${createError.message}`);
    setNotice(content.querySelector("#tournament-error"), "Draft saved. You can publish it below once the details are ready.", "success");
    await loadTournamentList(content.querySelector("#tournament-results"));
  });
  await loadTournamentList(content.querySelector("#tournament-results"));
}

async function loadTournamentList(container) {
  const { data, error } = await supabase.from("tournaments").select("id, organizer_id, name, game, format, rules, status, starts_at, registration_deadline, participant_limit, prize_description, prize_verified_at, organizer:profiles!tournaments_organizer_id_fkey(username, display_name)").order("starts_at", { ascending: true }).limit(50);
  if (error) return renderDataError(container, error, () => loadTournamentList(container));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.tournaments}</span><h2>No tournaments listed yet</h2><p>Verified tournament listings will show here when organizers publish them.</p></div>`;
    return;
  }
  const [registrationResult, teamResult] = await Promise.all([
    supabase.from("tournament_participants").select("tournament_id, status, team_id").eq("user_id", currentUser.id).in("tournament_id", data.map((item) => item.id)),
    supabase.from("teams").select("id, name").eq("captain_id", currentUser.id),
  ]);
  const registrationError = registrationResult.error || teamResult.error;
  if (registrationError) return renderDataError(container, registrationError, () => loadTournamentList(container));
  const registrations = registrationResult.data;
  const myTeams = teamResult.data || [];
  const registered = new Map((registrations || []).map((item) => [item.tournament_id, item.status]));
  container.innerHTML = data.map((tournament) => {
    const isOwner = tournament.organizer_id === currentUser.id;
    const joined = registered.get(tournament.id) === "registered";
    const canJoin = tournament.status === "registration_open" && (!tournament.registration_deadline || new Date(tournament.registration_deadline) > new Date());
    const teamRegistrations = registrations.filter((item) => item.tournament_id === tournament.id && item.team_id);
    const hasMyTeam = teamRegistrations.some((item) => myTeams.some((team) => team.id === item.team_id) && item.status === "registered");
    return `<article class="tournament-card"><div class="tournament-date"><strong>${datePart(tournament.starts_at, { day: "2-digit" })}</strong><span>${datePart(tournament.starts_at, { month: "short" })}</span></div><div class="tournament-info"><span class="status-tag">${escapeHtml(tournament.status.replaceAll("_", " "))}</span><h3>${escapeHtml(tournament.name)}</h3><p>${escapeHtml(tournament.game)} · ${escapeHtml(tournament.format)} · ${escapeHtml(tournament.organizer?.display_name || "Organizer")}</p><p>${escapeHtml(tournament.rules || "Rules to be announced by the organizer.")}</p><small>${tournament.participant_limit ? `Limit ${tournament.participant_limit} entries` : "Open participant limit"}${tournament.prize_description && tournament.prize_verified_at ? ` · Verified prize: ${escapeHtml(tournament.prize_description)}` : ""}</small><div class="card-actions">${joined ? `<button class="button secondary compact" data-tournament-cancel="${tournament.id}">Cancel registration</button>` : canJoin ? `<button class="button primary compact" data-tournament-join="${tournament.id}">Register individually</button>` : ""}${canJoin && myTeams.length && !hasMyTeam ? `<select aria-label="Choose team to register" data-team-choice="${tournament.id}">${myTeams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("")}</select><button class="button secondary compact" data-tournament-team="${tournament.id}">Register team</button>` : ""}${isOwner && tournament.status === "draft" ? `<button class="button secondary compact" data-tournament-publish="${tournament.id}">Open registration</button>` : ""}${isOwner ? `<button class="button secondary compact" data-manage-bracket="${tournament.id}">Manage matches</button>` : ""}</div><div data-bracket="${tournament.id}"></div></div></article>`;
  }).join("");
  container.querySelectorAll("[data-tournament-join]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error: joinError } = await supabase.rpc("register_for_tournament", { requested_tournament_id: control.dataset.tournamentJoin });
    if (joinError) {
      control.disabled = false;
      return renderDataError(container, joinError, () => loadTournamentList(container));
    }
    await loadTournamentList(container);
  }));
  container.querySelectorAll("[data-tournament-cancel]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error: cancelError } = await supabase.from("tournament_participants").update({ status: "cancelled" }).eq("tournament_id", control.dataset.tournamentCancel).eq("user_id", currentUser.id);
    if (cancelError) {
      control.disabled = false;
      return renderDataError(container, cancelError, () => loadTournamentList(container));
    }
    await loadTournamentList(container);
  }));
  container.querySelectorAll("[data-tournament-team]").forEach((control) => control.addEventListener("click", async () => {
    const teamId = container.querySelector(`[data-team-choice="${control.dataset.tournamentTeam}"]`).value;
    control.disabled = true;
    const { error: teamError } = await supabase.rpc("register_team_for_tournament", {
      requested_tournament_id: control.dataset.tournamentTeam,
      requested_team_id: teamId,
    });
    if (teamError) {
      control.disabled = false;
      return renderDataError(container, teamError, () => loadTournamentList(container));
    }
    await loadTournamentList(container);
  }));
  container.querySelectorAll("[data-tournament-publish]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error: publishError } = await supabase.from("tournaments").update({ status: "registration_open" }).eq("id", control.dataset.tournamentPublish).eq("organizer_id", currentUser.id);
    if (publishError) {
      control.disabled = false;
      return renderDataError(container, publishError, () => loadTournamentList(container));
    }
    await loadTournamentList(container);
  }));
  container.querySelectorAll("[data-manage-bracket]").forEach((control) => control.addEventListener("click", () => openTournamentManager(control.dataset.manageBracket, container.querySelector(`[data-bracket="${control.dataset.manageBracket}"]`))));
}

async function openTournamentManager(tournamentId, container) {
  const [registrations, matches] = await Promise.all([
    supabase.from("tournament_participants").select("user_id, team_id, profiles!tournament_participants_user_id_fkey(username, display_name)").eq("tournament_id", tournamentId).eq("status", "registered").limit(500),
    supabase.from("tournament_matches").select("id, round_number, match_number, participant_one, participant_two, scheduled_at, status").eq("tournament_id", tournamentId).order("round_number").order("match_number").limit(200),
  ]);
  const error = registrations.error || matches.error;
  if (error) return renderDataError(container, error, () => openTournamentManager(tournamentId, container));
  const participants = registrations.data || [];
  const options = participants.map((participant) => `<option value="${participant.user_id}">${escapeHtml(participant.profiles?.display_name || participant.profiles?.username || participant.user_id)}${participant.team_id ? " (team captain)" : ""}</option>`).join("");
  container.innerHTML = `<form class="edit-card match-form" data-create-match="${tournamentId}"><h3>Schedule a match</h3><label>Round</label><input name="round" type="number" min="1" value="1" required /><label>Match number</label><input name="match" type="number" min="1" value="${(matches.data?.length || 0) + 1}" required /><label>Player or team one</label><select name="one" required>${options}</select><label>Player or team two</label><select name="two" required>${options}</select><label>Schedule</label><input name="scheduled_at" type="datetime-local" /><button class="button secondary compact" type="submit">Create match</button></form><div class="post-list">${(matches.data || []).map((match) => `<article class="post-card"><strong>Round ${match.round_number} · Match ${match.match_number}</strong><span class="status-tag">${escapeHtml(match.status)}</span>${match.status !== "completed" ? `<form class="result-form" data-record-result="${match.id}"><label>Winner</label><select name="winner"><option value="${match.participant_one}">${escapeHtml(participants.find((p) => p.user_id === match.participant_one)?.profiles?.display_name || "Player one")}</option><option value="${match.participant_two}">${escapeHtml(participants.find((p) => p.user_id === match.participant_two)?.profiles?.display_name || "Player two")}</option></select><label>Result details</label><input name="details" maxlength="2000" required /><button class="button secondary compact" type="submit">Record result</button></form>` : ""}</article>`).join("")}</div>`;
  container.querySelector("[data-create-match]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const one = String(form.get("one"));
    const two = String(form.get("two"));
    if (one === two) return setNotice(container, "Choose two different participants.");
    const { error: createError } = await supabase.from("tournament_matches").insert({
      tournament_id: tournamentId,
      round_number: Number(form.get("round")),
      match_number: Number(form.get("match")),
      participant_one: one,
      participant_two: two,
      scheduled_at: form.get("scheduled_at") ? new Date(String(form.get("scheduled_at"))).toISOString() : null,
    });
    if (createError) return renderDataError(container, createError, () => openTournamentManager(tournamentId, container));
    await openTournamentManager(tournamentId, container);
  });
  container.querySelectorAll("[data-record-result]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const { error: resultError } = await supabase.from("tournament_results").insert({
      match_id: form.dataset.recordResult,
      winner_id: String(values.get("winner")),
      recorded_by: currentUser.id,
      result_details: String(values.get("details")).trim(),
    });
    if (resultError) return renderDataError(container, resultError, () => openTournamentManager(tournamentId, container));
    const { error: matchError } = await supabase.from("tournament_matches").update({ status: "completed" }).eq("id", form.dataset.recordResult);
    if (matchError) return renderDataError(container, matchError, () => openTournamentManager(tournamentId, container));
    await openTournamentManager(tournamentId, container);
  }));
}

async function renderCommunities(content) {
  if (selectedCommunityId) return renderCommunityDetail(content, selectedCommunityId);
  content.innerHTML = `${pageHeader("COMMUNITY", "Find your crew.", "Join public communities or create one for your game.")}<details class="form-disclosure"><summary>Create a community</summary><form id="community-form" class="edit-card"><div id="community-error" class="notice" role="alert" hidden></div><label for="community-name">Name</label><input id="community-name" name="name" maxlength="80" required /><label for="community-game">Game</label><input id="community-game" name="game" maxlength="100" required /><label for="community-description">Description</label><textarea id="community-description" name="description" maxlength="1000" rows="3"></textarea><label for="community-rules">Community rules</label><textarea id="community-rules" name="rules" maxlength="5000" rows="4"></textarea><button class="button primary" type="submit">Create public community</button></form></details><div id="community-results" class="community-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  content.querySelector("#community-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error: createError } = await supabase.from("communities").insert({
      owner_id: currentUser.id,
      name: String(form.get("name")).trim(),
      game: String(form.get("game")).trim(),
      description: String(form.get("description")).trim(),
      rules: String(form.get("rules")).trim(),
      visibility: "public",
      status: "active",
    });
    submit.disabled = false;
    if (createError) return setNotice(content.querySelector("#community-error"), `Could not create community: ${createError.message}`);
    setNotice(content.querySelector("#community-error"), "Community created. You are its owner.", "success");
    await loadCommunities(content.querySelector("#community-results"));
  });
  await loadCommunities(content.querySelector("#community-results"));
}

async function loadCommunities(container) {
  const { data, error } = await supabase.from("communities").select("id, owner_id, name, description, game, community_members(count)").eq("visibility", "public").eq("status", "active").order("created_at", { ascending: false }).limit(24);
  if (error) return renderDataError(container, error, () => loadCommunities(container));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.communities}</span><h2>Your community is waiting to be built</h2><p>Public gaming communities will appear here when they’re created.</p></div>`;
    return;
  }
  const memberships = await supabase.from("community_members").select("community_id").eq("user_id", currentUser.id).in("community_id", data.map((community) => community.id));
  const joinedIds = new Set((memberships.data || []).map((item) => item.community_id));
  container.innerHTML = data.map((community) => `<article class="community-card"><span class="quick-icon">${icons.communities}</span><small>${escapeHtml(community.game || "Gaming")}</small><h3>${escapeHtml(community.name)}</h3><p>${escapeHtml(community.description || "A place for players to connect.")}</p><span class="muted-small">${community.community_members?.[0]?.count ?? 0} members</span><div class="card-actions"><button class="button secondary compact" data-community-open="${community.id}">Open</button>${joinedIds.has(community.id) ? `<span class="muted-small">Joined</span>` : `<button class="button primary compact" data-community-join="${community.id}">Join</button>`}</div></article>`).join("");
  container.querySelectorAll("[data-community-open]").forEach((control) => control.addEventListener("click", () => {
    selectedCommunityId = control.dataset.communityOpen;
    renderCommunityDetail(document.querySelector("#page-content"), selectedCommunityId);
  }));
  container.querySelectorAll("[data-community-join]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error: joinError } = await supabase.from("community_members").insert({ community_id: control.dataset.communityJoin, user_id: currentUser.id, role: "member" });
    if (joinError) {
      control.disabled = false;
      return renderDataError(container, joinError, () => loadCommunities(container));
    }
    await loadCommunities(container);
  }));
}

async function renderCommunityDetail(content, communityId) {
  const { data: community, error } = await supabase.from("communities").select("id, owner_id, name, description, game, rules").eq("id", communityId).single();
  if (error) return renderDataError(content, error, () => renderCommunityDetail(content, communityId));
  const membership = await supabase.from("community_members").select("community_id").eq("community_id", communityId).eq("user_id", currentUser.id).maybeSingle();
  if (membership.error) return renderDataError(content, membership.error, () => renderCommunityDetail(content, communityId));
  const isMember = Boolean(membership.data);
  content.innerHTML = `${pageHeader(escapeHtml(community.game || "COMMUNITY"), escapeHtml(community.name), escapeHtml(community.description))}<button class="button secondary compact" data-action="back-communities">← All communities</button>${isMember ? `<details class="form-disclosure"><summary>Post to this community</summary><form id="community-post-form" class="edit-card"><div id="post-error" class="notice" role="alert" hidden></div><label for="post-body">Your post</label><textarea id="post-body" maxlength="5000" rows="4" required></textarea><button class="button primary" type="submit">Publish post</button></form></details>` : `<p class="muted-small">Join this community to post and comment.</p><button class="button primary compact" data-action="detail-join">Join community</button>`}<p class="muted-small">${escapeHtml(community.rules || "Community guidelines: be respectful and follow the platform rules.")}</p><div id="community-posts" class="post-list"></div>`;
  content.querySelector('[data-action="back-communities"]').addEventListener("click", () => {
    selectedCommunityId = null;
    renderCommunities(content);
  });
  content.querySelector('[data-action="detail-join"]')?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const { error: joinError } = await supabase.from("community_members").insert({ community_id: communityId, user_id: currentUser.id, role: "member" });
    if (joinError) {
      event.currentTarget.disabled = false;
      return setNotice(content.querySelector(".muted-small"), `Couldn't join: ${joinError.message}`);
    }
    await renderCommunityDetail(content, communityId);
  });
  content.querySelector("#community-post-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    const body = content.querySelector("#post-body").value.trim();
    submit.disabled = true;
    const { error: postError } = await supabase.from("community_posts").insert({ community_id: communityId, author_id: currentUser.id, body });
    submit.disabled = false;
    if (postError) return setNotice(content.querySelector("#post-error"), `Post could not be published: ${postError.message}`);
    content.querySelector("#post-body").value = "";
    await loadCommunityPosts(communityId, content.querySelector("#community-posts"), true);
  });
  await loadCommunityPosts(communityId, content.querySelector("#community-posts"), isMember);
}

async function loadCommunityPosts(communityId, container, isMember = false) {
  const { data, error } = await supabase.from("community_posts").select("id, body, created_at, author_id, profiles!community_posts_author_id_fkey(display_name, username)").eq("community_id", communityId).order("created_at", { ascending: false }).limit(40);
  if (error) return renderDataError(container, error, () => loadCommunityPosts(communityId, container, isMember));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state"><h2>Start the conversation</h2><p>There are no posts yet.</p></div>`;
    return;
  }
  const comments = await Promise.all(data.map((post) => supabase.from("community_comments").select("id, author_id, body, created_at, profiles!community_comments_author_id_fkey(display_name, username)").eq("post_id", post.id).order("created_at").limit(20)));
  const failedComments = comments.find((result) => result.error);
  if (failedComments) return renderDataError(container, failedComments.error, () => loadCommunityPosts(communityId, container, isMember));
  container.innerHTML = data.map((post, index) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(post.profiles?.display_name || post.profiles?.username || "Player")}</strong><time>${escapeHtml(datePart(post.created_at, { dateStyle: "medium", timeStyle: "short" }))}</time></div><p>${escapeHtml(post.body)}</p>${post.author_id === currentUser.id ? `<button class="text-button" data-remove-post="${post.id}">Delete post</button>` : ""}<div class="comment-list">${comments[index].data.map((comment) => `<p><strong>${escapeHtml(comment.profiles?.display_name || comment.profiles?.username || "Player")}</strong> ${escapeHtml(comment.body)}</p>`).join("")}</div>${isMember ? `<form class="comment-form" data-comment-post="${post.id}"><label class="sr-only" for="comment-${post.id}">Comment on post</label><input id="comment-${post.id}" name="body" maxlength="2000" placeholder="Write a comment…" required /><button class="button secondary compact" type="submit">Comment</button></form>` : ""}</article>`).join("");
  container.querySelectorAll("[data-remove-post]").forEach((control) => control.addEventListener("click", async () => {
    const { error: removeError } = await supabase.from("community_posts").delete().eq("id", control.dataset.removePost).eq("author_id", currentUser.id);
    if (removeError) return renderDataError(container, removeError, () => loadCommunityPosts(communityId, container, isMember));
    await loadCommunityPosts(communityId, container, isMember);
  }));
  container.querySelectorAll("[data-comment-post]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button");
    submit.disabled = true;
    const { error: commentError } = await supabase.from("community_comments").insert({
      post_id: form.dataset.commentPost,
      author_id: currentUser.id,
      body: new FormData(form).get("body").toString().trim(),
    });
    if (commentError) {
      submit.disabled = false;
      return renderDataError(container, commentError, () => loadCommunityPosts(communityId, container, isMember));
    }
    await loadCommunityPosts(communityId, container, isMember);
  }));
}

async function renderMessages(content) {
  content.innerHTML = `${pageHeader("MESSAGES", "Private conversations.", "Only conversation participants can read these messages.")}<div class="message-layout"><aside class="conversation-list"><div id="conversation-items" class="skeleton-card"></div></aside><section id="conversation-thread" class="conversation-thread"><div class="empty-state"><span class="empty-icon">${icons.messages}</span><h2>Your conversations</h2><p>Start a private conversation from Discover.</p></div></section></div>`;
  await loadConversations(content);
}

async function loadConversations(content) {
  const list = content.querySelector("#conversation-items");
  const { data: memberships, error } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", currentUser.id);
  if (error) return renderDataError(list, error, () => loadConversations(content));
  if (!memberships.length) {
    list.innerHTML = `<div class="empty-state"><p>No conversations yet. Find a player in Discover to start one.</p></div>`;
    return;
  }
  const ids = memberships.map((item) => item.conversation_id);
  const { data: conversations, error: conversationsError } = await supabase.from("conversation_members").select("conversation_id, user_id, profiles!conversation_members_user_id_fkey(username, display_name)").in("conversation_id", ids).neq("user_id", currentUser.id);
  if (conversationsError) return renderDataError(list, conversationsError, () => loadConversations(content));
  list.innerHTML = conversations.map((member) => `<button class="conversation-item ${selectedConversationId === member.conversation_id ? "active" : ""}" data-conversation="${member.conversation_id}"><span class="avatar">${escapeHtml(initials(member.profiles?.display_name))}</span><span><strong>${escapeHtml(member.profiles?.display_name || "Player")}</strong><small>@${escapeHtml(member.profiles?.username || "")}</small></span></button>`).join("");
  list.querySelectorAll("[data-conversation]").forEach((control) => control.addEventListener("click", () => openConversation(content, control.dataset.conversation)));
  if (selectedConversationId && ids.includes(selectedConversationId)) await openConversation(content, selectedConversationId);
  else if (!selectedConversationId) await openConversation(content, ids[0]);
}

async function openConversation(content, conversationId) {
  selectedConversationId = conversationId;
  const thread = content.querySelector("#conversation-thread");
  const { data: members, error } = await supabase.from("conversation_members").select("user_id, profiles!conversation_members_user_id_fkey(display_name, username)").eq("conversation_id", conversationId).neq("user_id", currentUser.id).limit(1);
  if (error) return renderDataError(thread, error, () => openConversation(content, conversationId));
  const other = members[0]?.profiles;
  thread.innerHTML = `<header class="thread-heading"><strong>${escapeHtml(other?.display_name || "Conversation")}</strong><small>@${escapeHtml(other?.username || "")}</small></header><div id="message-history" class="message-history"></div><form id="message-form" class="chat-compose"><label class="sr-only" for="message-input">Your message</label><input id="message-input" maxlength="4000" placeholder="Write a message…" required /><button class="button primary" type="submit">Send</button></form><div id="message-error" class="notice" role="alert" hidden></div>`;
  document.querySelectorAll("[data-conversation]").forEach((item) => item.classList.toggle("active", item.dataset.conversation === conversationId));
  const history = thread.querySelector("#message-history");
  await loadMessages(conversationId, history);
  const channel = supabase.channel(`conversation-${conversationId}`).on("postgres_changes", {
    event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}`,
  }, () => loadMessages(conversationId, history)).subscribe();
  currentPageCleanup = () => supabase.removeChannel(channel);
  thread.querySelector("#message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    const submit = event.currentTarget.querySelector("button");
    const body = input.value.trim();
    if (!body) return;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const { error: sendError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      body,
    });
    submit.disabled = false;
    submit.textContent = "Send";
    if (sendError) return setNotice(thread.querySelector("#message-error"), `Message not sent: ${sendError.message}`);
    input.value = "";
    await loadMessages(conversationId, history);
  });
}

async function loadMessages(conversationId, container, offset = 0, prepend = false) {
  const { data, error } = await supabase.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).range(offset, offset + 49);
  if (error) return renderDataError(container, error, () => loadMessages(conversationId, container));
  const messages = data.reverse();
  const html = messages.map((message) => `<article class="message-bubble ${message.sender_id === currentUser.id ? "mine" : ""}"><p>${escapeHtml(message.body)}</p><time>${escapeHtml(datePart(message.created_at, { hour: "2-digit", minute: "2-digit" }))}</time></article>`).join("");
  if (prepend) {
    const oldHeight = container.scrollHeight;
    container.querySelector("[data-load-older]")?.remove();
    container.insertAdjacentHTML("afterbegin", html);
    if (offset + data.length < 500) container.insertAdjacentHTML("afterbegin", `<button class="text-button load-older" data-load-older>Load older messages</button>`);
    container.scrollTop = container.scrollHeight - oldHeight;
  } else {
    container.innerHTML = `${data.length === 50 ? `<button class="text-button load-older" data-load-older>Load older messages</button>` : ""}${html || `<p class="muted-small">Say hello to start this conversation.</p>`}`;
    container.scrollTop = container.scrollHeight;
  }
  container.querySelector("[data-load-older]")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    await loadMessages(conversationId, container, offset + 50, true);
  });
  const incoming = messages.filter((message) => message.sender_id !== currentUser.id).map((message) => message.id);
  if (incoming.length) {
    const { error: receiptError } = await supabase.from("message_receipts").update({ read_at: new Date().toISOString() })
      .eq("user_id", currentUser.id).is("read_at", null).in("message_id", incoming);
    if (receiptError) console.error("Could not mark messages read:", receiptError);
  }
}

async function renderTeams(content) {
  content.innerHTML = `${pageHeader("SQUAD UP", "Teams.", "Build a roster around the games you play.")}<details class="form-disclosure"><summary>Create a team</summary><form id="team-form" class="edit-card"><div id="team-error" class="notice" role="alert" hidden></div><label for="team-name">Team name</label><input id="team-name" name="name" maxlength="80" required /><label for="team-game">Game</label><input id="team-game" name="game" maxlength="100" required /><label for="team-description">Description</label><textarea id="team-description" name="description" maxlength="1000" rows="3"></textarea><button class="button primary" type="submit">Create team</button></form></details><div id="team-invitations"></div><div id="team-results" class="community-grid"><div class="skeleton-card"></div></div>`;
  content.querySelector("#team-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await supabase.from("teams").insert({
      captain_id: currentUser.id,
      name: String(form.get("name")).trim(),
      game: String(form.get("game")).trim(),
      description: String(form.get("description")).trim(),
    });
    submit.disabled = false;
    if (error) return setNotice(content.querySelector("#team-error"), `Could not create the team: ${error.message}`);
    setNotice(content.querySelector("#team-error"), "Team created. You are the captain.", "success");
    await loadTeams(content);
  });
  await loadTeams(content);
}

async function loadTeams(content) {
  const invitations = content.querySelector("#team-invitations");
  const teamResult = await supabase.from("team_invitations").select("id, team_id, created_at, teams(name, game), inviter:profiles!team_invitations_inviter_id_fkey(display_name, username)").eq("invitee_id", currentUser.id).eq("status", "pending").order("created_at", { ascending: false }).limit(20);
  if (teamResult.error) return renderDataError(invitations, teamResult.error, () => loadTeams(content));
  invitations.innerHTML = teamResult.data.length ? `<div class="section-heading"><div><p class="eyebrow">INVITATIONS</p><h2>Team invites</h2></div></div>${teamResult.data.map((invite) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(invite.teams?.name || "Team")}</strong><span>${escapeHtml(invite.inviter?.display_name || invite.inviter?.username || "Player")} invited you</span></div><div class="card-actions"><button class="button primary compact" data-invite="${invite.id}" data-accept="true">Accept</button><button class="button secondary compact" data-invite="${invite.id}" data-accept="false">Decline</button></div></article>`).join("")}` : "";
  invitations.querySelectorAll("[data-invite]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.rpc("respond_to_team_invitation", {
      requested_invitation_id: control.dataset.invite,
      accept_invitation: control.dataset.accept === "true",
    });
    if (error) {
      control.disabled = false;
      return renderDataError(invitations, error, () => loadTeams(content));
    }
    await loadTeams(content);
  }));

  const result = await supabase.from("teams").select("id, captain_id, name, description, game, team_members(count)").order("created_at", { ascending: false }).limit(30);
  const container = content.querySelector("#team-results");
  if (result.error) return renderDataError(container, result.error, () => loadTeams(content));
  if (!result.data.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.teams}</span><h2>No teams yet</h2><p>Create one or accept an invitation to join your first squad.</p></div>`;
    return;
  }
  container.innerHTML = result.data.map((team) => `<article class="community-card"><span class="quick-icon">${icons.teams}</span><small>${escapeHtml(team.game || "Gaming")}</small><h3>${escapeHtml(team.name)}</h3><p>${escapeHtml(team.description || "A team for players.")}</p><span class="muted-small">${team.team_members?.[0]?.count || 0} members · ${team.captain_id === currentUser.id ? "Captain" : "Member"}</span>${team.captain_id === currentUser.id ? `<form class="invite-form" data-team="${team.id}"><label>Invite by username</label><div class="inline-form"><input name="username" maxlength="24" placeholder="gamer_tag" required /><button class="button secondary compact" type="submit">Invite</button></div><div class="notice" role="alert" hidden></div></form>` : ""}</article>`).join("");
  container.querySelectorAll(".invite-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const submit = form.querySelector("button");
    submit.disabled = true;
    const target = await supabase.from("profiles").select("id").eq("username", normalizeUsername(input.value)).maybeSingle();
    if (target.error || !target.data) {
      submit.disabled = false;
      return setNotice(form.querySelector(".notice"), target.error?.message || "No public player has that username.");
    }
    const { error } = await supabase.rpc("invite_team_member", { requested_team_id: form.dataset.team, requested_invitee_id: target.data.id });
    submit.disabled = false;
    if (error) return setNotice(form.querySelector(".notice"), error.message);
    setNotice(form.querySelector(".notice"), "Invitation sent.", "success");
    input.value = "";
  }));
}

async function renderCalls(content) {
  const configNotice = liveKitServerUrl
    ? ""
    : `<div class="notice">Calls are not active in this environment yet. Configure <code>VITE_LIVEKIT_URL</code> to enable call controls. The server validates its LiveKit URL and API credentials before issuing a token, and any missing configuration is reported without simulating a connection.</div>`;
  content.innerHTML = `${pageHeader("VOICE & VIDEO", "Calls and voice rooms.", "Private calls use LiveKit WebRTC. Audio and video are never relayed through GameHub chat.")}${configNotice}<div id="call-page-error" class="notice" role="alert" hidden></div><div class="call-create-grid"><form id="group-call-form" class="edit-card"><h2>Start a group call</h2><label for="group-title">Call name</label><input id="group-title" maxlength="100" placeholder="Game night" required /><label for="group-players">Invite by usernames</label><input id="group-players" placeholder="player_one, player_two" required /><small>Invite 2–7 players. Each account's call privacy and block settings are enforced.</small><button class="button primary" type="submit" ${liveKitServerUrl ? "" : "disabled"}>Start group voice call</button></form><form id="voice-room-form" class="edit-card"><h2>Create a voice room</h2><label for="voice-room-title">Room name</label><input id="voice-room-title" maxlength="100" placeholder="Casual squad lobby" required /><small>Public voice rooms are visible to signed-in players. No call is recorded.</small><button class="button secondary" type="submit" ${liveKitServerUrl ? "" : "disabled"}>Create voice room</button></form></div><div class="section-heading"><div><p class="eyebrow">LIVE & INCOMING</p><h2>Your calls</h2></div><button class="button secondary compact" data-action="refresh-calls">Refresh</button></div><div id="call-list" class="call-list"><div class="skeleton-card"></div></div><div class="section-heading"><div><p class="eyebrow">OPEN ROOMS</p><h2>Voice rooms</h2></div></div><div id="voice-room-list" class="community-grid"><div class="skeleton-card"></div></div><div class="section-heading"><div><p class="eyebrow">RECENT</p><h2>Call history</h2></div></div><div id="call-history" class="post-list"></div>`;
  content.querySelector("#group-call-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (!liveKitServerUrl) return;
    const usernames = [...new Set(content.querySelector("#group-players").value.split(",").map((name) => normalizeUsername(name)).filter(Boolean))];
    if (usernames.length < 2 || usernames.length > 7) {
      return setNotice(content.querySelector("#call-page-error"), "Enter between 2 and 7 unique usernames, separated by commas.");
    }
    submit.disabled = true;
    const { data: profiles, error: lookupError } = await supabase.from("profiles").select("id, username").in("username", usernames);
    if (lookupError) {
      submit.disabled = false;
      return setNotice(content.querySelector("#call-page-error"), lookupError.message);
    }
    if (profiles.length !== usernames.length) {
      submit.disabled = false;
      const found = new Set(profiles.map((profile) => profile.username));
      return setNotice(content.querySelector("#call-page-error"), `Player not found: ${usernames.find((name) => !found.has(name))}`);
    }
    const { data: callId, error } = await supabase.rpc("create_group_call", {
      requested_user_ids: profiles.map((profile) => profile.id),
      requested_title: content.querySelector("#group-title").value.trim(),
    });
    submit.disabled = false;
    if (error) return setNotice(content.querySelector("#call-page-error"), error.message);
    content.querySelector("#group-players").value = "";
    await refreshCallLists(content);
    await connectToCall(callId, false, "group_voice");
  });
  content.querySelector("#voice-room-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!liveKitServerUrl) return;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { data: callId, error } = await supabase.rpc("create_voice_room", {
      requested_title: content.querySelector("#voice-room-title").value.trim(),
    });
    submit.disabled = false;
    if (error) return setNotice(content.querySelector("#call-page-error"), error.message);
    content.querySelector("#voice-room-title").value = "";
    await refreshCallLists(content);
    await connectToCall(callId, false, "voice_room");
  });
  content.querySelector('[data-action="refresh-calls"]').addEventListener("click", () => refreshCallLists(content));
  await refreshCallLists(content);
  const channel = supabase.channel(`calls-${currentUser.id}`).on("postgres_changes", {
    event: "*", schema: "public", table: "call_participants", filter: `user_id=eq.${currentUser.id}`,
  }, () => refreshCallLists(content)).on("postgres_changes", {
    event: "UPDATE", schema: "public", table: "call_sessions",
  }, () => refreshCallLists(content)).subscribe();
  currentPageCleanup = () => supabase.removeChannel(channel);
}

async function refreshCallLists(content) {
  const callList = content.querySelector("#call-list");
  if (!callList) return;
  const { data: memberships, error: membershipError } = await supabase.from("call_participants")
    .select("call_id, participant_status, invited_at").eq("user_id", currentUser.id)
    .order("invited_at", { ascending: false }).limit(50);
  if (membershipError) return renderDataError(callList, membershipError, () => refreshCallLists(content));

  const callIds = memberships.map((membership) => membership.call_id);
  let calls = [];
  if (callIds.length) {
    const { data, error } = await supabase.from("call_sessions")
      .select("id, call_type, title, status, created_by, created_at, accepted_at, ended_at, call_participants(user_id, participant_status, profiles!call_participants_user_id_fkey(display_name, username))")
      .in("id", callIds).order("created_at", { ascending: false }).limit(50);
    if (error) return renderDataError(callList, error, () => refreshCallLists(content));
    calls = data;
  }
  if (activeCallId && !calls.some((call) => call.id === activeCallId && ["ringing", "active"].includes(call.status))) {
    await disconnectActiveCall();
  }
  const membershipByCall = new Map(memberships.map((membership) => [membership.call_id, membership]));
  const ringingCallIds = new Set(calls.filter((call) => isCallTimeoutCandidate(
    call,
    membershipByCall.get(call.id)?.participant_status,
  )).map((call) => call.id));
  for (const [callId, timer] of missedCallTimers) {
    if (!ringingCallIds.has(callId)) {
      clearTimeout(timer);
      missedCallTimers.delete(callId);
    }
  }
  for (const call of calls) {
    if (ringingCallIds.has(call.id) && !missedCallTimers.has(call.id)) {
      scheduleMissedCall(call.id, call.created_at, content);
    }
  }
  const liveCalls = calls.filter((call) => ["ringing", "active"].includes(call.status));
  const history = calls.filter((call) => !["ringing", "active"].includes(call.status));
  callList.innerHTML = liveCalls.length ? liveCalls.map((call) => renderCallCard(call, membershipByCall.get(call.id))).join("") : `<div class="empty-state"><span class="empty-icon">${icons.calls}</span><h2>No incoming or active calls</h2><p>Start a call from Discover or create a group call or voice room here.</p></div>`;
  content.querySelector("#call-history").innerHTML = history.length ? history.slice(0, 20).map((call) => renderCallCard(call, membershipByCall.get(call.id), true)).join("") : `<div class="empty-state"><p>Your call history will appear here.</p></div>`;
  callList.querySelectorAll("[data-call-action]").forEach((control) => control.addEventListener("click", () => handleCallAction(control, content)));
  content.querySelector("#call-history").querySelectorAll("[data-call-action]").forEach((control) => control.addEventListener("click", () => handleCallAction(control, content)));

  const roomsContainer = content.querySelector("#voice-room-list");
  const { data: rooms, error: roomError } = await supabase.from("call_sessions")
    .select("id, title, created_at, call_participants(user_id, participant_status)")
    .eq("call_type", "voice_room").eq("status", "active")
    .order("created_at", { ascending: false }).limit(20);
  if (roomError) return renderDataError(roomsContainer, roomError, () => refreshCallLists(content));
  roomsContainer.innerHTML = rooms.length ? rooms.map((room) => `<article class="community-card"><small>OPEN VOICE ROOM</small><h3>${escapeHtml(room.title)}</h3><p>No recording. Leave whenever you like.</p><button class="button primary compact" data-join-room="${room.id}" ${liveKitServerUrl ? "" : "disabled"}>Join room</button></article>`).join("") : `<div class="empty-state"><h2>No open voice rooms</h2><p>Create a room to start a casual group voice chat.</p></div>`;
  roomsContainer.querySelectorAll("[data-join-room]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.rpc("join_voice_room", { requested_call_id: control.dataset.joinRoom });
    if (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#call-page-error"), error.message);
    }
    await connectToCall(control.dataset.joinRoom, false, "voice_room");
    await refreshCallLists(content);
  }));
}

function renderCallCard(call, membership, history = false) {
  const ownStatus = membership?.participant_status || "ended";
  const otherParticipants = call.call_participants?.filter((participant) => participant.user_id !== currentUser.id) || [];
  const names = otherParticipants.map((participant) => participant.profiles?.display_name || participant.profiles?.username || "Player");
  const status = call.status === "ringing" && ownStatus === "ringing" ? "Incoming"
    : call.status === "ringing" && ownStatus === "outgoing" ? "Calling"
      : call.status;
  let controls = "";
  if (!history && ownStatus === "ringing") {
    controls = `<button class="button primary compact" data-call-action="accept" data-call="${call.id}" data-call-type="${call.call_type}" ${liveKitServerUrl ? "" : "disabled"}>Accept</button><button class="button secondary compact" data-call-action="decline" data-call="${call.id}">Decline</button>`;
  } else if (!history && ownStatus === "outgoing" && call.status === "ringing") {
    controls = `<button class="button secondary compact" data-call-action="cancel" data-call="${call.id}">Cancel call</button>`;
  } else if (!history && call.call_type === "voice_room" && ownStatus !== "accepted") {
    controls = `<button class="button primary compact" data-join-room="${call.id}" ${liveKitServerUrl ? "" : "disabled"}>Join room</button>`;
  } else if (!history && ["accepted", "outgoing"].includes(ownStatus)) {
    const action = ["voice_room", "group_voice"].includes(call.call_type) ? "leave" : "end";
    const label = call.call_type === "voice_room" ? "Leave room" : call.call_type === "group_voice" ? "Leave group call" : "End call";
    controls = `<button class="button secondary compact" data-call-action="${action}" data-call="${call.id}">${label}</button>`;
  }
  return `<article class="post-card call-card"><div class="post-head"><strong>${escapeHtml(call.title || (call.call_type === "video" ? "Video call" : "Voice call"))}</strong><span class="status-tag">${escapeHtml(String(status).replaceAll("_", " "))}</span></div><p>${escapeHtml(names.length ? names.join(", ") : "You")}</p><small>${escapeHtml(call.call_type.replaceAll("_", " "))} · ${escapeHtml(datePart(call.created_at, { dateStyle: "medium", timeStyle: "short" }))}</small>${controls ? `<div class="card-actions">${controls}</div>` : ""}</article>`;
}

async function handleCallAction(control, content) {
  const callId = control.dataset.call;
  const action = control.dataset.callAction;
  control.disabled = true;
  const { error } = await supabase.rpc("respond_to_call", {
    requested_call_id: callId,
    requested_action: action,
  });
  if (error) {
    control.disabled = false;
    return setNotice(content.querySelector("#call-page-error"), error.message);
  }
  if (action === "accept") await connectToCall(callId, control.dataset.callType === "video", control.dataset.callType);
  else if (activeCallId === callId) await disconnectActiveCall();
  await refreshCallLists(content);
}

async function connectToCall(callId, enableVideo = false, callTypeHint = null) {
  if (!liveKitServerUrl) {
    announce("Calls are unavailable because LiveKit is not configured.");
    return;
  }
  const content = document.querySelector("#page-content");
  const errorNotice = content?.querySelector("#call-page-error");
  if (activeLiveKitRoom && activeCallId === callId) return;
  if (activeLiveKitRoom) await disconnectActiveCall();
  activeCallType = callTypeHint;
  const stageHost = document.querySelector("#global-call-stage-host");
  if (stageHost) {
    stageHost.innerHTML = `<section id="call-stage" class="call-stage"><div class="call-connection"><span class="spinner" aria-hidden="true"></span><span>Preparing secure call…</span></div></section>`;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sign in again before joining a call.");
    const { data: participants, error: participantsError } = await supabase.from("call_participants")
      .select("user_id, profiles!call_participants_user_id_fkey(display_name, username)")
      .eq("call_id", callId);
    if (participantsError) throw new Error(`Participant list could not be loaded: ${participantsError.message}`);
    activeCallNames = new Map((participants || []).map((participant) => [
      participant.user_id,
      participant.profiles?.display_name || participant.profiles?.username || "Player",
    ]));
    const response = await fetch("/api/calls/token", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ callId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "A secure call connection could not be prepared.");
    if (result.serverUrl !== liveKitServerUrl) throw new Error("The configured LiveKit server URL does not match this deployment.");

    const { Room, RoomEvent, Track } = await import("livekit-client");
    activeLiveKitTrack = Track;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    activeLiveKitRoom = room;
    activeCallId = callId;
    activeCallType = result.callType;
    activeCallVideo = enableVideo || result.callType === "video";
    activeCallMicrophoneEnabled = true;
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      const status = document.querySelector("#call-connection-state");
      if (status) status.textContent = state === "connected"
        ? room.remoteParticipants.size ? `Connected · ${room.remoteParticipants.size} other participant${room.remoteParticipants.size === 1 ? "" : "s"}`
          : "Connected to media server · waiting for participants"
        : state === "reconnecting" ? "Connection interrupted · reconnecting…" : state;
    });
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted]) {
      room.on(event, () => renderCallParticipants(room));
    }
    room.on(RoomEvent.Disconnected, () => {
      const status = document.querySelector("#call-connection-state");
      if (status) status.textContent = "Disconnected";
    });
    await room.connect(result.serverUrl, result.token);
    await room.localParticipant.setMicrophoneEnabled(activeCallMicrophoneEnabled);
    if (activeCallVideo) await room.localParticipant.setCameraEnabled(true);
    renderCallStage(room);
  } catch (error) {
    console.error("Could not join LiveKit call:", error);
    const failedCallType = activeCallType;
    if (activeLiveKitRoom) {
      await activeLiveKitRoom.disconnect();
      activeLiveKitRoom = null;
      activeCallId = null;
      activeCallType = null;
    }
    activeCallId = null;
    activeCallType = null;
    activeLiveKitTrack = null;
    activeCallNames.clear();
    if (errorNotice) setNotice(errorNotice, `Call could not connect: ${error.message}`);
    if (stageHost?.querySelector("#call-stage")) {
      const failedStage = stageHost.querySelector("#call-stage");
      failedStage.innerHTML = `<div class="notice" role="alert">Call not connected. Check microphone/camera permission, network access and LiveKit configuration. No media was sent through GameHub messaging.</div><button class="button secondary compact" data-dismiss-call-error>Dismiss</button>`;
      failedStage.querySelector("[data-dismiss-call-error]").addEventListener("click", () => { stageHost.innerHTML = ""; });
    }
    const cleanupAction = ["voice_room", "group_voice"].includes(failedCallType) ? "leave" : "end";
    const { error: cleanupError } = await supabase.rpc("respond_to_call", { requested_call_id: callId, requested_action: cleanupAction });
    if (cleanupError) console.error("Could not clean up failed call:", cleanupError.message);
  }
}

function renderCallStage(room) {
  const stageHost = document.querySelector("#global-call-stage-host");
  if (!stageHost) return;
  let stage = stageHost.querySelector("#call-stage");
  if (!stage) {
    stageHost.innerHTML = `<section id="call-stage" class="call-stage"></section>`;
    stage = stageHost.querySelector("#call-stage");
  }
  stage.innerHTML = `<div class="call-stage-heading"><div><p class="eyebrow">LIVEKIT WEBRTC</p><h2>Call</h2><p id="call-connection-state" class="muted">Connecting…</p></div><div class="card-actions"><button class="button secondary compact" data-action="reconnect-call">Reconnect</button><button class="button danger compact" data-action="hangup-call">${activeCallType === "voice_room" ? "Leave room" : activeCallType === "group_voice" ? "Leave group call" : "End call"}</button></div></div><div id="call-participants" class="call-participants"></div><div class="call-controls"><button class="button secondary compact" data-action="toggle-microphone">Mute microphone</button>${["group_voice", "voice_room"].includes(activeCallType) ? "" : `<button class="button secondary compact" data-action="toggle-camera">${activeCallVideo ? "Turn camera off" : "Turn camera on"}</button>`}</div><div id="call-media-error" class="notice" role="alert" hidden></div>`;
  stage.querySelector('[data-action="hangup-call"]').addEventListener("click", async () => {
    const action = ["voice_room", "group_voice"].includes(activeCallType) ? "leave" : "end";
    const { error } = await supabase.rpc("respond_to_call", { requested_call_id: activeCallId, requested_action: action });
    if (error) return setNotice(stage.querySelector("#call-media-error"), `Could not end the call: ${error.message}`);
    await disconnectActiveCall();
    if (document.querySelector("#call-list")) await refreshCallLists(document.querySelector("#page-content"));
  });
  stage.querySelector('[data-action="reconnect-call"]').addEventListener("click", async () => {
    const status = stage.querySelector("#call-connection-state");
    const reconnect = stage.querySelector('[data-action="reconnect-call"]');
    reconnect.disabled = true;
    status.textContent = "Refreshing secure connection…";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again before reconnecting.");
      const response = await fetch("/api/calls/token", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ callId: activeCallId }),
      });
      const tokenResult = await response.json();
      if (!response.ok) throw new Error(tokenResult.error || "Could not refresh the call token.");
      if (tokenResult.serverUrl !== liveKitServerUrl) throw new Error("The configured LiveKit server URL does not match this deployment.");
      await room.disconnect();
      await room.connect(tokenResult.serverUrl, tokenResult.token);
      await room.localParticipant.setMicrophoneEnabled(activeCallMicrophoneEnabled);
      if (activeCallVideo) await room.localParticipant.setCameraEnabled(true);
      setNotice(stage.querySelector("#call-media-error"), "");
      status.textContent = room.remoteParticipants.size
        ? `Connected · ${room.remoteParticipants.size} other participant${room.remoteParticipants.size === 1 ? "" : "s"}`
        : "Connected to media server · waiting for participants";
    } catch (error) {
      status.textContent = "Reconnect failed";
      setNotice(stage.querySelector("#call-media-error"), error.message);
    } finally {
      reconnect.disabled = false;
    }
  });
  stage.querySelector('[data-action="toggle-microphone"]').addEventListener("click", async (event) => {
    try {
      const enabled = !room.localParticipant.isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(enabled);
      activeCallMicrophoneEnabled = enabled;
      event.currentTarget.textContent = enabled ? "Mute microphone" : "Unmute microphone";
    } catch (error) {
      setNotice(stage.querySelector("#call-media-error"), `Microphone could not be changed: ${error.message}`);
    }
  });
  stage.querySelector('[data-action="toggle-camera"]').addEventListener("click", async (event) => {
    try {
      activeCallVideo = !room.localParticipant.isCameraEnabled;
      await room.localParticipant.setCameraEnabled(activeCallVideo);
      event.currentTarget.textContent = activeCallVideo ? "Turn camera off" : "Turn camera on";
      renderCallParticipants(room);
    } catch (error) {
      activeCallVideo = false;
      setNotice(stage.querySelector("#call-media-error"), `Camera could not be enabled: ${error.message}`);
    }
  });
  renderCallParticipants(room);
}

function renderCallParticipants(room) {
  const container = document.querySelector("#call-participants");
  if (!container || !activeLiveKitTrack) return;
  const { Source } = activeLiveKitTrack;
  const connectionState = document.querySelector("#call-connection-state");
  if (connectionState && room.state === "connected") {
    const otherCount = room.remoteParticipants.size;
    connectionState.textContent = otherCount
      ? `Connected · ${otherCount} other participant${otherCount === 1 ? "" : "s"}`
      : "Connected to media server · waiting for participants";
  }
  const participants = [room.localParticipant, ...room.remoteParticipants.values()];
  for (const participant of participants.slice(1)) {
    participant.getTrackPublication?.(Source.Camera)?.track?.detach();
    participant.getTrackPublication?.(Source.Microphone)?.track?.detach();
  }
  container.innerHTML = participants.map((participant, index) => {
    const label = index === 0 ? `${currentProfile.display_name} (you)` : activeCallNames.get(participant.identity) || participant.name || "Player";
    const camera = participant.getTrackPublication?.(Source.Camera);
    return `<article class="call-participant"><div class="participant-video" data-participant="${escapeHtml(participant.identity)}">${camera?.track ? "" : `<span class="avatar">${escapeHtml(initials(label))}</span>`}</div><strong>${escapeHtml(label)}</strong><small>${participant.isMicrophoneEnabled ? "Microphone on" : "Microphone muted"}</small></article>`;
  }).join("");
  for (const participant of participants) {
    const publication = participant.getTrackPublication?.(Source.Camera);
    const video = container.querySelector(`[data-participant="${CSS.escape(participant.identity)}"]`);
    if (publication?.track && video) {
      const element = publication.track.attach();
      element.autoplay = true;
      element.playsInline = true;
      video.replaceChildren(element);
    }
    const audioPublication = participant.getTrackPublication?.(Source.Microphone);
    if (index > 0 && audioPublication?.track) {
      const audio = audioPublication.track.attach();
      audio.autoplay = true;
      audio.setAttribute("aria-label", `Audio from ${label}`);
      audio.className = "call-audio-output";
      container.append(audio);
    }
  }
}

async function disconnectActiveCall() {
  if (activeLiveKitRoom) await activeLiveKitRoom.disconnect();
  activeLiveKitRoom = null;
  activeCallId = null;
  activeCallType = null;
  activeCallMicrophoneEnabled = true;
  activeLiveKitTrack = null;
  activeCallNames.clear();
  activeCallVideo = false;
  const stageHost = document.querySelector("#global-call-stage-host");
  if (stageHost) stageHost.innerHTML = "";
}

async function renderNotifications(content) {
  content.innerHTML = `${pageHeader("UPDATES", "Notifications.", "Messages, follows, friend requests, team invites and tournament updates.")}<button class="button secondary compact" data-action="mark-all-read">Mark all as read</button><div id="notification-list" class="post-list"><div class="skeleton-card"></div></div>`;
  const list = content.querySelector("#notification-list");
  const { data, error } = await supabase.from("notifications").select("id, actor_id, kind, resource_id, read_at, created_at, profiles!notifications_actor_id_fkey(username, display_name)").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(50);
  if (error) return renderDataError(list, error, () => renderNotifications(content));
  if (!data.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">${icons.notifications}</span><h2>You’re all caught up</h2><p>New updates will appear here.</p></div>`;
    return;
  }
  list.innerHTML = data.map((notice) => `<article class="post-card ${notice.read_at ? "read-notice" : "unread-notice"}"><div class="post-head"><strong>${escapeHtml(notificationText(notice))}</strong><time>${escapeHtml(datePart(notice.created_at, { dateStyle: "medium", timeStyle: "short" }))}</time></div>${notice.kind === "friend_request" && notice.actor_id ? `<div class="card-actions"><button class="button primary compact" data-friend-response="${notice.resource_id}" data-accept="true">Accept request</button><button class="button secondary compact" data-friend-response="${notice.resource_id}" data-accept="false">Decline</button></div>` : notice.kind === "team_invitation" ? `<button class="button secondary compact" data-page="teams">View team invite</button>` : notice.kind === "call" ? `<button class="button secondary compact" data-page="calls">Open call</button>` : ""}<button class="text-button" data-mark-read="${notice.id}">${notice.read_at ? "Read" : "Mark as read"}</button></article>`).join("");
  list.querySelectorAll("[data-mark-read]").forEach((control) => control.addEventListener("click", async () => {
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", control.dataset.markRead).eq("user_id", currentUser.id);
    if (error) return renderDataError(list, error, () => renderNotifications(content));
    await renderNotifications(content);
  }));
  list.querySelectorAll("[data-friend-response]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.rpc("respond_to_friend_request", {
      requested_request_id: control.dataset.friendResponse,
      accept_request: control.dataset.accept === "true",
    });
    if (error) {
      control.disabled = false;
      return renderDataError(list, error, () => renderNotifications(content));
    }
    await renderNotifications(content);
  }));
  list.querySelectorAll('[data-page="teams"]').forEach((control) => control.addEventListener("click", () => { activePage = "teams"; renderPage(); }));
  list.querySelectorAll('[data-page="calls"]').forEach((control) => control.addEventListener("click", () => { activePage = "calls"; renderPage(); }));
  content.querySelector('[data-action="mark-all-read"]').addEventListener("click", async () => {
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", currentUser.id).is("read_at", null);
    if (error) return renderDataError(list, error, () => renderNotifications(content));
    await renderNotifications(content);
  });
  const channel = supabase.channel(`notifications-${currentUser.id}`).on("postgres_changes", {
    event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUser.id}`,
  }, () => renderNotifications(content)).subscribe();
  currentPageCleanup = () => supabase.removeChannel(channel);
}

function notificationText(notice) {
  const actor = notice.profiles?.display_name || notice.profiles?.username || "A player";
  return ({
    message: `${actor} sent you a message`,
    follow: `${actor} followed you`,
    friend_request: `${actor} sent you a friend request`,
    team_invitation: `${actor} invited you to a team`,
    community: `${actor} sent you a community update`,
    tournament: `${actor} registered for your tournament`,
    call: `${actor} is calling you`,
    moderation: "You have a moderation update",
  })[notice.kind] || "You have an update";
}

async function renderSettings(content) {
  content.innerHTML = `${pageHeader("YOUR ACCOUNT", "Settings.", "Control your privacy, messages and account data.")}<form id="settings-form" class="edit-card"><div id="settings-error" class="notice" role="alert" hidden></div><label for="message-privacy">Who can message you</label><select id="message-privacy"><option value="everyone">Everyone</option><option value="followers">People you follow</option><option value="nobody">Nobody</option></select><label for="call-privacy">Who can call you</label><select id="call-privacy"><option value="everyone">Everyone</option><option value="followers">People you follow</option><option value="nobody">Nobody</option></select><label for="timezone">Timezone</label><select id="timezone"><option value="Africa/Nairobi">East Africa Time (Nairobi)</option><option value="Africa/Kampala">East Africa Time (Kampala)</option><option value="Africa/Dar_es_Salaam">East Africa Time (Dar es Salaam)</option><option value="UTC">UTC</option></select><label class="check-label"><input id="in-app-notifications" type="checkbox" checked /><span>In-app notifications</span></label><label class="check-label"><input id="email-notifications" type="checkbox" /><span>Email notifications (requires configured mail delivery)</span></label><button class="button primary" type="submit">Save preferences</button></form><div class="edit-card"><h2>Favourite games</h2><form id="game-form" class="inline-form"><label class="sr-only" for="favorite-game">Add a game</label><input id="favorite-game" maxlength="100" placeholder="Game title" required /><select id="favorite-platform" aria-label="Platform"><option value="">Any platform</option><option value="pc">PC</option><option value="playstation">PlayStation</option><option value="xbox">Xbox</option><option value="mobile">Mobile</option><option value="other">Other</option></select><button class="button secondary" type="submit">Add</button></form><div id="settings-games" class="tag-row"></div></div><div class="edit-card"><h2>Your account data</h2><p class="muted">Download a JSON copy of the personal data associated with your account.</p><button class="button secondary" data-action="export-account">Download my data</button></div><div class="edit-card danger-card"><h2>Delete your account</h2><p class="muted">This permanently removes your profile and personal data. Financial records may be retained as required by law.</p><button class="button danger" data-action="delete-account">Request account deletion</button><div id="delete-error" class="notice" role="alert" hidden></div></div>`;
  const { data, error } = await supabase.from("user_preferences").select("*").eq("user_id", currentUser.id).maybeSingle();
  if (error) return setNotice(content.querySelector("#settings-error"), error.message);
  if (data) {
    content.querySelector("#message-privacy").value = data.message_privacy;
    content.querySelector("#call-privacy").value = data.call_privacy || "everyone";
    content.querySelector("#timezone").value = data.timezone;
    content.querySelector("#in-app-notifications").checked = data.in_app_notifications;
    content.querySelector("#email-notifications").checked = data.email_notifications;
  }
  content.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error: saveError } = await supabase.from("user_preferences").upsert({
      user_id: currentUser.id,
      message_privacy: content.querySelector("#message-privacy").value,
      call_privacy: content.querySelector("#call-privacy").value,
      timezone: content.querySelector("#timezone").value,
      in_app_notifications: content.querySelector("#in-app-notifications").checked,
      email_notifications: content.querySelector("#email-notifications").checked,
    });
    submit.disabled = false;
    setNotice(content.querySelector("#settings-error"), saveError ? saveError.message : "Preferences saved.", saveError ? "error" : "success");
  });
  const games = content.querySelector("#settings-games");
  await loadUserGames(games, currentUser.id, true);
  games.addEventListener("click", async (event) => {
    const tag = event.target.closest("[data-remove-game]");
    if (!tag) return;
    const { error: removeError } = await supabase.from("user_game_preferences").delete().eq("user_id", currentUser.id).eq("game", tag.dataset.removeGame);
    if (removeError) return renderDataError(games, removeError, () => loadUserGames(games, currentUser.id, true));
    await loadUserGames(games, currentUser.id, true);
  });
  content.querySelector("#game-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const game = content.querySelector("#favorite-game");
    const { error: addError } = await supabase.from("user_game_preferences").insert({
      user_id: currentUser.id,
      game: game.value.trim(),
      platform: content.querySelector("#favorite-platform").value || null,
    });
    if (addError) return setNotice(content.querySelector("#settings-error"), addError.message);
    game.value = "";
    await loadUserGames(games, currentUser.id, true);
  });
  content.querySelector('[data-action="export-account"]').addEventListener("click", async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    const { data: exportData, error: exportError } = await supabase.rpc("export_account_data");
    control.disabled = false;
    if (exportError) return setNotice(content.querySelector("#settings-error"), `Could not export your account data: ${exportError.message}`);
    const { data: callsData, error: callsError } = await supabase.rpc("export_voice_call_data");
    if (callsError) return setNotice(content.querySelector("#settings-error"), `Could not export your call history: ${callsError.message}`);
    exportData.voice_calls = callsData;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `gamehub-account-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setNotice(content.querySelector("#settings-error"), "Your account data download has started.", "success");
  });
  content.querySelector('[data-action="delete-account"]').addEventListener("click", async (event) => {
    if (!window.confirm("Delete your GameHub account and personal profile data? This cannot be undone.")) return;
    const control = event.currentTarget;
    control.disabled = true;
    if (activeCallId) {
      const action = ["voice_room", "group_voice"].includes(activeCallType) ? "leave" : "end";
      const { error: callError } = await supabase.rpc("respond_to_call", {
        requested_call_id: activeCallId,
        requested_action: action,
      });
      if (callError) {
        control.disabled = false;
        return setNotice(content.querySelector("#delete-error"), `Leave the active call before deleting your account: ${callError.message}`);
      }
      await disconnectActiveCall();
    }
    let response;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "X-GameHub-Confirm-Delete": "yes" },
      });
    } catch (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#delete-error"), `Deletion request failed: ${error.message}`);
    }
    const result = await response.json();
    if (!response.ok) {
      control.disabled = false;
      return setNotice(content.querySelector("#delete-error"), result.error || "Account deletion could not be completed.");
    }
    setNotice(content.querySelector("#delete-error"), "Your account and personal data have been deleted.", "success");
    await supabase.auth.signOut();
  });
}

async function renderMarketplace(content) {
  content.innerHTML = `${pageHeader("OPTIONAL EXTRAS", "Marketplace.", "Marketplace purchases are coming soon. No payment will be collected; community features remain free.")}<div id="credit-balance" class="notice success"></div><div id="market-products" class="community-grid"><div class="skeleton-card"></div></div><div class="section-heading"><div><p class="eyebrow">ORDERS</p><h2>Your purchases</h2></div></div><div id="order-history" class="post-list"></div>`;
  const [ledger, products, orders] = await Promise.all([
    supabase.from("credit_ledger_entries").select("amount").eq("user_id", currentUser.id),
    supabase.from("products").select("id, name, description, product_type, price_minor, currency_code, credit_amount").eq("active", true).order("created_at", { ascending: false }).limit(50),
    supabase.from("orders").select("id, status, total_minor, currency_code, created_at, order_items(products(name))").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(25),
  ]);
  if (ledger.error) return renderDataError(content.querySelector("#credit-balance"), ledger.error, () => renderMarketplace(content));
  if (products.error) return renderDataError(content.querySelector("#market-products"), products.error, () => renderMarketplace(content));
  if (orders.error) return renderDataError(content.querySelector("#order-history"), orders.error, () => renderMarketplace(content));
  const balance = (ledger.data || []).reduce((total, entry) => total + entry.amount, 0);
  content.querySelector("#credit-balance").textContent = `Credit balance: ${balance} GH credits`;
  const productContainer = content.querySelector("#market-products");
  productContainer.innerHTML = products.data.length ? products.data.map((product) => `<article class="community-card"><small>${escapeHtml(product.product_type.replace("_", " "))}</small><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p>${product.credit_amount ? `<span class="muted-small">${product.credit_amount} credits</span>` : ""}<div class="card-actions"><strong>${formatMoney(product.price_minor, product.currency_code)}</strong><button class="button secondary compact" type="button" disabled aria-disabled="true">Coming soon</button></div></article>`).join("") : `<div class="empty-state"><h2>No marketplace items yet</h2><p>The catalog will appear here when items are ready. Marketplace purchases are coming soon.</p></div>`;
  productContainer.querySelectorAll("[data-buy-product]").forEach((control) => control.addEventListener("click", async () => {
    if (!window.confirm("Continue to Paystack to complete this purchase?")) return;
    control.disabled = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ productId: control.dataset.buyProduct, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Payment could not be started.");
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      control.disabled = false;
      return renderDataError(productContainer, error, () => renderMarketplace(content));
    }
  }));
  content.querySelector("#order-history").innerHTML = orders.data.length ? orders.data.map((order) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(order.order_items?.[0]?.products?.name || "Digital order")}</strong><span class="status-tag">${escapeHtml(order.status)}</span></div><p>${escapeHtml(formatMoney(order.total_minor, order.currency_code))} · ${escapeHtml(datePart(order.created_at, { dateStyle: "medium" }))}</p></article>`).join("") : `<p class="muted-small">No purchases yet.</p>`;
}

function formatMoney(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

async function handlePaymentReturn() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("payment") !== "return") return;
  const reference = url.searchParams.get("reference");
  url.searchParams.delete("payment");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  const host = document.querySelector("#page-content");
  if (!host) return;
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.textContent = "Checking your payment with Paystack…";
  host.prepend(notice);
  if (!reference) {
    setNotice(notice, "Payment reference was not returned. Check your order history or contact support.");
    return;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/payments/verify?reference=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Payment status could not be verified.");
    if (result.status === "paid") {
      setNotice(notice, "Payment verified. Your purchase is now available in your account.", "success");
      return;
    }
    setNotice(notice, `Payment status: ${result.status}. Check your order history before trying again.`);
  } catch (error) {
    setNotice(notice, `We couldn't verify the payment yet: ${error.message}. Check your order history before trying again.`);
  }
}

async function renderAdmin(content) {
  if (!["admin", "moderator"].includes(currentProfile.platform_role)) {
    content.innerHTML = `<div class="empty-state"><h2>Restricted area</h2><p>Moderator permissions are required.</p></div>`;
    return;
  }
  content.innerHTML = `${pageHeader("PLATFORM OPERATIONS", "Moderation queue.", "Review reports and submissions. Every action is recorded.")}<div id="admin-error" class="notice" hidden></div><div class="section-heading"><div><p class="eyebrow">REPORTS</p><h2>Player reports</h2></div></div><div id="admin-reports" class="post-list"></div><div class="section-heading"><div><p class="eyebrow">STREAM REPORTS</p><h2>Reported streams</h2></div></div><div id="admin-stream-reports" class="post-list"></div><div class="section-heading"><div><p class="eyebrow">STREAMS</p><h2>Unverified streams</h2></div></div><div id="admin-streams" class="post-list"></div><div class="section-heading"><div><p class="eyebrow">TOURNAMENTS</p><h2>Prize claims</h2></div></div><div id="admin-prizes" class="post-list"></div><div class="section-heading"><div><p class="eyebrow">MARKETPLACE</p><h2>Products</h2></div></div><form id="product-form" class="edit-card"><div id="product-error" class="notice" hidden></div><label for="product-name">Name</label><input id="product-name" name="name" maxlength="120" required /><label for="product-description">Description</label><textarea id="product-description" name="description" maxlength="2000" rows="3"></textarea><label for="product-type">Product type</label><select id="product-type" name="product_type"><option value="cosmetic">One-time cosmetic</option><option value="credit_pack">Credits pack</option></select><label for="product-price">Price (KES)</label><input id="product-price" name="price" type="number" min="1" max="1000000" step="1" required /><div id="cosmetic-entitlement"><label for="entitlement-key">Entitlement key</label><input id="entitlement-key" name="entitlement_key" maxlength="120" /></div><div id="credit-amount-field" hidden><label for="credit-amount">Credits to grant after verified payment</label><input id="credit-amount" name="credit_amount" type="number" min="1" max="100000" /></div><label class="check-label"><input name="active" type="checkbox" /><span>Publish this product</span></label><button class="button primary" type="submit">Create product</button></form><div id="product-list" class="community-grid"></div>`;
  const [reports, streams, prizes, streamReports] = await Promise.all([
    supabase.from("reports").select("id, reporter_id, reported_user_id, resource_type, resource_id, reason, status, created_at").eq("status", "open").order("created_at", { ascending: true }).limit(50),
    supabase.from("streams").select("id, title, game, provider, url, user_id, created_at").eq("status", "unverified").order("created_at", { ascending: true }).limit(50),
    supabase.from("tournaments").select("id, name, prize_description, organizer_id").not("prize_description", "is", null).is("prize_verified_at", null).limit(50),
    supabase.from("stream_reports").select("id, stream_id, reporter_id, reason, created_at, streams(title, game, provider)").eq("status", "open").order("created_at", { ascending: true }).limit(50),
  ]);
  const failure = reports.error || streams.error || prizes.error || streamReports.error;
  if (failure) return setNotice(content.querySelector("#admin-error"), `Could not load moderation data: ${failure.message}`);
  const reportList = content.querySelector("#admin-reports");
  reportList.innerHTML = reports.data.length ? reports.data.map((report) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(report.resource_type)} report</strong><time>${escapeHtml(datePart(report.created_at, { dateStyle: "medium", timeStyle: "short" }))}</time></div><p>${escapeHtml(report.reason)}</p><small>Reference: ${escapeHtml(report.resource_id)}</small><div class="card-actions"><button class="button secondary compact" data-review-report="${report.id}" data-status="reviewed">Mark reviewed</button><button class="button danger compact" data-review-report="${report.id}" data-status="actioned">Take action</button><button class="button secondary compact" data-review-report="${report.id}" data-status="dismissed">Dismiss</button></div></article>`).join("") : `<p class="muted-small">No open reports.</p>`;
  reportList.querySelectorAll("[data-review-report]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const action = ({ reviewed: "review", actioned: "action", dismissed: "dismiss" })[control.dataset.status];
    const { error } = await supabase.rpc("moderate_report", {
      requested_report_id: control.dataset.reviewReport,
      requested_action: action,
    });
    if (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#admin-error"), error.message);
    }
    await renderAdmin(content);
  }));
  const streamReportList = content.querySelector("#admin-stream-reports");
  streamReportList.innerHTML = streamReports.data.length ? streamReports.data.map((report) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(report.streams?.title || "Stream report")}</strong><time>${escapeHtml(datePart(report.created_at, { dateStyle: "medium", timeStyle: "short" }))}</time></div><p>${escapeHtml(report.reason)}</p><small>${escapeHtml(report.streams?.game || "Unknown game")} · ${escapeHtml(report.streams?.provider || "Unknown provider")}</small><div class="card-actions"><button class="button secondary compact" data-stream-report="${report.id}" data-action="review">Mark reviewed</button><button class="button danger compact" data-stream-report="${report.id}" data-action="remove">Remove stream</button><button class="button secondary compact" data-stream-report="${report.id}" data-action="dismiss">Dismiss</button></div></article>`).join("") : `<p class="muted-small">No open stream reports.</p>`;
  streamReportList.querySelectorAll("[data-stream-report]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.rpc("moderate_stream_report", {
      requested_report_id: control.dataset.streamReport,
      requested_action: control.dataset.action,
    });
    if (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#admin-error"), error.message);
    }
    await renderAdmin(content);
  }));
  const streamList = content.querySelector("#admin-streams");
  streamList.innerHTML = streams.data.length ? streams.data.map((stream) => `<article class="post-card"><div class="post-head"><strong>${escapeHtml(stream.title)}</strong><span>${escapeHtml(stream.game)} · ${escapeHtml(stream.provider)}</span></div><a href="${escapeHtml(stream.url)}" target="_blank" rel="noopener noreferrer">Review external stream link</a><p class="muted-small">A manual review is not a live status check from the provider.</p><div class="card-actions"><button class="button primary compact" data-stream-review="${stream.id}" data-status="live">Confirm live (manual review)</button><button class="button secondary compact" data-stream-review="${stream.id}" data-status="offline">Mark offline</button><button class="button secondary compact" data-stream-review="${stream.id}" data-status="unavailable">Mark unavailable</button><button class="button danger compact" data-stream-review="${stream.id}" data-status="removed">Remove</button></div></article>`).join("") : `<p class="muted-small">No streams awaiting review.</p>`;
  streamList.querySelectorAll("[data-stream-review]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.from("streams").update({ status: control.dataset.status }).eq("id", control.dataset.streamReview);
    if (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#admin-error"), error.message);
    }
    await renderAdmin(content);
  }));
  const prizeList = content.querySelector("#admin-prizes");
  prizeList.innerHTML = prizes.data.length ? prizes.data.map((tournament) => `<article class="post-card"><strong>${escapeHtml(tournament.name)}</strong><p>${escapeHtml(tournament.prize_description)}</p><button class="button primary compact" data-verify-prize="${tournament.id}">Verify prize details</button></article>`).join("") : `<p class="muted-small">No tournament prize claims awaiting review.</p>`;
  prizeList.querySelectorAll("[data-verify-prize]").forEach((control) => control.addEventListener("click", async () => {
    control.disabled = true;
    const { error } = await supabase.from("tournaments").update({ prize_verified_at: new Date().toISOString() }).eq("id", control.dataset.verifyPrize);
    if (error) {
      control.disabled = false;
      return setNotice(content.querySelector("#admin-error"), error.message);
    }
    await renderAdmin(content);
  }));
  const productType = content.querySelector("#product-type");
  const updateProductFields = () => {
    const credits = productType.value === "credit_pack";
    content.querySelector("#credit-amount-field").hidden = !credits;
    content.querySelector("#cosmetic-entitlement").hidden = credits;
  };
  productType.addEventListener("change", updateProductFields);
  updateProductFields();
  content.querySelector("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const isCredit = form.get("product_type") === "credit_pack";
    const payload = {
      name: String(form.get("name")).trim(),
      description: String(form.get("description")).trim(),
      product_type: isCredit ? "credit_pack" : "cosmetic",
      price_minor: Number(form.get("price")) * 100,
      currency_code: "KES",
      credit_amount: isCredit ? Number(form.get("credit_amount")) : null,
      entitlement_key: isCredit ? null : String(form.get("entitlement_key")).trim(),
      active: form.get("active") === "on",
    };
    if (!Number.isSafeInteger(payload.price_minor) || (isCredit && !payload.credit_amount) || (!isCredit && !payload.entitlement_key)) {
      return setNotice(content.querySelector("#product-error"), "Enter a valid price and required product entitlement.");
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await supabase.from("products").insert(payload);
    submit.disabled = false;
    if (error) return setNotice(content.querySelector("#product-error"), error.message);
    setNotice(content.querySelector("#product-error"), "Product created.", "success");
    await loadAdminProducts(content.querySelector("#product-list"));
  });
  await loadAdminProducts(content.querySelector("#product-list"));
}

async function loadAdminProducts(container) {
  const { data, error } = await supabase.from("products").select("id, name, product_type, price_minor, currency_code, active").order("created_at", { ascending: false }).limit(50);
  if (error) return renderDataError(container, error, () => loadAdminProducts(container));
  container.innerHTML = data.length ? data.map((product) => `<article class="community-card"><small>${escapeHtml(product.product_type)}</small><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(formatMoney(product.price_minor, product.currency_code))}</p><label class="check-label"><input type="checkbox" data-product-active="${product.id}" ${product.active ? "checked" : ""} /><span>Visible to players</span></label></article>`).join("") : `<p class="muted-small">No products configured.</p>`;
  container.querySelectorAll("[data-product-active]").forEach((control) => control.addEventListener("change", async () => {
    control.disabled = true;
    const { error: updateError } = await supabase.from("products").update({ active: control.checked }).eq("id", control.dataset.productActive);
    if (updateError) {
      control.disabled = false;
      return renderDataError(container, updateError, () => loadAdminProducts(container));
    }
    control.disabled = false;
  }));
}
function renderDataError(container, error, retry) {
  console.error("GameHub data request failed:", error);
  container.innerHTML = `<div class="empty-state error-state"><h2>We couldn’t load this right now</h2><p>${escapeHtml(error.message || "Check your connection and try again.")}</p><button class="button secondary" type="button" data-action="retry">Try again</button></div>`;
  container.querySelector('[data-action="retry"]').addEventListener("click", retry);
}

function countryName(code) {
  return ({ KE: "Kenya", UG: "Uganda", TZ: "Tanzania", NG: "Nigeria", ZA: "South Africa", OTHER: "Other" })[code] || "Country not set";
}

function datePart(value, options) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, options).format(date);
}

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", currentUser.id).single();
  if (error) throw error;
  currentProfile = data;
}

async function showAuthenticatedApp() {
  renderLoading("Loading your profile");
  try {
    await loadProfile();
    if (!currentProfile.onboarding_completed_at || !currentProfile.username) {
      renderOnboarding();
      return;
    }
    const authReturnPage = sessionStorage.getItem("gamehub-auth-return");
    if (authReturnPage) {
      sessionStorage.removeItem("gamehub-auth-return");
      activePage = authReturnPage;
      renderPublicRoute();
      return;
    }
    const pathPage = publicPathPages[window.location.pathname.replace(/\/+$/, "") || "/"];
    if (pathPage && pathPage !== "home") {
      activePage = pathPage;
      renderPublicRoute();
      return;
    }
    renderApp();
    await handlePaymentReturn();
  } catch (error) {
    console.error("Could not load profile:", error);
    app.innerHTML = `<main class="loading-screen"><div class="notice error">We couldn't load your profile. ${escapeHtml(error.message)}</div><button class="button secondary" data-action="retry-profile">Try again</button></main>`;
    app.querySelector('[data-action="retry-profile"]').addEventListener("click", showAuthenticatedApp);
  }
}

async function signOut() {
  if (activeCallId) {
    const action = ["voice_room", "group_voice"].includes(activeCallType) ? "leave" : "end";
    let callError;
    try {
      ({ error: callError } = await supabase.rpc("respond_to_call", {
        requested_call_id: activeCallId,
        requested_action: action,
      }));
    } catch (error) {
      callError = error;
    }
    if (callError) {
      console.error("Could not clean up call before sign-out:", callError.message);
      announce("Call cleanup failed. You are signing out, but the call may remain active until it expires.");
    }
    await disconnectActiveCall();
  }
  for (const timer of missedCallTimers.values()) clearTimeout(timer);
  missedCallTimers.clear();
  stopGlobalCallAlerts();
  let result;
  try {
    result = await supabase.auth.signOut();
  } catch (error) {
    result = { error };
  }
  const { error } = result;
  if (error) {
    console.error("Sign out failed:", error);
    announce("We couldn't sign you out. Please try again.");
  }
}

window.addEventListener("hashchange", (event) => {
  const page = pageFromLocation();
  const previousHash = new URL(event.oldURL).hash.slice(1).split("?")[0];
  if (["sign-in", "register"].includes(page) && publicNavigation.some(([key]) => key === previousHash) === false && longPublicPages[previousHash]) {
    sessionStorage.setItem("gamehub-auth-return", previousHash);
  }
  if (currentUser && publicNavigation.some(([key]) => key === page)) {
    activePage = page;
    renderApp();
  } else {
    renderPublicRoute();
  }
});

function showGlobalStatus(message, type = "info") {
  let banner = document.querySelector("#global-status-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "global-status-banner";
    banner.setAttribute("role", "status");
    document.body.append(banner);
  }
  banner.className = `global-status-banner ${type}`;
  banner.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" aria-label="Dismiss message">Dismiss</button>`;
  banner.querySelector("button").addEventListener("click", () => banner.remove());
}

window.addEventListener("offline", () => showGlobalStatus("You are offline. Unsaved changes may not be saved; reconnect before retrying.", "error"));
window.addEventListener("online", () => {
  document.querySelector("#global-status-banner")?.remove();
  announce("Connection restored. Retry any request that did not complete; GameHub will not repeat payments or submissions automatically.");
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled application request failure:", event.reason?.name || "unknown error");
  showGlobalStatus("Something unexpected happened. Check the current screen before retrying; payments and submissions are not repeated automatically.", "error");
});

if (!isSupabaseConfigured) {
  renderPublicRoute();
} else {
  renderLoading();
  supabase.auth.getSession().then(({ data: { session }, error }) => {
    if (error) {
      app.innerHTML = `<main class="loading-screen"><div class="notice error">Authentication could not be restored: ${escapeHtml(error.message)}</div><button class="button secondary" data-action="reload">Retry</button></main>`;
      app.querySelector('[data-action="reload"]').addEventListener("click", () => window.location.reload());
      return;
    }
    currentUser = session?.user || null;
    if (currentUser) showAuthenticatedApp();
    else renderPublicRoute();
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const nextUser = session?.user || null;
    if (event === "PASSWORD_RECOVERY" && nextUser) {
      currentUser = nextUser;
      renderPasswordRecovery();
      return;
    }
    if (nextUser?.id !== currentUser?.id) {
      stopGlobalCallAlerts();
      if (!nextUser && activeCallId) void disconnectActiveCall();
      currentUser = nextUser;
      currentProfile = null;
      if (currentUser) showAuthenticatedApp();
      else renderPublicRoute();
    }

    function renderPasswordRecovery() {
      app.innerHTML = `<main class="onboarding-wrap"><section class="onboarding-card"><p class="eyebrow">ACCOUNT SECURITY</p><h1>Choose a new password.</h1><p class="muted">Use at least 8 characters for your new password.</p><div id="recovery-notice" class="notice" role="alert" hidden></div><form id="recovery-form"><label for="new-password">New password</label><input id="new-password" type="password" minlength="8" autocomplete="new-password" required /><label for="confirm-password">Confirm new password</label><input id="confirm-password" type="password" minlength="8" autocomplete="new-password" required /><button class="button primary full" type="submit">Update password</button></form></section></main>`;
      document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = document.querySelector("#new-password").value;
        const confirmation = document.querySelector("#confirm-password").value;
        const notice = document.querySelector("#recovery-notice");
        if (password !== confirmation) {
          setNotice(notice, "The passwords don’t match.");
          return;
        }
        const submit = event.currentTarget.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = "Updating password…";
        let result;
        try {
          result = await supabase.auth.updateUser({ password });
        } catch (error) {
          result = { error };
        }
        if (result.error) {
          submit.disabled = false;
          submit.textContent = "Update password";
          setNotice(notice, authErrorMessage(result.error));
          return;
        }
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error("Password updated, but sign-out failed:", error);
          setNotice(notice, "Your password was updated, but we couldn't sign you out. Please sign out manually.", "success");
          return;
        }
        announce("Password updated. Sign in with your new password.");
      });
    }
  });
  app.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "google") {
      const button = event.target.closest("button");
      button.disabled = true;
      button.textContent = "Connecting to Google…";
      let result;
      try {
        result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
      } catch (error) {
        result = { error };
      }
      const { error } = result;
      if (error) {
        button.disabled = false;
        button.textContent = "Continue with Google";
        setNotice(document.querySelector("#auth-notice"), authErrorMessage(error));
      }
    } else if (action === "toggle-auth") {
      isSignUp = !isSignUp;
      renderAuth();
      document.querySelector("#auth-title").textContent = isSignUp ? "Start your free account." : "Your people are here.";
      document.querySelector("#auth-subtitle").textContent = isSignUp ? "Join the community. No payment details needed." : "Sign in or create your free account to get started.";
      document.querySelector("#auth-submit").textContent = isSignUp ? "Create account" : "Continue with email";
      document.querySelector('[data-action="toggle-auth"]').textContent = isSignUp ? "Already a member? Sign in" : "New here? Create account";
      document.querySelector("#password").autocomplete = isSignUp ? "new-password" : "current-password";
    } else if (action === "reset-password") {
      const email = document.querySelector("#email").value.trim();
      if (!email) {
        setNotice(document.querySelector("#auth-notice"), "Enter your email address above, then choose Forgot password.");
        document.querySelector("#email").focus();
        return;
      }
      let result;
      try {
        result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
      } catch (error) {
        result = { error };
      }
      const { error } = result;
      setNotice(document.querySelector("#auth-notice"), error ? authErrorMessage(error) : "If an account exists for that email, a password reset link is on its way.", error ? "error" : "success");
    }
  });
}
