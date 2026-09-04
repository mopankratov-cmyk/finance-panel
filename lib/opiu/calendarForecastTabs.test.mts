import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../components/calendar/CalendarPage.tsx", import.meta.url), "utf8");

test("calendar forecast tabs default to calendar and mount publication panels conditionally", () => {
  assert.match(source, /useState<"calendar" \| "expense" \| "income" \| "forecast" \| "ozon-forecast">\("calendar"\)/);
  assert.match(source, /<SalesForecastPanel[\s\S]{0,500}accounts=\{state\.accounts\}[\s\S]{0,500}companyByPayment=\{companyByPayment\}/);
  assert.match(source, /<OzonForecastPanel[\s\S]{0,400}accounts=\{state\.accounts\}[\s\S]{0,400}companies=\{companies\}/);
  assert.doesNotMatch(source, /(?:SalesForecastPanel|OzonForecastPanel)[\s\S]{0,400}(?:onAddPayment|onUpdatePayment)/);
});

test("calendar-only mutation controls stay outside forecast views", () => {
  assert.match(source, /const isForecastView = view === "forecast" \|\| view === "ozon-forecast";/);
  // Панель может быть обёрнута в скобки и перенесена на новую строку — сторожу важно условие, а не форматирование.
  assert.match(source, /\{view !== "forecast" && view !== "ozon-forecast" && \(?\s*<FinancialAlertsPanel/);
  assert.match(source, /\{!isForecastView && <FinanceTasksPanel \/>\}/);
  // Авто-выгрузка календаря в Google по таймеру убрана — только кнопка.
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*void syncCalendarToGoogle\(\);/);
});

test("selecting a forecast tab closes open calendar editing surfaces", () => {
  assert.match(source, /if \(nextView === "forecast" \|\| nextView === "ozon-forecast"\) \{\s*setSelectedDate\(null\);\s*setQuickAddPending\(false\);\s*setBulkOpen\(false\);\s*setReplaceCalendarOpen\(false\);/);
});
