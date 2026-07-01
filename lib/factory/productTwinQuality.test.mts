// Product Twin image quality critic. Run: npx tsx lib/factory/productTwinQuality.test.mts
import sharp from "sharp";
import { assessProductTwinImage } from "./productTwinQuality";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

const crisp = await sharp({
  create: { width: 1600, height: 1600, channels: 4, background: { r: 248, g: 248, b: 246, alpha: 1 } },
})
  .composite([{ input: Buffer.from(`<svg width="900" height="900" xmlns="http://www.w3.org/2000/svg"><rect x="160" y="160" width="580" height="580" rx="70" fill="white" stroke="#222" stroke-width="22"/><text x="250" y="460" font-size="120" fill="#d97828">SPF50+</text></svg>`), gravity: "center" }])
  .png()
  .toBuffer();

const q = await assessProductTwinImage({ buffer: crisp, kind: "clean_png", category: "cosmetics" });
ok(q.qualityScore > 0.4, "critic scores crisp product image");
ok(q.exposureScore > 0.5, "critic computes exposure score");
ok(q.objectCoverage > 0.05, "critic estimates object coverage");
ok(q.labelDetailScore > 0.2, "critic estimates label/detail signal");
ok(q.backgroundCleanliness > 0.5, "critic estimates background cleanliness");
ok(Array.isArray(q.rejectReasons), "critic returns reject reasons");
ok(["low", "medium", "high"].includes(q.identityRisk), "critic returns identity risk");
ok(!q.rejectReasons.includes("cosmetics_label_detail_risk"), "critic does not flag crisp readable cosmetics label");

const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ffffff" } }).png().toBuffer();
const tq = await assessProductTwinImage({ buffer: tiny, kind: "clean_png", category: "cosmetics" });
ok(tq.rejectReasons.includes("low_resolution"), "critic rejects low resolution");

const blankBottle = await sharp({
  create: { width: 1600, height: 1600, channels: 4, background: { r: 248, g: 248, b: 246, alpha: 1 } },
})
  .composite([{ input: Buffer.from(`<svg width="900" height="900" xmlns="http://www.w3.org/2000/svg"><rect x="250" y="130" width="400" height="640" rx="80" fill="white"/></svg>`), gravity: "center" }])
  .png()
  .toBuffer();
const bq = await assessProductTwinImage({ buffer: blankBottle, kind: "clean_png", category: "cosmetics" });
ok(bq.rejectReasons.includes("cosmetics_label_detail_risk"), "critic flags over-simplified cosmetics pack");

console.log(`\nproductTwinQuality: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
