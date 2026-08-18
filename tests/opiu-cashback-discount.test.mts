import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { reportRowForStorage } from "../lib/opiu/syncReportRows";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Строка ОПиУ «Компенсация скидки по программе лояльности» всегда показывала 0:
// метрика и отчёт её уже агрегировали, но колонки не было в БД, синк не запрашивал
// поле у WB, а чтение не выбирало его. Цепочка обязана держаться целиком.

test("синк запрашивает поле у WB и кладёт его в строку хранения", async () => {
  const sync = await read("../lib/opiu/syncReportRows.ts");
  // Без явного запроса WB не отдаёт это поле вовсе.
  assert.match(sync, /"cashbackDiscount"/);
  const stored = reportRowForStorage("cab-1", {
    rrd_id: 42,
    rr_dt: "2026-08-11",
    cashback_discount: 137.5,
  } as Parameters<typeof reportRowForStorage>[1]);
  assert.equal(stored.cashback_discount, 137.5);
});

test("пустое поле остаётся NULL, а не превращается в ноль рублей", () => {
  const stored = reportRowForStorage("cab-1", {
    rrd_id: 43,
    rr_dt: "2026-08-11",
  } as Parameters<typeof reportRowForStorage>[1]);
  // NULL значит «в строке отчёта поля не было», ноль — «WB компенсировал 0 ₽».
  assert.equal(stored.cashback_discount, null);
});

test("camelCase от WB доезжает до snake_case колонки", async () => {
  // WB отдаёт часть полей в camelCase; без записи в карте алиасов значение
  // потерялось бы молча и метрика осталась бы нулевой.
  const pagination = await read("../lib/wb/reportPagination.ts");
  assert.match(pagination, /cashbackDiscount: "cashback_discount"/);
});

test("чтение ОПиУ выбирает колонку и не тянет за собой старый TODO", async () => {
  const rows = await read("../lib/opiu/reportRows.ts");
  assert.match(rows, /"cashback_discount"/);
  assert.doesNotMatch(rows, /TODO\(loyalty_comp\)/);
});

test("миграция добавляет колонку идемпотентно и nullable", async () => {
  const migration = await read("../supabase/migrations/202608200002_wb_report_cashback_discount.sql");
  assert.match(migration, /add column if not exists cashback_discount numeric/);
  assert.doesNotMatch(migration, /not null/i);
});
