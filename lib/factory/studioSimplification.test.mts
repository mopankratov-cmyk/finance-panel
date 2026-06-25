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

const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/compact:true/.test(studio), "Studio starts in compact operator mode");
ok(/COMPACT_HIDDEN_SCREENS=new Set\(\["inspector","static","balances","learn"\]\)/.test(studio), "compact mode hides non-MVP screens from navigation");
ok(/function visibleScreens\(\)\{ return S\.compact \? SCREENS\.filter/.test(studio), "navigation is derived from visible screens");
ok(/visibleScreens\(\)\.forEach/.test(studio), "renderNav uses compact-aware screen list");
ok(!/if\(gens\|\|otk\|\|signalBits\.length\)/.test(studio) && !/"sprint 1 · fail-open"/.test(studio), "factory pulse stays compact in both command modes");
ok(!/box\.appendChild\(el\("button",\{class:"btn sm",style:"margin-top:8px;width:100%;justify-content:center;",onclick:\(\)=>go\("worker"\)\},"Worker"\)\)/.test(studio), "compact sidebar pulse does not duplicate Worker entry point");
ok(/function renderObservabilityCard\(host\)\{[\s\S]*if\(S\.compact\)return;/.test(studio), "execution observability is hidden from compact command center");
ok(/if\(heartbeatDiag&&!S\.compact\)/.test(studio), "heartbeat diagnostics are full-mode only");
ok(/heartbeat не настроен/.test(studio), "queue fallback heartbeat copy avoids saying the worker is dead");
ok(/renderToken:0/.test(studio) && /const token=\+\+S\.renderToken/.test(studio) && /const live=\(\)=>S\.screen==="center"&&S\.renderToken===token/.test(studio), "command center ignores stale async render passes");
ok(/async function screenWorker\(root, force, renderToken\)\{[\s\S]*const isLiveRender=\(\)=>S\.screen==="worker"&&S\.renderToken===token/.test(studio), "worker screen ignores stale async render passes");
ok(/const factorySuggested=suggested\.filter\(\(a\)=>!isWorkerInfraAction\(a&&a\.action\)\)/.test(studio), "worker screen filters infra-only suggested actions out of factory todo list");
ok(/const focusRun=orderedRuns\[0\]\|\|null;/.test(studio) && /focusRunLabel=focusRun\?\(focusRun\.stale\|\|focusRun\.status==="running"\?"Текущий прогон":"Последний прогон"\):"Прогон";/.test(studio), "worker screen focuses the top card on real factory runs instead of markdown task queue items");
ok(/const recentRuns=Array\.isArray\(runObservability&&runObservability\.recent_runs\)\?runObservability\.recent_runs:\[\];/.test(studio) && /"Очередь прогонов"/.test(studio), "worker screen shows real factory run queue from observability");
ok(/const activeRuns=recentRuns\.filter\(\(r\)=>r&&\(r\.active\|\|r\.status==="running"\|\|r\.stale\)\);[\s\S]*const queueRuns=\(activeRuns\.length\?activeRuns:recentRuns\);[\s\S]*const orderedRuns=\[\.\.\.queueRuns\][\s\S]*const visibleRuns=orderedRuns\.slice\(0,S\.compact\?4:8\)/.test(studio), "worker run queue prefers active runs while keeping a compact fallback");
ok(/focusRun\.active_step\?`идёт шаг \$\{focusRun\.active_step\}`:focusRun\.last_step\?`последний шаг \$\{focusRun\.last_step\}`:"прогон в работе"/.test(studio) && /focusRun\.active_step\?`застрял на шаге \$\{focusRun\.active_step\}`:focusRun\.last_step\?`застрял после шага \$\{focusRun\.last_step\}`:"прогон завис в running"/.test(studio), "worker focus card explains live or stuck run progress instead of raw backlog tasks");
ok(/"stale", Number\(runObservability&&runObservability\.stale_running\|\|0\), "var\(--warn-bg\)"/.test(studio) && /r&&r\.stale\?"stale_running":r\.status/.test(studio), "worker run queue surfaces stale running runs separately");
ok(/"active", Number\(runObservability&&runObservability\.active_sample_runs\|\|queueRuns\.length\|\|0\), "var\(--bg-input\)"/.test(studio) && /"history", Number\(runObservability&&\(\(runObservability\.legacy_failed_runs\|\|0\)\+\(runObservability\.legacy_warning_runs\|\|0\)\)\|\|0\), "var\(--bg-input\)"/.test(studio), "worker queue meta distinguishes live active runs from historical noise");
ok(/live ops quiet right now; historical sample still keeps/.test(studio), "full observability card explains when only historical incidents remain");
ok(!/if\(workerRow&&!S\.compact\)/.test(studio), "command center does not render a duplicate worker summary card");
ok(/class:"system-pill"[\s\S]*onclick:\(\)=>go\("worker"\)/.test(studio), "command center uses one compact system pill for ops and worker status");
ok(/hasCriticalSystemAlert=level==="critical"\|\|opsAlerts\.some/.test(studio) && /class:"card health-banner "/.test(studio), "factory health banner only surfaces critical system alerts in command center");
ok(!/задача "\+workerRow\.current_task_id/.test(studio) && /Идёт в фоне как серия прогонов\./.test(studio), "command center hides raw worker task ids and uses run-centric autopilot copy");
ok(/@media \(max-width:700px\)\{[\s\S]*\.hdr\{display:grid;grid-template-columns:1fr/.test(studio), "mobile command header stacks actions without horizontal overflow");
ok(/@media \(max-width:900px\)\{[\s\S]*\.rail-head>\.logo\{display:flex!important;\}[\s\S]*\.rail-head>div:not\(\.logo\),\.nav-cap,.nav-tt,.nav-st,.rail-foot\{display:none!important;\}/.test(studio), "mobile rail keeps only compact navigation chrome visible");
ok(/class:"niche-grid",role:"listbox"/.test(studio) && /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(studio), "niche selector uses stable 2x2 grid in normal desktop width");
ok(/role:"option","aria-selected":active\?"true":"false"/.test(studio), "niche tiles expose selected state semantically");
ok(/class:"filter-row",role:"group","aria-label":"Фильтр товаров"/.test(studio), "product filters are grouped and expose pressed state");
ok(/class:"product-gap-chip"/.test(studio) && /data-real-frames/.test(studio), "product missing assets are compact while exact status data remains available");
ok(/function splitBriefText/.test(studio) && /class:"rec-list"/.test(studio), "marketer panel uses scannable summary and recommendation cards");
ok(/const learnWarnings=Array\.isArray\(d\.warnings\)\?d\.warnings\.filter\(Boolean\):\[\];[\s\S]*"read-path warnings"/.test(studio), "learn screen surfaces warning metadata instead of silently flattening degraded reads");
ok(/const ST=\{otk_pass:\["var\(--ok\)","ОТК ✓"\],approved:\["var\(--ok\)","одобрено"\],warning:\["var\(--warn\)","warning"\],otk_fail:\["var\(--warn\)","низкий ОТК"\],rejected:\["var\(--err\)","reject"\],artifact_fail:\["var\(--err\)","артефакт"\]/.test(studio), "learn generation history uses explicit status labels instead of flattening all non-pass states to warning");
ok(/const lineageBits=\[[\s\S]*r\.recipe_id!=null\?\("#"\+String\(r\.recipe_id\)\):null,[\s\S]*r\.attempt!=null\?\("try "\+String\(r\.attempt\)\):null,[\s\S]*r\.variant_idx!=null\?\("var "\+String\(r\.variant_idx\)\):null/.test(studio) && /reasonText=r\.reason\?String\(r\.reason\)\.slice\(0,72\):""/.test(studio), "learn generation history shows lineage bits and reason text for recent attempts");
ok(/closeFork=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onForkKey\); \}/.test(studio) && /"Собрать контент"[\s\S]*"Закрыть"/.test(studio), "product format modal has an explicit close path");
ok(/closeNight=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onNightKey\); \}/.test(studio) && /closeBrand=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onBrandKey\); \}/.test(studio), "command center modals clean up Escape handlers");
ok(/closeEmbed=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onEmbedKey\); \}/.test(studio) && /closeMedia=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onMediaKey\); \}/.test(studio), "media modals clean up Escape handlers");
ok(/closeAuto=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onAutoKey\); \}/.test(studio), "autofill result modal cleans up Escape handler");
ok(/if\(S\.compact\)\{[\s\S]*localStorage\.setItem\("noda_compact","0"\)/.test(studio), "assistant entry point expands full mode when needed");

if (failed) process.exit(1);
console.log(`studioSimplification: ${passed} passed, ${failed} failed`);
