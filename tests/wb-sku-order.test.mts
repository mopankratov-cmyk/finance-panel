import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildSkuOrderIndex, parseSkuOrderInput, sortByCustomSkuOrder } from "../lib/wb/skuOrder";

// Ручной порядок выдачи артикулов (просьба менеджера: «зашить последовательность
// из таблицы»). Законы: перечисленные — строго в заданном порядке, остальные —
// после них БЕЗ перестановок (стабильно), мусор из вставки не ломает список.

test("перечисленные идут в заданном порядке, остальные — после, стабильно", () => {
  const index = buildSkuOrderIndex([300, 100]);
  const items = [
    { nm: 100, tag: "a" },
    { nm: 200, tag: "b" },
    { nm: 300, tag: "c" },
    { nm: null, tag: "d" },
    { nm: 400, tag: "e" },
  ];
  const sorted = sortByCustomSkuOrder(items, (item) => item.nm, index);
  assert.deepEqual(sorted.map((item) => item.tag), ["c", "a", "b", "d", "e"]);
});

test("пустой порядок ничего не переставляет", () => {
  const items = [{ nm: 2 }, { nm: 1 }];
  assert.deepEqual(sortByCustomSkuOrder(items, (item) => item.nm, buildSkuOrderIndex([])), items);
});

test("вставка из таблицы разбирается: разделители любые, дубли и мусор выпадают", () => {
  // «1 2 3» — порядковые номера строк, прилипшие при копировании колонки «№».
  assert.deepEqual(
    parseSkuOrderInput("1 874393713\n2 874404592, 874404593;  874393713\nабв 0 -5"),
    [874393713, 874404592, 874404593],
  );
});

test("порядок настраивается в РНП и применяется на Юнит/Товарах/Полках", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const rnp = await read("../components/wb/WbRnpPage.tsx");
  assert.match(rnp, /useCabinetSkuOrder\(/);
  assert.match(rnp, /Свой порядок/);
  assert.match(rnp, /\/api\/sku-order/);
  for (const path of ["../components/wb/WbUnitPage.tsx", "../components/wb/WbProductPage.tsx", "../components/wb/WbShelfPage.tsx"]) {
    const source = await read(path);
    assert.match(source, /sortByCustomSkuOrder\(/, `${path} не применяет порядок`);
  }
  const route = await read("../app/api/sku-order/route.ts");
  assert.match(route, /requireApiSession/);
  assert.match(route, /hasCabinetAccess/);
});
