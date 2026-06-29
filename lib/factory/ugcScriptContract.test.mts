import { readFileSync } from "node:fs";
import { equal, ok } from "node:assert/strict";
import { buildFallbackUgcScript, normalizeUgcScript } from "./ugcScript";

const route = readFileSync("app/api/factory/ugc-script/route.ts", "utf8");
const helper = readFileSync("lib/factory/ugcScript.ts", "utf8");

ok(/app\/api\/factory\/ugc-script\/route\.ts/.test("app/api/factory/ugc-script/route.ts"), "UGC script route path exists");
ok(/checkPersonaConsent\(db, personaRef\)/.test(route), "UGC script checks persona consent");
ok(/validateBlueprint\(blueprintRaw\)/.test(route), "UGC script reuses Blueprint validation");
ok(/render_allowed/.test(route) && /render_blockers/.test(route), "UGC script returns render gate state");
ok(/hook\.text и spoken_lines\[0\]\.text должны дословно совпадать/.test(route), "Prompt locks hook text");
ok(/normalizeUgcScript/.test(route), "Route normalizes Claude JSON through strict helper");
ok(/function blockersForRender/.test(helper), "Helper centralizes render blockers");
ok(/RENDER_CONSENT_STATUSES/.test(helper) && /"stock"/.test(helper), "Render gate accepts stock platform personas");

const valid = normalizeUgcScript({
  hook: { text: "Я не ожидала, что крем так ляжет", locked: true },
  product: "крем",
  duration_sec: 16,
  spoken_lines: [
    { t: 0, text: "Я не ожидала, что крем так ляжет", emotion: "surprised", delivery: "confessional", pause_after_ms: 200 },
    { t: 4, text: "Смотри на кожу при дневном свете, не на фильтр.", emotion: "honest", delivery: "demo", pause_after_ms: 100 },
  ],
  onscreen: [{ t: 0, text: "без фильтра" }],
  cta: "Сверяй артикул",
}, { expectedHook: "Я не ожидала, что крем так ляжет", product: "крем", personaId: "persona_1", consentStatus: "granted" });

ok(valid.valid, "Valid UGC script passes");
ok(valid.script.render_allowed, "Granted persona allows render");
equal(valid.script.spoken_lines[0].text, valid.script.hook.text, "First spoken line equals locked hook");

const stock = normalizeUgcScript({
  hook: { text: "Исходный хук", locked: true },
  duration_sec: 12,
  spoken_lines: [
    { t: 0, text: "Исходный хук", emotion: "curious", delivery: "confessional", pause_after_ms: 200 },
    { t: 3, text: "Показываю товар без фильтра.", emotion: "honest", delivery: "demo", pause_after_ms: 100 },
  ],
  onscreen: [{ t: 0, text: "без фильтра" }],
}, { expectedHook: "Исходный хук", product: "товар", personaId: "stock_persona", consentStatus: "stock" });

ok(stock.script.render_allowed, "Stock Creatify persona allows render after backfill");

const blocked = normalizeUgcScript({
  hook: { text: "Другой хук", locked: true },
  duration_sec: 16,
  spoken_lines: [
    { t: 0, text: "Другой хук", emotion: "flat", delivery: "robotic", pause_after_ms: 5000 },
  ],
}, { expectedHook: "Исходный хук", product: "товар", personaId: "persona_2", consentStatus: "unknown" });

ok(!blocked.valid, "Changed hook fails validation");
ok(!blocked.script.render_allowed, "Unknown consent blocks render");
ok(blocked.script.render_blockers.some((item) => item.includes("hook text must stay locked")), "Hook-lock blocker is explicit");
ok(blocked.script.render_blockers.some((item) => item.includes("persona consent unknown")), "Consent blocker is explicit");

const fallback = buildFallbackUgcScript({ hook: "Исходный хук", product: "товар", personaId: null, consentStatus: null, reason: "test" });
ok(fallback.spoken_lines.length >= 2, "Fallback still returns usable spoken lines");
ok(!fallback.render_allowed, "Fallback blocks render without persona consent");

console.log("ugcScriptContract: passed");
