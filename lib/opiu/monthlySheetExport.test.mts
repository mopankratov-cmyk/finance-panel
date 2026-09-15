import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyOpiuStatement } from "./monthlyStatement.ts";
import { buildMonthlyOpiuSheetPayload } from "./monthlySheetExport.ts";

test("месячный ОПиУ выгружается отдельным листом по выбранной компании без служебных колонок", () => {
  const statement = buildMonthlyOpiuStatement({
    wb: { revenue_before_spp: 1000, commission: 100, acquiring: 0, ad: 30, other: 10, cogs: 300, packaging: 20, logistics: null, storage: null, penalty: null },
    ozon: { revenue: 500, commission: 50, delivery: 40, services: 20, cogs: 150 },
  });
  const payload = buildMonthlyOpiuSheetPayload(statement, { monthKey: "2026-09", monthLabel: "сентябрь 2026 г.", generatedAt: "11.09.2026, 12:00", companyKey: "company-1", companyLabel: "ИП Панкратов" });
  assert.match(payload.sheetName, /^ОПиУ 2026-09 [0-9a-f]{8} ИП Панкратов$/);
  assert.deepEqual(payload.rows[3], ["Компания", "ИП Панкратов", "", "", ""]);
  assert.deepEqual(payload.rows[5], ["Статья", "WB", "Ozon", "Общие", "Итого"]);
  const sales = payload.rows.find((row) => row[0] === "Продажи на МП")!;
  assert.equal(sales[1], 1000);
  assert.equal(sales[2], 500);
  assert.equal(sales[4], 1500);
  const logistics = payload.rows.find((row) => row[0] === "Логистика маркетплейсов")!;
  assert.equal(logistics[4], "");
  assert.equal(logistics[2], 40);
});

test("длинные названия компаний не смешивают месяцы и компании в одном листе", () => {
  const statement = buildMonthlyOpiuStatement({});
  const common = { monthLabel: "сентябрь 2026 г.", generatedAt: "15.09.2026, 12:00", companyLabel: `ООО ${"Очень длинное название ".repeat(8)}` };
  const september = buildMonthlyOpiuSheetPayload(statement, { ...common, monthKey: "2026-09", companyKey: "company-1" });
  const october = buildMonthlyOpiuSheetPayload(statement, { ...common, monthKey: "2026-10", companyKey: "company-1" });
  const otherCompany = buildMonthlyOpiuSheetPayload(statement, { ...common, monthKey: "2026-09", companyKey: "company-2" });
  assert.ok(september.sheetName.length <= 100);
  assert.match(september.sheetName, /^ОПиУ 2026-09 [0-9a-f]{8} /);
  assert.notEqual(september.sheetName, october.sheetName);
  assert.notEqual(september.sheetName, otherCompany.sheetName);
});
