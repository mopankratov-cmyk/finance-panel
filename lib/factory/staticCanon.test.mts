// Юнит-фикстуры канона статики. Запуск: npx tsx lib/factory/staticCanon.test.mts
import { specFor, FORMATS, accentFor, scaleType, fitHeadline, clampDesc, luminance, contrastRatio, pickTextColor, TYPE_FLOOR, SEO } from "./staticCanon";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

// ── форматы ──
eq(specFor("pin_2x3").w, 1000, "pin 2:3 ширина 1000");
eq(specFor("pin_2x3").h, 1500, "pin 2:3 высота 1500");
eq(specFor("card_3x4").w / specFor("card_3x4").h, 1080 / 1440, "карточка 3:4 пропорция");
eq(specFor("ig_4x5").h, 1350, "IG 4:5 = 1080×1350");
eq(specFor("zzz" as never).format, "pin_2x3", "неизвестный формат → дефолт pin");
ok(specFor("pin_2x3").marginY === 150, "pin safe-зона top/bottom 150");

// ── акцент → цель ──
ok(accentFor("reach", 0) !== accentFor("saves", 0), "reach-акцент ≠ saves-акцент");
ok(accentFor("reach", 0) === accentFor("reach", 4), "акцент циклится по пулу");
ok(/^#/.test(accentFor("reach", 0)), "акцент — hex");

// ── тайп-скейл ──
eq(scaleType(140, 1000), 140, "scaleType baseline 1000 = identity");
eq(scaleType(100, 500), 50, "scaleType 500px = половина");
ok(scaleType(24, 1000) >= TYPE_FLOOR, "caption на baseline не ниже floor");

// ── хедлайн ≤7 слов ──
{
  const fh = fitHeadline("сумка под которую соберётся весь образ на каждый день недели");
  eq(fh.split(" ").length, 7, "хедлайн обрезан до 7 слов");
  ok(fh.endsWith("…"), "обрезанный хедлайн оканчивается …");
}
ok(fitHeadline("короткий хук").endsWith("хук"), "короткий хедлайн не трогаем");
ok(fitHeadline("раз два три четыре пять шесть семь восемь").endsWith("…"), "длинный → с эллипсисом");

// ── описание SEO clamp ──
ok(clampDesc("x".repeat(300)).length <= SEO.descMax, "описание ≤ descMax");
ok(clampDesc("норм").length === 4, "короткое описание не трогаем");

// ── контраст (WCAG) ──
ok(luminance("#ffffff") > 0.9, "белый ~ макс яркость");
ok(luminance("#000000") < 0.05, "чёрный ~ мин яркость");
ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.1, "бел/чёрн контраст = 21:1");
{
  const onWarm = pickTextColor("#d9603b"); // терракота
  ok(/^#/.test(onWarm.color), "pickTextColor вернул цвет");
  ok(typeof onWarm.ok === "boolean", "pickTextColor вернул ok-флаг");
  const onWhite = pickTextColor("#ffffff");
  ok(onWhite.ratio > pickTextColor("#808080").ratio, "на белом контраст выше, чем на сером");
}

console.log(`\nstaticCanon: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
