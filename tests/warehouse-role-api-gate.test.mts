import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Роль «Оператор склада» — это сотрудник фулфилмента, чужой компании. Страницы
// ему закрывал canAccess, а /api/* пропускал любую живую сессию: из консоли
// открывались прибыль, закупочные цены и условия фабрик.
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("роль warehouse отсекается на /api/*, а не только на страницах", () => {
  assert.match(proxy, /session\.role === "warehouse" && !isWarehouseApiAllowed/);
});

test("оператору открыт модуль склада и отметка факта приёмки — и ничего больше", () => {
  const body = proxy.slice(proxy.indexOf("function isWarehouseApiAllowed"), proxy.indexOf("function isSellerApiAllowed"));
  assert.match(body, /\/api\/warehouse\//);
  assert.match(body, /supplies\\\/receipts/);
  assert.match(body, /return false;/);
  // Ни одного финансового или закупочного пути в разрешённом списке.
  for (const forbidden of ["/api/opiu", "/api/costs", "/api/purchase-orders", "/api/unit", "/api/rnp"]) {
    assert.ok(!body.includes(forbidden), `в allowlist оператора склада попал ${forbidden}`);
  }
});
