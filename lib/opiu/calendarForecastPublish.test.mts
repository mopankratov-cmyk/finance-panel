import assert from "node:assert/strict";
import test from "node:test";
import { buildForecastPayments, forecastScopeKey, mergeForecastPublication } from "./calendarForecastPublish.ts";

const scope = { marketplace: "ozon" as const, cabinetId: "cab-1", companyId: "company-1", accountId: "account-1", year: 2026, month: 8 };

test("повторная публикация отчёта обновляет ту же запись", () => {
  const first = buildForecastPayments(scope, [{ key: "report-10", reportId: "report-10", date: "2026-08-20", amount: 100, source: "financial_report" }]);
  const corrected = buildForecastPayments(scope, [{ key: "report-10", reportId: "report-10", date: "2026-08-21", amount: 120, source: "financial_report" }]);
  assert.equal(first[0].id, corrected[0].id);
  assert.equal(corrected[0].amount, 120);
  assert.equal(corrected[0].date, "2026-08-21");
});

test("кабинеты и компании имеют разные устойчивые ключи", () => {
  assert.notEqual(forecastScopeKey(scope), forecastScopeKey({ ...scope, cabinetId: "cab-2" }));
  assert.notEqual(forecastScopeKey(scope), forecastScopeKey({ ...scope, companyId: "company-2" }));
});

test("исчезнувшая строка того же прогноза отменяется без удаления факта", () => {
  const existing = buildForecastPayments(scope, [
    { key: "week-1", date: "2026-08-10", amount: 100, source: "forecast" },
    { key: "week-2", date: "2026-08-17", amount: 200, source: "forecast" },
  ]);
  const desired = buildForecastPayments(scope, [{ key: "week-1", date: "2026-08-11", amount: 150, source: "forecast" }]);
  const merged = mergeForecastPublication(existing, desired, forecastScopeKey(scope));
  assert.equal(merged.find((row) => row.id === existing[1].id)?.status, "cancelled");
  assert.equal(merged.find((row) => row.id === existing[0].id)?.amount, 150);
});
