import test from "node:test";
import assert from "node:assert/strict";
import { __test, onRequest } from "./[[path]].js";

test("public shared routes map to explicitly selected public-safe fields", () => {
  assert.deepEqual(__test.routeLookup("/@player_one"), {
    table: "profiles",
    select: "username,display_name,bio,avatar_path",
    filters: { username: "eq.player_one" },
  });
  assert.equal(__test.routeLookup("/teams/squad-abcdef123456").table, "teams");
  assert.deepEqual(__test.routeLookup("/tournaments/finals-abcdef123456").filters, {
    share_code: "eq.abcdef123456",
    status: "neq.draft",
  });
  assert.equal(__test.routeLookup("/teams/squad-not-a-share-code"), null);
});

test("social metadata replaces page-specific title, description and canonical URL safely", () => {
  const html = [
    "<title>DrivenWave</title>",
    '<meta name="description" content="Default" />',
    '<meta property="og:title" content="Default" />',
    '<meta property="og:description" content="Default" />',
    '<meta property="og:url" content="https://drivenwave.site/" />',
    '<meta property="og:image" content="https://drivenwave.site/drivenwave-social.png" />',
    '<meta name="twitter:title" content="Default" />',
    '<meta name="twitter:description" content="Default" />',
    '<meta name="twitter:image" content="https://drivenwave.site/drivenwave-social.png" />',
    '<link rel="canonical" href="https://drivenwave.site/" />',
  ].join("");
  const updated = __test.injectMetadata(html, "/@player_one", {
    title: "Player <one> · DrivenWave",
    description: "A public profile & gaming page",
    image: "https://project.supabase.co/avatar.png",
  });

  assert.match(updated, /Player &lt;one&gt; · DrivenWave/);
  assert.match(updated, /A public profile &amp; gaming page/);
  assert.match(updated, /og:url" content="https:\/\/drivenwave\.site\/@player_one"/);
  assert.match(updated, /og:image" content="https:\/\/project\.supabase\.co\/avatar\.png"/);
  assert.doesNotMatch(updated, /service.role|private.email/i);
});

test("social crawler requests receive public page metadata without changing browser assets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    assert.match(String(input), /rest\/v1\/teams/);
    assert.match(String(input), /visibility=eq\.public/);
    assert.match(options.headers.Authorization, /^Bearer /);
    return new Response(JSON.stringify([{ name: "Open Squad", game: "Arena", description: "Join the team" }]), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await onRequest({
      request: new Request("https://drivenwave.site/teams/open-squad-abcdef123456"),
      env: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" },
      next: async () => new Response("<title>DrivenWave</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });
    assert.match(await response.text(), /Open Squad · DrivenWave/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=300");

    const assetNext = async () => new Response("asset", {
      headers: { "content-type": "text/javascript" },
    });
    const assetResponse = await onRequest({
      request: new Request("https://drivenwave.site/teams/open-squad-abcdef123456"),
      env: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" },
      next: assetNext,
    });
    assert.equal(await assetResponse.text(), "asset");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
