import assert from "node:assert/strict";
import test from "node:test";

import {
  filterRnpProductFacets,
  rnpBrandOptions,
  rnpCategoryOptions,
  sortRnpProducts,
  type RnpFacetSku,
} from "./productFacets";

const skus: RnpFacetSku[] = [
  { nm: 1, art: "NV-JACKET", name: "Ветровка", brand: "NORVIA", subject: "Куртки", metrics: [{ field: "orders_sum", total: 150 }] },
  { nm: 2, art: "RB-PENCIL", name: "Пенал", brand: "RIOBOX", subject: "Пеналы", metrics: [{ field: "orders_sum", total: 420 }] },
  { nm: 3, art: "RB-BAG", name: "Сумка", brand: "RIOBOX", subject: "", metrics: [{ field: "orders_sum", total: null }] },
];

test("РНП строит бренды и категории из карточек товаров, а не из кабинетов", () => {
  assert.deepEqual(rnpBrandOptions(skus), ["NORVIA", "RIOBOX"]);
  assert.deepEqual(rnpCategoryOptions(skus, { "RB-BAG": "Сумки" }), ["Куртки", "Пеналы", "Сумки"]);
});

test("фильтры бренда и категории можно применять одновременно", () => {
  assert.deepEqual(
    filterRnpProductFacets(skus, { brand: "RIOBOX", category: "Пеналы" }).map((sku) => sku.nm),
    [2],
  );
  assert.deepEqual(
    filterRnpProductFacets(skus, { category: "__none" }).map((sku) => sku.nm),
    [3],
  );
});

test("сортировка РНП меняет направление и оставляет пустые значения внизу", () => {
  assert.deepEqual(sortRnpProducts(skus, "orders_sum", -1).map((sku) => sku.nm), [2, 1, 3]);
  assert.deepEqual(sortRnpProducts(skus, "orders_sum", 1).map((sku) => sku.nm), [1, 2, 3]);
});
