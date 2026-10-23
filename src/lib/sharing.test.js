import test from "node:test";
import assert from "node:assert/strict";
import { whatsappShareUrl } from "./sharing.js";

test("WhatsApp share links use encoded message text and the actual public page URL", () => {
  const message = "Join our gaming community on DrivenWave!";
  const publicUrl = "https://drivenwave.site/teams/arena-squad-123456abcdef";
  const desktopUrl = new URL(whatsappShareUrl(message, publicUrl));
  assert.equal(desktopUrl.origin, "https://web.whatsapp.com");
  assert.equal(desktopUrl.pathname, "/send");
  assert.equal(desktopUrl.searchParams.get("text"), `${message}\n${publicUrl}`);

  const mobileUrl = new URL(whatsappShareUrl(message, publicUrl, true));
  assert.equal(mobileUrl.origin, "https://wa.me");
  assert.equal(mobileUrl.searchParams.get("text"), `${message}\n${publicUrl}`);
});
