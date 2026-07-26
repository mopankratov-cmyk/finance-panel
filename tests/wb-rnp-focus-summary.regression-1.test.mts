import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WB RNP keeps optional management assistant blocks disabled by default", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

  assert.match(source, /const SHOW_RNP_ASSISTANT_BLOCKS = false;/);
  assert.match(source, /SHOW_RNP_ASSISTANT_BLOCKS && \(/);
  assert.match(source, /SHOW_RNP_ASSISTANT_BLOCKS && activeData\?\.scope_freshness/);
  assert.match(source, /SHOW_RNP_ASSISTANT_BLOCKS && activeData && focusSummary/);
  assert.match(source, /buildRnpFocusSummary\(sortedSkus\)/);
  assert.match(source, /Фокус по текущему срезу/);
  assert.match(source, /ДРР = реклама \/ заказы/);
  assert.match(source, /focusSummary\.signals\.map/);
});

test("WB RNP page exposes an article comparison chart for the current slice", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

  assert.match(source, /articleCompareCatalog/);
  assert.match(source, /buildRnpArticleCompare\(sortedSkus, activeData\.period, compareMetric, sortedSkus\.length/);
  assert.match(source, /selectedCompareNms/);
  assert.match(source, /Сравнение артикулов/);
  assert.match(source, /Все артикулы/);
  assert.match(source, /поиск по артикулу, названию или WB ID/);
  assert.match(source, /ResponsiveContainer/);
  assert.match(source, /COMPARE_METRICS\.map/);
  assert.match(source, /cart_conversion/);
  assert.match(source, /setFocusedNm\(line\.nm\)/);
  assert.match(source, /Все SKU/);
});
