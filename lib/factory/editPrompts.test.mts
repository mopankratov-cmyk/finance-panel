// Юнит-фикстуры детерминированного сборщика edit/motion-промптов. Запуск: npx tsx lib/factory/editPrompts.test.mts
// Без фреймворка (в проекте нет) — простые ассерты, exit 1 при первом провале.
import { buildEditPrompt, buildMotionPrompt, categoryFor, categoryForBrand, defaultSceneFor, MOTION_NEGATIVE, type ProductCategory } from "./editPrompts";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; } else { fail++; console.error("✗ " + msg); } }
function eq(a: unknown, b: unknown, msg: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── бренд → категория ──
{
  eq(categoryForBrand("CLÉRIN"), "bag", "CLÉRIN → bag");
  eq(categoryForBrand("ENOUGH"), "cosmetics", "ENOUGH → cosmetics");
  eq(categoryForBrand("SADOER"), "cosmetics", "SADOER → cosmetics");
  eq(categoryForBrand("LAMEILA"), "cosmetics", "LAMEILA → cosmetics");
  eq(categoryForBrand("JOMTAM"), "cosmetics", "JOMTAM → cosmetics");
  eq(categoryForBrand("YOYO"), "cosmetics", "YOYO → cosmetics");
  eq(categoryForBrand("ANJO"), "cosmetics", "ANJO → cosmetics");
  eq(categoryForBrand("NORVIA"), "apparel", "NORVIA → apparel");
  eq(categoryForBrand("Tim Tin"), "toy", "Tim Tin → toy");
  eq(categoryForBrand("Ортопедия"), "generic", "Ортопедия → generic");
  eq(categoryForBrand("Обувь"), "generic", "Обувь → generic");
  eq(categoryForBrand(""), "generic", "пусто → generic");
  eq(categoryForBrand("НЕИЗВЕСТНО"), "generic", "неизвестный бренд → generic");
}

// ── категория по артикулу+названию (через detectBrand) ──
{
  eq(categoryFor("CLR00912", "сумка"), "bag", "CLR* → bag");
  eq(categoryFor("EN000813", ""), "cosmetics", "EN* → cosmetics");
  eq(categoryFor("TT06103", "бластер"), "toy", "TT* → toy");
  eq(categoryFor("HT-80-02", "куртка"), "apparel", "HT-* → apparel");
  eq(categoryFor("NV001", ""), "apparel", "NV* → apparel");
  eq(categoryFor("XXX999", "что-то"), "generic", "неизвестный артикул → generic");
  // РЕГРЕСС (ревью FIX #1): имя с «сумка» НЕ должно перебивать бренд по артикулу
  eq(categoryFor("EN000813", "сумка для косметики"), "cosmetics", "EN* + «сумка» в имени → cosmetics (артикул авторитетен)");
  eq(categoryFor("TT06103", "сумка-бластер"), "toy", "TT* + «сумка» в имени → toy (артикул авторитетен)");
  eq(categoryFor("", "сумка"), "bag", "без артикула, имя «сумка» → bag (фолбэк по имени работает)");
}

const CATS: ProductCategory[] = ["bag", "cosmetics", "apparel", "toy", "generic"];

// ── CLEAN: формула Lock/Change/Scope/Constraints, БЕЗ запретных формулировок, с товаром ──
{
  const p = buildEditPrompt({ category: "bag", op: "clean", product: "brown leather tote bag" });
  ok(/showing ONLY the brown leather tote bag/.test(p), "clean содержит product");
  ok(/Lock:/.test(p) && /Change:/.test(p) && /Scope:/.test(p) && /Constraints:/.test(p), "clean: все 4 секции формулы (Lock/Change/Scope/Constraints)");
  ok(/edit the background ONLY/.test(p), "clean: дискретный Scope-клозет анти-дрейфа");
  ok(/light-grey studio backdrop/.test(p), "clean: изоляция на грей-фон");
  ok(/logo legible and uncropped/.test(p), "clean: лого читаемо/не обрезано");
  for (const c of CATS) {
    const pp = buildEditPrompt({ category: c, op: "clean" });
    ok(!/remove\s+(the\s+)?(watermark|logo|text)/i.test(pp), `clean[${c}]: НЕТ запретного "remove watermark/logo/text"`);
    ok(/Recreate this as a clean/.test(pp), `clean[${c}]: созидательная формулировка (recreate)`);
  }
}

// ── STAGE: сцена оператора подставляется; дефолт берётся из категории ──
{
  const custom = buildEditPrompt({ category: "bag", op: "stage", product: "tote", scene: "on a rooftop at sunset" });
  ok(/Place THIS exact tote into on a rooftop at sunset/.test(custom), "stage: произвольная сцена оператора подставлена");
  ok(/do not alter, morph, or relabel it/.test(custom), "stage: preserve-клозет");
  ok(/edit the environment ONLY/.test(custom), "stage: дискретный Scope-клозет (правим только окружение)");
  ok(/contact shadow and subtle reflection/.test(custom), "stage: контактная тень + рефлекс (композит-реализм)");
  ok(/9:16/.test(custom), "stage: вертикаль 9:16");

  const dflt = buildEditPrompt({ category: "cosmetics", op: "stage" });
  ok(dflt.includes(defaultSceneFor("cosmetics")), "stage без сцены → дефолтная сцена категории");
  for (const c of CATS) {
    const pp = buildEditPrompt({ category: c, op: "stage" });
    ok(!/remove\s+(the\s+)?(watermark|logo|text)/i.test(pp), `stage[${c}]: НЕТ запретного "remove …"`);
    ok(pp.includes(defaultSceneFor(c)), `stage[${c}]: содержит дефолтную сцену`);
  }
}

// ── категорийные identity-якоря (lock) попадают в промпт ──
{
  ok(/stitching, leather grain/.test(buildEditPrompt({ category: "bag", op: "clean" })), "bag lock: швы/фактура кожи");
  ok(/printed shade name and ingredient text/.test(buildEditPrompt({ category: "cosmetics", op: "stage" })), "cosmetics lock: текст оттенка/состава");
  ok(/nozzle, trigger, tank/.test(buildEditPrompt({ category: "toy", op: "clean" })), "toy lock: сопло/курок/бак");
  ok(/garment cut, seams, zipper, hood/.test(buildEditPrompt({ category: "apparel", op: "stage" })), "apparel lock: крой/швы/молния/капюшон");
}

// ── MOTION-скелет: ОДИН camera move, preservation, БЕЗ повтора внешности; детальный товар = минимум движения ──
{
  for (const c of CATS) {
    const m = buildMotionPrompt({ category: c });
    ok(/stable and fully intact/.test(m), `motion[${c}]: preservation-клозет`);
    ok(/no shape change, no morphing, crisp edges/.test(m), `motion[${c}]: анти-морфинг`);
    // не должно повторять свет/цвет/фон (это уже в кадре)
    ok(!/palette|backdrop|background colour|lighting setup/i.test(m), `motion[${c}]: не описывает свет/палитру/фон`);
  }
  ok(/static locked-off/.test(buildMotionPrompt({ category: "toy" })), "motion[toy]: статичный кадр (детальный товар)");
  ok(/orbital track/.test(buildMotionPrompt({ category: "cosmetics" })), "motion[cosmetics]: орбитальная проводка");
  ok(/dolly push-in/.test(buildMotionPrompt({ category: "bag" })), "motion[bag]: dolly push-in");
  // лаконичность: ~ до 35 слов
  for (const c of CATS) ok(buildMotionPrompt({ category: c }).split(/\s+/).length <= 36, `motion[${c}]: лаконично (≤36 слов)`);
}

// ── негатив определён ──
ok(/label distortion/.test(MOTION_NEGATIVE) && /no jitter/.test(MOTION_NEGATIVE), "MOTION_NEGATIVE задан");

console.log(`\neditPrompts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
