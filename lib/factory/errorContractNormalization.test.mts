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
const renderRoutes = [
  "app/api/factory/assemble/route.ts",
  "app/api/factory/static-status/route.ts",
  "app/api/factory/video-fal/route.ts",
  "app/api/factory/artifact-check/route.ts",
  "app/api/factory/media-store/route.ts",
  "app/api/factory/post-metrics/route.ts",
  "app/api/factory/ugc-creatify/route.ts",
  "app/api/factory/video-fal-status/[id]/route.ts",
  "app/api/factory/ugc-creatify-status/[id]/route.ts",
  "app/api/factory/ugc-creatify-render/[id]/route.ts",
  "app/api/factory/winners/route.ts",
  "app/api/factory/ab-rank/route.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const contentActionRoutes = [
  "app/api/factory/products/route.ts",
  "app/api/factory/brand-kit/route.ts",
  "app/api/factory/autofill/route.ts",
  "app/api/factory/scenario/route.ts",
  "app/api/factory/scenario-quality/route.ts",
  "app/api/factory/hook-judge/route.ts",
  "app/api/factory/hook-pick/route.ts",
  "app/api/factory/improve-prompt/route.ts",
  "app/api/factory/broll/route.ts",
  "app/api/factory/subtitle/route.ts",
  "app/api/factory/overlay/route.ts",
  "app/api/factory/gen-save/route.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const serviceRoutes = [
  "app/api/factory/status/route.ts",
  "app/api/factory/observer/route.ts",
  "app/api/factory/produce/route.ts",
  "app/api/factory/disk-source/route.ts",
  "app/api/factory/reject/route.ts",
  "app/api/factory/batch/route.ts",
  "app/api/factory/assistant/route.ts",
  "app/api/factory/prepare-product/route.ts",
  "app/api/factory/wb-index/route.ts",
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
ok(!/(assemble|static-status|video-fal|video-fal-status|artifact-check|media-store|post-metrics|ugc-creatify|ugc-creatify-status|ugc-creatify-render|winners (GET|POST)|ab-rank) crash:/.test(renderRoutes), "render and media routes do not leak English crash prefixes");
ok(/сборка таймлайна упала:/.test(renderRoutes) && /сохранение медиа упало:/.test(renderRoutes) && /сохранение метрик публикации упало:/.test(renderRoutes), "render and media routes use operator-facing Russian copy");
ok(!/(products|brand-kit (GET|POST)|autofill|scenario|scenario-quality|hook-judge|hook-pick|improve-prompt|broll|subtitle|overlay|gen-save (GET|POST)) crash:/.test(contentActionRoutes), "content action routes do not leak English crash prefixes");
ok(/автозаполнение нод упало:/.test(contentActionRoutes) && /сценарий упал:/.test(contentActionRoutes) && /сохранение генерации упало:/.test(contentActionRoutes), "content action routes use operator-facing Russian copy");
ok(!/(status|observer|produce|disk-source|reject|batch|assistant|prepare-product|wb-index) crash:/.test(serviceRoutes), "service routes do not leak English crash prefixes");
ok(/статус завода упал:/.test(serviceRoutes) && /производство ролика упало:/.test(serviceRoutes) && /подготовка товара упала:/.test(serviceRoutes), "service routes use operator-facing Russian copy");

if (failed) process.exit(1);
console.log(`errorContractNormalization: ${passed} passed, ${failed} failed`);
