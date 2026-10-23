import test from "node:test";
import assert from "node:assert/strict";
import { classifyError, describeError } from "./errors.js";

test("missing and invalid API configuration is classified as an operator issue", () => {
  for (const error of [
    { code: "SERVICE_CONFIGURATION", status: 503 },
    { message: "Payments are not configured for this deployment.", status: 503 },
    { message: "Invalid API key", status: 401 },
    { message: "Missing required environment variable PAYSTACK_SECRET_KEY", status: 500 },
  ]) {
    assert.equal(classifyError(error), "configuration");
    assert.match(describeError(error).message, /not a problem with your account/i);
  }
});

test("user-correctable database validation errors are distinguished from service faults", () => {
  assert.equal(classifyError({ code: "23505" }), "input");
  assert.equal(classifyError({ code: "22023" }), "input");
  assert.equal(classifyError({ status: 422 }), "input");
});

test("provider, network and access errors remain distinct from input errors", () => {
  assert.equal(classifyError({ status: 502 }), "service");
  assert.equal(classifyError({ status: 429 }), "service");
  assert.equal(classifyError({ name: "TypeError", message: "Failed to fetch" }), "connection");
  assert.equal(classifyError({ name: "NotAllowedError", message: "Permission denied" }), "device");
  assert.equal(classifyError({ status: 403 }), "access");
});
