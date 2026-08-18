import assert from "node:assert/strict";
import test from "node:test";

import { REVENUE_CORE_SHARE, selectRevenueCore } from "../lib/rnp/operatingMatrix";

// Детектор аномалий кричал на 90% каталога (315 из 351 у СЛОЁНО): при росте
// кабинета на 23% недельные колебания больше порога есть почти у всех, а громче
// всех шумит хвост с единичными заказами. Сигналы считаем по ядру оборота.

const sku = (nm: number, revenue: number | null) => ({
  nm,
  metrics: [{ field: "orders_sum", total: revenue }],
});

test("ядро — артикулы, дающие 80% оборота; хвост отсекается", () => {
  const core = selectRevenueCore([sku(1, 800), sku(2, 150), sku(3, 30), sku(4, 20)]);
  assert.equal(core.has(1), true);
  // 800/1000 = 80% набрано первым же артикулом — остальные в хвосте.
  assert.deepEqual([...core], [1]);
});

test("артикул, пересекающий порог доли, входит в ядро", () => {
  // Единственный SKU даёт 100% оборота: пустое ядро означало бы «сигналов нет никогда».
  assert.deepEqual([...selectRevenueCore([sku(7, 500)])], [7]);
  // Ровные доли: 4 × 25% — на 80% нужно четыре, а не три.
  const even = selectRevenueCore([sku(1, 25), sku(2, 25), sku(3, 25), sku(4, 25)]);
  assert.equal(even.size, 4);
});

test("нулевой или неизвестный оборот — ядром считаем весь список", () => {
  // Иначе детектор молчал бы не потому, что всё спокойно, а потому что нет данных.
  assert.equal(selectRevenueCore([sku(1, 0), sku(2, null)]).size, 2);
  assert.equal(selectRevenueCore([]).size, 0);
});

test("доля ядра — 80% по умолчанию и настраивается", () => {
  assert.equal(REVENUE_CORE_SHARE, 0.8);
  const wide = selectRevenueCore([sku(1, 800), sku(2, 150), sku(3, 50)], 0.95);
  assert.equal(wide.size, 2);
});

test("экран считает аномалии по ядру, а не по всему каталогу", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(page, /const revenueCore = useMemo\(\(\) => selectRevenueCore\(facetSkus\)/);
  assert.match(page, /if \(!revenueCore\.has\(sku\.nm\)\) continue;/);
  // Прежний обход всего каталога — то самое, из-за чего «аномален» был весь кабинет.
  assert.doesNotMatch(page, /for \(const sku of activeData\?\.skus \?\? \[\]\) \{\s*\n\s*const anomalies = detectSkuSignals/);
  // Пользователь должен понимать, по какому множеству считается чип.
  const toolbar = await readFile(new URL("../components/wb/RnpOperatingToolbar.tsx", import.meta.url), "utf8");
  assert.match(toolbar, /дающих 80% оборота/);
});
