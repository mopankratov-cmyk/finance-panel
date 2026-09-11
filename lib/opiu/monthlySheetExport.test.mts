import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyOpiuStatement } from "./monthlyStatement.ts";
import { buildMonthlyOpiuSheetPayload } from "./monthlySheetExport.ts";

test("месячный ОПиУ выгружается отдельным листом с числовыми суммами и полнотой", () => {
  const statement = buildMonthlyOpiuStatement({
    wb: { revenue_before_spp: 1000, commission: 100, acquiring: 20, ad: 30, other: 10, cogs: 300, logistics: null, storage: null, penalty: null },
    ozon: { revenue: 500, commission: 50, delivery: 40, services: 20, cogs: 150 },
  });
  const payload = buildMonthlyOpiuSheetPayload(statement, { monthLabel: "сентябрь 2026 г.", generatedAt: "11.09.2026, 12:00" });
  assert.match(payload.sheetName, /^ОПиУ /);
  assert.deepEqual(payload.rows[5], ["Статья", "WB", "Ozon", "Общие", "Итого", "Известная часть", "Источник", "Полнота"]);
  const sales = payload.rows.find((row) => row[0] === "Продажи на МП")!;
  assert.equal(sales[1], 1000);
  assert.equal(sales[2], 500);
  assert.equal(sales[4], 1500);
  const logistics = payload.rows.find((row) => row[0] === "Логистика маркетплейсов")!;
  assert.equal(logistics[4], "");
  assert.equal(logistics[5], 40);
  assert.equal(logistics[7], "Частично");
});
