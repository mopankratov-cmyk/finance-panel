import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

// Роль «Менеджер МП» ведёт кабинеты маркетплейсов. Страницы ОПиУ, P&L и
// репрайсера ей закрыты ролью, но /api/* пропускал любую живую сессию —
// и /api/opiu (у которого нет собственной проверки роли) открывался из
// консоли браузера одним fetch.
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("роль manager отсекается на /api/*, а не только на страницах", () => {
  assert.match(proxy, /session\.role === "manager" && !isManagerApiAllowed/);
});

test("закрыт финансовый контур, рабочие инструменты менеджера открыты", () => {
  const body = proxy.slice(proxy.indexOf("const MANAGER_DENIED_API"), proxy.indexOf("export async function proxy"));
  assert.match(body, /"\/api\/opiu"/);
  assert.match(body, /"\/api\/repricer"/);
  // Ozon-кокпит, WB-аналитика, склад, поставки и себестоимость менеджеру нужны
  // для работы — они не должны попасть в запрет.
  for (const working of ["/api/ozon", "/api/wb", "/api/warehouse", "/api/supplies", "/api/costs", "/api/rnp"]) {
    assert.ok(!body.includes(`"${working}"`), `в запрет менеджеру попал рабочий путь ${working}`);
  }
});
