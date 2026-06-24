// Юнит-фикстуры билдера спеки b-ролла. Запуск: npx tsx lib/factory/brollSpec.test.mts
import { buildBRollSpec, detectPreset, splitToLines, resolveAccent, hasStatNumber, ACCENTS } from "./brollSpec";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗ " + m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── detectPreset ──
{
  eq(detectPreset("экономит 8 часов в неделю"), "stat", "число → stat");
  eq(detectPreset("90% задач"), "stat", "процент → stat");
  eq(detectPreset("просто работает"), "quote", "≤3 слов → quote");
  eq(detectPreset("тебе не нужен ещё один инструмент"), "cascade", "длинная фраза → cascade");
}

// ── hasStatNumber ──
{
  ok(hasStatNumber("8 метров"), "8 метров — число есть");
  ok(hasStatNumber("за 3 минуты"), "3 минуты");
  ok(!hasStatNumber("красиво и быстро"), "без числа");
}

// ── splitToLines ──
{
  const phrase = "тебе не нужен ещё один тул тебе нужен результат";
  const l = splitToLines(phrase, 4, 18);
  ok(l.length >= 2 && l.length <= 4, `строк 2..4 (${l.length})`);
  eq(l.join(" "), phrase, "слова не теряются при разбиении");
  ok(l.every((s) => s.length <= 30), "строки не слишком длинные");
  eq(splitToLines("", 4, 18), [], "пусто → []");
  ok(splitToLines("один два три четыре пять шесть семь восемь девять десять", 4, 12).length <= 4, "никогда > maxLines");
}

// ── resolveAccent: hex / имя / ротация ──
{
  eq(resolveAccent("#abc", 0), "#abc", "валидный hex как есть");
  eq(resolveAccent("cyan", 0), ACCENTS.cyan, "имя из палитры");
  eq(resolveAccent("НЕТ", 0), resolveAccent(undefined, 0), "мусор → дефолт по индексу");
  ok(resolveAccent(undefined, 0) !== resolveAccent(undefined, 1), "ротация: idx0 ≠ idx1");
  eq(resolveAccent(undefined, 0), resolveAccent(undefined, 4), "ротация цикличная (0==4)");
}

// ── buildBRollSpec: cascade ──
{
  const s = buildBRollSpec({ phrase: "тебе не нужен ещё один тул тебе нужен результат", kicker: "fable 5" }, 0);
  eq(s.preset, "cascade", "cascade по умолчанию для длинной фразы");
  ok(s.lines.length >= 2 && s.lines.length <= 4, "1..4 строки");
  eq(s.emphasizeIndex, s.lines.length - 1, "по умолчанию подсвечена последняя строка");
  eq(s.kicker, "FABLE 5", "kicker → UPPERCASE, обрезан");
  eq(s.durationInFrames, 120, "дефолт 4с = 120 кадров");
  ok(/^#/.test(s.accent), "accent — hex");
}

// ── buildBRollSpec: stat ──
{
  const s = buildBRollSpec({ phrase: "экономит 8 часов", accent: "lime", durationSec: 3 }, 1);
  eq(s.preset, "stat", "число → stat");
  ok(!!s.stat && /\d/.test(s.stat.value), "stat.value содержит число");
  eq(s.accent, ACCENTS.lime, "именованный акцент");
  eq(s.durationInFrames, 90, "3с = 90 кадров");
}

// ── buildBRollSpec: quote + clamps ──
{
  const s = buildBRollSpec({ phrase: "просто работает", preset: "quote", durationSec: 99 }, 2);
  eq(s.preset, "quote", "явный preset уважается");
  eq(s.durationInFrames, 240, "durationSec клампится к 8с (240)");
  const s2 = buildBRollSpec({ phrase: "x", durationSec: 0.1 }, 0);
  eq(s2.durationInFrames, 60, "durationSec клампится к 2с (60)");
}

console.log(`\nbrollSpec: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
