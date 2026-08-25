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

test("все четыре проводки заводят документ и называют его номер", () => {
  for (const route of ["writeoffs", "transfers", "returns"]) {
    const src = readFileSync(new URL(`../app/api/warehouse/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(src, /recordStockDoc\(/, `${route}: не заводит документ`);
    assert.match(src, /docNumber: doc\.number/, `${route}: не отдаёт номер в ответе`);
  }

  // Отгрузка — исключение: одна проводка уезжает в разные кабинеты, и накладных
  // у неё столько, сколько адресатов. Номер приходит списком, а не полем.
  const shipments = readFileSync(new URL("../app/api/warehouse/shipments/route.ts", import.meta.url), "utf8");
  assert.match(shipments, /recordStockDoc\(/, "shipments: не заводит документ");
  assert.match(shipments, /docs\.push\(\{ number: doc\.number/, "shipments: не отдаёт номера накладных");
  assert.match(shipments, /cabinetId: cabinetId \|\| null/, "shipments: документ не помнит своего кабинета");
});

test("сторно отгрузки не трогает соседние накладные той же проводки", () => {
  const src = readFileSync(new URL("../app/api/warehouse/docs/[id]/reverse/route.ts", import.meta.url), "utf8");
  // Без кабинета функция отменит ВСЕ движения проводки — то есть и то, что
  // уехало в другой кабинет по другой накладной.
  assert.match(src, /p_cabinet_id: doc\.cabinet_id/, "сторно не передаёт кабинет документа");

  const sql = readFileSync(new URL("../supabase/migrations/202608250027_doc_reversal_cabinet.sql", import.meta.url), "utf8");
  assert.match(sql, /p_cabinet_id is null or cabinet_id = p_cabinet_id/, "функция не сужает отмену по кабинету");
  // Старую сигнатуру обязательно снять: иначе вызов с четырьмя аргументами
  // станет неоднозначным между ней и новой с умолчанием.
  assert.match(sql, /drop function if exists public\.post_doc_reversal\(text, text, text, text\)/);

  // Пока миграции нет, документ без кабинета обязан сторнироваться по-старому,
  // а накладная на кабинет — отказаться, а не отменить лишнее.
  assert.match(src, /if \(doc\.cabinet_id\) \{/, "нет отдельной ветки для накладной на кабинет");
  assert.match(src, /await db\.rpc\("post_doc_reversal", args\)/, "нет отката на старую сигнатуру");
});

test("сторно отказывается работать по черновику и по уже сторнированному", () => {
  const src = readFileSync(new URL("../app/api/warehouse/docs/[id]/reverse/route.ts", import.meta.url), "utf8");
  assert.match(src, /Документ уже сторнирован/);
  assert.match(src, /Черновик сторнировать нечем/);
  // Карточка сторно не должна пережить неудачную запись движений.
  assert.match(src, /await db\.from\("stock_docs"\)\.delete\(\)/);
});

test("печатная форма открыта той же роли, что и модуль склада", async () => {
  const { canAccess } = await import("../lib/auth/roles.ts");
  assert.equal(canAccess("warehouse", "/warehouse/print/abc"), true, "оператор ФФ должен печатать бумагу");
  assert.equal(canAccess("warehouse", "/opiu"), false, "и не должен ходить в финансы");
});

test("печатная форма перемещения не задваивает позиции", () => {
  // Перемещение пишет пару движений на строку: минус на источнике, плюс на
  // приёмнике. Печатать обе значит показать в накладной двойное количество.
  const src = readFileSync(new URL("../components/warehouse/PrintableDoc.tsx", import.meta.url), "utf8");
  assert.match(src, /kind === "transfer" \? doc\.lines\.filter\(\(row\) => row\.qty < 0\)/);
});

test("номер, однажды выданный, нельзя выдать второй раз", () => {
  // Регистр append-only: отметка сторно с номером документа лежит в базе вечно.
  // Обнулённый счётчик выдаёт номер заново — и свежая накладная наследует чужую
  // отметку, отказываясь сторнироваться со словами «уже сторнирован».
  const sql = readFileSync(new URL("../supabase/migrations/202608250029_ledger_number_functions.sql", import.meta.url), "utf8");
  assert.match(sql, /before update or delete on public\.stock_doc_counters/, "счётчик номеров ничем не защищён");
  assert.match(sql, /new\.last < old\.last/, "уменьшение счётчика не запрещено");
  assert.match(sql, /tg_op = 'DELETE'/, "удаление счётчика не запрещено");
});

test("повторное сторно узнаётся по проводке, а не по строке номера", () => {
  const schema = readFileSync(new URL("../supabase/migrations/202608250028_ledger_number_safety.sql", import.meta.url), "utf8");
  assert.match(schema, /add column if not exists reverses_doc_id text/, "нет точного ключа отмены");
  assert.doesNotMatch(schema, /^create (or replace )?function/m, "схема и процедуры должны лежать в разных файлах");

  const fn = readFileSync(new URL("../supabase/migrations/202608250029_ledger_number_functions.sql", import.meta.url), "utf8");
  assert.match(fn, /reverses_doc_id = p_source_movement_doc_id/, "сторожок не смотрит на проводку");
  assert.match(fn, /cabinet_id is not distinct from p_cabinet_id/, "сторожок не различает кабинеты");
  // Строки сторно, записанные до появления ключа, обязаны проверяться по-старому.
  assert.match(fn, /reverses_doc_id is null and note = p_source_number/, "старые строки сторно остались без защиты");
  // И сама отметка обязана записываться, иначе ключ всегда пустой.
  assert.match(fn, /doc_id, reverses_doc_id, note, created_by/, "сторно не записывает свой ключ");
});
