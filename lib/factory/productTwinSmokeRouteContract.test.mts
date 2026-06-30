// Contract test for Product Twin internal smoke route.
// Run: npx tsx lib/factory/productTwinSmokeRouteContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/product-twin/smoke/route.ts", "utf8");
const buildRoute = readFileSync("app/api/factory/product-twin/build/route.ts", "utf8");
const builder = readFileSync("lib/factory/productTwinBuild.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "smoke route uses existing cron/session auth");
ok(/buildProductTwin/.test(route), "smoke route can run live Product Twin build");
ok(/getLatestProductTwinByArticle/.test(route), "smoke route checks DB by article");
ok(/getBestProductTwinAsset/.test(route), "smoke route checks broll_ready twin asset");
ok(/buildProductBrollPlan/.test(route), "smoke route produces b-roll dry run");
ok(/archiveFactoryVideosToYandex/.test(route), "smoke route includes Yandex archive report");
ok(/buildProductTwin/.test(buildRoute), "public build route delegates to shared builder");
ok(/resolveInputImage/.test(builder), "shared builder resolves source image");

console.log("productTwinSmokeRouteContract: passed");

