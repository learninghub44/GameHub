import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./token.js";

const request = () => new Request("https://gamehub.example/api/calls/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ callId: "00000000-0000-4000-8000-000000000001" }),
});

test("call token endpoint reports missing LiveKit configuration without issuing a token", async () => {
  const response = await onRequestPost({ request: request(), env: {} });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test("call token endpoint rejects an insecure production LiveKit URL", async () => {
  const response = await onRequestPost({
    request: request(),
    env: {
      LIVEKIT_URL: "http://media.example",
      LIVEKIT_API_KEY: "development-key",
      LIVEKIT_API_SECRET: "development-secret",
    },
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /secure WebSockets/i);
});

test("call token endpoint requires an authenticated participant", async () => {
  const response = await onRequestPost({
    request: request(),
    env: {
      LIVEKIT_URL: "wss://media.example",
      LIVEKIT_API_KEY: "development-key",
      LIVEKIT_API_SECRET: "development-secret",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "development-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "development-service-role-key",
    },
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign in/i);
});

test("call token endpoint issues a scoped token only after the authorization RPC succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async (url, options = {}) => {
    observed.push({ url: String(url), authorization: options.headers?.Authorization });
    if (String(url).endsWith("/auth/v1/user")) {
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    }
    if (String(url).endsWith("/rest/v1/rpc/authorize_call_token")) {
      return Response.json([{ room_name: "gh-private-room", call_type: "voice" }]);
    }
    throw new Error("Unexpected external request");
  };
  try {
    const response = await onRequestPost({
      request: new Request("https://gamehub.example/api/calls/token", {
        method: "POST",
        headers: { Authorization: "Bearer user-access-token", "Content-Type": "application/json" },
        body: JSON.stringify({ callId: "00000000-0000-4000-8000-000000000001" }),
      }),
      env: {
        LIVEKIT_URL: "wss://media.example",
        LIVEKIT_API_KEY: "development-key",
        LIVEKIT_API_SECRET: "development-secret",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "development-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "development-service-role-key",
      },
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.serverUrl, "wss://media.example");
    assert.equal(result.callType, "voice");
    assert.equal(result.token.split(".").length, 3);
    assert.deepEqual(observed.map(({ authorization }) => authorization), [
      "Bearer user-access-token",
      "Bearer user-access-token",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
