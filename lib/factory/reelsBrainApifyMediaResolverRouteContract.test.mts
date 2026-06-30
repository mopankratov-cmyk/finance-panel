import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/reels-brain/media-resolver/apify/route.ts", "utf8");

ok(route.includes("action === \"start\""), "resolver route supports short start action");
ok(route.includes("action === \"poll\""), "resolver route supports short poll action");
ok(route.includes("download_videos"), "resolver route exposes explicit download_videos flag");
ok(route.includes("media_assets"), "resolver route merges assets into analyzed_full.media_assets");
ok(route.includes("isAuthorizedReelsBrainJobRequest"), "resolver route requires cron/job authorization");
ok(!/\/api\/factory\/(produce|scenario|director|publish)\b/.test(route), "resolver does not call generation or publish routes");
ok(!/\b(produce|scenario|director|publish)\s*\(/.test(route), "resolver does not call forbidden generation functions");

console.log("reelsBrainApifyMediaResolverRouteContract ok");
