import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/hybrid-compose/route.ts", "utf8");

ok(/function productAssetsFromBody/.test(route), "hybrid-compose reads structured product assets");
ok(/function isTrustedProductBroll/.test(route), "hybrid-compose validates product b-roll trust");
ok(/source === "canonical"/.test(route), "canonical product source is allowed");
ok(/source === "prepared"/.test(route), "prepared product source is allowed");
ok(/source === "product_lane"/.test(route), "product lane source is allowed");
ok(/analysis\.canonical === true/.test(route), "canonical analysis marker is allowed");
ok(/const unsafeAssets = productAssets\.filter/.test(route), "hybrid-compose computes unsafe assets");
ok(/hybrid-compose требует canonical\/prepared product b-roll/.test(route), "unsafe hybrid b-roll fails before paid compose");
ok(/Raw\/random disk source запрещён/.test(route), "operator error explains random disk source is blocked");
ok(/product_source_tier/.test(route), "legacy product_images can pass only with explicit source tier");
ok(/falTimeline/.test(route), "route still uses timeline compose after the guard");

console.log("hybridLaneGuardContract: passed");
