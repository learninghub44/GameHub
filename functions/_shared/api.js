export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function configuration(env) {
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new Error("Server integration is not configured.");
  return { url: url.replace(/\/$/, ""), anon, service };
}

export async function authenticatedUser(request, env) {
  const { url, anon } = configuration(env);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: authorization },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function serviceFetch(env, pathname, options = {}) {
  const { url, service } = configuration(env);
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The database service returned an invalid response.");
    }
  }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint;
    throw new Error(message || `Database request failed with status ${response.status}.`);
  }
  return data;
}

export function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
