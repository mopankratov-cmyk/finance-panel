import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/ozon/rnp/route.ts", import.meta.url), "utf8");
const factView = readFileSync(new URL("../components/planning/SalesPlanFactView.tsx", import.meta.url), "utf8");

// План продаж ведётся по артикулам продавца, а аналитика Ozon отдаёт числовой sku.
// Пока артикул не попадал в ответ, факт не находился ни для одной строки плана:
// весь месяц показывал «—» при живых заказах в API.
test("факт Ozon отдаёт артикул продавца, а не только sku", () => {
  assert.match(route, /art:\s*skuToOffer\[sku\]/);
});

test("план сопоставляет факт по артикулу", () => {
  assert.match(factView, /byId\.set\(sku\.art\.toLocaleLowerCase\("ru-RU"\), sku\)/);
});
