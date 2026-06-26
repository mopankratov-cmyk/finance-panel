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
const creatifyAdapter = readFileSync("lib/factory/creatify.ts", "utf8");
const patrickLegacy = readFileSync("public/inferno/patrick-legacy.html", "utf8");
const graphRun = readFileSync("app/api/factory/graph-run/route.ts", "utf8");
const liveRoutes = [
  "app/api/factory/decompose/route.ts",
  "app/api/factory/node-preview/route.ts",
  "app/api/factory/recipes/route.ts",
  "app/api/factory/balances/route.ts",
  "app/api/factory/studio/route.ts",
  "app/api/factory/niche-brief/route.ts",
  "app/api/factory/static-generate/route.ts",
  "app/api/factory/creatify-options/route.ts",
  "app/api/factory/node-save/route.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const orchestrationRoutes = [
  "app/api/factory/ops/route.ts",
  "app/api/factory/stability/route.ts",
  "app/api/factory/worker-state/route.ts",
  "app/api/factory/graph-run/tick/route.ts",
  "app/api/factory/graph-run/cron/route.ts",
  "app/api/factory/graph-run/rejudge/route.ts",
  "app/api/factory/jobs/balances-cron/route.ts",
  "app/api/factory/jobs/corpus-cron/route.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");

ok(!/detail:\s*error/.test(ugcCreatify), "ugc-creatify route no longer duplicates errors into detail");
ok(!/\{\s*error,\s*detail:\s*error/.test(ugcCreatify), "ugc-creatify keeps a single canonical error field");
ok(!/detail:\s*error/.test(creatifyAvatars), "creatify-avatars route no longer emits duplicate detail field");
ok(/\)\.error \|\| \(body as Record<string, unknown>\)\.detail \|\| r\.text/.test(creatifyAdapter), "creatify adapter prefers canonical error field before legacy detail");
ok(/d\.error \|\| d\.detail \|\| 'Creatify не подключён'/.test(patrickLegacy), "legacy avatar picker prefers canonical error field");
ok(/d\.error \|\| d\.detail \|\| 'не удалось запустить'/.test(patrickLegacy), "legacy UGC launcher prefers canonical error field");
ok(/this\.utmMsg = 'ошибка: ' \+ \(d\.error \|\| d\.detail \|\| 'не удалось'\)/.test(patrickLegacy), "legacy utm launcher prefers canonical error field");
ok(/this\.crit\.step = 'ошибка: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустилось'\)/.test(patrickLegacy), "legacy critic launcher prefers canonical error field");
ok(/Kling: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустился'\)/.test(patrickLegacy), "legacy Kling path prefers canonical error field");
ok(/Higgsfield: ' \+ \(d\.error \|\| d\.detail \|\| 'не запустился'\)/.test(patrickLegacy), "legacy Higgsfield path prefers canonical error field");
ok(!/graph-run crash:/.test(graphRun) && (graphRun.match(/graph-run упал:/g) || []).length >= 2, "graph-run route crash errors use operator-facing Russian copy");
ok(!/(decompose|node-preview|recipes|balances|studio|niche-brief|static-generate|creatify-options|node-save) crash:/.test(liveRoutes), "primary Studio routes do not leak English crash prefixes");
ok(/разбор конкурента упал:/.test(liveRoutes) && /превью ноды упало:/.test(liveRoutes) && /рецепты упали:/.test(liveRoutes) && /балансы упали:/.test(liveRoutes), "primary Studio route fallbacks use operator-facing Russian copy");
ok(!/(ops|stability|worker-state (GET|POST)|graph-run\/tick|graph-run\/cron|graph-run\/rejudge|jobs\/balances-cron|jobs\/corpus-cron) crash:/.test(orchestrationRoutes), "ops and graph orchestration routes do not leak English crash prefixes");
ok(!/error: "unauthorized"/.test(orchestrationRoutes) && /неверный CRON_SECRET/.test(orchestrationRoutes), "protected factory service routes explain auth failures as CRON_SECRET problems");

if (failed) process.exit(1);
console.log(`errorContractNormalization: ${passed} passed, ${failed} failed`);
