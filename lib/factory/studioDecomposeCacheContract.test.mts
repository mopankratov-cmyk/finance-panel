import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const html = readFileSync("public/inferno/studio.html", "utf8");

ok(/decomposeCache:\{\}/.test(html), "studio state keeps a decompose cache");
ok(/const cached=S\.decomposeCache\[String\(v\.id\|\|\"\"\)\]; S\.decompose=cached\|\|null; S\.decomposeVideo=cached\?v:S\.decomposeVideo;/.test(html), "video selection restores cached decompose result");
ok(/if\(!S\.decompose && S\.selectedVideo && S\.decomposeCache\[String\(S\.selectedVideo\)\]\)/.test(html), "decompose screen restores cached state after rerender");
ok(/if\(!d\.error && d && d\.nodes\) S\.decomposeCache\[String\(v\.id\|\|\"\"\)\]=d;/.test(html), "successful decompose responses are cached by video id");

console.log("studioDecomposeCacheContract: passed");
