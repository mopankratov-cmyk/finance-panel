import { strict as assert } from "node:assert";
import test from "node:test";
import { planProductImport, type CatalogCard } from "../lib/warehouse/missingProducts.ts";

const windowStart = new Date("2026-02-24T00:00:00Z");
const card = (over: Partial<CatalogCard>): CatalogCard => ({
  nmId: 1, article: "A-1", brand: "BRAND", title: "Товар", createdAt: "2023-05-16T00:00:00Z", ...over,
});

test("старая карточка без заказов за окно в справочник не идёт", () => {
  const plan = planProductImport([card({})], [], { soldNmIds: new Set(), windowStart });
  assert.equal(plan.create.length, 0);
  assert.deepEqual(plan.stale.map((row) => row.article), ["A-1"]);
});

test("новая карточка без заказов — не покойник, а новинка", () => {
  const plan = planProductImport(
    [card({ createdAt: "2026-08-01T00:00:00Z" })],
    [],
    { soldNmIds: new Set(), windowStart },
  );
  assert.deepEqual(plan.create.map((row) => row.article), ["A-1"]);
});

test("старая карточка с заказами за окно заводится", () => {
  const plan = planProductImport([card({})], [], { soldNmIds: new Set([1]), windowStart });
  assert.equal(plan.create.length, 1);
});

test("includeStale заводит и молчащие — осознанное решение человека", () => {
  const plan = planProductImport([card({})], [], { soldNmIds: new Set(), windowStart, includeStale: true });
  assert.equal(plan.create.length, 1);
  assert.equal(plan.stale.length, 0);
});

test("товар, заведённый без номера карточки, находится по артикулу и не дублируется", () => {
  const plan = planProductImport(
    [card({ nmId: 777, article: "HT-83-17", createdAt: "2026-08-01T00:00:00Z" })],
    [{ nmId: null, article: "ht-83-17" }],
    { soldNmIds: new Set(), windowStart },
  );
  assert.equal(plan.create.length, 0);
  assert.equal(plan.stale.length, 0);
});

test("карточка без артикула пропускается: артикул — ключ товара", () => {
  const plan = planProductImport(
    [card({ article: "  ", createdAt: "2026-08-01T00:00:00Z" })],
    [],
    { soldNmIds: new Set(), windowStart },
  );
  assert.equal(plan.create.length + plan.stale.length, 0);
});
