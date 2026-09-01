import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
    // Фулфилмент наш, а не маркетплейса: у строки, пришедшей только из Ozon,
    // его взять неоткуда, и подставлять туда чужую цифру нельзя.
    fulfillment_rub: 0,
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

test("фулфилмент едет из справочника и не переписывает себестоимость", () => {
  // warehouse_expenses — историческое имя колонки; по данным это фулфилмент на
  // единицу (9–187 ₽ у 170 из 215 товаров), и он уже питает маржу. Экран его
  // раньше не показывал вовсе, поэтому пробел в нём тихо завышал прибыль.
  const result = mergeCostCatalog(
    [{ article: "A1", name: "Товар", cost_rub: 100, warehouse_expenses: 15.5 }],
    [],
  );
  const row = result.rows.find((r) => r.article === "A1");
  assert.equal(row?.cost_rub, 100);
  assert.equal(row?.fulfillment_rub, 15.5);
});

test("пустой фулфилмент — это ноль, а не потеря себестоимости", () => {
  const result = mergeCostCatalog([{ article: "A2", cost_rub: 90 }], []);
  const row = result.rows.find((r) => r.article === "A2");
  assert.equal(row?.cost_rub, 90);
  assert.equal(row?.fulfillment_rub, 0);
});

test("сохранение патчит только присланное", () => {
  // Раньше POST всегда писал cost_rub. С приходом второй денежной графы это
  // значило бы обнуление себестоимости при каждой правке фулфилмента.
  const route = readFileSync(new URL("../app/api/costs/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(cost !== undefined\) patch\.cost_rub = cost;/);
  assert.match(route, /if \(fulfillment !== undefined\) patch\.warehouse_expenses = fulfillment;/);
  assert.match(route, /if \(!Object\.keys\(patch\)\.length\) return NextResponse\.json\(\{ ok: true \}\);/);
  // Отрицательная сумма — опечатка, а не скидка: она молча испортит маржу.
  assert.match(route, /!Number\.isFinite\(parsed\) \|\| parsed < 0/);
});
