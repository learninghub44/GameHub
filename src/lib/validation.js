export function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 24) {
    return "Choose a username between 3 and 24 characters.";
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return "Use only lowercase letters, numbers and underscores.";
  }
  if (/^(admin|administrator|gamehub|support|moderator|staff|system)$/.test(username)) {
    return "That username is reserved.";
  }
  return "";
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function streamDetails(value, parent = "") {
  const url = safeExternalUrl(value);
  if (!url) return null;

  const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "youtu.be"]);
  const twitchHosts = new Set(["twitch.tv", "www.twitch.tv"]);
  if (youtubeHosts.has(url.hostname)) {
    const path = url.pathname.split("/").filter(Boolean);
    const videoId = url.hostname === "youtu.be"
      ? path[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v")
        : ["live", "embed", "shorts"].includes(path[0])
          ? path[1]
          : null;
    const channel = path[0]?.startsWith("@") && path[1] === "live" ? path[0] : null;
    if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
      return { provider: "youtube", url, embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}` };
    }
    if (channel) return { provider: "youtube", url, embedUrl: null };
    return null;
  }

  if (twitchHosts.has(url.hostname)) {
    const path = url.pathname.split("/").filter(Boolean);
    const channel = path[0];
    const reservedRoutes = new Set(["directory", "downloads", "inventory", "jobs", "login", "p", "prime", "search", "settings", "subscriptions", "turbo", "videos", "wallet"]);
    if (path.length !== 1 || !channel || reservedRoutes.has(channel.toLowerCase()) || !/^[a-z0-9_]{4,25}$/i.test(channel)) return null;
    const embedUrl = parent
      ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}`
      : null;
    return { provider: "twitch", url, embedUrl };
  }

  return null;
}
