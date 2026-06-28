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

const source = readFileSync("lib/factory/seriesReadinessSmoke.mjs", "utf8");

ok(/Factory 50-run series readiness smoke \(read-only\)/.test(source), "series readiness smoke is documented as read-only");
ok(/\/api\/factory\/series-readiness/.test(source), "series readiness smoke calls the readiness endpoint");
ok(/url\.searchParams\.set\("target_runs", String\(opts\.targetRuns\)\)/.test(source), "series readiness smoke forwards target runs");
ok(/url\.searchParams\.set\("batch_size", String\(opts\.batchSize\)\)/.test(source), "series readiness smoke forwards batch size");
ok(/seriesAfter: process\.env\.FACTORY_SERIES_AFTER/.test(source), "series readiness smoke reads active series window from env");
ok(/--series-after <iso>/.test(source), "series readiness smoke documents active series window flag");
ok(/url\.searchParams\.set\("series_after", opts\.seriesAfter\)/.test(source), "series readiness smoke forwards active series window");
ok(/series_start_at/.test(source), "series readiness smoke reports active series window");
ok(/DEFAULT_JSON_OUT = "docs\/factory-latest-series-readiness\.json"/.test(source), "series readiness smoke writes latest JSON artifact");
ok(/DEFAULT_MD_OUT = "docs\/factory-latest-series-readiness\.md"/.test(source), "series readiness smoke writes latest markdown artifact");
ok(/ready_to_launch_next/.test(source), "series readiness smoke reports launch readiness");
ok(/process\.exitCode = 1/.test(source), "series readiness smoke exits nonzero when endpoint is not ok");
ok(!/method: "POST"/.test(source), "series readiness smoke never posts or launches generation");

if (failed) process.exit(1);
console.log(`seriesReadinessSmokeContract: ${passed} passed, ${failed} failed`);
