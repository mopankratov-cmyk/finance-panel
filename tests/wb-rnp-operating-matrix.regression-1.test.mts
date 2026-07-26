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
  assert.match(page, /previousValue=\{dayOverDayBaseline\(metric\.daily, previousMetric\?\.daily, index\)\}/);
  assert.match(page, /index === openDayIndex \? null : dayOverDayBaseline/);
  assert.match(page, /<DeltaMark/);
  assert.match(page, /<Sparkline values=\{metric\.daily\}/);
  assert.match(page, /heatmapEnabled/);
});

test("WB RNP supports article-list filtering and anomaly direction filters", () => {
  assert.match(toolbar, /Поиск \/ список артикулов/);
  assert.match(toolbar, /nmID \/ артикул — можно списком/);
  assert.match(page, /matchesArticleList\(sku, articleQuery\)/);
  assert.match(page, /detectSkuAnomalies/);
  assert.match(toolbar, /Только риски/);
  assert.match(toolbar, /Только рост/);
});

test("WB RNP turnover window reaches the cached table calculation", () => {
  assert.match(page, /Окно оборота, дн/);
  assert.match(toolbar, /окно оборачиваемости \{props\.turnoverWindowDays\} дней/);
  assert.match(page, /turnover_days: String\(turnoverWindowDays\)/);
  assert.match(tableRoute, /sp\.get\("turnover_days"\)/);
});

test("WB RNP follows the Optima matrix composition for summary and every product", () => {
  assert.match(page, /Рука на пульсе/);
  assert.match(page, /title="Общая сводка"/);
  assert.match(page, /function OptimaProductCard/);
  assert.match(page, /function OptimaMatrixTable/);
  assert.match(page, /За период/);
  assert.match(page, /Мини-график/);
  assert.match(page, /Журнал изменений/);
  assert.match(toolbar, /Показатели \{props\.metricFields\.length\}\/\{RNP_METRIC_FIELDS\.length\}/);
  assert.match(toolbar, /Показатели · тяните ⠿ для порядка/);
});

test("WB RNP mirrors the Optima default week, grouped matrix and display controls", () => {
  assert.match(page, /useState<DateRange>\(\(\) => rangeFor\("week"\)\)/);
  assert.match(page, /finance-panel:wb-rnp-operating-matrix:v2/);
  assert.match(page, /OPTIMA_TABLE_GROUPS/);
  assert.match(page, /Продажи и возвраты/);
  assert.match(page, /groupedMetrics\.map/);
  assert.match(toolbar, /Бренд или кабинет/);
  assert.match(toolbar, /Настройки отображения/);
  assert.match(toolbar, /Формат чисел/);
});

test("WB RNP shared tags and product journal stay scoped to one cabinet", () => {
  assert.match(drawer, /Общие для всех сотрудников кабинета/);
  assert.match(drawer, /Сохранить в журнал/);
  assert.match(page, /message\.includes\("вне контура выбранного кабинета"\)/);
  assert.match(page, /setOperationsSkuNm\(null\)/);
  assert.match(operationsRoute, /Для тегов и журнала выберите один WB-кабинет/);
  assert.match(operationsRoute, /requestAllowedNmIds/);
  assert.match(operationsRoute, /nmParam == null \|\| nmParam\.trim\(\) === "" \? null : Number\(nmParam\)/);
  assert.match(operationsRoute, /\.range\(from, from \+ pageSize - 1\)/);
  assert.match(operationsRoute, /action === "set_tag"/);
  assert.match(operationsRoute, /action === "add_journal"/);
  assert.match(operationsMigration, /foreign key \(cabinet_id, tag_id\)/);
});
