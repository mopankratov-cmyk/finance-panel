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
ok(/if\(S\.compact\)\{[\s\S]*S\.observerError[\s\S]*return;\s*\}\s*if\(gens\|\|otk\|\|signalBits/.test(studio), "factory pulse collapses details in compact mode");
ok(!/box\.appendChild\(el\("button",\{class:"btn sm",style:"margin-top:8px;width:100%;justify-content:center;",onclick:\(\)=>go\("worker"\)\},"Worker"\)\)/.test(studio), "compact sidebar pulse does not duplicate Worker entry point");
ok(/function renderObservabilityCard\(host\)\{[\s\S]*if\(S\.compact\)return;/.test(studio), "execution observability is hidden from compact command center");
ok(/if\(heartbeatDiag&&!S\.compact\)/.test(studio), "heartbeat diagnostics are full-mode only");
ok(/heartbeat не настроен/.test(studio), "queue fallback heartbeat copy avoids saying the worker is dead");
ok(/renderToken:0/.test(studio) && /const token=\+\+S\.renderToken/.test(studio) && /const live=\(\)=>S\.screen==="center"&&S\.renderToken===token/.test(studio), "command center ignores stale async render passes");
ok(/ordered\.slice\(0,S\.compact\?1:6\)/.test(studio), "compact worker queue shows only the current queue item");
ok(/t\.blockers&&t\.blockers\.length&&!S\.compact/.test(studio), "compact worker queue hides long blocker detail");
ok(/if\(workerRow&&!S\.compact\)/.test(studio), "command center avoids duplicate worker card in compact mode");
ok(/class:"system-pill"[\s\S]*onclick:\(\)=>go\("worker"\)/.test(studio), "command center uses one compact system pill for ops and worker status");
ok(/class:"card health-banner "/.test(studio) && /class:"health-details"/.test(studio), "factory health is a compact banner with expandable technical details");
ok(/@media \(max-width:700px\)\{[\s\S]*\.hdr\{display:grid;grid-template-columns:1fr/.test(studio), "mobile command header stacks actions without horizontal overflow");
ok(/@media \(max-width:900px\)\{[\s\S]*\.rail-head>\.logo\{display:flex!important;\}[\s\S]*\.rail-head>div:not\(\.logo\),\.nav-cap,.nav-tt,.nav-st,.rail-foot\{display:none!important;\}/.test(studio), "mobile rail keeps only compact navigation chrome visible");
ok(/class:"niche-grid",role:"listbox"/.test(studio) && /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(studio), "niche selector uses stable 2x2 grid in normal desktop width");
ok(/role:"option","aria-selected":active\?"true":"false"/.test(studio), "niche tiles expose selected state semantically");
ok(/class:"filter-row",role:"group","aria-label":"Фильтр товаров"/.test(studio), "product filters are grouped and expose pressed state");
ok(/class:"product-gap-chip"/.test(studio) && /data-real-frames/.test(studio), "product missing assets are compact while exact status data remains available");
ok(/function splitBriefText/.test(studio) && /class:"rec-list"/.test(studio), "marketer panel uses scannable summary and recommendation cards");
ok(/closeFork=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onForkKey\); \}/.test(studio) && /"Собрать контент"[\s\S]*"Закрыть"/.test(studio), "product format modal has an explicit close path");
ok(/closeNight=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onNightKey\); \}/.test(studio) && /closeBrand=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onBrandKey\); \}/.test(studio), "command center modals clean up Escape handlers");
ok(/closeEmbed=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onEmbedKey\); \}/.test(studio) && /closeMedia=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onMediaKey\); \}/.test(studio), "media modals clean up Escape handlers");
ok(/closeAuto=\(\)=>\{ ov\.remove\(\); document\.removeEventListener\("keydown",onAutoKey\); \}/.test(studio), "autofill result modal cleans up Escape handler");
ok(/if\(S\.compact\)\{[\s\S]*localStorage\.setItem\("noda_compact","0"\)/.test(studio), "assistant entry point expands full mode when needed");

if (failed) process.exit(1);
console.log(`studioSimplification: ${passed} passed, ${failed} failed`);
