import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const observability = readFileSync("lib/factory/observability.ts", "utf8");

ok(/\[\.\.\.log\]\.reverse\(\)\.find\(\(e\) => e && e\.status === "running"\)/.test(observability), "buildRunSummary uses the latest running execution log entry");

console.log("runSummaryLatestActiveContract: passed");
