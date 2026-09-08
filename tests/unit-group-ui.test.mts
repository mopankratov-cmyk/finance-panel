import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Маржу по артикулам показывают ДВА разных экрана, и это намеренно:
// `/unit` — рабочий экран менеджера, живёт без финансовых вкладок и получает
// кабинет параметром; `/opiu/margin` — тот же смысл внутри финансового
// контура, со вкладками и кабинетом из сессии. Тест раньше считал, что
// компонент один, и после разделения молча сторожил не тот файл: проверял
// защиты у `UnitMarginPage`, тогда как финансовый маршрут давно рисует
// `MarginByArticlePage`. Здесь каждый экран проверяется тем, что верно
// про него.
test("финансовый контур владеет вкладками, экран менеджера — нет", async () => {
  const [unit, wrapper, tabs] = await Promise.all([
    readFile(new URL("../app/unit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/opiu/margin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/FinanceTabs.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(unit, /FinanceTabs/, "экран менеджера не должен тянуть финансовые вкладки");
  assert.match(wrapper, /<FinanceTabs\s*\/>/);
  assert.match(wrapper, /<MarginByArticlePage\s*\/>/, "финансовый маршрут рисует свой компонент");
  assert.match(tabs, /\{ href: "\/opiu\/margin", label: "Маржа по артикулам" \}/);
});

test("экран менеджера передаёт кабинет в запрос", async () => {
  // У `/unit` кабинет приходит параметром, и его надо экранировать: id
  // подставляется в строку запроса.
  const client = await readFile(new URL("../components/opiu/UnitMarginPage.tsx", import.meta.url), "utf8");
  assert.match(client, /encodeURIComponent\(cabId\)/);
});

test("финансовый экран не показывает чужие цифры, пока грузит новые", async () => {
  // Здесь кабинет берётся из сессии, параметра нет — зато есть смена бренда и
  // периода. Пока новые данные едут, старые строки показывать нельзя: под
  // новым заголовком стояла бы прошлая выборка. Защита сделана порядком веток
  // рендера — сначала `loading`, и только потом данные, — поэтому проверяем
  // именно порядок, а не наличие сброса состояния.
  const client = await readFile(new URL("../components/opiu/MarginByArticlePage.tsx", import.meta.url), "utf8");
  assert.match(client, /new AbortController\(\)/, "устаревший ответ не должен выиграть гонку");
  assert.match(client, /return \(\) => controller\.abort\(\)/);
  const loadingBranch = client.indexOf("{loading ?");
  const dataBranch = client.indexOf("data && data.rows.length");
  assert.ok(loadingBranch > 0 && dataBranch > 0, "ветки загрузки и данных на месте");
  assert.ok(loadingBranch < dataBranch,
    "данные проверяются раньше загрузки — на экране останутся строки прошлой выборки");
});

test("scope changes abort stale requests and clear last-good data", async () => {
  const client = await readFile(new URL("../components/opiu/UnitMarginPage.tsx", import.meta.url), "utf8");
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /signal:\s*controller\.signal/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /const guard = requestGuard\.current/);
  assert.match(client, /guard\.isCurrent\(generation\)/);
  assert.match(client, /setData\(null\)/);
});

test("group UI labels units honestly and switcher exposes group-list failures", async () => {
  const [route, switcher] = await Promise.all([
    readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/CabinetSwitcher.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /Текущий остаток \+ в пути/);
  assert.match(route, /Продажи \/ заказы %/);
  assert.match(route, /Удержания WB ₽\/ед/);
  assert.match(route, /Цена до СПП ₽\/ед для/);
  assert.match(route, /row\.revenue > 0 && row\.orders > 0/);
  assert.match(route, /последний синхронизированный 30-дневный snapshot/);
  assert.match(route, /целевая цена и дельта для группы недоступны/);
  assert.match(switcher, /if \(!r\.ok\) throw/);
  assert.match(switcher, /role="alert"/);
});

test("manager cabinet metadata listing fails closed and the switcher requests accessible cabinets", async () => {
  const [cabinetsRoute, groupsRoute, switcher] = await Promise.all([
    readFile(new URL("../app/api/cabinets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cabinet-groups/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/CabinetSwitcher.tsx", import.meta.url), "utf8"),
  ]);
  const cabinetsGet = cabinetsRoute.slice(
    cabinetsRoute.indexOf("export async function GET"),
    cabinetsRoute.indexOf("export async function POST"),
  );
  const cabinetsPost = cabinetsRoute.slice(cabinetsRoute.indexOf("export async function POST"));

  assert.match(switcher, /fetch\("\/api\/cabinets\?accessible=1"/);
  // Роль со списком кабинетов спрашивается общим признаком: сравнение со
  // строкой «manager» пропускало мимо ограничения каждую новую роль.
  assert.match(cabinetsGet, /session\.role === "seller"[\s\S]+accessibleOnly && isCabinetScopedRole\(session\.role\)/);
  assert.match(cabinetsGet, /session\.cabinet_ids\.includes\(String\(cabinet\.id\)\)/);
  assert.match(cabinetsGet, /session\.organization_id !== null/);
  assert.match(groupsRoute, /const groups = filterCabinetGroups\([\s\S]+session\);/);
  assert.doesNotMatch(cabinetsPost, /accessibleOnly|session\?\.role|cabinet_ids/);
});
