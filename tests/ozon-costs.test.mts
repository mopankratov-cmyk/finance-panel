import assert from "node:assert/strict";
import test from "node:test";
import {
  createOzonCostResolver,
  normalizeOzonProductName,
  ozonProductNameSimilarity,
} from "../lib/ozon/costs";

test("Ozon cost resolver matches offer ids case-insensitively", () => {
  const costs = createOzonCostResolver([
    { article: "TT04101", name: "Водяной пистолет УЗИ (207мл) черный с глушителем", cost_rub: 550 },
  ]);

  assert.deepEqual(costs.resolve({ offerId: "tt04101" }), {
    article: "TT04101",
    name: "Водяной пистолет УЗИ (207мл) черный с глушителем",
    cost: 550,
    source: "article",
  });
});

test("Ozon cost resolver transfers WB costs to Ozon by product name", () => {
  const costs = createOzonCostResolver([
    { article: "WB-CLR-01", name: "Солнцезащитный увлажняющий крем для лица и тела 50 мл", cost_rub: 320 },
  ]);

  assert.deepEqual(costs.resolve({ offerId: "OZON-999", names: ["Солнцезащитный увлажняющий крем для лица и тела, 50 мл"] }), {
    article: "WB-CLR-01",
    name: "Солнцезащитный увлажняющий крем для лица и тела 50 мл",
    cost: 320,
    source: "name",
  });
});

test("Ozon cost resolver ignores zero-cost article rows and falls back to product name", () => {
  const costs = createOzonCostResolver([
    { article: "OZON-999", name: "Солнцезащитный увлажняющий крем для лица и тела 50 мл", cost_rub: 0 },
    { article: "WB-CLR-01", name: "Солнцезащитный увлажняющий крем для лица и тела 50 мл", cost_rub: 320 },
  ]);

  assert.deepEqual(costs.resolve({ offerId: "OZON-999", names: ["Солнцезащитный увлажняющий крем для лица и тела, 50 мл"] }), {
    article: "WB-CLR-01",
    name: "Солнцезащитный увлажняющий крем для лица и тела 50 мл",
    cost: 320,
    source: "name",
  });
});

test("Ozon cost resolver uses only confident fuzzy product-name matches", () => {
  assert.equal(
    normalizeOzonProductName("Водяной пистолет УЗИ (207мл) — чёрный с глушителем"),
    "водяной пистолет узи 207мл черный с глушителем",
  );
  assert.ok(
    ozonProductNameSimilarity("Пенал школьный розовый", "Пенал школьный (розовый)") >= 0.86,
  );

  const costs = createOzonCostResolver([
    { article: "PINK-PENCIL", name: "Пенал школьный (розовый)", cost_rub: 170 },
    { article: "BLACK-PENCIL", name: "Пенал школьный (черный)", cost_rub: 175 },
  ]);

  assert.equal(costs.resolve({ offerId: "OZ-PINK", names: ["Пенал школьный розовый"] })?.article, "PINK-PENCIL");
  assert.equal(costs.resolve({ offerId: "OZ-GENERIC", names: ["Пенал школьный"] }), null);
});

test("Ozon cost resolver does not use ambiguous exact names with different costs", () => {
  const costs = createOzonCostResolver([
    { article: "A", name: "Набор косметический", cost_rub: 100 },
    { article: "B", name: "Набор косметический", cost_rub: 200 },
  ]);

  assert.equal(costs.resolve({ offerId: "OZ", names: ["Набор косметический"] }), null);
});
