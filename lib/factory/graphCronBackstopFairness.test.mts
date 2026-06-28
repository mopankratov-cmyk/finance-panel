import { readFileSync } from "node:fs";

const watchdog = readFileSync("lib/factory/graphWatchdog.ts", "utf8");
const cron = readFileSync("app/api/factory/graph-run/cron/route.ts", "utf8");

let passed = 0;
let failed = 0;

function ok(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("FAIL", message);
  }
}

ok(/const CRON_MAX_WAKE = 5;/.test(cron), "cron wakes more than one stale recipe per pass");
ok(/maxWake: CRON_MAX_WAKE/.test(cron), "cron route forwards shared maxWake constant");
ok(/const prevTs = prev\.updated_at \? new Date\(prev\.updated_at\)\.getTime\(\) : Number\.POSITIVE_INFINITY;/.test(watchdog), "watchdog keeps the oldest timestamp per recipe while deduping");
ok(/\.sort\(\(a, b\) => \{[\s\S]*const stepA = String\(a\.run_plan\?\.step \|\| \"\"\);[\s\S]*const stepB = String\(b\.run_plan\?\.step \|\| \"\"\);[\s\S]*return bTs - aTs;[\s\S]*\}\)/.test(watchdog), "watchdog sorts wake candidates toward fresher running work before slicing");
ok(/\.slice\(0, maxWake\)/.test(watchdog), "watchdog still respects wake cap after fairness sort");

if (failed) process.exit(1);
console.log(`graphCronBackstopFairness: ${passed} passed, ${failed} failed`);
