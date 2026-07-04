import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }

const route = readFileSync("app/api/factory/reels-brain/progress/route.ts", "utf8");

ok(/throughput_24h/.test(route), "progress exposes 24h throughput");
ok(/media_backlog/.test(route) && /audio_backlog/.test(route) && /analyze_backlog/.test(route), "progress exposes pipeline backlogs");
ok(/generator_ready_patterns/.test(route) && /patterns/.test(route), "progress exposes pattern readiness");
ok(/eta_hours/.test(route) && /automation_eta_hours/.test(route), "progress exposes ETA fields");
ok(/direct_media_rate/.test(route) && /audio_extracted_rate/.test(route), "progress exposes conversion rates");
ok(/primary_bottleneck/.test(route) && /platform_watchlist/.test(route), "progress exposes bottleneck summary and platform watchlist");
ok(/incident_timeline/.test(route) && /run_timeline/.test(route) && /incidentHistory/.test(route), "progress exposes incident and run timeline");

if (fail) {
  console.error(`reelsBrainProgressContract: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`reelsBrainProgressContract: ${pass} passed, 0 failed`);
