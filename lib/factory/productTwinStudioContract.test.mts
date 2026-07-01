// Product Twin Studio contract. Run: npx tsx lib/factory/productTwinStudioContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");
const page = readFileSync("app/inferno/product-twins/page.tsx", "utf8");
const agent = readFileSync("app/agent/page.tsx", "utf8");

ok(/ProductTwinStudio/.test(page) && /connection\(\)/.test(page), "Product Twin Studio route is dynamic");
ok(/source_pack_readiness/.test(studio) && /sourcePackReadiness/.test(studio), "studio renders source-pack readiness");
ok(/\/api\/factory\/product-twin\/inventory/.test(studio), "studio loads product twin inventory");
ok(/\/api\/factory\/product-twin\/source-pack/.test(studio), "studio can apply source packs");
ok(/\/api\/factory\/product-twin\/batch-build/.test(studio), "studio can rebuild twins");
ok(/\/api\/factory\/product-twin\/by-article/.test(studio), "studio can load latest twin by article");
ok(/\/api\/factory\/product-broll-feedback/.test(studio), "studio can send b-roll QA feedback");
ok(/\/api\/factory\/product-broll-batch/.test(studio) && /Submit 1/.test(studio), "studio can run a guarded one-job b-roll experiment");
ok(/\/api\/factory\/product-broll-montage/.test(studio) && /Plan Montage/.test(studio) && /Render Montage/.test(studio), "studio exposes real-photo montage lane for complex categories");
ok(/source_gate/.test(studio) && /pickBrollView/.test(studio), "studio surfaces source gate and prefers derived b-roll views");
ok(/NV-08,NV-836,NV-816,NV-01,CLR00716/.test(studio), "studio includes apparel and bag default articles");
ok(/href="\/inferno\/product-twins"/.test(agent), "agent page links to Product Twin Studio");

console.log("productTwinStudioContract: passed");
