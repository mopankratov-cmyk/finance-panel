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
ok(/if\(S\.compact\)\{\s*box\.appendChild[\s\S]*return;\s*\}\s*if\(gens\|\|otk\|\|signalBits/.test(studio), "factory pulse collapses details in compact mode");
ok(/function renderObservabilityCard\(host\)\{[\s\S]*if\(S\.compact\)return;/.test(studio), "execution observability is hidden from compact command center");
ok(/if\(heartbeatDiag&&!S\.compact\)/.test(studio), "heartbeat diagnostics are full-mode only");
ok(/heartbeat не настроен/.test(studio), "queue fallback heartbeat copy avoids saying the worker is dead");
ok(/if\(workerRow&&!S\.compact\)/.test(studio), "command center avoids duplicate worker card in compact mode");
ok(/if\(S\.compact\)\{[\s\S]*localStorage\.setItem\("noda_compact","0"\)/.test(studio), "assistant entry point expands full mode when needed");

if (failed) process.exit(1);
console.log(`studioSimplification: ${passed} passed, ${failed} failed`);
