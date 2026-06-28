import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const falVideo = readFileSync("lib/factory/falVideo.ts", "utf8");
const overlayRoute = readFileSync("app/api/factory/overlay/route.ts", "utf8");
const hybridRoute = readFileSync("app/api/factory/hybrid-compose/route.ts", "utf8");
const subtitleRoute = readFileSync("app/api/factory/subtitle/route.ts", "utf8");

ok(/setTimeout\(r, 3000 \+ Math\.floor\(Math\.random\(\) \* 700\)\)/.test(falVideo), "fal compose polling uses jitter instead of hard 3s busy-poll");
ok(/if \(Date\.now\(\) >= deadline\) return \{ pending: true, responseUrl, error: "compose still processing" \};/.test(falVideo), "falCompose preserves responseUrl on timeout");
ok(/if \(Date\.now\(\) >= deadline\) return \{ pending: true, responseUrl, error: "timeline compose still processing" \};/.test(falVideo), "falTimeline preserves responseUrl on timeout");
ok(/if \(Date\.now\(\) >= deadline\) return \{ pending: true, responseUrl, error: `\$\{endpoint\.split\("\/"\)\.pop\(\) \|\| "queue"\} still processing` \};/.test(falVideo), "generic fal queue preserves responseUrl on timeout");
ok(/if \(r\.pending && r\.responseUrl\) \{[\s\S]*pending_url: r\.responseUrl[\s\S]*status: 202/.test(overlayRoute), "overlay route surfaces pending compose handles");
ok(/if \(r\.pending && r\.responseUrl\) \{[\s\S]*pending_url: r\.responseUrl[\s\S]*status: 202/.test(hybridRoute), "hybrid-compose route surfaces pending timeline handles");
ok(/if \(r\.pending && r\.responseUrl\) \{[\s\S]*pending_url: r\.responseUrl[\s\S]*status: 202/.test(subtitleRoute), "subtitle route surfaces pending subtitle handles");

console.log("falComposePendingContract: passed");
