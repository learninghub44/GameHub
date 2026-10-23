const DEFAULT_PUBLIC_SITE_URL = "https://drivenwave.site";

export function getPublicSiteUrl(configuredUrl) {
  const parsed = new URL(configuredUrl || DEFAULT_PUBLIC_SITE_URL);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("The public site URL must use HTTPS.");
  }
  return parsed.origin;
}

export function getAuthRedirectUrl(location, configuredUrl, flow) {
  const localDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);
  const baseUrl = localDevelopment ? location.origin : getPublicSiteUrl(configuredUrl);
  const redirect = new URL("/", baseUrl);
  redirect.searchParams.set("auth", "callback");
  redirect.searchParams.set("flow", flow);
  return redirect.href;
}
