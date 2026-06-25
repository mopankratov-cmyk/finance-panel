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

const nodePreview = readFileSync("app/api/factory/node-preview/route.ts", "utf8");

ok(/if \(hit\?\.output_url\) \{[\s\S]*await logGeneration\(\{[\s\S]*reason: "cache_hit"[\s\S]*cached: true/.test(nodePreview), "node-preview cache hits are logged to generation_history");
ok(/source: "node_preview"/.test(nodePreview), "node-preview history rows keep source=node_preview");
ok(/await logGeneration\(\{ recipe_id: body\.recipe_id \?\? null[\s\S]*status: "generated", source: "node_preview" \}\);/.test(nodePreview), "instant node-preview done path logs generated history");
ok(/if \(s\.status === "done"\) \{[\s\S]*await logGeneration\(\{[\s\S]*source: "node_preview" \}\);/.test(nodePreview), "async node-preview done path logs generated history");

if (failed) process.exit(1);
console.log(`nodePreviewHistory: ${passed} passed, ${failed} failed`);
