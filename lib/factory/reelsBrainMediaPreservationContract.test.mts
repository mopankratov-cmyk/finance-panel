import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const analyzeRoute = readFileSync("app/api/factory/reels-brain/analyze/route.ts", "utf8");
const backlogRoute = readFileSync("app/api/factory/jobs/reels-brain-analyze-backlog/route.ts", "utf8");

ok(analyzeRoute.includes("mergeAnalyzedFull"), "analyze route merges analyzed_full instead of replacing it");
ok(backlogRoute.includes("mergeAnalyzedFull"), "backlog cleanup merges analyzed_full instead of replacing it");
ok(analyzeRoute.includes("media_assets: root.media_assets"), "analyze route preserves media_assets");
ok(backlogRoute.includes("media_assets: root.media_assets"), "backlog route preserves media_assets");
ok(!analyzeRoute.includes("analyzed_full: resolvedAnalysis"), "analyze route must not overwrite analyzed_full with raw analysis");

console.log("reelsBrainMediaPreservationContract ok");
