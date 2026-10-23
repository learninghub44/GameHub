const DEFAULT_SITE = "https://drivenwave.site";
const DEFAULT_TITLE = "DrivenWave — Gaming Community";
const DEFAULT_DESCRIPTION = "Find your people, games and next competition on DrivenWave.";
const PUBLIC_IMAGE = `${DEFAULT_SITE}/drivenwave-social.png`;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function safeDescription(value) {
  const safeValue = String(value || DEFAULT_DESCRIPTION)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return safeValue || DEFAULT_DESCRIPTION;
}

function routeLookup(pathname) {
  const profile = pathname.match(/^\/@([a-z0-9_]{3,24})\/?$/i);
  if (profile) return { table: "profiles", select: "username,display_name,bio,avatar_path", filters: { username: `eq.${profile[1].toLowerCase()}` } };
  const entity = pathname.match(/^\/(communities|teams|tournaments)\/[a-z0-9-]+-([a-f0-9]{12})\/?$/i);
  if (!entity) return null;
  if (entity[1] === "communities") {
    return { table: "communities", select: "name,description,game,share_code", filters: { share_code: `eq.${entity[2].toLowerCase()}`, visibility: "eq.public", status: "eq.active" } };
  }
  if (entity[1] === "teams") {
    return { table: "teams", select: "name,description,game,share_code", filters: { share_code: `eq.${entity[2].toLowerCase()}`, visibility: "eq.public" } };
  }
  return { table: "tournaments", select: "name,game,format,starts_at,prize_description,prize_verified_at,share_code", filters: { share_code: `eq.${entity[2].toLowerCase()}`, status: "neq.draft" } };
}

async function lookupPublicPage(env, route) {
  const projectUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!projectUrl || !anonKey) return null;
  const query = new URLSearchParams({ select: route.select, limit: "1" });
  for (const [key, value] of Object.entries(route.filters)) query.set(key, value);
  let response;
  try {
    response = await fetch(`${projectUrl.replace(/\/+$/, "")}/rest/v1/${route.table}?${query}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
    });
  } catch (error) {
    console.error("Public share metadata service is unavailable:", error?.name || "unknown error");
    return null;
  }
  if (!response.ok) {
    console.error("Public share metadata lookup failed:", route.table, response.status);
    return null;
  }
  const [record] = await response.json();
  if (!record) return null;
  const title = record.display_name
    ? `${record.display_name} (@${record.username})`
    : record.name || DEFAULT_TITLE;
  const game = record.game ? `${record.game} · ` : "";
  let description = route.table === "profiles"
    ? `${record.username}'s public gaming profile on DrivenWave.`
    : record.description || `${game}${record.format || "Gaming community"} on DrivenWave.`;
  if (route.table === "tournaments") {
    const start = record.starts_at ? new Date(record.starts_at).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" }) : "";
    const verifiedPrize = record.prize_verified_at && record.prize_description ? ` Verified prize: ${record.prize_description}.` : "";
    description = `${game}${record.format || "Esports"} tournament${start ? ` starts ${start}` : ""} on DrivenWave.${verifiedPrize}`;
  }
  const image = record.avatar_path
    ? `${projectUrl.replace(/\/+$/, "")}/storage/v1/object/public/gamehub-avatars/${record.avatar_path.split("/").map(encodeURIComponent).join("/")}`
    : PUBLIC_IMAGE;
  return { title: `${safeDescription(title)} · DrivenWave`, description: safeDescription(description), image };
}

function injectMetadata(html, pathname, metadata) {
  const canonical = `${DEFAULT_SITE}${pathname}`;
  const values = {
    description: metadata.description,
    title: metadata.title,
    canonical,
    image: metadata.image || PUBLIC_IMAGE,
  };
  const replacements = [
    [/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(values.title)}</title>`],
    [/<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeHtml(values.description)}" />`],
    [/<meta property="og:title" content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escapeHtml(values.title)}" />`],
    [/<meta property="og:description" content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${escapeHtml(values.description)}" />`],
    [/<meta property="og:url" content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${escapeHtml(values.canonical)}" />`],
    [/<meta property="og:image" content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${escapeHtml(values.image)}" />`],
    [/<meta name="twitter:title" content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${escapeHtml(values.title)}" />`],
    [/<meta name="twitter:description" content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${escapeHtml(values.description)}" />`],
    [/<meta name="twitter:image" content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${escapeHtml(values.image)}" />`],
    [/<link rel="canonical" href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escapeHtml(values.canonical)}" />`],
  ];
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), html);
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) return next();
  const route = routeLookup(url.pathname);
  if (!route) return next();
  const page = await lookupPublicPage(env, route);
  if (!page) return next();
  const response = await next();
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return response;
  const html = injectMetadata(await response.text(), url.pathname, page);
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=300, s-maxage=300");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export const __test = { injectMetadata, routeLookup };
