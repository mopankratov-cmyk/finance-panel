import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buyerDiscountForOffer,
  mergeBuyerDiscountSources,
  taxableOzonPrice,
  EMPTY_OZON_BUYER_DISCOUNT,
} from "../lib/ozon/buyerDiscount";
import type { OzonRealizationRow } from "../lib/ozon/api";

// Ozon добивает часть цены за покупателя: продавец ставит 2070 ₽, покупатель платит
// 930 ₽, разницу закрывают баллы Ozon и софинансирование банка (проверено на отчёте
// о реализации за июль 2026). Налог платится с того, что заплатил покупатель.

const discountOf = (rows: OzonRealizationRow[], label = "2026-07") =>
  mergeBuyerDiscountSources([{ label, rows }]);

const row = (over: Partial<OzonRealizationRow>): OzonRealizationRow => ({
  sku: "1282975117",
  offerId: "JG0902",
  name: "Товар",
  quantity: 1,
  pricePerInstance: 930.17,
  sellerPricePerInstance: 2070,
  ...over,
});

test("доля скидки считается по каждому товару отдельно", () => {
  const discount = discountOf([
    row({ offerId: "JG0902", pricePerInstance: 930.17, sellerPricePerInstance: 2070 }),
    row({ offerId: "ESC00124", pricePerInstance: 220, sellerPricePerInstance: 300 }),
  ]);
  assert.equal(Math.round((discount.byOffer.get("JG0902") ?? 0) * 1000) / 10, 55.1);
  assert.equal(Math.round((discount.byOffer.get("ESC00124") ?? 0) * 1000) / 10, 26.7);
  assert.equal(discount.covered, 2);
  assert.deepEqual(discount.sources, ["2026-07 (+2)"]);
});

test("строки взвешиваются количеством, а не считаются поштучно", () => {
  const discount = discountOf([
    row({ offerId: "A", quantity: 10, pricePerInstance: 100, sellerPricePerInstance: 200 }),
    row({ offerId: "A", quantity: 1, pricePerInstance: 190, sellerPricePerInstance: 200 }),
  ]);
  // (10×100 + 190) / (11×200) = 1190 / 2200 → скидка 45.9%, а не среднее из 50% и 5%.
  assert.equal(Math.round((discount.byOffer.get("A") ?? 0) * 1000) / 10, 45.9);
});

// Скидка у каждого товара своя — разброс в кабинете от 20% до 63%. Подставить
// чужую среднюю значит соврать про конкретный товар, поэтому доля остаётся неизвестной.
test("товару без своих строк чужая средняя не подставляется", () => {
  const discount = discountOf([row({ offerId: "A", pricePerInstance: 150, sellerPricePerInstance: 300 })]);
  assert.equal(buyerDiscountForOffer(discount, "A"), 0.5);
  assert.equal(buyerDiscountForOffer(discount, "нет-такого"), null);
});

test("товар берёт долю из самого свежего отчёта, где он есть", () => {
  const discount = mergeBuyerDiscountSources([
    { label: "по дням", rows: [row({ offerId: "A", pricePerInstance: 240, sellerPricePerInstance: 300 })] },
    { label: "2026-07", rows: [
      row({ offerId: "A", pricePerInstance: 150, sellerPricePerInstance: 300 }),
      row({ offerId: "B", pricePerInstance: 100, sellerPricePerInstance: 400 }),
    ] },
  ]);
  const round = (value: number | null) => (value == null ? null : Math.round(value * 1000) / 1000);
  // A уже был в свежем отчёте — старая доля его не перебивает.
  assert.equal(round(buyerDiscountForOffer(discount, "A")), 0.2);
  // B в свежем окне не продавался — добираем из закрытого месяца.
  assert.equal(buyerDiscountForOffer(discount, "B"), 0.75);
  assert.deepEqual(discount.sources, ["по дням (+1)", "2026-07 (+1)"]);
});

test("без отчёта скидка неизвестна, а не нулевая", () => {
  assert.equal(buyerDiscountForOffer(EMPTY_OZON_BUYER_DISCOUNT, "A"), null);
  // Неизвестная скидка оставляет базой цену продавца — прежнее поведение, но помеченное.
  assert.equal(taxableOzonPrice(300, null), 300);
});

test("база налога — цена покупателя", () => {
  assert.equal(taxableOzonPrice(300, 0.267), 219.9);
  const taxPct = 7;
  assert.equal(Math.round(taxableOzonPrice(300, 0.267) * taxPct / 100), 15);
  // До правки было бы 300 × 7% = 21 ₽.
  assert.notEqual(Math.round(300 * taxPct / 100), 15);
});

test("цена покупателя выше цены продавца не даёт отрицательной скидки", () => {
  const discount = discountOf([row({ offerId: "A", pricePerInstance: 400, sellerPricePerInstance: 300 })]);
  assert.equal(discount.byOffer.get("A"), 0);
});

test("цена покупателя читается из блока доставки, цена продавца — с верхнего уровня", async () => {
  const api = await readFile(new URL("../lib/ozon/api.ts", import.meta.url), "utf8");
  assert.match(api, /pricePerInstance: Number\(delivery\.price_per_instance/);
  assert.match(api, /sellerPricePerInstance: Number\(row\.seller_price_per_instance/);
});

test("юнит и кокпит Ozon считают налог от цены покупателя", async () => {
  const [route, cockpit] = await Promise.all([
    readFile(new URL("../app/api/ozon/unit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ozon/cockpit.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /const taxRub = Math\.round\(\(buyerPrice \* taxPct\) \/ 100\)/);
  assert.doesNotMatch(route, /const taxRub = Math\.round\(\(price \* taxPct\) \/ 100\)/);
  assert.match(cockpit, /const tax = buyerPrice \* taxPct \/ 100/);
  assert.doesNotMatch(cockpit, /const tax = salePrice \* taxPct \/ 100/);
});

test("временная диагностика убрана из ответа юнита", async () => {
  const route = await readFile(new URL("../app/api/ozon/unit/route.ts", import.meta.url), "utf8");
  for (const leftover of ["priceFieldsSample", "postingFinanceSample", "realizationSample"]) {
    assert.doesNotMatch(route, new RegExp(leftover), `в ответе осталась диагностика ${leftover}`);
  }
  // Источники скидки должны быть видны: лаг закрытого месяца нельзя подразумевать.
  assert.match(route, /buyerDiscountSources: buyerDiscount\.sources/);
});
