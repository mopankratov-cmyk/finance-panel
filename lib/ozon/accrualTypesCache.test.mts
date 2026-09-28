import assert from "node:assert/strict";
import test from "node:test";
import { labelFromAccrualType, parseAccrualTypeRows } from "./accrualTypesCache.ts";

test("maps Ozon's accrual-types response into upsert-ready rows", () => {
  const now = new Date("2026-09-25T00:00:00.000Z");
  const rows = parseAccrualTypeRows(
    [
      { id: 69, name: "SaleCommission", description: "Комиссия за продажу" },
      { id: 12, name: "SomeNonItemFee", description: "" },
    ],
    now,
  );
  assert.deepEqual(rows, [
    { type_id: 69, name: "SaleCommission", description: "Комиссия за продажу", updated_at: "2026-09-25T00:00:00.000Z" },
    { type_id: 12, name: "SomeNonItemFee", description: "", updated_at: "2026-09-25T00:00:00.000Z" },
  ]);
});

test("drops entries with a non-finite or missing id rather than writing a broken primary key", () => {
  const now = new Date("2026-09-25T00:00:00.000Z");
  const rows = parseAccrualTypeRows(
    [
      { id: 69, name: "SaleCommission", description: "" },
      { id: Number.NaN, name: "Broken", description: "" },
    ] as never,
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type_id, 69);
});

test("labelFromAccrualType prefers the Russian description over the internal English name (finding I5)", () => {
  // The plan's own fixture has name: "SaleCommission", description: "Комиссия
  // за продажу" — a finance report for a Russian-speaking user should show
  // the description, not Ozon's internal identifier.
  assert.equal(
    labelFromAccrualType({ name: "SaleCommission", description: "Комиссия за продажу" }),
    "Комиссия за продажу",
  );
});

test("labelFromAccrualType falls back to name when description is empty", () => {
  assert.equal(labelFromAccrualType({ name: "SomeNonItemFee", description: "" }), "SomeNonItemFee");
});
