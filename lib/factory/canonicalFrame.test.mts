import { strictEqual } from "node:assert";
import sharp from "sharp";
import { CANONICAL_FRAME_HEIGHT, CANONICAL_FRAME_WIDTH, normalizeToOutputRes } from "./canonicalFrame";

const input = await sharp({
  create: {
    width: 1000,
    height: 600,
    channels: 4,
    background: { r: 240, g: 40, b: 80, alpha: 1 },
  },
}).png().toBuffer();

const out = await normalizeToOutputRes(input);
const meta = await sharp(out).metadata();

strictEqual(meta.width, CANONICAL_FRAME_WIDTH, "canonical frame width is 720");
strictEqual(meta.height, CANONICAL_FRAME_HEIGHT, "canonical frame height is 1280");
strictEqual(meta.format, "png", "canonical frame is persisted as png");

console.log("canonicalFrame: passed");
