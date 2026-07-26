import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RNP_VIEW_PRESETS } from "../lib/rnp/operatingMatrix";

const page = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../components/wb/RnpOperatingToolbar.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../components/wb/RnpProductOperationsDrawer.tsx", import.meta.url), "utf8");
const tableRoute = readFileSync(new URL("../app/api/rnp/[shop]/table/route.ts", import.meta.url), "utf8");
const operationsRoute = readFileSync(new URL("../app/api/rnp/[shop]/operations/route.ts", import.meta.url), "utf8");
const operationsMigration = readFileSync(new URL("../supabase/migrations/20260726_wb_rnp_operations.sql", import.meta.url), "utf8");

test("WB RNP exposes five configurable metric views and persists a custom order", () => {
  assert.deepEqual(
    RNP_VIEW_PRESETS.map((preset) => preset.label),
    ["Основное", "Конверсии", "Реклама", "Остатки", "Юнит-экономика"],
  );
  assert.match(page, /RNP_MATRIX_STORAGE_KEY/);
  assert.match(page, /setMetricViewId\("custom"\)/);
  assert.match(toolbar, /moveMetric/);
});

test("WB RNP renders previous-period deltas, heatmap and sparklines in the operating table", () => {
  assert.match(page, /previousEqualRange/);
  assert.match(page, /previousController/);
  assert.match(page, /previousValue=\{previousMetric\?\.daily\[index\]\}/);
  assert.match(page, /<DeltaMark/);
  assert.match(page, /<Sparkline values=\{metric\.daily\}/);
  assert.match(page, /heatmapEnabled/);
});

test("WB RNP supports article-list filtering and anomaly direction filters", () => {
  assert.match(toolbar, /Артикулы или WB ID/);
  assert.match(page, /matchesArticleList\(sku, articleQuery\)/);
  assert.match(page, /detectSkuAnomalies/);
  assert.match(toolbar, /Риски/);
  assert.match(toolbar, /Рост/);
});

test("WB RNP turnover window reaches the cached table calculation", () => {
  assert.match(toolbar, /Окно расчёта оборачиваемости/);
  assert.match(page, /turnover_days: String\(turnoverWindowDays\)/);
  assert.match(tableRoute, /sp\.get\("turnover_days"\)/);
});

test("WB RNP shared tags and product journal stay scoped to one cabinet", () => {
  assert.match(drawer, /Общие для всех сотрудников кабинета/);
  assert.match(drawer, /Сохранить в журнал/);
  assert.match(operationsRoute, /Для тегов и журнала выберите один WB-кабинет/);
  assert.match(operationsRoute, /requestAllowedNmIds/);
  assert.match(operationsRoute, /\.range\(from, from \+ pageSize - 1\)/);
  assert.match(operationsRoute, /action === "set_tag"/);
  assert.match(operationsRoute, /action === "add_journal"/);
  assert.match(operationsMigration, /foreign key \(cabinet_id, tag_id\)/);
});
