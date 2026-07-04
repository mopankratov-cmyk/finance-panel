import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const route = readFileSync("app/api/factory/reels-brain/health/route.ts", "utf8");
const reportHtml = readFileSync("app/inferno/vendor/reels-brain-report/route.ts", "utf8");
const portfolioHtml = readFileSync("app/inferno/vendor/reels-brain-portfolio/route.ts", "utf8");
const cron = readFileSync("app/api/factory/jobs/reels-brain-cron/route.ts", "utf8");
const bulk = readFileSync("app/api/factory/jobs/reels-brain-bulk-ingest/route.ts", "utf8");

ok(/\/api\/factory\/reels-brain\/progress/.test(route) && /\/api\/factory\/reels-brain\/providers/.test(route) && /\/api\/factory\/worker-state/.test(route), "health route aggregates progress, providers and worker-state");
ok(/primary_bottleneck/.test(route) && /source_intelligence/.test(route), "health route exposes bottleneck and source intelligence");
ok(/adaptiveCronProfile/.test(cron) && /adaptive_profile/.test(cron), "cron exposes adaptive intensity profile");
ok(/providerCapForLane/.test(bulk) && /preferredSourceProvider/.test(bulk), "bulk ingest uses preferred provider memory and adaptive provider caps");
ok(/Pipeline/.test(reportHtml) && /Backlog by platform/.test(reportHtml), "public niche report shows pipeline backlog");
ok(/Pipeline truth/.test(portfolioHtml) && /worker state/i.test(portfolioHtml), "portfolio report shows pipeline truth and worker state");

if (failed) process.exit(1);
console.log(`reelsBrainHealthContract: ${passed} passed, ${failed} failed`);
