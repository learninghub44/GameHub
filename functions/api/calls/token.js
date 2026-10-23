import { authenticatedUser, configuration, json, validUuid } from "../../_shared/api.js";
import { createLiveKitToken } from "../../_shared/livekit.js";

export async function onRequestPost({ request, env }) {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
    return json({ error: "Voice and video calls are not configured for this deployment." }, 503);
  }
  try {
    const mediaUrl = new URL(env.LIVEKIT_URL);
    if (mediaUrl.protocol !== "wss:" && !(mediaUrl.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(mediaUrl.hostname))) {
      return json({ error: "The configured LiveKit URL must use secure WebSockets." }, 503);
    }
  } catch {
    return json({ error: "The configured LiveKit URL is invalid." }, 503);
  }

  let user;
  try {
    user = await authenticatedUser(request, env);
  } catch {
    return json({ error: "Authentication service is temporarily unavailable." }, 503);
  }
  if (!user) return json({ error: "Sign in to join a call." }, 401);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid JSON request." }, 400);
  }
  if (!validUuid(input?.callId)) return json({ error: "A valid call identifier is required." }, 400);

  try {
    const { url, anon } = configuration(env);
    const authorization = request.headers.get("Authorization");
    const response = await fetch(`${url}/rest/v1/rpc/authorize_call_token`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requested_call_id: input.callId }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const message = result?.message || result?.error_description || "You are not allowed to join this call.";
      const status = response.status === 401 || response.status === 403 ? 403 : 400;
      return json({ error: message }, status);
    }
    const authorized = await response.json();
    const call = Array.isArray(authorized) ? authorized[0] : authorized;
    if (!call?.room_name || !call?.call_type) return json({ error: "This call is no longer available." }, 404);

    const token = await createLiveKitToken({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      identity: user.id,
      roomName: call.room_name,
    });
    return json({ token, serverUrl: env.LIVEKIT_URL, callType: call.call_type });
  } catch (error) {
    console.error("LiveKit token generation failed:", error.message);
    return json({ error: "A secure call connection could not be prepared." }, 503);
  }
}
