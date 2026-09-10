import assert from "node:assert/strict";
import test from "node:test";

import { buildOpiuSheetPayload } from "./googleSheetExport";
import type { OpiuReport } from "./buildReport";

const report: OpiuReport = {
  weeks: [{ weekStart: "2026-09-07", rangeFrom: "2026-09-07", rangeTo: "2026-09-13", label: "7–13 сен." }],
  warehouseByWeek: {},
  missingCostArticles: [],
  rows: [
    { id: "orders", label: "Заказы, руб", kind: "metric", values: [1000, 1000] },
    { id: "commission", label: "Комиссия ВБ, руб", kind: "metric", expense: true, values: [200, 200] },
    { id: "commission_pct", label: "% комиссии", kind: "percent", values: [20, 20] },
    { id: "sep", label: "", kind: "separator", values: [null, null] },
    { id: "marginal", label: "Маржинальный доход", kind: "metric", values: [800, 800] },
  ],
};

test("Google export preserves the WB financial report hierarchy and numeric types", () => {
  const payload = buildOpiuSheetPayload(report, {
    brandLabel: "ИП Панкратов",
    periodLabel: "Сентябрь 2026",
    generatedAt: "10.09.2026, 15:30",
  });

  assert.equal(payload.sheetName, "Финансовый отчёт WB ИП Панкрато");
  assert.deepEqual(payload.rows[5], ["Показатель", "7–13 сен.", "Итого"]);
  assert.ok(payload.rows.some((row) => row[0] === "Производственные расходы · Переменные"));
  assert.deepEqual(payload.rows.find((row) => row[0] === "Комиссия ВБ, руб"), ["Комиссия ВБ, руб", 200, 200]);
  assert.deepEqual(payload.rows.find((row) => row[0] === "% комиссии"), ["% комиссии", 0.2, 0.2]);
  assert.equal(payload.rows.some((row) => row[0] === "" && row.every((cell) => cell === "")), true);
});

test("Google sheet name removes forbidden characters and respects the 31 character limit", () => {
  const payload = buildOpiuSheetPayload(report, {
    brandLabel: "Бренд / направление [тест]",
    periodLabel: "01.09.2026:30.09.2026",
    generatedAt: "сейчас",
  });

  assert.ok(payload.sheetName.length <= 31);
  assert.doesNotMatch(payload.sheetName, /[\\/?*\[\]:]/);
});
