import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const auth = readFileSync("lib/factory/reelsBrainJobAuth.ts", "utf8");
const reset = readFileSync("app/api/factory/reels-brain/reset/route.ts", "utf8");
const providerDebug = readFileSync("app/api/factory/reels-brain/provider-debug/route.ts", "utf8");

ok(!/if \(!secret\) return true/.test(auth), "job auth has no fail-open shortcut when CRON_SECRET is missing");
ok(/if \(!secret\) \{[\s\S]*?return false;[\s\S]*?\}/.test(auth), "job auth fails closed when CRON_SECRET is missing");
ok(/console\.error\(/.test(auth), "job auth loudly logs the missing CRON_SECRET misconfiguration");

ok(/isAuthorizedReelsBrainJobRequest/.test(reset), "reset route uses the shared job auth helper");
ok(!/function authOk/.test(reset), "reset route has no local authOk copy");
ok(/parseReelsBrainNiches/.test(reset), "reset route resolves the Reels Brain niche list");
ok(/\.delete\(\)\s*\.in\("niche", niches\)/.test(reset), "reset deletes viral_videos only for Reels Brain niches");
ok(!/\.neq\("url", "__never__"\)/.test(reset), "reset has no delete-everything filter on viral_videos");
ok(/RESET_REELS_BRAIN/.test(reset), "reset still requires the explicit confirm phrase");

ok(/isAuthorizedReelsBrainJobRequest/.test(providerDebug), "provider-debug route uses the shared job auth helper");
ok(!/function authOk/.test(providerDebug), "provider-debug route has no local authOk copy");

console.log("reelsBrainResetContract: passed");
