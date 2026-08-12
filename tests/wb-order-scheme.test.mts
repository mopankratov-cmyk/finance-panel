import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { wbSchemeFromWarehouseType } from "../lib/wb/scheme";

test("склад продавца распознаётся как FBS, склад WB — как FBW", () => {
  assert.equal(wbSchemeFromWarehouseType("Склад продавца"), "fbs");
  assert.equal(wbSchemeFromWarehouseType("склад ПРОДАВЦА"), "fbs");
  assert.equal(wbSchemeFromWarehouseType("Склад поставщика"), "fbs");
  assert.equal(wbSchemeFromWarehouseType("Склад WB"), "fbw");
  assert.equal(wbSchemeFromWarehouseType("Склад маркетплейса"), "fbw");
});

test("неизвестный тип склада молчит, а не считается складом WB", () => {
  // Строки, записанные до появления колонки, тип склада не знают. Считать их FBW
  // значило бы приписать заказам схему, которой в данных нет.
  assert.equal(wbSchemeFromWarehouseType(null), null);
  assert.equal(wbSchemeFromWarehouseType(undefined), null);
  assert.equal(wbSchemeFromWarehouseType(""), null);
  assert.equal(wbSchemeFromWarehouseType("   "), null);
});

test("синки пишут сырой тип склада и переживают отсутствие колонки", () => {
  // chunkedUpsertWithOptionalColumns выбрасывает колонку, если её ещё нет в БД,
  // поэтому деплой до применения миграции не ломает синхронизацию.
  for (const file of ["orders", "sales"]) {
    const source = readFileSync(new URL(`../app/api/sync/${file}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /warehouse_type:/, `${file}: тип склада не записывается`);
    const upsertCall = source.slice(source.indexOf("chunkedUpsertWithOptionalColumns("));
    assert.match(
      upsertCall.slice(0, 200),
      /"warehouse_type"/,
      `${file}: колонка не помечена как необязательная — деплой без миграции сломает синк`,
    );
  }
});
