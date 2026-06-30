import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/reelsBrainRailwayWorker.mjs", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

ok(source.includes("REELS_BRAIN_ENABLE_BULK"), "worker keeps explicit paid-bulk env guard");
ok(source.includes("false);"), "paid bulk is disabled by default");
ok(source.includes("/api/factory/jobs/reels-brain-analyze-backlog"), "worker analyzes stored backlog");
ok(source.includes("/api/factory/reels-brain/patterns/build-all"), "worker rebuilds pattern memory");
ok(source.includes("/api/factory/reels-brain/digest-all"), "worker refreshes digest surface");
ok(!/\/api\/factory\/(produce|scenario|director|publish)\b/.test(source), "worker does not call content factory generation/publish routes");
ok(!/\b(produce|scenario|director|publish)\s*\(/.test(source), "worker does not call forbidden generation functions");
ok(dockerfile.includes('CMD ["node", "lib/factory/reelsBrainRailwayWorker.mjs"]'), "Dockerfile starts the offline worker directly");

console.log("reelsBrainRailwayWorkerContract ok");
