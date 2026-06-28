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

const html = readFileSync("public/inferno/studio.html", "utf8");

ok(/const imp=d\.improvement\|\|null;/.test(html), "learning screen reads improvement snapshot");
ok(/Серия улучшения — батчи по 5 роликов/.test(html), "learning screen renders improvement section header");
ok(/else if\(attrs\[k\]===false\) continue;/.test(html), "Studio DOM helper skips false boolean attributes");
ok(/const series=imp\.series_state/.test(html), "learning screen reads series state");
ok(/Control-patterns сейчас/.test(html), "learning screen renders top pattern block");
ok(/Оси экспериментов/.test(html), "learning screen renders experiment axis block");
ok(/Что делать в следующей пятёрке/.test(html), "learning screen renders next batch actions");
ok(/План следующей пятёрки/.test(html), "learning screen renders next batch plan");
ok(/главный следующий шаг/.test(html), "learning screen highlights one primary next action");
ok(/следующая пятёрка/.test(html), "learning screen links next action to the existing batch launcher");
ok(/seriesAfter:\(\(\)=>\{try\{return localStorage\.getItem\("factory_series_after"\)\|\|null;/.test(html), "learning screen restores active series window from local storage");
ok(/function setSeriesAfter\(value\)/.test(html), "learning screen centralizes active series window updates");
ok(/localStorage\.setItem\("factory_series_after",S\.seriesAfter\)/.test(html), "learning screen persists active series window");
ok(/localStorage\.removeItem\("factory_series_after"\)/.test(html), "learning screen can clear active series window");
ok(/новый цикл/.test(html), "learning screen can start a fresh 50-run cycle");
ok(/preflight нового цикла/.test(html), "learning screen can dry-run the first batch of a fresh cycle");
ok(/const startedAt=new Date\(\)\.toISOString\(\); setSeriesAfter\(startedAt\);/.test(html), "new-cycle preflight persists the fresh series window");
ok(/openNightRun\(\{count:5,niche:imp\.niche\|\|S\.activeNiche,require_full_batch:true,require_learning_gate:true,auto_preflight:true,series_after:startedAt\}\)/.test(html), "new-cycle preflight opens a dry-run guarded first batch");
ok(/series_after="\+encodeURIComponent\(seriesStart\)/.test(html), "learning screen forwards active series window to readiness");
ok(/series_after:seriesStart/.test(html), "learning screen forwards active series window to next-five launch");
ok(/const nextGate=imp\.next_batch_gate/.test(html), "learning screen reads next-batch gate");
ok(/const completeCurrentCount=latest&&latest\.total_runs>0&&latest\.total_runs<\(imp\.batch_size\|\|5\)/.test(html), "learning screen detects incomplete current batch");
ok(/добить пятёрку/.test(html), "learning screen can complete an incomplete batch");
ok(/openNightRun\(\{count:completeCurrentCount,niche:imp\.niche\|\|S\.activeNiche,auto_preflight:true,series_after:seriesStart,skip_confirm:true\}\)/.test(html), "learning screen launches only missing current-batch recipes");
ok(/skip_confirm:true/.test(html), "learning batch launcher can skip native confirm after gated preflight");
ok(/opts\.skip_confirm\|\|confirm\("Запустить ночной прогон\?/.test(html), "ordinary night run keeps confirm while gated learning flow can bypass it");
ok(/disabled:!nextGate\.ready/.test(html), "learning screen holds next-five action when feedback gate is not ready");
ok(/gate ready/.test(html) && /gate hold/.test(html), "learning screen surfaces next-batch gate state");
ok(/api\("\/series-readiness"/.test(html), "learning screen can query series readiness endpoint");
ok(/series readiness: ready/.test(html) && /series readiness: hold/.test(html), "learning screen renders series readiness verdict");
ok(/blockers: /.test(html), "learning screen renders series readiness blockers");
ok(/openNightRun\(opts=\{\}\)/.test(html), "batch launcher accepts learning presets");
ok(/openNightRun\(\{count:5,niche:imp\.niche\|\|S\.activeNiche,require_full_batch:true,require_learning_gate:true,auto_preflight:true,series_after:seriesStart,skip_confirm:true\}\)/.test(html), "learning next action opens a server-gated 5-run niche batch with preflight");
ok(/payload\.require_learning_gate=true/.test(html), "batch launcher forwards learning gate to batch API");
ok(/payload\.series_after=opts\.series_after/.test(html), "batch launcher forwards active series window to batch API");
ok(/if\(opts\.auto_preflight\)setTimeout\(\(\)=>run\(true\),0\);/.test(html), "batch launcher can auto-run dry preflight");
ok(/payload\.niche=presetNiche/.test(html), "batch launcher passes niche to existing batch API");
ok(/market win/.test(html), "learning screen surfaces market wins");
ok(/следующий batch #/.test(html), "learning screen shows next batch index");
ok(/Последняя серия #"\+latest\.index\+\(latest\.batch_run_id\?" · "\+latest\.batch_run_id:""\)/.test(html), "learning screen shows latest batch run id");
ok(/роликов до цели/.test(html), "learning screen shows remaining runs to target");
ok(/quality /.test(html), "learning screen separates quality wins from market wins");
ok(/повторяющийся warning/.test(html), "learning screen surfaces repeated warning reasons");
ok(/feedback /.test(html), "learning screen surfaces explicit feedback coverage");
ok(/Очередь обратной связи/.test(html), "learning screen renders market feedback queue");
ok(/imp\.feedback_queue&&imp\.feedback_queue\.length/.test(html), "learning screen uses server-provided feedback queue first");
ok(/api\("\/post-metrics"/.test(html), "learning feedback queue can record market views");
ok(/api\("\/winners"/.test(html), "learning feedback queue can mark winners");
ok(/api\("\/reject"/.test(html), "learning feedback queue can record rejects");
ok(/api\("\/feedback-queue\?limit=8"/.test(html), "learning screen loads video-memory feedback queue");
ok(/Очередь памяти видосов/.test(html), "learning screen renders video-memory queue");
ok(/action:"winner"/.test(html) && /action:"reject"/.test(html), "video-memory queue can mark winner or trash without FAL");
ok(/status_check_failed/.test(html), "batch progress keeps per-recipe status fetch failures separate from real recipe failures");
ok(/const failed=rows\.filter\(x=>x&&\(\(x\.step==="failed"\)\|\|\(x\.status==="run_fail"\)\)\)\.length;/.test(html), "batch progress counts only real failed recipe states as failed");
ok(/\/graph-run\/tick/.test(html) && /nudge best-effort/.test(html), "batch progress can nudge graph-run ticks without requiring cron secrets");
ok(/setTimeout\(\(\)=>ctl\.abort\(\),25000\)/.test(html), "batch progress nudge gives one graph step enough time to persist progress");

if (failed) process.exit(1);
console.log(`studioImprovementLoopContract: ${passed} passed, ${failed} failed`);
