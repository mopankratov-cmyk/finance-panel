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

const genSave = readFileSync("app/api/factory/gen-save/route.ts", "utf8");

ok(/const logGenSaveHistory = async/.test(genSave), "gen-save has a local history helper");
ok(/if \(dup\?\.url\) \{[\s\S]*await logGenSaveHistory\(videoUrl, dup\.url\);[\s\S]*already: true/.test(genSave), "initial dedupe hit is still logged to generation_history");
ok(/if \(dup2\?\.url\) \{[\s\S]*await logGenSaveHistory\(videoUrl, dup2\.url\);[\s\S]*already: true/.test(genSave), "post-upload dedupe hit is still logged to generation_history");
ok(/if \(ex\?\.url\) \{[\s\S]*await logGenSaveHistory\(videoUrl, ex\.url\);[\s\S]*already: true/.test(genSave), "unique-index race dedupe is still logged to generation_history");
ok(/await logGenSaveHistory\(videoUrl, null, "artifact_fail", diag \|\| "storage failed"\)/.test(genSave), "video storage failures are logged as artifact_fail");
ok(/return NextResponse\.json\(\{ ok: false, error: "не удалось скачать\/залить видео", diag \}, \{ status: 502 \}\)/.test(genSave), "video storage failures return non-2xx to internal callers");
ok(/await logGenSaveHistory\(videoUrl, null, "artifact_fail", insErr\.message\)/.test(genSave), "catalog insert failures are logged as artifact_fail");
ok(/return NextResponse\.json\(\{ ok: false, error: insErr\.message \}, \{ status: 500 \}\)/.test(genSave), "catalog insert failures return 500 to internal callers");
ok(/await logGenSaveHistory\(slides\[0\] \|\| null, null, "artifact_fail"/.test(genSave), "carousel failures are logged as artifact_fail");
ok(/return NextResponse\.json\(\{ ok: false, error: "не удалось залить слайды карусели" \}, \{ status: 502 \}\)/.test(genSave), "carousel upload failures return non-2xx to internal callers");
ok(/await logGenSaveHistory\(slides\[0\] \|\| null, clean\[0\]\)/.test(genSave), "carousel successes are logged to generation_history");
ok(/status: status \|\| \(typeof b\.otk === "number" && b\.otk < 7 \? "warning" : "generated"\)/.test(genSave), "low-OTK history remains warning, not fail-closed");

if (failed) process.exit(1);
console.log(`genSaveHistory: ${passed} passed, ${failed} failed`);
