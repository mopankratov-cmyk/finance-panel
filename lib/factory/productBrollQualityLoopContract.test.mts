// Contract test for Product b-roll quality loop. Run: npx tsx lib/factory/productBrollQualityLoopContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/productBrollLearning.ts", "utf8");
const route = readFileSync("app/api/factory/product-broll-loop/route.ts", "utf8");
const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");

ok(/assessProductBrollQuality/.test(helper), "learning helper has post-render b-roll quality gate");
ok(/category_too_complex/.test(helper) && /apparel/.test(helper) && /bag/.test(helper), "autonomous loop blocks apparel/bag generative b-roll");
ok(/artifact_detected/.test(helper) && /identity_drift/.test(helper), "quality gate rejects artifact and identity drift signals");

ok(/LoopAction = "plan" \| "submit_one" \| "judge" \| "mark_reject"/.test(route), "loop route supports plan, submit_one, judge and mark_reject actions");
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "loop route uses existing operator/session auth");
ok(/falVideoStatus/.test(route) && /extractFrames/.test(route) && /runArtifactCheck/.test(route), "judge polls FAL, extracts frames and runs artifact check");
ok(/archiveExternalMediaToYandex/.test(route) && /content_assets/.test(route), "judge archives and catalogs generated videos");
ok(/mark_reject/.test(route) && /identity_drift/.test(route), "loop can correct prior false-positive b-roll labels");
ok(/getBestProductTwinAsset/.test(route) && /assetQuality: view \? null : pickedAsset\?\.asset\.qualityScore/.test(route), "loop plan uses the same latest twin asset quality gate as paid submit");

ok(/selectedComplexCategory/.test(studio) && /manual only/.test(studio), "Studio disables autonomous paid submit for apparel/bag");
ok(/\/api\/factory\/product-broll-loop/.test(studio) && /Loop Plan/.test(studio) && /Judge Last/.test(studio), "Studio runs the simple-SKU loop through plan, submit, and judge controls");

console.log("productBrollQualityLoopContract: passed");
