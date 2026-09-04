import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canAccess } from "../lib/auth/roles.ts";
import { canManageStock, isExternalSeller, isWarehouseOperator } from "../lib/warehouse/operatorScope.ts";

// Внешний селлер — ЧУЖАЯ компания. Модуль склада ему открыт, чтобы он вёл свой
// склад, и вся граница держится на юрлице: доступные юрлица считаются по
// кабинетам его организации. Эти сторожа следят, чтобы граница не размылась —
// ни списком путей, ни справочником, который отдают целиком.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("селлеру открыт модуль склада и закрыт финансовый контур", () => {
  assert.equal(canAccess("seller", "/warehouse"), true);
  assert.equal(canAccess("seller", "/warehouse/print/abc"), true);
  for (const forbidden of ["/opiu", "/payments", "/costs", "/accounts", "/users"]) {
    assert.equal(canAccess("seller", forbidden), false, `селлеру открыт ${forbidden}`);
  }
});

test("селлер — хозяин своего склада, а не оператор фулфилмента", () => {
  // Ставить задания и править приход он должен: без этого склад не ведут.
  assert.equal(canManageStock("seller"), true);
  assert.equal(canManageStock("warehouse"), false);
  assert.equal(isWarehouseOperator("seller"), false);
  assert.equal(isExternalSeller("seller"), true);
  assert.equal(isExternalSeller("director"), false);
});

test("прокси пускает селлера в склад, но не в контур маркировки", () => {
  const proxy = read("proxy.ts");
  const body = proxy.slice(proxy.indexOf("function isSellerApiAllowed"), proxy.indexOf("function isOzonManagerApiAllowed"));
  assert.match(body, /pathname\.startsWith\("\/api\/warehouse\/"\)/, "склад не открыт селлеру");
  // Коды Честного Знака заказываются нашими токенами, и юрлица селлера там нет.
  assert.match(body, /!pathname\.startsWith\("\/api\/warehouse\/kiz"\)/, "маркировка открыта селлеру");
});

test("справочники не отдаются внешней компании целиком", () => {
  // В товарах лежит закупочная цена: запрос без параметра `entity` не должен
  // возвращать чужие карточки.
  for (const route of ["app/api/warehouse/products/route.ts", "app/api/warehouse/variants/route.ts", "app/api/warehouse/warehouses/route.ts"]) {
    assert.match(read(route), /isExternalSeller\(/, `${route}: справочник не ограничен для селлера`);
  }
});

test("вкладка маркировки скрыта у внешней компании", () => {
  const page = read("components/warehouse/WarehousePage.tsx");
  assert.match(page, /SELLER_HIDDEN_TABS/, "нет отдельного набора вкладок для селлера");
  assert.match(page, /me\?\.role === "seller"/, "роль селлера не влияет на набор вкладок");
});

test("доступ к юрлицу селлера считается по его организации, а не по роли", () => {
  const access = read("lib/warehouse/entityAccess.ts");
  assert.match(access, /session\?\.role === "seller"/, "селлер не выделен в расчёте доступа");
  assert.match(access, /organization_id/, "доступ не привязан к организации");
  // Юрлицо без кабинетов не должно быть видно чужой компании.
  assert.match(access, /cabinets\.length === 0\s*\?\s*canSee\(null\)/, "юрлицо без кабинетов не проверяется");
});
