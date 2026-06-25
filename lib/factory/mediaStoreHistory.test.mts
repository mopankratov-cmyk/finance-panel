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

const mediaStore = readFileSync("app/api/factory/media-store/route.ts", "utf8");

ok(/import \{ logGeneration \} from/.test(mediaStore), "media-store can write into generation_history");
ok(/const historyEnabled = body\.log_history !== false;/.test(mediaStore), "media-store supports explicit history opt-out");
ok(/const logMediaStoreHistory = async \(outputUrl: string \| null, status: string, note\?: string \| null\)/.test(mediaStore), "media-store has a shared history helper");
ok(/await logGeneration\(\{[\s\S]*source,[\s\S]*reason: note \|\| reason,[\s\S]*article,/.test(mediaStore), "media-store logs shared lineage metadata into generation_history");
ok(/if \(!urls\.length\) \{[\s\S]*await logMediaStoreHistory\(null, "artifact_fail", errors\[0\] \|\| "media_store_upload_failed"\)/.test(mediaStore), "media-store logs full upload failure as artifact_fail history");
ok(/await logMediaStoreHistory\(urls\[0\], typeof otkScore === "number" && otkScore < 7 \? "warning" : "generated", errors\[0\] \|\| reason\)/.test(mediaStore), "media-store logs successful uploads with warning-aware status");

if (failed) process.exit(1);
console.log(`mediaStoreHistory: ${passed} passed, ${failed} failed`);
