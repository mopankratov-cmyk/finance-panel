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

test("товар и размер проверяются на владельца перед чтением и записью", () => {
  // Идентификаторы приходят из адреса и тела: без проверки владельца чужую
  // карточку можно было переписать и даже перевести на своё юрлицо.
  const owner = read("lib/warehouse/ownership.ts");
  assert.match(owner, /assertProductsInScope/);
  assert.match(owner, /assertVariantsInScope/);
  assert.match(owner, /visibleWarehouseIds/);

  assert.match(read("app/api/warehouse/products/[id]/route.ts"), /assertProductsInScope\(/, "правка товара без проверки владельца");
  const variants = read("app/api/warehouse/variants/route.ts");
  assert.match(variants, /assertProductsInScope\(/, "чтение размеров без проверки владельца");
  assert.match(variants, /assertVariantsInScope\(/, "правка размера без проверки владельца");
  // Список справочника по чужому юрлицу должен отвечать отказом, а не пустотой.
  assert.match(read("app/api/warehouse/products/route.ts"), /Нет доступа к юрлицу/);
});

test("проводки не называют чужой артикул в тексте ошибки", () => {
  // Сообщение «на складе не хватает NV-836-04 · 42» по чужому размеру — это
  // оракул для перебора справочника, поэтому размер проверяется до проводки.
  for (const route of ["writeoffs", "shipments", "transfers", "returns", "tasks"]) {
    assert.match(read(`app/api/warehouse/${route}/route.ts`), /assertVariantsInScope\(/, `${route}: размер не проверен на владельца`);
  }
});

test("массовые инструменты справочника закрыты внешней компании", () => {
  // Они читают и переписывают карточки всех юрлиц сразу.
  for (const route of ["products/owners", "products/import", "variants/import"]) {
    assert.match(read(`app/api/warehouse/${route}/route.ts`), /isExternalSeller\(session\?\.role\)/, `${route}: открыт внешней компании`);
  }
});

test("печатная форма требует сессию", () => {
  // Без сессии listAccessibleEntities считает вызов машинным и отдаёт все юрлица.
  for (const page of ["app/warehouse/print/[id]/page.tsx", "app/warehouse/print/receipt/[batch]/page.tsx"]) {
    const src = read(page);
    assert.match(src, /getServerSession\(\)/, `${page}: не проверяет сессию`);
    assert.match(src, /if \(!session\) notFound\(\)/, `${page}: пускает без сессии`);
  }
});

test("агентская связь не открывает чужое юрлицо внешней компании", () => {
  const access = read("lib/warehouse/entityAccess.ts");
  assert.match(access, /link\.relation === "own"/, "агентская связь открывает юрлицо целиком");
  assert.match(access, /sellerCabinets\.has\(link\.cabinetId\)/, "чужие кабинеты юрлица видны");
});

test("внешний селлер переходит между своими модулями, не упираясь в отказ", () => {
  // Общая витрина модулей роли закрыта, поэтому «Все модули» из склада увела бы
  // его на отказ, а в меню WB не было пункта, ведущего в склад.
  assert.equal(canAccess("seller", "/"), false, "витрина модулей открыта — тогда правка не нужна");

  const wb = read("components/wb/WbShell.tsx");
  const sellerNav = wb.slice(wb.indexOf("const SELLER_SYSTEM_NAV"), wb.indexOf("const SELLER_TEAM_NAV"));
  assert.match(sellerNav, /href: "\/warehouse"/, "в меню WB нет пункта склада");

  const shell = read("components/warehouse/WarehouseShell.tsx");
  assert.match(shell, /me\?\.role === "seller" \? "\/wb\/rnp" : "\/"/, "из склада селлера уводит на закрытую витрину");
});

test("селлера с подключённым кабинетом ведёт в аналитику, а не на подключение", async () => {
  const { roleHome } = await import("../lib/auth/roles.ts");
  // Пока кабинета нет, экран подключения — единственное осмысленное место.
  assert.equal(roleHome({ role: "seller", cabinet_ids: [] }), "/wb/connect");
  assert.equal(roleHome({ role: "seller" }), "/wb/connect");
  // Подключил — там смотреть нечего, ведём в аналитику.
  assert.equal(roleHome({ role: "seller", cabinet_ids: ["705b2f54"] }), "/wb/rnp");
  // Нашим ролям адрес не меняется.
  assert.equal(roleHome({ role: "director", cabinet_ids: [] }), "/");
  assert.equal(roleHome({ role: "warehouse", cabinet_ids: [] }), "/warehouse");
  assert.equal(roleHome(null), "/login");
});
