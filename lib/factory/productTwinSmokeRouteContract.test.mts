// Contract test for Product Twin internal smoke route.
// Run: npx tsx lib/factory/productTwinSmokeRouteContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/product-twin/smoke/route.ts", "utf8");
const buildRoute = readFileSync("app/api/factory/product-twin/build/route.ts", "utf8");
const builder = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const falImageEdit = readFileSync("lib/factory/falImageEdit.ts", "utf8");
const falVideo = readFileSync("lib/factory/falVideo.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "smoke route uses existing cron/session auth");
ok(/buildProductTwin/.test(route), "smoke route can run live Product Twin build");
ok(/getLatestProductTwinByArticle/.test(route), "smoke route checks DB by article");
ok(/getBestProductTwinAsset/.test(route), "smoke route checks broll_ready twin asset");
ok(/buildProductBrollPlan/.test(route), "smoke route produces b-roll dry run");
ok(/sp\.get\("submit"\) === "1"/.test(route), "smoke route requires explicit submit=1 for paid b-roll submit");
ok(/Math\.min\(submit \? 2 : 5/.test(route), "smoke route caps paid submit count lower than dry-run");
ok(/falVideoSubmitDetailed/.test(route), "smoke route can submit b-roll through Product Twin asset");
ok(/rehostImageForFal/.test(route), "smoke route rehosts selected twin asset before FAL submit");
ok(/status_route: "\/api\/factory\/video-fal-status\/\{task_id\}"/.test(route), "smoke route returns status route for archive-on-complete");
ok(/archiveFactoryVideosToYandex/.test(route), "smoke route includes Yandex archive report");
ok(/buildProductTwin/.test(buildRoute), "public build route delegates to shared builder");
ok(/resolveInputImage/.test(builder), "shared builder resolves source image");
ok(/process\.env\.FAL_KEY && !process\.env\.FAL_BILLING_KEY/.test(builder), "Product Twin builder accepts FAL_BILLING_KEY fallback in preview");
ok(/process\.env\.FAL_KEY \|\| process\.env\.FAL_BILLING_KEY/.test(falImageEdit), "FAL image edit accepts FAL_BILLING_KEY fallback");
ok(/process\.env\.FAL_KEY \|\| process\.env\.FAL_BILLING_KEY/.test(falVideo), "FAL video submit accepts FAL_BILLING_KEY fallback");

console.log("productTwinSmokeRouteContract: passed");
