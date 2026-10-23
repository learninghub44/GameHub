import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import { canvasToPng, drawFlyer, FLYER_FORMATS, FLYER_TYPES } from "./flyers.js";

function createTestCanvas() {
  const context = {
    addColorStop() {},
    beginPath() {},
    arc() {},
    closePath() {},
    fill() {},
    fillRect() {},
    fillText() {},
    lineTo() {},
    measureText(text) { return { width: String(text).length * 8 }; },
    moveTo() {},
    roundRect() {},
    save() {},
    restore() {},
    stroke() {},
    createRadialGradient() { return this; },
  };
  return {
    getContext: () => context,
  };
}

test("all flyers render artwork at the required pixel dimensions", () => {
  assert.deepEqual(FLYER_FORMATS, {
    status: { label: "WhatsApp Status", width: 1080, height: 1920 },
    square: { label: "Square social post", width: 1080, height: 1080 },
    landscape: { label: "Landscape event flyer", width: 1920, height: 1080 },
  });
  assert.equal(Object.keys(FLYER_TYPES).length, 8);
  for (const [format, dimensions] of Object.entries(FLYER_FORMATS)) {
    const canvas = createTestCanvas();
    drawFlyer(canvas, {
      type: "event",
      format,
      theme: "neon",
      title: "Community game night",
      game: "Rocket League",
      description: "Join local players this weekend.",
      date: "Saturday",
      prize: "",
      cta: "JOIN THE GAME",
      username: "player_one",
      showUsername: true,
      showAvatar: false,
      showLink: true,
      shareUrl: "https://drivenwave.site/@player_one",
    });
    assert.equal(canvas.width, dimensions.width);
    assert.equal(canvas.height, dimensions.height);
  }
});

test("PNG export rejects a blank canvas and returns a PNG blob", async () => {
  await assert.rejects(canvasToPng({ width: 0, height: 0 }), /Generate a flyer preview/);
  const blob = await canvasToPng({
    width: 100,
    height: 100,
    toBlob(callback, type) { callback(new Blob(["png-data"], { type })); },
  });
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 8);
});

test("the social preview image is a valid 1200x630 PNG", () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/drivenwave-social.png");
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const imageData = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      imageData.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  assert.equal(zlib.inflateSync(Buffer.concat(imageData)).length, 630 * (1200 * 4 + 1));
});
