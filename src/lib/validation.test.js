import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsername, safeExternalUrl, streamDetails, validateUsername } from "./validation.js";

test("username validation normalizes case and surrounding whitespace", () => {
  assert.equal(normalizeUsername("  Player_1 "), "player_1");
  assert.equal(validateUsername("  Player_1 "), "");
});

test("username validation rejects invalid lengths, characters and reserved names", () => {
  assert.notEqual(validateUsername("ab"), "");
  assert.notEqual(validateUsername("a".repeat(25)), "");
  assert.notEqual(validateUsername("player name"), "");
  assert.notEqual(validateUsername("admin"), "");
});

test("external URLs must use HTTPS", () => {
  assert.equal(safeExternalUrl("http://example.com"), null);
  assert.equal(safeExternalUrl("not a url"), null);
  assert.equal(safeExternalUrl("https://example.com").hostname, "example.com");
});

test("stream URLs only allow supported YouTube and Twitch formats", () => {
  assert.equal(streamDetails("javascript:alert(1)"), null);
  assert.equal(streamDetails("https://youtube.com/watch?v=AbCdEf12345").provider, "youtube");
  assert.equal(streamDetails("https://youtu.be/AbCdEf12345").embedUrl, "https://www.youtube-nocookie.com/embed/AbCdEf12345");
  assert.equal(streamDetails("https://twitch.tv/example_player", "gamehub.example").embedUrl.includes("parent=gamehub.example"), true);
  assert.equal(streamDetails("https://twitch.tv/directory"), null);
});
