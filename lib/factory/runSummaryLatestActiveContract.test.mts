import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const observability = readFileSync("lib/factory/observability.ts", "utf8");

ok(/const active = last\?\.status === "running" \? last : null;/.test(observability), "buildRunSummary only marks the latest unfinished log entry as active");

console.log("runSummaryLatestActiveContract: passed");
