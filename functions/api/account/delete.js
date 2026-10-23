import { authenticatedUser, configuration, json, serviceFetch } from "../../_shared/api.js";

function encodeObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("X-GameHub-Confirm-Delete") !== "yes") {
    return json({ error: "Explicit account deletion confirmation is required." }, 400);
  }
  let user;
  try {
    user = await authenticatedUser(request, env);
  } catch {
    return json({ error: "Authentication service is unavailable." }, 503);
  }
  if (!user) return json({ error: "Sign in again before deleting your account." }, 401);

  try {
    const { url, anon, service } = configuration(env);
    const prepared = await fetch(`${url}/rest/v1/rpc/prepare_account_deletion`, {
      method: "POST",
      headers: { apikey: anon, Authorization: request.headers.get("Authorization"), "Content-Type": "application/json" },
      body: "{}",
    });
    if (!prepared.ok) return json({ error: "Your deletion request could not be prepared. Please try again." }, 502);

    const listResponse = await fetch(`${url}/storage/v1/object/list/gamehub-avatars`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: user.id, limit: 100, offset: 0 }),
    });
    if (!listResponse.ok) return json({ error: "Your account data was prepared, but avatar cleanup failed. Retry account deletion." }, 502);
    const objects = await listResponse.json();
    for (const object of objects) {
      const path = `${user.id}/${object.name}`;
      const removed = await fetch(`${url}/storage/v1/object/gamehub-avatars/${encodeObjectPath(path)}`, {
        method: "DELETE",
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      });
      if (!removed.ok && removed.status !== 404) {
        return json({ error: "Your account data was prepared, but avatar cleanup failed. Retry account deletion." }, 502);
      }
    }

    const deleted = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    if (!deleted.ok) return json({ error: "Your account data was prepared, but final account removal failed. Retry deletion or contact support." }, 502);
    return json({ deleted: true });
  } catch (error) {
    console.error("Account deletion failed:", error.message);
    return json({ error: "Account deletion could not be completed. Please retry or contact support." }, 502);
  }
}
