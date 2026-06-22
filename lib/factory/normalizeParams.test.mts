// §17 Ф0 · юнит-фикстуры нормализатора. Запуск: npx tsx lib/factory/normalizeParams.test.mts
// Без фреймворка (в проекте нет) — простые ассерты, exit 1 при первом провале.
import { normalizeParams } from "./normalizeParams";

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

// ── вложенный объект caption_setting (creatify) → плоские dotted-ключи ──
{
  const r = normalizeParams("creatify", { caption_setting: { font_size: 70, font_family: "Poppins", offset: { x: 0, y: 10 } } });
  eq(r.params["caption_setting.font_size"], 70, "creatify вложенный caption_setting.font_size сплющен");
  eq(r.params["caption_setting.font_family"], "Poppins", "creatify вложенный font_family сплющен");
  eq(r.params["caption_setting.offset.x"], 0, "creatify тройная вложенность offset.x сплющена");
  ok(!r.warnings.some(w => w.includes("caption_setting»")), "creatify caption_setting НЕ отброшен как неизвестный");
}
// ── вложенные font/output (shotstack) → dotted ──
{
  const r = normalizeParams("shotstack", { font: { size: 60, color: "#fff" }, output: { fps: "25" } });
  eq(r.params["font.size"], 60, "shotstack font.size сплющен");
  eq(r.params["output.fps"], "25", "shotstack output.fps сплющен");
}
// ── смешанные плоский + вложенный в одном вызове ──
{
  const r = normalizeParams("creatify", { aspect_ratio: "9x16", caption_setting: { font_size: 50 } });
  eq(r.params.aspect_ratio, "9x16", "смешанный: плоский aspect_ratio сохранён");
  eq(r.params["caption_setting.font_size"], 50, "смешанный: вложенный caption_setting сплющен");
}
// ── null в тумблере → дефолт схемы (а НЕ false) ──
{
  const r = normalizeParams("creatify", { no_stock_broll: null });
  eq(r.params.no_stock_broll, true, "null тумблер → дефолт схемы true (анти-слоп держится)");
}

// ── picker: кастомный live-id (бренд-кит visual_style) НЕ снапается на дефолт ──
{
  const r = normalizeParams("creatify", { visual_style: "custom_template_abc123", override_voice: "ru-voice-xyz" });
  eq(r.params.visual_style, "custom_template_abc123", "picker visual_style кастомный id оставлен (не снап)");
  eq(r.params.override_voice, "ru-voice-xyz", "picker override_voice (без values) проходит как есть");
}
// ── picker со встроенным значением — проходит без варнинга ──
{
  const r = normalizeParams("creatify", { visual_style: "AvatarBubbleTemplate" });
  eq(r.params.visual_style, "AvatarBubbleTemplate", "picker встроенный visual_style сохранён");
  ok(!r.warnings.some(w => w.includes("visual_style")), "встроенный visual_style без варнинга");
}

// ── picker-сентинел: автофилл вписал ИМЯ контрола в значение source-поля → отброшено (не доедет до Remotion как staticFile("picker")) ──
{
  const r = normalizeParams("disk_real", { url: "picker", role: "scene" });
  ok(!("url" in r.params) || r.params.url === undefined, "disk_real url=«picker» (имя контрола) отброшен");
  eq(r.params.role, "scene", "мета-поле role при этом сохранено");
  ok(r.warnings.some(w => w.includes("picker") && w.includes("ui-контрол")), "варнинг про плейсхолдер-сентинел");
}
{
  const r = normalizeParams("seedance", { image_url: "picker" });
  ok(!("image_url" in r.params) || r.params.image_url === undefined, "seedance image_url=«picker» отброшен");
  ok(r.warnings.includes("needs_image"), "после сброса заглушки i2v-гард просит реальное image_url (needs_image)");
}
{ // реальный URL в том же поле — НЕ трогаем
  const r = normalizeParams("disk_real", { url: "https://cdn.example.com/clip.mp4" });
  eq(r.params.url, "https://cdn.example.com/clip.mp4", "реальный url источника сохранён (сентинел-гард не задевает валидное)");
}

// ── цвет (ui:color): валидный hex проходит, мусор отбрасывается/на дефолт ──
{
  const r = normalizeParams("creatify", { "caption_setting.text_color": "#FFEE00", "caption_setting.highlight_text_color": "красный" });
  eq(r.params["caption_setting.text_color"], "#FFEE00", "валидный hex цвета сохранён");
  ok(!("caption_setting.highlight_text_color" in r.params), "мусорный цвет «красный» отброшен (нет дефолта)");
}
{
  const r = normalizeParams("shotstack", { "font.color": "#GGGGGG" });
  eq(r.params["font.color"], "#ffffff", "невалидный hex shotstack font.color → дефолт #ffffff");
  ok(r.warnings.some(w => w.includes("не hex-цвет")), "варнинг про не-hex цвет");
}
{
  const r = normalizeParams("creatify", { "caption_setting.text_color": "#FFEE0080" });
  eq(r.params["caption_setting.text_color"], "#FFEE0080", "hex с альфой (8 знаков) принят");
}

// ── РЕГРЕСС (баг #5): «незначащее» число (''/null/boolean/array/пробелы) → ДЕФОЛТ схемы,
//    а не Number()→0/1 → клэмп к min. seedance.duration: min 2, max 12, default 5. ──
{
  eq(normalizeParams("seedance", { duration: "" }).params.duration, 5, "duration:'' → дефолт 5 (не min 2)");
  eq(normalizeParams("seedance", { duration: null }).params.duration, 5, "duration:null → дефолт 5");
  eq(normalizeParams("seedance", { duration: true }).params.duration, 5, "duration:true → дефолт 5 (а не Number(true)=1→min)");
  eq(normalizeParams("seedance", { duration: [] }).params.duration, 5, "duration:[] → дефолт 5");
  eq(normalizeParams("seedance", { duration: "   " }).params.duration, 5, "duration:'   ' (пробелы) → дефолт 5");
  eq(normalizeParams("seedance", { duration: "8" }).params.duration, 8, "duration:'8' (валидная строка-число) всё ещё парсится");
  eq(normalizeParams("seedance", { duration: 0 }).params.duration, 2, "duration:0 (явный ноль) → клэмп к min 2 (это НЕ незначащий вход)");
}

console.log(`\nnormalizeParams: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
