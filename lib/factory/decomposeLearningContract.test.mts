import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass += 1; else { fail += 1; console.error("FAIL", msg); } }

const route = readFileSync("app/api/factory/decompose/route.ts", "utf8");
const autofill = readFileSync("app/api/factory/autofill/route.ts", "utf8");
const critic = readFileSync("app/api/factory/video-critic/route.ts", "utf8");
const hints = readFileSync("lib/factory/learningHints.ts", "utf8");

ok(/import \{ learningHints \} from "@\/lib\/factory\/learningHints"/.test(route), "decompose imports learning hints");
ok(/const lh = db \? await learningHints\(db, niche\) : ""/.test(route), "decompose reads niche learning hints fail-open");
ok(/Восстанови структуру и разложи на ноды\.\$\{lh\}/.test(route), "decompose appends learning hints into the model prompt");
ok(/learningHints\(db, niche\)\.catch\(\(\) => ""\)/.test(autofill), "autofill consumes learning hints fail-open");
ok(/await rejectAntiFor\(dbAnti, niche\)/.test(critic), "video critic reads reject anti-patterns");
ok(/Promise\.all\(\[winnersHintFor\(db, niche\), corpusHooksFor\(db, niche\), rejectAntiFor\(db, niche\)\]\)/.test(hints), "learning hint bundle combines winners, hook corpus, and rejects");

console.log(`decomposeLearningContract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
