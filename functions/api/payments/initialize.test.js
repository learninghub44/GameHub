import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./initialize.js";

test("marketplace checkout is disabled unless explicitly enabled", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("Checkout must not call providers while disabled.");
  };
  try {
    const response = await onRequestPost({
      request: new Request("https://gamehub.example/api/payments/initialize", { method: "POST" }),
      env: {},
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Marketplace checkout is disabled for this deployment." });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
