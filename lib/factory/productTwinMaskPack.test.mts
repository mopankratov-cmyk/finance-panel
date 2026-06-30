// Product Twin asset pack mask smoke. Run: npx tsx lib/factory/productTwinMaskPack.test.mts
import { strict as assert } from "node:assert";
import sharp from "sharp";
import { buildTwinImageVariants } from "./productTwinStore";

const product = await sharp({
  create: { width: 900, height: 900, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
})
  .composite([{
    input: Buffer.from(`<svg width="520" height="720" xmlns="http://www.w3.org/2000/svg">
      <rect x="140" y="70" width="240" height="580" rx="80" fill="#f8fafc" stroke="#111827" stroke-width="24"/>
      <rect x="190" y="300" width="140" height="180" rx="24" fill="#2dd4bf"/>
      <text x="203" y="408" font-size="58" font-family="Arial" fill="#0f172a">SPF</text>
    </svg>`),
    gravity: "center",
  }])
  .png()
  .toBuffer();

const variants = await buildTwinImageVariants({
  cleanBuffer: product,
  article: "YYS0101",
  twinId: "pt_mask_test",
  category: "cosmetics",
});

const kinds = variants.map((variant) => variant.kind);
assert.ok(kinds.includes("clean_png"));
assert.ok(kinds.includes("shadow_bg"));
assert.ok(kinds.includes("object_mask"));
assert.ok(kinds.includes("alpha"));
assert.ok(kinds.includes("depth_map"));
assert.ok(kinds.includes("segmentation"));

const mask = variants.find((variant) => variant.kind === "object_mask");
assert.ok(mask);
assert.equal(mask.contentType, "image/png");
assert.equal(typeof mask.metrics?.object_coverage, "number");
assert.ok(Number(mask.metrics?.object_coverage) > 0.05);
assert.ok(Number(mask.metrics?.object_coverage) < 0.75);
assert.equal(mask.quality.brollReady, false);
assert.equal(mask.quality.heroReady, false);

const alpha = variants.find((variant) => variant.kind === "alpha");
assert.ok(alpha);
assert.equal(typeof alpha.metrics?.alpha_coverage, "number");
assert.ok(Number(alpha.metrics?.alpha_coverage) > 0.05);
assert.equal(alpha.quality.brollReady, false);

const segmentation = variants.find((variant) => variant.kind === "segmentation");
assert.ok(segmentation);
assert.deepEqual(segmentation.metrics?.segments, ["background", "product"]);
assert.equal(segmentation.quality.heroReady, false);

const depth = variants.find((variant) => variant.kind === "depth_map");
assert.ok(depth);
assert.equal(depth.metrics?.depth_strategy, "mask_radial_v0");
assert.equal(depth.quality.brollReady, false);

console.log("productTwinMaskPack: ok");
