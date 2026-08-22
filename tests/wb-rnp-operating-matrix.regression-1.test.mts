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

test("WB RNP exposes seven configurable metric views and persists a custom order", () => {
  assert.deepEqual(
    RNP_VIEW_PRESETS.map((preset) => preset.label),
    ["Основное", "Продажи и возвраты", "Цены", "Конверсии", "Реклама", "Остатки", "Юнит-экономика"],
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
  assert.match(toolbar, /nmID \/ артикул — можно списком/);
  // Поиск фильтрует по ОТЛОЖЕННОМУ значению: ввод не должен на каждый символ
  // пересобирать сводку/дельты/ленту (см. fix перф-аудита).
  assert.match(page, /matchesArticleList\(sku, deferredArticleQuery\)/);
  assert.match(page, /useDeferredValue\(articleQuery\)/);
  assert.match(page, /detectSkuAnomalies/);
  assert.match(toolbar, /Только риски/);
  assert.match(toolbar, /Только рост/);
});

test("WB RNP turnover window reaches the cached table calculation", () => {
  // Контрол переехал в шапку-тулбар («Окно оборач. N дн», как у референса).
  assert.match(toolbar, /Окно оборач\./);
  assert.match(toolbar, /props\.onTurnoverWindowChange/);
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
  // Счётчик видимости показателей теперь в стиле референса: 👁 N/78.
  assert.match(toolbar, /\{props\.metricFields\.length\}\/\{RNP_METRIC_FIELDS\.length\}/);
  assert.match(toolbar, /Показатели · тяните ⠿ для порядка/);
});

test("WB RNP mirrors the Optima default week, grouped matrix and display controls", () => {
  assert.match(page, /useState<DateRange>\(\(\) => rangeFor\("week"\)\)/);
  assert.match(page, /finance-panel:wb-rnp-operating-matrix:v2/);
  assert.match(page, /OPTIMA_TABLE_GROUPS/);
  assert.match(page, /Продажи и возвраты/);
  assert.match(page, /groupedMetrics\.map/);
  assert.match(toolbar, /aria-label="Бренд товара"/);
  assert.match(toolbar, /Бренд: все/);
  assert.match(toolbar, /Категория: все/);
  assert.match(toolbar, /Настройки отображения/);
  assert.match(toolbar, /Формат чисел/);
});

test("WB RNP shared tags and product journal stay scoped to one cabinet", () => {
  assert.match(drawer, /Общие для всех сотрудников кабинета/);
  assert.match(drawer, /Сохранить в журнал/);
  assert.match(page, /setOperationsSkuNm\(null\)/);
  assert.match(page, /journalByNm\.get\(sku\.nm\)/);
  assert.match(operationsRoute, /Для тегов и журнала выберите один WB-кабинет/);
  assert.match(operationsRoute, /requestAllowedNmIds/);
  assert.match(operationsRoute, /loadJournalEntries/);
  assert.match(operationsRoute, /\.range\(from, from \+ pageSize - 1\)/);
  assert.match(operationsRoute, /action === "set_tag"/);
  assert.match(operationsRoute, /action === "add_journal"/);
  assert.match(operationsMigration, /foreign key \(cabinet_id, tag_id\)/);
});

test("теги РНП можно переименовать и удалить, а назначать — без журнала", () => {
  // Раньше «+ тег» в карточке открывал панель «Теги и журнал» целиком, а
  // переименования и удаления не существовало: опечатка в теге жила вечно.
  assert.match(operationsRoute, /action === "rename_tag"/);
  assert.match(operationsRoute, /action === "delete_tag"/);
  // Удаление снимает тег с товаров каскадом схемы — и локальное состояние
  // страницы обязано зеркалить это, иначе чипы висят до перезагрузки.
  assert.match(page, /setTagAssignments\(\(current\) => current\.filter\(\(item\) => item\.tag_id !== tagId\)\)/);
  assert.match(page, /QuickTagPicker/);
  assert.match(toolbar, /onRenameTag/);
  assert.match(toolbar, /onDeleteTag/);
  assert.match(toolbar, /Удалить тег «\$\{tag\.name\}»/ );
});
