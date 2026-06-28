import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");
const criticRoute = readFileSync("app/api/factory/video-critic/route.ts", "utf8");

ok(/const v = await jpost\(origin, "\/api\/factory\/video-critic"/.test(source), "graph-run always asks video-critic during OTK");
ok(/\.\.\.\(frames\.length \? \{\} : \{ storyboard: true, scenario: plan\.nodes \}\)/.test(source), "empty-frame OTK uses storyboard fallback");
ok(/if \(missingFrames\) \{[\s\S]*score рассчитан по \$\{basis \|\| "storyboard"\} fallback[\s\S]*сохраняем ролик без оценки/.test(source), "empty-frame OTK distinguishes fallback-scored runs from no-score runs");
ok(/const storyboardFallback = body\.storyboard === true && !frames\.length && !!\(hook \|\| scenarioText\);/.test(criticRoute), "video-critic accepts storyboard fallback from hook OR scenario text");
ok(/Нет кадров и нет storyboard-сигнала/.test(criticRoute), "video-critic only hard-fails empty-frame requests with no storyboard signal at all");

console.log("otkStoryboardFallback: passed");
