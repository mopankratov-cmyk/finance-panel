import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");
const qaGates = readFileSync("lib/factory/qaGates.ts", "utf8");

ok(!/jpost\(origin, "\/api\/factory\/video-critic"/.test(source), "graph-run does not call video-critic route-to-route during OTK");
ok(/runVideoCritic\(\{[\s\S]*scenario: plan\.nodes/.test(source), "graph-run passes storyboard context to in-process critic");
ok(/if \(missingFrames\) \{[\s\S]*score рассчитан по \$\{basis \|\| "storyboard"\} fallback[\s\S]*сохраняем ролик без оценки/.test(source), "empty-frame OTK distinguishes fallback-scored runs from no-score runs");
ok(/!frames\.length && !hook && !scenarioText/.test(qaGates), "in-process critic only hard-fails empty-frame requests with no storyboard signal at all");
ok(/basis: "fallback"/.test(qaGates), "critic fallback basis is explicit and cannot masquerade as frame-grounded model pass");

console.log("otkStoryboardFallback: passed");
