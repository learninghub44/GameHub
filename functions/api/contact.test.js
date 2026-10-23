import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "./contact.js";

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "development-anon-key",
};

function request(body, headers = { "Content-Type": "application/json" }, method = "POST") {
  return new Request("https://gamehub.example/api/contact", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const validForm = {
  name: "Player",
  email: "player@example.com",
  category: "general",
  subject: "A question about GameHub",
  message: "I have a question about using the community features.",
};

test("contact endpoint requires POST and configured Supabase", async () => {
  const methodResponse = await onRequest({ request: request({}, {}, "GET"), env });
  assert.equal(methodResponse.status, 405);
  const configResponse = await onRequest({ request: request(validForm), env: {} });
  assert.equal(configResponse.status, 503);
  assert.equal((await configResponse.json()).error.code, "SERVICE_UNAVAILABLE");
});

test("contact endpoint validates content type, field lengths and bounded request size", async () => {
  const contentTypeResponse = await onRequest({
    request: request(validForm, { "Content-Type": "text/plain" }),
    env,
  });
  assert.equal(contentTypeResponse.status, 415);
  const missingContentType = await onRequest({ request: request(validForm, {}), env });
  assert.equal(missingContentType.status, 415);

  const malformedJson = await onRequest({
    request: new Request("https://gamehub.example/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
    env,
  });
  assert.equal(malformedJson.status, 400);

  const invalidResponse = await onRequest({ request: request({ ...validForm, email: "not-an-email" }), env });
  assert.equal(invalidResponse.status, 422);
  assert.equal((await invalidResponse.json()).error.code, "VALIDATION_ERROR");

  const oversized = new Request("https://gamehub.example/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "8001" },
    body: " ".repeat(8001),
  });
  const oversizedResponse = await onRequest({ request: oversized, env });
  assert.equal(oversizedResponse.status, 413);
  const streamedOversized = await onRequest({
    request: new Request("https://gamehub.example/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validForm, message: "x".repeat(8_100) }),
    }),
    env,
  });
  assert.equal(streamedOversized.status, 413);
});

test("contact endpoint stores validated submissions through the database RPC", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return Response.json("00000000-0000-4000-8000-000000000001");
  };
  try {
    const response = await onRequest({
      request: request(validForm, { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" }),
      env,
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.equal(result.data.reference, "00000000-0000-4000-8000-000000000001");
    assert.equal(captured.url, `${env.SUPABASE_URL}/rest/v1/rpc/submit_contact_request`);
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.apikey, env.SUPABASE_ANON_KEY);
    const rpcBody = JSON.parse(captured.options.body);
    assert.equal(rpcBody.requested_email, validForm.email);
    assert.match(rpcBody.requested_rate_key, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contact endpoint reports database rate limits without exposing provider errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "P0001", message: "internal database text" }, { status: 400 });
  try {
    const response = await onRequest({ request: request(validForm), env });
    const result = await response.json();
    assert.equal(response.status, 429);
    assert.equal(result.error.code, "RATE_LIMITED");
    assert.equal(JSON.stringify(result).includes("internal database text"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
