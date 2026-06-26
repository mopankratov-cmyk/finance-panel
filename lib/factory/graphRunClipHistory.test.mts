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

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/persistClips\(db: SupabaseClient, nodes: RunNode\[\], article: string, niche: string, recipeId\?: number\)/.test(graphRun), "persistClips accepts recipe id for lineage");
ok(/await logGeneration\(\{ recipe_id: recipeId \?\? null[\s\S]*reason: "clip_library_dedupe"/.test(graphRun), "clip durable dedupe hits are logged to generation_history");
ok(/await logGeneration\(\{ recipe_id: recipeId \?\? null[\s\S]*status: "artifact_fail"[\s\S]*reason: `clip fetch \$\{r\.status\}`/.test(graphRun), "clip fetch failures are logged as artifact_fail");
ok(/await logGeneration\(\{ recipe_id: recipeId \?\? null[\s\S]*status: "artifact_fail"[\s\S]*reason: "clip fetch empty"/.test(graphRun), "empty clip downloads are logged as artifact_fail");
ok(/await logGeneration\(\{ recipe_id: recipeId \?\? null[\s\S]*status: "artifact_fail"[\s\S]*reason: `clip upload: \$\{error\.message\}`/.test(graphRun), "clip upload failures are logged as artifact_fail");
ok(/await logGeneration\(\{ recipe_id: recipeId \?\? null[\s\S]*reason: "clip_library"/.test(graphRun), "clip durable successes are logged to generation_history");
ok(/await persistClips\(db, visualNodes, article, niche, id\)/.test(graphRun), "graph-run passes recipe id into clip persistence");
ok(/select\("disk,kind,url,duration_sec"\)/.test(graphRun) && /if \(b\.duration_sec && !n\.duration_sec\) n\.duration_sec = b\.duration_sec;/.test(graphRun), "auto-bound real clips preserve catalog duration in run nodes");

if (failed) process.exit(1);
console.log(`graphRunClipHistory: ${passed} passed, ${failed} failed`);
