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

const ugcCreatify = readFileSync("app/api/factory/ugc-creatify/route.ts", "utf8");
const creatifyAvatars = readFileSync("app/api/factory/creatify-avatars/route.ts", "utf8");
const patrickLegacy = readFileSync("public/inferno/patrick-legacy.html", "utf8");

ok(!/detail:\s*error/.test(ugcCreatify), "ugc-creatify route no longer duplicates errors into detail");
ok(!/\{\s*error,\s*detail:\s*error/.test(ugcCreatify), "ugc-creatify keeps a single canonical error field");
ok(!/detail:\s*error/.test(creatifyAvatars), "creatify-avatars route no longer emits duplicate detail field");
ok(/d\.error \|\| d\.detail \|\| 'Creatify не подключён'/.test(patrickLegacy), "legacy avatar picker prefers canonical error field");
ok(/d\.error \|\| d\.detail \|\| 'не удалось запустить'/.test(patrickLegacy), "legacy UGC launcher prefers canonical error field");
ok(/this\.utmMsg = 'ошибка: ' \+ \(d\.error \|\| d\.detail \|\| 'не удалось'\)/.test(patrickLegacy), "legacy utm launcher prefers canonical error field");
ok(/this\.crit\.step = 'ошибка: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустилось'\)/.test(patrickLegacy), "legacy critic launcher prefers canonical error field");
ok(/Kling: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустился'\)/.test(patrickLegacy), "legacy Kling path prefers canonical error field");
ok(/Higgsfield: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустился'\)/.test(patrickLegacy), "legacy Higgsfield path prefers canonical error field");

if (failed) process.exit(1);
console.log(`errorContractNormalization: ${passed} passed, ${failed} failed`);
