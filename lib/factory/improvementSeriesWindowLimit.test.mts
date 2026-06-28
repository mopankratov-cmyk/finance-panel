import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/improvementLoop.ts", "utf8");

ok(/const queryLimit = seriesStartAt \? Math\.max\(targetRuns \* 4, 240\) : Math\.max\(targetRuns, 80\);/.test(source), "active series window uses a wider query limit before filtering");
ok(/\.limit\(queryLimit\)/.test(source), "improvement snapshot applies the widened query limit");
ok(/\.filter\(\(row\) => !seriesStartAt \|\| String\(runStartedAtFromPlan\(row\.run_plan\) \|\| row\.created_at \|\| ""\) >= seriesStartAt\)/.test(source), "series_after filtering remains based on run start time");

console.log("improvementSeriesWindowLimit contract ok");
