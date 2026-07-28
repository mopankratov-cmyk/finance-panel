import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateSalesPlanRowStockRisk,
  emptySalesPlanMonths,
  normalizeSalesPlanRow,
  refreshSalesPlanMarketplaceStocks,
  type SalesPlanDocument,
  type SalesPlanRow,
} from "../lib/planning/salesPlan";

const table = readFileSync(new URL("../components/planning/SalesPlanTable.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

function row(overrides: Partial<SalesPlanRow> = {}): SalesPlanRow {
  const months = emptySalesPlanMonths(2026);
  months["07"] = Array.from({ length: 31 }, (_, index) => index >= 20 ? 2 : 99);
  months["08"] = Array.from({ length: 31 }, () => 4);
  return {
    id: "sku-1",
    model: "NV-1",
    modelName: "Куртка",
    variant: "NV-1-BLK",
    color: "Чёрный",
    externalId: "101",
    price: 1_000,
    buyout: 50,
    adPct: 10,
    stock: 999,
    openingStocks: { "08": 77 },
    ffAllocatedStocks: { "08": 10 },
    marketplaceStocks: { "08": { quantity: 20, asOf: "2026-07-20T12:00:00.000Z", stale: false } },
    image: null,
    isNew: false,
    months,
    ...overrides,
  };
}

function document(current: SalesPlanRow, status: "draft" | "approved" = "draft"): SalesPlanDocument {
  return {
    schemaVersion: 1,
    marketplace: "wb",
    cabinetId: "cabinet",
    year: 2026,
    version: 1,
    revision: 0,
    status,
    responsible: "",
    rows: [current],
    createdAt: "",
    updatedAt: "",
    approvedAt: status === "approved" ? "2026-07-20T12:00:00.000Z" : null,
    approvedBy: status === "approved" ? "owner" : null,
    submittedAt: null,
    submittedBy: null,
    returnedAt: null,
    returnedBy: null,
    returnComment: null,
    monthStates: { "08": {
      monthKey: "08",
      status,
      version: 1,
      revision: 0,
      submittedAt: null,
      submittedBy: null,
      approvedAt: status === "approved" ? "2026-07-20T12:00:00.000Z" : null,
      approvedBy: status === "approved" ? "owner" : null,
      returnedAt: null,
      returnedBy: null,
      returnComment: null,
      rnpSyncedAt: null,
    } },
    rnpSyncedAt: null,
  };
}

test("forecast keeps real stocks outside buyout and applies buyout to remaining plus target orders", () => {
  const risk = calculateSalesPlanRowStockRisk(row(), "08", 2026);
  assert.equal(risk.ffAllocated, 10);
  assert.equal(risk.marketplaceStock, 20);
  assert.equal(risk.remainingOrders, 22);
  assert.equal(risk.targetMonthOrders, 124);
  assert.equal(risk.plannedBuyouts, 73);
  assert.equal(risk.endingStock, -43);
  assert.equal(risk.shortageQty, 43);
});

test("snapshot boundary excludes past and snapshot days", () => {
  const current = row({ marketplaceStocks: { "07": { quantity: 20, asOf: "2026-07-20", stale: false } } });
  const risk = calculateSalesPlanRowStockRisk(current, "07", 2026);
  assert.equal(risk.remainingOrders, 0);
  assert.equal(risk.targetMonthOrders, 22);
});

test("buyout edge rates are rounded once across all considered orders", () => {
  assert.equal(calculateSalesPlanRowStockRisk(row({ buyout: 0 }), "08", 2026).endingStock, 30);
  assert.equal(calculateSalesPlanRowStockRisk(row({ buyout: 100 }), "08", 2026).endingStock, -116);
  assert.equal(calculateSalesPlanRowStockRisk(row({ buyout: 33, months: {
    ...row().months,
    "07": Array.from({ length: 31 }, (_, index) => index > 19 ? 0 : 99),
    "08": [1, 1],
  } }), "08", 2026).plannedBuyouts, 1);
});

test("legacy documents keep the previous opening-stock forecast without double counting", () => {
  const legacy = normalizeSalesPlanRow({
    ...row(),
    ffAllocatedStocks: undefined,
    marketplaceStocks: undefined,
    openingStocks: { "08": 77 },
    months: { ...row().months, "08": [4, 4, 4] },
  }, 2026);
  const risk = calculateSalesPlanRowStockRisk(legacy, "08", 2026);
  assert.equal(risk.currentStock, 77);
  assert.equal(risk.endingStock, 71);
});

test("failed and unmatched refresh keep last-good stock stale; successful zero is current", () => {
  const initial = document(row());
  const failed = refreshSalesPlanMarketplaceStocks(initial, "08", [], {
    failed: true,
    asOf: "2026-07-21T10:00:00.000Z",
  });
  assert.deepEqual(failed.rows[0].marketplaceStocks?.["08"], {
    quantity: 20,
    asOf: "2026-07-20T12:00:00.000Z",
    stale: true,
  });
  const unmatched = refreshSalesPlanMarketplaceStocks(initial, "08", [{ externalId: "other", variant: "OTHER", stock: 0 }], {
    asOf: "2026-07-21T10:00:00.000Z",
  });
  assert.equal(unmatched.rows[0].marketplaceStocks?.["08"]?.quantity, 20);
  assert.equal(unmatched.rows[0].marketplaceStocks?.["08"]?.stale, true);
  const zero = refreshSalesPlanMarketplaceStocks(initial, "08", [{ externalId: "101", variant: "NV-1-BLK", stock: 0 }], {
    asOf: "2026-07-21T10:00:00.000Z",
  });
  assert.deepEqual(zero.rows[0].marketplaceStocks?.["08"], {
    quantity: 0,
    asOf: "2026-07-21T10:00:00.000Z",
    stale: false,
  });
});

test("approved snapshot is immutable and ambiguous variant fallback does not cross-match", () => {
  const approved = document(row(), "approved");
  assert.strictEqual(
    refreshSalesPlanMarketplaceStocks(approved, "08", [{ externalId: "101", variant: "NV-1-BLK", stock: 0 }]),
    approved,
  );
  const ambiguous = refreshSalesPlanMarketplaceStocks(document(row({ externalId: "" })), "08", [
    { externalId: "201", variant: "NV-1-BLK", stock: 1 },
    { externalId: "202", variant: "NV-1-BLK", stock: 2 },
  ]);
  assert.equal(ambiguous.rows[0].marketplaceStocks?.["08"]?.quantity, 20);
  assert.equal(ambiguous.rows[0].marketplaceStocks?.["08"]?.stale, true);
});

test("year boundary fails visibly when the previous-year daily plan is unavailable", () => {
  const current = row({
    marketplaceStocks: { "01": { quantity: 20, asOf: "2026-12-20", stale: false } },
  });
  const risk = calculateSalesPlanRowStockRisk(current, "01", 2027);
  assert.equal(risk.forecastAvailable, false);
  assert.match(risk.unavailableReason ?? "", /границу года/);
});

test("snapshot without as-of fails visibly instead of subtracting unknown past days", () => {
  const current = row({
    marketplaceStocks: { "08": { quantity: 20, asOf: null, stale: true } },
  });
  const risk = calculateSalesPlanRowStockRisk(current, "08", 2026);
  assert.equal(risk.forecastAvailable, false);
  assert.equal(risk.shortageDay, null);
  assert.match(risk.unavailableReason ?? "", /даты снимка/);
});

test("table exposes FF, marketplace and forecast columns in order without editable legacy opening stock", () => {
  const ff = table.indexOf("ФФ, шт.");
  const marketplace = table.indexOf("МП, шт.");
  const forecast = table.indexOf("Прогноз конца");
  assert.ok(table.indexOf(">Рек %<") < ff && ff < marketplace && marketplace < forecast);
  assert.doesNotMatch(table, /Ост\. нач\./);
  assert.doesNotMatch(table, /openingStocks: \{ \.\.\.row\.openingStocks/);
  assert.match(table, /Дефицит/);
});

test("catalog refresh is scope-guarded against stale cabinet requests", () => {
  assert.match(page, /current\.marketplace !== marketplace \|\| current\.cabinetId !== cabinetId \|\| current\.year !== year/);
  assert.match(page, /catalogRequestScope\.current !== targetPeriod/);
  assert.match(page, /`\$\{marketplace\}:\$\{cabinetId\}:\$\{year\}-\$\{activeMonth\}`/);
});
