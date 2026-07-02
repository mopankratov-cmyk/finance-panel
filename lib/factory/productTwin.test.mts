// Product Twin domain helpers. Run: npx tsx lib/factory/productTwin.test.mts
import {
  buildProductPromptLibrary,
  buildTwinId,
  createTwinAsset,
  normalizeTwinCategory,
  pickBestTwinAsset,
} from "./productTwin";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

ok(normalizeTwinCategory("cosmetics", "YYS0101", "YOYO SPF50 sunscreen") === "cosmetics", "category accepts explicit cosmetics");
ok(normalizeTwinCategory("", "TT04102", "green water blaster") === "toy", "category infers toy from product/article");
ok(normalizeTwinCategory("", "NV-08", "NV-08") === "apparel", "category infers apparel from NORVIA article");
ok(normalizeTwinCategory("", "CLR00716", "CLR00716") === "bag", "category infers bag from CLERIN article");
ok(/^pt_YYS0101_[a-f0-9]{12}$/.test(buildTwinId({ article: "YYS0101", source: "/x/1.png" })), "twin id is deterministic and readable");

const lib = buildProductPromptLibrary({ article: "TT04102", product: "green water blaster", category: "toy", cleanPrompt: "clean" });
ok(/Preserve the exact product identity/.test(lib.preserve_identity), "prompt library has identity preservation");
ok(lib.broll_motion.includes("water burst hook"), "toy prompt library includes toy motion");

const low = createTwinAsset({ twinId: "pt_x", article: "A", kind: "clean_png", url: "https://x/a.png", truthLevel: "truthful", qualityScore: 0.7, risk: "medium" });
const high = createTwinAsset({ twinId: "pt_x", article: "A", kind: "shadow_bg", url: "https://x/b.png", truthLevel: "derived", qualityScore: 0.9, risk: "low" });
// broll: карточный shadow_bg (паспарту/вшитая подпись) даёт «рамку-в-рамке» в i2v-видео,
// поэтому full-bleed clean_png выигрывает даже при более высоком quality/низком risk у карточки.
ok(pickBestTwinAsset([low, high], "broll")?.assetId === low.assetId, "broll prefers full-bleed clean_png over card-style shadow_bg");
ok(pickBestTwinAsset([low, high], "hero")?.assetId === high.assetId, "hero still prefers card-style shadow_bg");

const strictClean = createTwinAsset({ twinId: "pt_y", article: "A", kind: "clean_png", url: "https://x/c.png", truthLevel: "truthful", qualityScore: 0.62, brollReady: false });
const strictMask = createTwinAsset({ twinId: "pt_y", article: "A", kind: "object_mask", url: "https://x/m.png", truthLevel: "derived", qualityScore: 0.99, brollReady: false });
ok(pickBestTwinAsset([strictMask, strictClean], "broll")?.assetId === strictClean.assetId, "broll picker falls back to non-service clean asset when no asset is flagged ready");

console.log(`\nproductTwin: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
