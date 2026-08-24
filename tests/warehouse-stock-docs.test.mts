import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { movementDocIdOf, recordStockDoc } from "../lib/warehouse/stockDocs.ts";

test("документ находит свои движения по ключу, который вернула проводка", () => {
  assert.equal(movementDocIdOf("shipment", { shipmentId: "s-1" }), "s-1");
  assert.equal(movementDocIdOf("transfer", { transferId: "t-1" }), "t-1");
  assert.equal(movementDocIdOf("writeoff", { writeoffId: "w-1" }), "w-1");
  assert.equal(movementDocIdOf("return", { returnId: "r-1" }), "r-1");
  assert.equal(movementDocIdOf("receipt", { batchId: "b-1" }), "b-1");
});

test("проводка без ключа движений оставляет документ без ссылки, а не ломается", () => {
  assert.equal(movementDocIdOf("shipment", { qty: 5 }), null);
  assert.equal(movementDocIdOf("shipment", null), null);
});

test("сбой записи документа не отменяет проведённую операцию", async () => {
  // Движения уже в регистре: отказать пользователю из-за незаписанной карточки
  // значило бы соврать про неудачу там, где операция прошла.
  const db = { rpc: async () => ({ error: { code: "42P01" } }) } as never;
  const doc = await recordStockDoc(db, {
    kind: "shipment", legalEntityId: "e1", result: { shipmentId: "s-1" }, actor: null,
  });
  assert.equal(doc, null);
});

test("все четыре проводки заводят документ", () => {
  for (const route of ["shipments", "writeoffs", "transfers", "returns"]) {
    const src = readFileSync(new URL(`../app/api/warehouse/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(src, /recordStockDoc\(/, `${route}: не заводит документ`);
    assert.match(src, /docNumber: doc\.number/, `${route}: не отдаёт номер в ответе`);
  }
});

test("сторно отказывается работать по черновику и по уже сторнированному", () => {
  const src = readFileSync(new URL("../app/api/warehouse/docs/[id]/reverse/route.ts", import.meta.url), "utf8");
  assert.match(src, /Документ уже сторнирован/);
  assert.match(src, /Черновик сторнировать нечем/);
  // Карточка сторно не должна пережить неудачную запись движений.
  assert.match(src, /await db\.from\("stock_docs"\)\.delete\(\)/);
});
