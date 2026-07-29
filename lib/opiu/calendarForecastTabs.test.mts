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
