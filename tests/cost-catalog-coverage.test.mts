import assert from "node:assert/strict";
import test from "node:test";
import { mergeCostCatalog } from "../lib/costs/catalog";

test("cost coverage includes marketplace SKUs missing from product_costs", () => {
  const result = mergeCostCatalog(
    [{ article: "KNOWN", name: "Известный товар", cost_rub: 100 }],
    [
      { article: "KNOWN", name: "Известный товар", source: "WB" },
      { article: "MISSING", name: "Новый товар Ozon", source: "Ozon" },
    ],
  );

  assert.equal(result.count, 2);
  assert.equal(result.filled, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.rows[0].article, "MISSING");
  assert.equal(result.rows[0].cost_rub, 0);
  assert.equal(result.rows[1].source, "WB");
});

test("cost coverage uses the Ozon resolver result without hiding the offer_id", () => {
  const result = mergeCostCatalog(
    [{ article: "WB-ARTICLE", name: "Одинаковый товар", cost_rub: 250 }],
    [{
      article: "OZON-OFFER",
      name: "Одинаковый товар",
      source: "Ozon",
      resolvedCostRub: 250,
      resolvedFrom: "WB-ARTICLE",
    }],
  );

  assert.equal(result.count, 2);
  assert.equal(result.filled, 2);
  assert.deepEqual(result.rows.find((row) => row.article === "OZON-OFFER"), {
    article: "OZON-OFFER",
    name: "Одинаковый товар",
    cost_rub: 250,
    brand: "",
    category: "",
    source: "Ozon",
    inherited_from: "WB-ARTICLE",
  });
});

test("cost coverage deduplicates article casing across catalogues", () => {
  const result = mergeCostCatalog(
    [{ article: "esc00121", name: "Пенал", cost_rub: 170 }],
    [
      { article: "ESC00121", name: "Пенал", source: "WB" },
      { article: "Esc00121", name: "Пенал", source: "Ozon" },
    ],
  );

  assert.equal(result.count, 1);
  assert.equal(result.filled, 1);
  assert.equal(result.rows[0].source, "Ozon, WB");
});
