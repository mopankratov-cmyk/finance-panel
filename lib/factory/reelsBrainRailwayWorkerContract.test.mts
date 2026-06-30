import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/reelsBrainRailwayWorker.mjs", "utf8");
const mediaResolver = readFileSync("lib/factory/reelsBrainMediaAssetResolver.mjs", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

ok(source.includes("REELS_BRAIN_ENABLE_BULK"), "worker keeps explicit paid-bulk env guard");
ok(source.includes("REELS_BRAIN_ENABLE_MEDIA_RESOLVER"), "worker keeps explicit async media resolver env guard");
ok(source.includes("false);"), "paid bulk is disabled by default");
ok(source.includes("/api/factory/jobs/reels-brain-analyze-backlog"), "worker analyzes stored backlog");
ok(source.includes("/api/factory/reels-brain/patterns/build-all"), "worker rebuilds pattern memory");
ok(source.includes("/api/factory/reels-brain/digest-all"), "worker refreshes digest surface");
ok(source.includes("resolve media assets"), "worker runs media asset resolver before analysis");
ok(source.includes("/api/factory/reels-brain/media-intelligence"), "worker refreshes media intelligence report");
ok(source.includes("/api/factory/reels-brain/media-resolver/apify"), "worker can call async Apify media resolver when explicitly enabled");
ok(mediaResolver.includes("classify only; no download; no provider calls"), "media resolver is classification-only and cost-safe");
ok(mediaResolver.includes("social_page_url_no_direct_asset"), "media resolver detects metadata-only social URLs");
ok(!/spawn|execFile|child_process|await import\(/.test(mediaResolver), "media resolver does not execute heavy media runtime");
ok(source.includes("heartbeat_failed_non_blocking"), "heartbeat failures are fail-open and do not stop learning");
ok(!/\/api\/factory\/(produce|scenario|director|publish)\b/.test(source), "worker does not call content factory generation/publish routes");
ok(!/\b(produce|scenario|director|publish)\s*\(/.test(source), "worker does not call forbidden generation functions");
ok(dockerfile.includes('CMD ["node", "lib/factory/reelsBrainRailwayWorker.mjs"]'), "Dockerfile starts the offline worker directly");
ok(dockerfile.includes("reelsBrainMediaAssetResolver.mjs"), "Dockerfile includes media resolver module");

console.log("reelsBrainRailwayWorkerContract ok");
