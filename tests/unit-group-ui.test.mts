import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manager unit route has no finance tabs and finance wrapper owns them", async () => {
  const [unit, wrapper, client, tabs] = await Promise.all([
    readFile(new URL("../app/unit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/opiu/margin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/opiu/UnitMarginPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/FinanceTabs.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(unit, /FinanceTabs/);
  assert.match(wrapper, /<FinanceTabs\s*\/>/);
  assert.match(wrapper, /<UnitMarginPage\s*\/>/);
  assert.match(tabs, /\{ href: "\/opiu\/margin", label: "Маржа по артикулам" \}/);
  assert.match(client, /encodeURIComponent\(cabId\)/);
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
  assert.match(cabinetsGet, /accessibleOnly && session\?\.role === "manager"\s*\?\s*allCabinets\.filter/);
  assert.match(cabinetsGet, /session\.cabinet_ids\.includes\(String\(cabinet\.id\)\)/);
  assert.doesNotMatch(cabinetsGet, /session\.cabinet_ids\.length\s*>\s*0/);
  assert.match(groupsRoute, /const groups = filterCabinetGroups\([\s\S]+session\);/);
  assert.doesNotMatch(cabinetsPost, /accessibleOnly|session\?\.role|cabinet_ids/);
});
