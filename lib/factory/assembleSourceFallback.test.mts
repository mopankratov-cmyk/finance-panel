import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/function fallbackVisualNodes\(nodes: RunNode\[\]\): RunNode\[\]/.test(source), "graph-run can rescue visual nodes from source assets");
ok(/gen-poll source fallback rescued/.test(source), "gen-poll can route directly into source fallback assemble");
ok(/assemble source fallback rescued/.test(source), "assemble emits a warning when source fallback rescues the run");
ok(/nodeRenderableMediaType\(n\)/.test(source), "assemble infers image vs video media type");
ok(/shotstack недоступен, а source fallback дал только изображения/.test(source), "assemble explains why image-only fallback still needs a renderer");
ok(/type: nodeRenderableMediaType\(n\)/.test(source), "shotstack edit uses inferred media type for fallback assets");

console.log("assembleSourceFallback: passed");
