import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const falVideo = readFileSync("lib/factory/falVideo.ts", "utf8");

ok(/if \(res\.status === 404 \|\| res\.status === 409 \|\| res\.status === 422\)/.test(falVideo), "falVideoStatus treats transient result 404/409/422 as in_progress");
ok(/return \{ status: "in_progress", error: detail \? `fal result \$\{res\.status\}: \$\{detail\}` : `fal result \$\{res\.status\}` \};/.test(falVideo), "falVideoStatus preserves transient result detail while continuing to poll");

console.log("falStatusTransient422Contract: passed");
