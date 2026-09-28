import assert from "node:assert/strict";
import test from "node:test";
import { sumOzonAdSpend } from "./opiuOzonAdSpend.ts";

test("uses the cabinet-total row for a day when it is present", () => {
  const total = sumOzonAdSpend([
    { client_id: "c1", sku: "*", date: "2026-08-01", spent: 500 },
    { client_id: "c1", sku: "sku-1", date: "2026-08-01", spent: 100 },
    { client_id: "c1", sku: "sku-2", date: "2026-08-01", spent: 200 },
  ]);
  // Must not double-count: 500, not 500 + 100 + 200.
  assert.equal(total, 500);
});

test("falls back to summing per-SKU rows for a day with no cabinet-total row yet", () => {
  const total = sumOzonAdSpend([
    { client_id: "c1", sku: "sku-1", date: "2026-08-01", spent: 100 },
    { client_id: "c1", sku: "sku-2", date: "2026-08-01", spent: 200 },
  ]);
  assert.equal(total, 300);
});

test("chooses the source independently per cabinet per day — one cabinet's per-SKU rows are not lost because another cabinet has a total (spec: same fix as app/api/ozon/ad-journal/route.ts)", () => {
  const total = sumOzonAdSpend([
    { client_id: "c1", sku: "*", date: "2026-08-01", spent: 500 },
    { client_id: "c2", sku: "sku-1", date: "2026-08-01", spent: 50 },
    { client_id: "c2", sku: "sku-2", date: "2026-08-01", spent: 25 },
  ]);
  assert.equal(total, 500 + 50 + 25);
});

test("the empty-day marker ('-') contributes nothing", () => {
  const total = sumOzonAdSpend([{ client_id: "c1", sku: "-", date: "2026-08-01", spent: 0 }]);
  assert.equal(total, 0);
});

test("an empty input returns zero", () => {
  assert.equal(sumOzonAdSpend([]), 0);
});
