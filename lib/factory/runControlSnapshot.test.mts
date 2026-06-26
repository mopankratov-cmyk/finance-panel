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

const runSnapshots = readFileSync("lib/factory/runSnapshots.ts", "utf8");
const observability = readFileSync("lib/factory/observability.ts", "utf8");

ok(/select\("id,article,niche,status,otk_score,output_url,created_at,run_plan"\)/.test(runSnapshots), "recent run snapshots include operator fields for production run control");
ok(/article\?: string \| null;/.test(observability), "RecentRunPoint exposes article");
ok(/output_url\?: string \| null;/.test(observability), "RecentRunPoint exposes output_url");
ok(/otk_score\?: number \| null;/.test(observability), "RecentRunPoint exposes otk_score");
ok(/article: raw\.article \? String\(raw\.article\) : null/.test(observability), "buildObservability maps article into recent runs");
ok(/output_url: raw\.output_url \? String\(raw\.output_url\) : null/.test(observability), "buildObservability maps output_url into recent runs");

if (failed) process.exit(1);
console.log(`runControlSnapshot: ${passed} passed, ${failed} failed`);
