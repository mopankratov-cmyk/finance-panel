import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const studioRoute = readFileSync("app/api/factory/studio/route.ts", "utf8");
const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/\.filter\(\(n\) => n\.status === "error"\)/.test(studioRoute), "studio route only surfaces node_errors for actual error nodes");
ok(/if \(s\.status === "done" && s\.url\) \{ n\.status = "done"; n\.url = s\.url; n\.error = null; \}/.test(graphRun), "graph-run clears stale node error text after successful poll");

console.log("studioRunningErrorNoiseContract: passed");
