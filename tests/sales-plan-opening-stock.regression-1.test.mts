import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateSalesPlanRowStockRisk,
  emptySalesPlanMonths,
  emptySalesPlanOpeningStocks,
  normalizeSalesPlanRow,
  salesPlanOpeningStock,
  type SalesPlanRow,
} from "../lib/planning/salesPlan";

const table = readFileSync(new URL("../components/planning/SalesPlanTable.tsx", import.meta.url), "utf8");

function row(): SalesPlanRow {
  const months = emptySalesPlanMonths(2026);
  months["08"] = [4, 4, 4];
  return {
    id: "sku",
    model: "NV-1",
    modelName: "Куртка",
    variant: "NV-1-BLK",
    color: "Чёрный",
    externalId: "1",
    price: 1_000,
    buyout: 50,
    adPct: 10,
    stock: 99,
    openingStocks: { ...emptySalesPlanOpeningStocks(99), "08": 10 },
    image: null,
    isNew: false,
    months,
  };
}

test("остаток на начало хранится отдельно для каждого месяца и участвует в дефиците", () => {
  const current = row();
  assert.equal(salesPlanOpeningStock(current, "08"), 10);
  assert.deepEqual(calculateSalesPlanRowStockRisk(current, "08"), {
    currentStock: 10,
    plannedOrders: 12,
    endingStock: -2,
    shortageDay: 3,
    shortageQty: 2,
  });
});

test("старые планы без нового поля совместимы и используют прежний остаток", () => {
  const normalized = normalizeSalesPlanRow({ ...row(), openingStocks: undefined, stock: 77 }, 2026);
  assert.equal(normalized.openingStocks?.["08"], 77);
});

test("таблица показывает редактируемый жёлтый столбец после рекламного процента", () => {
  assert.match(table, /Ост\. нач\./);
  assert.match(table, /Предполагаемый остаток на начало выбранного месяца/);
  assert.match(table, /openingStocks: \{ \.\.\.row\.openingStocks, \[monthKey\]/);
  assert.ok(table.indexOf(">Рек %<") < table.indexOf("Ост. нач."));
});
