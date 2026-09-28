import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// «Общая сводка» РНП (весь кабинет, без фильтра) считает profit_per_unit и
// romi внутри buildRnpTable — асинхронной, завязанной на БД функции, которую
// юнит-тестом не вызвать. Фиксируем регресс текстово: паттерн, который уже
// один раз привёл к заниженной прибыли на единицу (см. соседний фикс
// margin_pct тут же), не должен вернуться.
//
// Баг: числитель (grossDaily) считается только по SKU с известной
// себестоимостью и обрезан по summaryEconomyAsOf (граница свежести самого
// отстающего источника — продаж или рекламы). Знаменатель раньше брался из
// summary.buyouts_count/ad_spent — сумм по ВСЕМ SKU кабинета, включая те, что
// без себестоимости, и без обрезки по summaryEconomyAsOf. Прибыль урезанного
// набора SKU за урезанный период делилась на выкупы/расход ПОЛНОГО набора за
// ПОЛНЫЙ период — profit_per_unit и romi занижались всякий раз, когда
// себестоимость известна не для всех товаров (обычный случай) или кабинеты
// продаж/рекламы отстают друг от друга на разные сроки.

const load = async () => (await readFile(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("profit_per_unit сводки делится на выкупы ТЕХ ЖЕ SKU и того же периода, что и прибыль в числителе", async () => {
  const sql = await load();
  assert.doesNotMatch(sql, /summary\.find\(\(item\) => item\.field === "buyouts_count"\)\?\.total \?\? null/, "знаменатель не должен браться из total по ВСЕМ SKU без учёта costedSkus/summaryEconomyAsOf");
  assert.match(sql, /const costedBuyoutsCountDaily = days\.map\(\(day, index\) => \{/, "должна быть отдельная сумма выкупов, ограниченная costedSkus и summaryEconomyAsOf — по образцу costedBuyoutsSumDaily для margin_pct");
  assert.match(sql, /total: grossTotal != null && costedBuyoutsCountTotal != null && costedBuyoutsCountTotal > 0\s*\n\s*\? Math\.round\(grossTotal \/ costedBuyoutsCountTotal\)/, "profit_per_unit сводки должен делить на costedBuyoutsCountTotal, не на сумму по всем SKU");
});

test("romi сводки делится на рекламный расход ТЕХ ЖЕ SKU и того же периода, что и прибыль в числителе", async () => {
  const sql = await load();
  assert.doesNotMatch(sql, /summary\.find\(\(item\) => item\.field === "ad_spent"\)\?\.total \?\? null/, "знаменатель не должен браться из total по ВСЕМ SKU без учёта costedSkus/summaryEconomyAsOf");
  assert.match(sql, /const costedAdSpendDaily = days\.map\(\(day, index\) => \{/, "должна быть отдельная сумма рекламного расхода, ограниченная costedSkus и summaryEconomyAsOf — по образцу costedBuyoutsSumDaily для margin_pct");
  assert.match(sql, /total: grossTotal != null && costedAdSpendTotal != null && costedAdSpendTotal > 0\s*\n\s*\? Math\.round\(\(grossTotal \/ costedAdSpendTotal\)/, "romi сводки должен делить на costedAdSpendTotal, не на сумму по всем SKU");
});

test("три знаменателя сводки (margin_pct, profit_per_unit, romi) обрезаны одним и тем же приёмом — costedSkus + summaryEconomyAsOf", async () => {
  const sql = await load();
  const costedSumBlocks = sql.match(/const costed\w+Daily = days\.map\(\(day, index\) => \{\n\s*if \(day > summaryEconomyAsOf\) return null;\n\s*let sum = 0, any = false;\n\s*for \(const sku of costedSkus\) \{/g) ?? [];
  assert.equal(costedSumBlocks.length, 3, "ожидались три одинаково устроенных блока — costedBuyoutsSumDaily (margin_pct), costedBuyoutsCountDaily (profit_per_unit), costedAdSpendDaily (romi)");
});
