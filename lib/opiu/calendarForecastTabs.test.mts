import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../components/calendar/CalendarPage.tsx", import.meta.url),
  "utf8",
);

test("calendar forecast tabs default to calendar and mount read-only panels conditionally", () => {
  assert.match(
    source,
    /useState<"calendar" \| "expense" \| "income" \| "forecast" \| "ozon-forecast">\("calendar"\)/,
  );
  assert.match(source, /\["forecast", "Прогноз WB", TrendingUp\]/);
  assert.match(source, /\["ozon-forecast", "Прогноз Ozon", TrendingUp\]/);
  assert.match(
    source,
    /view === "forecast" \? \(\s*<SalesForecastPanel key=\{`\$\{year\}-\$\{month\}`\} year=\{year\} month=\{month\} \/>\s*\) : view === "ozon-forecast" \? \(\s*<OzonForecastPanel key=\{`ozon-\$\{year\}-\$\{month\}`\} year=\{year\} month=\{month\} \/>\s*\) : view === "calendar"/,
  );
});

test("forecast panels are absent from adjacent calendar layout and receive no mutation props", () => {
  const mainContentIndex = source.indexOf('<div id="calendar-main-content"');
  const beforeMainContent = source.slice(0, mainContentIndex);
  const conditionalContent = source.slice(mainContentIndex);

  assert.ok(mainContentIndex > -1);
  assert.doesNotMatch(beforeMainContent, /<SalesForecastPanel|<OzonForecastPanel/);
  assert.equal((conditionalContent.match(/<SalesForecastPanel/g) ?? []).length, 1);
  assert.equal((conditionalContent.match(/<OzonForecastPanel/g) ?? []).length, 1);
  assert.doesNotMatch(
    conditionalContent,
    /(?:SalesForecastPanel|OzonForecastPanel)[\s\S]{0,300}(?:onAddPayment|onUpdatePayment|existingPayments|accounts=\{|companies=\{|companyByPayment)/,
  );
});

test("calendar-only alerts and priority controls stay outside forecast views", () => {
  assert.match(
    source,
    /\{view !== "forecast" && view !== "ozon-forecast" && <div className="rounded-xl border border-slate-200 bg-white p-3">/,
  );
  assert.match(
    source,
    /\{view !== "forecast" && view !== "ozon-forecast" && <FinancialAlertsPanel/,
  );
});

test("selecting a forecast tab clears every open calendar mutation surface before changing view", () => {
  assert.match(
    source,
    /const isForecastView = view === "forecast" \|\| view === "ozon-forecast";/,
  );
  assert.match(
    source,
    /const handleViewChange = \(nextView:[\s\S]*?if \(nextView === "forecast" \|\| nextView === "ozon-forecast"\) \{\s*setSelectedDate\(null\);\s*setQuickAddPending\(false\);\s*setBulkOpen\(false\);\s*setReplaceCalendarOpen\(false\);\s*\}\s*setView\(nextView\);/,
  );
  assert.match(source, /onClick=\{\(\) => handleViewChange\(value\)\}/);
});

test("forecast views guard calendar sync and do not mount surrounding write controls", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(isForecastView \|\| calendarRows\.length <= 1\) return;/,
  );
  assert.match(
    source,
    /\{!isForecastView && \(\s*<div className="flex flex-wrap gap-2">[\s\S]*?syncCalendarToGoogle\(\)[\s\S]*?setReplaceCalendarOpen\(true\)[\s\S]*?<\/div>\s*\)\}/,
  );
  assert.match(source, /\{!isForecastView && <FinanceTasksPanel \/>\}/);
  assert.match(
    source,
    /\{!isForecastView && \(\s*<DayDetailPanel[\s\S]*?onAddPayment=\{handleAddPayment\}[\s\S]*?onUpdatePayment=\{handleUpdatePayment\}[\s\S]*?\/>\s*\)\}/,
  );
  assert.match(
    source,
    /\{!isForecastView && \(\s*<BulkPaymentModal[\s\S]*?dispatch\(\{ type: "ADD_PAYMENT"[\s\S]*?\/>\s*\)\}/,
  );
  assert.match(
    source,
    /\{!isForecastView && \(\s*<ReplaceCalendarModal[\s\S]*?dispatch\(\{ type: "DELETE_PAYMENT"[\s\S]*?dispatch\(\{ type: "ADD_PAYMENT"[\s\S]*?\/>\s*\)\}/,
  );
});
