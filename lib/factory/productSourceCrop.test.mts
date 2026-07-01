// Product source focus crop. Run: npx tsx lib/factory/productSourceCrop.test.mts
import sharp from "sharp";
import { strict as assert } from "node:assert";
import { focusProductSourceImage } from "./productSourceCrop";

const poster = await sharp({
  create: { width: 1600, height: 2000, channels: 4, background: "#f7f7f5" },
})
  .composite([
    { input: Buffer.from(`<svg width="1600" height="2000" xmlns="http://www.w3.org/2000/svg"><text x="60" y="220" font-size="80" fill="#111">PROMO TEXT</text><text x="1170" y="360" font-size="64" fill="#111">CLAIMS</text><rect x="650" y="420" width="300" height="980" rx="90" fill="#fff" stroke="#222" stroke-width="14"/><text x="700" y="900" font-size="96" fill="#e28a31">YOYO</text><text x="705" y="1040" font-size="72" fill="#111">SPF50</text></svg>`), top: 0, left: 0 },
  ])
  .png()
  .toBuffer();

const focused = await focusProductSourceImage({ buffer: poster, contentType: "image/png", category: "cosmetics", article: "YYS0101" });
assert.equal(focused.applied, true);
assert.equal(focused.contentType, "image/png");
assert.equal(focused.strategy, "cosmetics_center_label_focus_v1");
const meta = await sharp(focused.buffer).metadata();
assert.ok((meta.width || 0) >= 1000, "focused crop upscales central product zone");
assert.ok((meta.height || 0) >= 1400, "focused crop keeps vertical product composition");

const toy = await focusProductSourceImage({ buffer: poster, contentType: "image/png", category: "toy", article: "TT04102" });
assert.equal(toy.applied, false);
assert.equal(toy.buffer, poster);

console.log("productSourceCrop: passed");
