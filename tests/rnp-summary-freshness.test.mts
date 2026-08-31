import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summaryFreshnessCutoff } from "../lib/rnp/buildTable";

/**
 * Сводка «все кабинеты» обрезалась по САМОМУ свежему кабинету. За дни, до
 * которых отставший кабинет ещё не досинхронизировался, экран показывал сумму
 * без него — как настоящую. Читается это как обвал продаж, которого не было.
 */

test("граница сводки — по самому отставшему кабинету", () => {
  assert.equal(summaryFreshnessCutoff(["2026-08-29", "2026-08-25", "2026-08-28"]), "2026-08-25");
});

test("кабинет без данных за период границу не двигает", () => {
  assert.equal(summaryFreshnessCutoff([null, "2026-08-27", undefined]), "2026-08-27");
  assert.equal(summaryFreshnessCutoff([null, null]), null, "терять нечего — и обрезать нечего");
});

test("сводка и разрез по SKU используют разные границы", () => {
  const source = readFileSync(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  // Разрез по SKU обязан остаться на границе СВОЕГО кабинета: там сумма чужого
  // кабинета не участвует, и обрезать её по соседу значит терять факты.
  assert.match(source, /cutoffsByNm\.get\(t\.nm_id\) \?\? metricCutoffs/);
  // А сводка — на общей минимальной.
  assert.match(source, /const summary = buildMetrics\([\s\S]{0,200}?summaryCutoffs/);
  assert.match(source, /buildFunnelMetrics\(days, asOf, viewsByDateAll[\s\S]{0,200}?summaryFunnelCutoffs/);
  assert.match(source, /buildAdTypeMetrics\(days, asOf, adTypeBuckets, adTypeUnclassifiedSpent, summaryCutoffs\.adverts\)/);
});

test("экономика сводки обрезана той же границей, что и её базовые метрики", () => {
  const source = readFileSync(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  // Прибыль и себестоимость склеиваются суммой по SKU, а у каждого SKU граница
  // своего кабинета. Без общей отсечки «Выкупы» за день пусты, а «Прибыль» за
  // тот же день — число; хуже, прибыль полного периода делилась на выкупы
  // урезанного, и прибыль на единицу с ROMI выходили завышенными.
  assert.match(source, /const summaryEconomyAsOf = cutoffAsOf\(\s*\n\s*summaryFreshnessCutoff\(\[summaryCutoffs\.sales, summaryCutoffs\.adverts\]\)/);
  assert.match(source, /const sumDaily = \(field: string\) => days\.map\(\(day, i\) => \{\s*\n\s*if \(day > summaryEconomyAsOf\) return null;/);
  assert.match(source, /const costedBuyoutsSumDaily = days\.map\(\(day, index\) => \{\s*\n\s*if \(day > summaryEconomyAsOf\) return null;/);
});
