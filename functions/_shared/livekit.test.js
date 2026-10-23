import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createLiveKitToken } from "./livekit.js";

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

test("LiveKit tokens grant room-scoped publishing and expire after ten minutes", async () => {
  const nowSeconds = 1_800_000_000;
  const token = await createLiveKitToken({
    apiKey: "development-key",
    apiSecret: "development-secret-for-tests-only",
    identity: "user-123",
    roomName: "gh-room-123",
    nowSeconds,
  });
  const [header, payload, signature, extra] = token.split(".");
  assert.equal(extra, undefined);
  const claims = JSON.parse(decodeBase64Url(payload).toString("utf8"));
  assert.deepEqual(JSON.parse(decodeBase64Url(header).toString("utf8")), { alg: "HS256", typ: "JWT" });
  assert.equal(claims.iss, "development-key");
  assert.equal(claims.sub, "user-123");
  assert.equal(claims.exp, nowSeconds + 600);
  assert.equal(claims.video.room, "gh-room-123");
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);

  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from("development-secret-for-tests-only"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  assert.equal(
    await webcrypto.subtle.verify("HMAC", key, decodeBase64Url(signature), Buffer.from(`${header}.${payload}`)),
    true,
  );
});

test("LiveKit token generation rejects missing or incomplete authorization claims", async () => {
  await assert.rejects(
    createLiveKitToken({ apiKey: "key", apiSecret: "secret", identity: "user", roomName: "" }),
    /incomplete/i,
  );
});
