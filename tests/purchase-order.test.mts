import test from "node:test";
import assert from "node:assert/strict";
import { disallowedPurchaseNmIds, normalizePurchaseOrderPayload, purchaseOrderTotals } from "../lib/purchases/order";

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
