import test from "node:test";
import assert from "node:assert/strict";
import { getAuthRedirectUrl, getPublicSiteUrl } from "./site-url.js";

test("share links use the configured canonical HTTPS site", () => {
  assert.equal(getPublicSiteUrl("https://drivenwave.site/"), "https://drivenwave.site");
  assert.equal(getPublicSiteUrl(), "https://drivenwave.site");
});

test("authentication callbacks use localhost only during local development", () => {
  assert.equal(
    getAuthRedirectUrl({ hostname: "localhost", origin: "http://localhost:5173" }, "https://drivenwave.site", "oauth"),
    "http://localhost:5173/?auth=callback&flow=oauth",
  );
  assert.equal(
    getAuthRedirectUrl({ hostname: "drivenwave.site", origin: "https://drivenwave.site" }, undefined, "recovery"),
    "https://drivenwave.site/?auth=callback&flow=recovery",
  );
});

test("invalid non-HTTPS canonical sites are rejected", () => {
  assert.throws(() => getPublicSiteUrl("http://example.com"), /must use HTTPS/);
});
