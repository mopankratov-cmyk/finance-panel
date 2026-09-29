import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression: matchFbsSales() находит заказ FBS по юрлицу товара, а не по
// складу — WB отдаёт только обобщённый warehouse_type = "Склад продавца",
// без ID конкретного склада. Если у юрлица включено автосписание сразу на
// 2+ складах, один и тот же список заказов проверяется независимо против
// каждого склада: заказ достаётся только тому, что обработан первым
// (порядок Map непредсказуем), а остальные видят srid уже занятым в
// stock_moves (idempotency-проверка post_fbs_sales и уникальный индекс
// stock_moves_fbs_sale_unique скоуплены только по doc_id) и молча
// пропускают его — второй склад никогда не спишет свою часть продаж.
//
// Правильного способа привязать конкретный заказ к конкретному складу
// сейчас нет (WB такие данные не отдаёт), поэтому единственный честный
// фикс — не позволять включить это опасное состояние вовсе, ни при
// сохранении настройки, ни при запуске списания.

const warehousePatchRoute = readFileSync(
  new URL("../app/api/warehouse/warehouses/[id]/route.ts", import.meta.url),
  "utf8",
);
const fbsSalesRoute = readFileSync(new URL("../app/api/warehouse/fbs-sales/route.ts", import.meta.url), "utf8");

test("PATCH /warehouses/[id] отказывает включать fbsSalesSince на втором складе того же юрлица", () => {
  assert.match(
    warehousePatchRoute,
    /\.eq\("legal_entity_id", body\.entityId\)\s*\n\s*\.not\("fbs_sales_since", "is", null\)\s*\n\s*\.neq\("warehouse_id", id\)/,
    "должен искать другие склады этого юрлица с уже включённым автосписанием",
  );
  assert.match(
    warehousePatchRoute,
    /if \(conflict\) \{[\s\S]*?return fail\(\s*`[^`]*включить его ещё и здесь нельзя[^`]*`,\s*409,\s*\);/i,
    "должен честно отказывать 409, а не молча позволять второй склад",
  );
});

test("PATCH /warehouses/[id] не блокирует выключение (since=null) и первое включение", () => {
  // Гвард стоит внутри `if (since)` — выключение автосписания и первое
  // включение (когда конфликтов ещё нет) не должны упираться в проверку.
  assert.match(warehousePatchRoute, /if \(since\) \{\s*\n\s*const conflictResult = await db/);
});

test("POST /api/warehouse/fbs-sales отказывается списывать, если у юрлица включено 2+ склада", () => {
  assert.match(
    fbsSalesRoute,
    /if \(settings\.length > 1\) \{\s*\n\s*return fail\(/,
    "второй рубеж защиты — на случай гонки запросов или старых данных, обошедших PATCH-гвард",
  );
});

test("POST /api/warehouse/fbs-sales всё ещё разрешает списание при ровно одном включённом складе", () => {
  // Проверка стоит ПОСЛЕ settings.length === 0 и ДО построения linesByWarehouse —
  // ровно один склад проходит оба гварда и списывается как раньше.
  const zeroGuardIndex = fbsSalesRoute.indexOf("settings.length === 0");
  const multiGuardIndex = fbsSalesRoute.indexOf("settings.length > 1");
  const loopIndex = fbsSalesRoute.indexOf("for (const setting of settings)");
  assert.ok(zeroGuardIndex > -1 && multiGuardIndex > -1 && loopIndex > -1);
  assert.ok(zeroGuardIndex < multiGuardIndex, "сначала проверка на 0 складов");
  assert.ok(multiGuardIndex < loopIndex, "затем проверка на 2+ склада, и только потом обработка");
});
