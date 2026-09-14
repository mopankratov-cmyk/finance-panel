import test from "node:test";
import assert from "node:assert/strict";
import { diffPurchaseOrderRevision, disallowedPurchaseNmIds, normalizePurchaseOrderPayload, purchaseOrderTotals } from "../lib/purchases/order";

const draft = {
  cabinetId: "cabinet-1",
  orderNumber: "Z-2026-007",
  supplier: "Yiwu Factory",
  orderDate: "2026-07-13",
  productionDays: 21,
  currency: "CNY",
  exchangeRate: 12.5,
  status: "draft",
  items: [{ nmId: 101, article: "NORVIA-1", name: "Товар", quantity: 100, unitPrice: 20 }],
  paymentStages: [{ title: "Фабрика", percent: 100, amount: 2_000, dueDate: null, paidAt: null, status: "planned" }],
  logisticsStages: [{ title: "Карго", provider: "Cargo", dueDate: null, completedAt: null, cost: 5_000, status: "planned" }],
  expenses: [{ title: "Сертификация", amount: 1_000, currency: "RUB" }],
};

test("purchase order normalizes dates and calculates the complete landed total", () => {
  const result = normalizePurchaseOrderPayload(draft);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.expectedReadyDate, "2026-08-03");
  assert.deepEqual(purchaseOrderTotals(result.value), {
    goodsCurrency: 2_000,
    goodsRub: 25_000,
    logisticsRub: 5_000,
    expensesRub: 1_000,
    totalRub: 31_000,
    quantity: 100,
  });
});

test("purchase order rejects duplicate SKU and invalid quantity", () => {
  const duplicate = normalizePurchaseOrderPayload({ ...draft, items: [...draft.items, { ...draft.items[0], quantity: 1 }] });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error, /уже добавлен/);

  const invalid = normalizePurchaseOrderPayload({ ...draft, items: [{ ...draft.items[0], quantity: 0 }] });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /количество/);
});

test("active order requires line items and payment allocation of exactly 100 percent", () => {
  const noItems = normalizePurchaseOrderPayload({ ...draft, status: "placed", items: [] });
  assert.equal(noItems.ok, false);
  if (!noItems.ok) assert.match(noItems.error, /позицию/);

  const incompletePayment = normalizePurchaseOrderPayload({
    ...draft,
    status: "production",
    paymentStages: [{ ...draft.paymentStages[0], percent: 50 }],
  });
  assert.equal(incompletePayment.ok, false);
  if (!incompletePayment.ok) assert.match(incompletePayment.error, /100%/);
});

test("additional expenses use either rubles or the order exchange rate", () => {
  const result = normalizePurchaseOrderPayload({ ...draft, expenses: [{ title: "Страховка", amount: 10, currency: "USD" }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /RUB.*CNY/);
});

test("Optima allowlist fails closed and reports every foreign SKU", () => {
  assert.deepEqual(disallowedPurchaseNmIds(draft.items, new Set()), [101]);
  assert.deepEqual(disallowedPurchaseNmIds([...draft.items, { ...draft.items[0], nmId: 999 }], new Set([101])), [999]);
  assert.deepEqual(disallowedPurchaseNmIds(draft.items, null), []);
});

// Форма operation_audit_log.before_data/after_data: колонки БД (snake_case)
// на верхнем уровне, items/этапы — camelCase, как их шлёт форма (202609140005).
const revisionSnapshot = (overrides: Record<string, unknown> = {}) => ({
  order_number: "Z-2026-007",
  supplier: "Yiwu Factory",
  order_date: "2026-07-13",
  production_days: 21,
  expected_ready_date: "2026-08-03",
  currency: "CNY",
  exchange_rate: 12.5,
  status: "draft",
  note: "",
  items: [{ nmId: 101, article: "NORVIA-1", name: "Товар", quantity: 100, unitPrice: 20 }],
  ...overrides,
});

test("order revision diff is empty when a snapshot is missing (first save)", () => {
  assert.deepEqual(diffPurchaseOrderRevision(null, revisionSnapshot()), []);
});

test("order revision diff reports only fields that actually changed", () => {
  const before = revisionSnapshot();
  const after = revisionSnapshot({ production_days: 30, expected_ready_date: "2026-08-12", status: "placed" });
  const changes = diffPurchaseOrderRevision(before, after);
  assert.deepEqual(changes, [
    { kind: "field", field: "productionDays", before: "21", after: "30" },
    { kind: "field", field: "expectedReadyDate", before: "2026-08-03", after: "2026-08-12" },
    { kind: "field", field: "status", before: "draft", after: "placed" },
  ]);
});

test("order revision diff tracks item price and quantity changes, additions and removals", () => {
  const before = revisionSnapshot({
    items: [
      { nmId: 101, article: "NORVIA-1", name: "Товар", quantity: 100, unitPrice: 20 },
      { nmId: 102, article: "NORVIA-2", name: "Товар 2", quantity: 50, unitPrice: 15 },
    ],
  });
  const after = revisionSnapshot({
    items: [
      { nmId: 101, article: "NORVIA-1", name: "Товар", quantity: 120, unitPrice: 22 },
      { nmId: 103, article: "NORVIA-3", name: "Товар 3", quantity: 40, unitPrice: 18 },
    ],
  });
  const changes = diffPurchaseOrderRevision(before, after);
  assert.deepEqual(changes, [
    {
      kind: "itemChanged", nmId: 101, article: "NORVIA-1",
      quantityBefore: 100, quantityAfter: 120, unitPriceBefore: 20, unitPriceAfter: 22,
      articleBefore: "NORVIA-1", articleAfter: "NORVIA-1", nameBefore: "Товар", nameAfter: "Товар",
    },
    { kind: "itemAdded", nmId: 103, article: "NORVIA-3", quantity: 40, unitPrice: 18 },
    { kind: "itemRemoved", nmId: 102, article: "NORVIA-2" },
  ]);
});

test("order revision diff is stable when nothing changed", () => {
  const snapshot = revisionSnapshot();
  assert.deepEqual(diffPurchaseOrderRevision(snapshot, snapshot), []);
});

test("order revision diff reports an article/name-only change even when quantity and price stay the same", () => {
  const before = revisionSnapshot({ items: [{ nmId: 101, article: "NORVIA-1", name: "Товар", quantity: 100, unitPrice: 20 }] });
  const after = revisionSnapshot({ items: [{ nmId: 101, article: "NORVIA-01", name: "Товар", quantity: 100, unitPrice: 20 }] });
  const changes = diffPurchaseOrderRevision(before, after);
  assert.deepEqual(changes, [
    {
      kind: "itemChanged", nmId: 101, article: "NORVIA-01",
      quantityBefore: 100, quantityAfter: 100, unitPriceBefore: 20, unitPriceAfter: 20,
      articleBefore: "NORVIA-1", articleAfter: "NORVIA-01", nameBefore: "Товар", nameAfter: "Товар",
    },
  ]);
});

test("order revision diff skips item-level comparison for a legacy snapshot with no items key at all", () => {
  // before_data written by save_purchase_order before 202609140005 never had
  // an `items` key — must not be read as "items: []", or every real item on
  // the order would show up as a fabricated itemAdded.
  const { items: _omit, ...legacyBefore } = revisionSnapshot();
  const after = revisionSnapshot({ production_days: 30 });
  const changes = diffPurchaseOrderRevision(legacyBefore, after);
  assert.deepEqual(changes, [{ kind: "field", field: "productionDays", before: "21", after: "30" }]);
});
