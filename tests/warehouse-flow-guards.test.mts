import { strict as assert } from "node:assert";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

// Права по ТЗ команды: оператор фулфилмента (роль warehouse) принимает,
// пересчитывает, отмечает брак и подтверждает отгрузку. Ставить задания,
// править приход, отменять документы и менять справочник — администратор и
// менеджер. Спрятанная кнопка — не защита: каждый роут обязан проверять
// роль сам, и этот сторож следит, чтобы проверка не пропала при правках.
const route = (path: string) => readFileSync(new URL(`../app/api/warehouse/${path}`, import.meta.url), "utf8");
const has = (path: string) => existsSync(new URL(`../app/api/warehouse/${path}`, import.meta.url));

const MANAGER_ONLY = [
  "tasks/route.ts",
  "tasks/[id]/route.ts",
  "tasks/[id]/cancel/route.ts",
  "receipts/correct/route.ts",
  "docs/[id]/reverse/route.ts",
];

test("роуты, закрытые для оператора склада, проверяют роль через canManageStock", () => {
  for (const path of MANAGER_ONLY) {
    assert.ok(has(path), `${path}: роут не найден`);
    const src = route(path);
    assert.match(src, /canManageStock\(/, `${path}: нет проверки роли`);
    assert.match(src, /OPERATOR_FORBIDDEN/, `${path}: оператор не получает понятный отказ`);
  }
});

test("подтверждение задания открыто оператору: это его работа по ТЗ", () => {
  const src = route("tasks/[id]/ship/route.ts");
  // Подтверждение зовёт проводку в базе, а не пишет движения само.
  assert.match(src, /post_shipment_task/, "подтверждение не проводит задание функцией базы");
  assert.doesNotMatch(src, /OPERATOR_FORBIDDEN/, "оператору закрыли «Отгружено»");
});

test("каждая операция оставляет след в ленте событий", () => {
  const expectations: [string, string][] = [
    ["tasks/route.ts", "task_created"],
    ["tasks/[id]/ship/route.ts", "task_shipped"],
    ["tasks/[id]/cancel/route.ts", "task_cancelled"],
    ["receipts/route.ts", "receipt_counted"],
    ["receipts/correct/route.ts", "receipt_corrected"],
    ["writeoffs/route.ts", "writeoff_created"],
    ["docs/[id]/reverse/route.ts", "doc_reversed"],
  ];
  for (const [path, kind] of expectations) {
    const src = route(path);
    assert.match(src, /recordWarehouseEvent\(/, `${path}: не пишет событие`);
    assert.ok(src.includes(`"${kind}"`), `${path}: нет события ${kind}`);
  }
});

test("продажи FBS не участвуют в иерархии остатков — решение владельца", () => {
  const src = route("stock/route.ts");
  // Регистр знает продажи как kind='sale'; в «получено»/«отгружено» им не место.
  assert.doesNotMatch(src, /kind === ["']sale["']\)\s*\{[^}]*shipped/, "продажи попали в «отгружено»");
});

test("сторно и коррекция не переписывают регистр: движения только добавляются", () => {
  const fn = readFileSync(new URL("../supabase/migrations/202609040003_warehouse_flow_functions.sql", import.meta.url), "utf8");
  assert.doesNotMatch(fn, /update public\.stock_moves/i, "функция правит движения задним числом");
  assert.doesNotMatch(fn, /delete from public\.stock_moves/i, "функция удаляет движения");
});
