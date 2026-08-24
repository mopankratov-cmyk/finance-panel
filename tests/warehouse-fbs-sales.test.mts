import { strict as assert } from "node:assert";
import test from "node:test";
import { matchFbsSales, type FbsOrder, type VariantRef } from "../lib/warehouse/fbsSales.ts";

const RIO = "rio", FILIPPOV = "filippov";
const order = (over: Partial<FbsOrder>): FbsOrder => ({
  srid: "s1", nmId: 1, article: "ESC001", date: "2026-08-20T10:00:00Z", cabinetId: "optima", ...over,
});
const base = {
  barcodeBySrid: new Map<string, string>(),
  variantByBarcode: new Map<string, VariantRef>(),
  variantsByNmId: new Map<number, VariantRef[]>(),
  entityId: RIO,
  since: "2026-08-01",
};

test("товар списывается у своего владельца, даже если продан через чужой кабинет", () => {
  // Пеналы РИО продаются через агентский кабинет Оптимы, а своего кабинета
  // у РИО нет вовсе — это и есть боевой случай.
  const result = matchFbsSales({
    ...base,
    orders: [order({})],
    variantsByNmId: new Map([[1, [{ id: "v1", entityId: RIO }]]]),
  });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].cabinetId, "optima", "кабинет остаётся как канал продажи");
});

test("чужой товар не трогаем — он спишется при синхронизации своего юрлица", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({})],
    variantsByNmId: new Map([[1, [{ id: "v1", entityId: FILIPPOV }]]]),
  });
  assert.equal(result.lines.length, 0);
  assert.equal(result.otherEntity, 1);
});

test("баркод сборочного задания называет размер точно", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({ srid: "s7" })],
    barcodeBySrid: new Map([["s7", "200123"]]),
    variantByBarcode: new Map([["200123", { id: "size-M", entityId: RIO }]]),
    variantsByNmId: new Map([[1, [{ id: "size-S", entityId: RIO }, { id: "size-M", entityId: RIO }]]]),
  });
  assert.equal(result.lines[0].variantId, "size-M", "баркод важнее карточки");
});

test("карточка с несколькими размерами размер не называет — молча выбрать любой значит соврать", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({ article: "NV-01-55" })],
    variantsByNmId: new Map([[1, [{ id: "s", entityId: RIO }, { id: "m", entityId: RIO }]]]),
  });
  assert.equal(result.lines.length, 0);
  assert.deepEqual(result.unresolved, [{ article: "NV-01-55", count: 1 }]);
});

test("безразмерный товар определяется по карточке", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({})],
    variantsByNmId: new Map([[1, [{ id: "base", entityId: RIO }]]]),
  });
  assert.equal(result.lines[0].variantId, "base");
});

test("продажи раньше даты доверия не списываются", () => {
  const result = matchFbsSales({
    ...base,
    since: "2026-08-21",
    orders: [order({ date: "2026-08-20T10:00:00Z" })],
    variantsByNmId: new Map([[1, [{ id: "v1", entityId: RIO }]]]),
  });
  assert.equal(result.lines.length, 0, "иначе остаток уйдёт в минус на всю историю торговли");
});

test("товар без владельца попадает в неопознанные, а не списывается наугад", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({ article: "БЕЗ-ХОЗЯИНА" })],
    variantsByNmId: new Map([[1, [{ id: "v1", entityId: null }]]]),
  });
  assert.equal(result.lines.length, 0);
  assert.equal(result.otherEntity, 0);
  assert.deepEqual(result.unresolved, [{ article: "БЕЗ-ХОЗЯИНА", count: 1 }]);
});

test("неопознанные считаются по артикулам и сортируются по частоте", () => {
  const result = matchFbsSales({
    ...base,
    orders: [order({ srid: "a", article: "X" }), order({ srid: "b", article: "Y" }), order({ srid: "c", article: "Y" })],
  });
  assert.deepEqual(result.unresolved, [{ article: "Y", count: 2 }, { article: "X", count: 1 }]);
});
