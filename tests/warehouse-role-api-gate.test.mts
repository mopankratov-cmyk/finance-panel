import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Роль «Оператор склада» — это сотрудник фулфилмента, чужой компании. Страницы
// ему закрывал canAccess, а /api/* пропускал любую живую сессию: из консоли
// открывались прибыль, закупочные цены и условия фабрик.
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("роль warehouse отсекается на /api/*, а не только на страницах", () => {
  // Узкие списки API писались на одну роль и применяются к сотруднику
  // РОВНО с этой ролью: вторая роль обязана добавлять доступ, а не
  // упираться в чужой запрет.
  assert.match(proxy, /roles\.length === 1 && roles\[0\] === "warehouse" && !isWarehouseApiAllowed/);
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
