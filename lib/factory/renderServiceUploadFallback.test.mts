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

const server = readFileSync("render-service/server.mjs", "utf8");

ok(/async function uploadViaStorageRest\(bucket, objPath, buf, contentType\)/.test(server), "render-service exposes low-level storage REST upload helper");
ok(/method: "POST"[\s\S]*"x-upsert": "true"/.test(server), "storage REST fallback uploads with upsert enabled");
ok(/async function uploadRenderObject\(db, bucket, objPath, buf, contentType, id\)/.test(server), "render-service wraps SDK upload with object-level fallback");
ok(/trying storage REST fallback/.test(server), "render-service logs when it falls back from SDK upload to REST upload");
ok(/videoUrl = await uploadRenderObject\(db, BUCKET, objPath, buf, still \? "image\/png" : "video\/mp4", id\);/.test(server), "render loop uses the wrapped upload helper");

if (failed) process.exit(1);
console.log(`renderServiceUploadFallback: ${passed} passed, ${failed} failed`);
