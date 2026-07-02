// Contract test for Product Twin automatic classification. Run: npx tsx lib/factory/productTwinClassification.test.mts
import { strict as assert } from "node:assert";
import { classifyProductTwin } from "./productTwinClassification";
import type { ProductTwin } from "./productTwin";

const twin: ProductTwin = {
  twinId: "pt_demo",
  article: "YYS0101",
  productName: "YOYO SPF50 sunscreen cream",
  category: "cosmetics",
  status: "ready",
  qualityScore: 0.91,
  canonicalAssetId: "pt_demo_shadow_bg",
  sourceKind: "disk",
  sourcePath: "/demo/source.png",
  promptLibrary: {
    preserve_identity: "",
    negative_identity: "",
    clean_source: "",
    broll_motion: [],
    hero_shot: [],
    marketplace_card: [],
    ugc_scene: [],
  },
  createdAt: "2026-06-30T00:00:00.000Z",
  assets: [
    {
      assetId: "pt_demo_shadow_bg",
      twinId: "pt_demo",
      article: "YYS0101",
      kind: "shadow_bg",
      url: "https://example.com/shadow.png",
      truthLevel: "derived",
      qualityScore: 0.91,
      risk: "low",
      heroReady: true,
      brollReady: true,
      ugcReady: true,
      marketplaceSafe: true,
      adsSafe: true,
      qualityDetails: { dominant_color: "white", object_coverage: 0.44 },
    },
    {
      assetId: "pt_demo_clean_png",
      twinId: "pt_demo",
      article: "YYS0101",
      kind: "clean_png",
      url: "https://example.com/clean.png",
      truthLevel: "truthful",
      qualityScore: 0.68,
      risk: "medium",
      heroReady: false,
      brollReady: true,
      ugcReady: true,
      marketplaceSafe: true,
      adsSafe: true,
      qualityDetails: { reject_reasons: ["soft_edges"] },
    },
  ],
};

const classification = classifyProductTwin(twin);

assert.equal(classification.status, "ready");
assert.equal(classification.canonical.hero, "pt_demo_shadow_bg");
// broll предпочитает full-bleed clean_png карточному shadow_bg (см. pickBestTwinAsset)
assert.equal(classification.canonical.broll, "pt_demo_clean_png");
assert.equal(classification.summary.totalAssets, 2);
assert.equal(classification.summary.readyAssets, 1);
assert.equal(classification.summary.reviewAssets, 1);
assert.equal(classification.summary.brollReady, true);
assert.equal(classification.assets[0].type, "studio_shadow");
assert.equal(classification.assets[0].dominantColor, "white");
assert.equal(classification.assets[0].objectSize, "medium");
assert.equal(classification.assets[1].quality, "review");
assert.deepEqual(classification.assets[1].rejectReasons, ["soft_edges"]);

console.log("productTwinClassification: ok");
