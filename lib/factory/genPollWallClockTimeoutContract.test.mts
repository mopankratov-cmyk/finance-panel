import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");
const types = readFileSync("lib/factory/graphTypes.ts", "utf8");

ok(/step_started_at\?: string \| null;/.test(types), "RunPlan can persist the current step start time");
ok(/const MAX_GEN_POLL_MS = MAX_POLLS \* POLL_WAIT_MS \+ 60_000;/.test(source), "gen-poll has a wall-clock timeout");
ok(/function firstStepStartedAt\(plan: RunPlan, step: string\): string \| null/.test(source), "gen-poll can recover start time from execution log");
ok(/function stepAgeMs\(plan: RunPlan, step: string/.test(source), "graph-run computes step age");
ok(/plan\.step = "gen-poll"; plan\.pollCount = 0; plan\.step_started_at = new Date\(\)\.toISOString\(\);/.test(source), "submit transition stamps gen-poll start");
ok(/if \(!plan\.step_started_at\) plan\.step_started_at = firstStepStartedAt\(plan, "gen-poll"\) \|\| new Date\(\)\.toISOString\(\);/.test(source), "existing gen-poll runs get a recovered start time");
ok(/const timedOutByWallClock = stepAgeMs\(plan, "gen-poll"\) >= MAX_GEN_POLL_MS;/.test(source), "gen-poll checks wall-clock timeout");
ok(/pending\.length && !timedOutByWallClock/.test(source), "timed-out gen-poll skips another paid/provider poll wait");
ok(/pollCount < MAX_POLLS && !timedOutByWallClock/.test(source), "wall-clock timeout can stop waiting even when pollCount is stale");
ok(/generation poll wall-clock timeout/.test(source), "timed-out submitted nodes get an explicit reason");
ok(/plan\.step = "assemble";\s*plan\.step_started_at = null;/.test(source), "leaving gen-poll clears step start time");

console.log("genPollWallClockTimeoutContract: passed");
