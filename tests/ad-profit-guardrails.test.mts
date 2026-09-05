import assert from "node:assert/strict";
import test from "node:test";
import { calculateAdvertProfitGuardrail, compareAdvertBeforeAfter } from "../lib/adverts/profitGuardrails";

test("advert guardrail calculates break-even DRR and profit after ads", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 15_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.breakEvenDrr, 28);
  assert.equal(result.breakEvenRoas, 3.6);
  assert.equal(result.profitAfterAds, 13_000);
  assert.equal(result.action, "increase");
  assert.equal(result.confidence, "high");
});

test("advert guardrail fails closed without cost", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: null,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
  });
  assert.equal(result.profitAfterAds, null);
  assert.equal(result.breakEvenDrr, null);
  assert.equal(result.action, "insufficient");
});

test("advert guardrail fails closed without marketplace fees", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 0,
    acquiringPct: 0,
    extraPct: 0,
    taxPct: 7,
    feesComplete: false,
    stock: 100,
    dailyUnits: 2,
  });
  assert.equal(result.profitAfterAds, null);
  assert.equal(result.action, "insufficient");
});

test("advert guardrail does not scale without a known stock cover", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: null,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.daysCover, null);
  assert.equal(result.action, "hold");
});

test("advert guardrail does not scale on stale data", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 8,
  });
  assert.equal(result.confidence, "medium");
  assert.equal(result.action, "hold");
});

test("critical stock overrides an otherwise profitable scale recommendation", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 5,
    dailyUnits: 1,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.stockRisk, "critical");
  assert.equal(result.action, "decrease");
  assert.equal(result.budgetChangePct, -30);
});

test("before and after comparison requires two days on each side", () => {
  const comparison = compareAdvertBeforeAfter([
    { date: "2026-07-01", spent: 100, revenue: 1_000 },
    { date: "2026-07-02", spent: 120, revenue: 1_000 },
    { date: "2026-07-03", spent: 80, revenue: 1_000 },
    { date: "2026-07-04", spent: 90, revenue: 1_000 },
  ], "2026-07-03T10:00:00.000Z");
  assert.ok(comparison);
  assert.equal(comparison.before.drr, 11);
  assert.equal(comparison.after.drr, 8.5);
  assert.equal(comparison.drrDelta, -2.5);
});

/**
 * Свежее окно как вето для «поднять».
 *
 * Числа взяты с живого кабинета 05.09.2026, кампания 39112979: за 14 дней
 * расход 2 059 ₽ и выручка 23 338 ₽, но вся выручка пришла в два дня, стоившие
 * вместе 2 ₽, а закрытая неделя — 2 022 ₽ расхода при нуле атрибутированной
 * выручки. Строка списка показывала красное «ДРР 7д ∞» и зелёное «Можно
 * поднять» одновременно.
 */
const staleWinCase = {
  price: 1_000,
  cost: 400,
  revenue: 23_338,
  spent: 2_059,
  commissionPct: 20,
  acquiringPct: 2,
  extraPct: 3,
  taxPct: 7,
  stock: 100,
  dailyUnits: 2,
  attributionCompatible: true,
  dataAgeHours: 1,
};

test("«поднять» снимается, если закрытая неделя — расход без выручки", () => {
  const withoutRecent = calculateAdvertProfitGuardrail(staleWinCase);
  assert.equal(withoutRecent.action, "increase", "без свежего окна расчёт прежний");

  const withRecent = calculateAdvertProfitGuardrail({
    ...staleWinCase,
    recent: { days: 7, spent: 2_022, revenue: 0 },
  });
  assert.equal(withRecent.action, "hold");
  assert.equal(withRecent.budgetChangePct, 0);
  assert.match(withRecent.reason, /7 закрытых дней/);
  assert.ok(withRecent.reason.includes(`${(2_022).toLocaleString("ru-RU")} ₽`), "сумма расхода читается как деньги, а не как год");
});

test("свежее окно с выручкой рост не отменяет", () => {
  const result = calculateAdvertProfitGuardrail({
    ...staleWinCase,
    recent: { days: 7, spent: 1_000, revenue: 12_000 },
  });
  assert.equal(result.action, "increase");
});

test("вето не трогает «снизить» и «остановить»", () => {
  const outOfStock = calculateAdvertProfitGuardrail({
    ...staleWinCase,
    stock: 0,
    recent: { days: 7, spent: 2_022, revenue: 0 },
  });
  assert.equal(outOfStock.action, "pause", "кончившийся товар важнее любого окна");
});

test("причина у «снизить» называет сработавшую половину условия, а не обе", () => {
  // ДРР упирается в порог, но не превышает его с запасом: раньше текст
  // утверждал «ДРР 26.7% выше безопасного 26.7%» — числа спорили сами с собой.
  const atBreakEven = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 28_100,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(atBreakEven.action, "decrease");
  assert.ok(atBreakEven.profitAfterAds != null && atBreakEven.profitAfterAds < 0);
  assert.doesNotMatch(atBreakEven.reason, / или /, "«или» пересказывает условие вместо ответа");
  assert.match(atBreakEven.reason, /вплотную/);

  const wayAbove = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 50_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(wayAbove.action, "decrease");
  assert.match(wayAbove.reason, /заметно выше/);
});

/**
 * Потолки пополнения — последний автоматический тормоз перед необратимым
 * движением денег: вернуть сумму из бюджета кампании WB не умеет.
 *
 * Суточный поднят до 100 000 по требованию владельца 05.09.2026. Потолок ОДНОЙ
 * операции при этом намеренно оставлен прежним: два предохранителя ловят разные
 * ошибки — суточный держит общий объём за день, разовый не даёт одним нажатием
 * увести сумму, которую человек не собирался вводить.
 */
test("потолки пополнения: разовый ниже суточного и ловит описку", async () => {
  const { depositMaxPerDay, depositMaxPerOperation } = await import("../lib/adverts/depositLimits");
  assert.equal(depositMaxPerDay(), 100_000);
  assert.equal(depositMaxPerOperation(), 25_000);
  // Отношение важнее самих чисел: разовый ловит описку, суточный — объём.
  // Сравнявшись, они перестают быть двумя разными предохранителями.
  assert.ok(depositMaxPerOperation() < depositMaxPerDay(), "разовый потолок обязан быть ниже суточного");
  assert.ok(depositMaxPerOperation() <= depositMaxPerDay() / 3, "одно нажатие не должно уносить дневной лимит");
});
