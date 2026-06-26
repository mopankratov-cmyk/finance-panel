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

const staticStatus = readFileSync("app/api/factory/static-status/route.ts", "utf8");
const falStatus = readFileSync("app/api/factory/video-fal-status/[id]/route.ts", "utf8");
const ugcStatus = readFileSync("app/api/factory/ugc-creatify-status/[id]/route.ts", "utf8");

ok(/статус static-рендера упал:/.test(staticStatus), "static-status keeps operator-facing error copy");
ok(!/статус static-рендера упал[\s\S]*status:\s*500/.test(staticStatus), "static-status probe no longer returns HTTP 500 on crash");
ok(/статус FAL-видео упал:/.test(falStatus), "video-fal-status keeps operator-facing error copy");
ok(!/статус FAL-видео упал[\s\S]*status:\s*500/.test(falStatus), "video-fal-status probe no longer returns HTTP 500 on crash");
ok(/статус UGC Creatify упал:/.test(ugcStatus), "ugc-creatify-status keeps operator-facing error copy");
ok(!/статус UGC Creatify упал[\s\S]*status:\s*500/.test(ugcStatus), "ugc-creatify-status probe no longer returns HTTP 500 on crash");

if (failed) process.exit(1);
console.log(`statusProbeFailOpen: ${passed} passed, ${failed} failed`);
