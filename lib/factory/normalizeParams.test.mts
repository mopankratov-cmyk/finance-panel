// §17 Ф0 · юнит-фикстуры нормализатора. Запуск: npx tsx lib/factory/normalizeParams.test.mts
// Без фреймворка (в проекте нет) — простые ассерты, exit 1 при первом провале.
import { normalizeParams } from "./normalizeParams.ts";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; } else { fail++; console.error("✗ " + msg); } }
function eq(a: unknown, b: unknown, msg: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── seedance: дроп неизвестного, снап энума, clamp числа, форс вертикали, i2v needs_image ──
{
  const r = normalizeParams("seedance", { resolution: "720p", duration: 99, aspect_ratio: "16:9", bogus_field: 1, model: "nonsense" });
  eq(r.params.duration, 12, "seedance duration clamp 99→12 (max)");
  eq(r.params.aspect_ratio, "9:16", "seedance aspect форсирован в вертикаль");
  eq(r.params.model, "seedance", "seedance невалидная модель → снап на default");
  ok(!("bogus_field" in r.params), "seedance неизвестное поле отброшено");
  ok(r.warnings.some(w => w.includes("bogus_field")), "seedance варнинг про неизвестное поле");
  ok(r.warnings.includes("needs_image"), "seedance без image_url → needs_image");
  eq(r.params.camera_fixed, false, "seedance дефолт camera_fixed подставлен");
}
// ── seedance с картинкой: нет needs_image ──
{
  const r = normalizeParams("seedance", { image_url: "https://x/p.jpg", duration: 5 });
  ok(!r.warnings.includes("needs_image"), "seedance с image_url — без needs_image");
  eq(r.params.duration, 5, "seedance валидная длительность сохранена");
}
// ── kling: cfg_scale снап к step 0.05, duration строковый энум ──
{
  const r = normalizeParams("kling", { cfg_scale: 0.53, duration: "7", image_url: "u" });
  eq(r.params.cfg_scale, 0.55, "kling cfg_scale снап к шагу 0.05 (0.53→0.55)");
  eq(r.params.duration, "5", "kling duration «7» не из {5,10} → снап на default 5");
}
// ── creatify: вертикаль в формате 9x16, тумблер из строки ──
{
  const r = normalizeParams("creatify", { aspect_ratio: "16x9", no_stock_broll: "true", no_caption: false });
  eq(r.params.aspect_ratio, "9x16", "creatify вертикаль в ltv-формате 9x16");
  eq(r.params.no_stock_broll, true, "creatify тумблер из строки 'true'→true");
}
// ── число как мусорная строка → дефолт ──
{
  const r = normalizeParams("seedance", { duration: "абв", image_url: "u" });
  eq(r.params.duration, 5, "нечисловая длительность → дефолт 5");
}
// ── мета-ключи проходят насквозь ──
{
  const r = normalizeParams("seedance", { role: "hook", onscreen_text: "Смотри", image_url: "u" });
  eq(r.params.role, "hook", "meta role сохранён");
  eq(r.params.onscreen_text, "Смотри", "meta onscreen_text сохранён");
}
// ── неизвестный движок: пасс-сквозь + варнинг, без падения ──
{
  const r = normalizeParams("totally_unknown_tool", { foo: 1 });
  eq(r.params.foo, 1, "неизвестный движок — params как есть");
  ok(r.warnings.some(w => w.includes("нет схемы")), "неизвестный движок — варнинг про отсутствие схемы");
}
// ── null/undefined params не падают ──
{
  const r = normalizeParams("seedance", null);
  ok(typeof r.params === "object", "null params → объект дефолтов");
  eq(r.params.aspect_ratio, "9:16", "null params → дефолтная вертикаль");
}

console.log(`\nnormalizeParams: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
