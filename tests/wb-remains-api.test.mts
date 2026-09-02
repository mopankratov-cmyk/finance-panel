import assert from "node:assert/strict";
import test from "node:test";

import {
  WB_REMAINS_FROM_CLIENT,
  WB_REMAINS_TO_CLIENT,
  WB_REMAINS_TOTAL,
  WB_WAREHOUSE_REMAINS_URL,
  fetchWarehouseRemains,
  remainsToStockRows,
  type WbRemainsRow,
} from "../lib/wb/remainsApi";

// Живой ответ WB от 2026-09-01 (nmId 755558105, кабинет Retail Family), урезанный:
// агрегат «Всего…» дублирует складские строки, «в пути» — количества на артикул.
const SAMPLE: WbRemainsRow[] = [
  {
    nmId: 755558105,
    warehouses: [
      { warehouseName: WB_REMAINS_TO_CLIENT, quantity: 5 },
      { warehouseName: WB_REMAINS_FROM_CLIENT, quantity: 15 },
      { warehouseName: WB_REMAINS_TOTAL, quantity: 733 },
      { warehouseName: "Склад WB РФ", quantity: 204 },
      { warehouseName: "Коледино", quantity: 231 },
      { warehouseName: "Электросталь", quantity: 144 },
    ],
  },
];

test("агрегат «Всего…» не попадает в складской разрез — суммы честные", () => {
  const rows = remainsToStockRows(SAMPLE);

  assert.ok(!rows.some((row) => row.warehouse === WB_REMAINS_TOTAL));
  // Сумма quantity = реальные склады + «Склад WB РФ» (дизъюнктная компонента), без агрегата.
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 204 + 231 + 144);
  assert.equal(rows.reduce((sum, row) => sum + row.in_way_to_client, 0), 5);
  assert.equal(rows.reduce((sum, row) => sum + row.in_way_from_client, 0), 15);
});

test("«в пути» хранится колонками своей псевдостроки, не остатком", () => {
  const rows = remainsToStockRows(SAMPLE);

  const toClient = rows.find((row) => row.warehouse === WB_REMAINS_TO_CLIENT);
  assert.deepEqual(toClient, { nm_id: 755558105, warehouse: WB_REMAINS_TO_CLIENT, quantity: 0, in_way_to_client: 5, in_way_from_client: 0 });
  const fromClient = rows.find((row) => row.warehouse === WB_REMAINS_FROM_CLIENT);
  assert.deepEqual(fromClient, { nm_id: 755558105, warehouse: WB_REMAINS_FROM_CLIENT, quantity: 0, in_way_to_client: 0, in_way_from_client: 15 });
  const koledino = rows.find((row) => row.warehouse === "Коледино");
  assert.deepEqual(koledino, { nm_id: 755558105, warehouse: "Коледино", quantity: 231, in_way_to_client: 0, in_way_from_client: 0 });
});

test("битые строки отчёта пропускаются без падения", () => {
  const rows = remainsToStockRows([
    { nmId: 0, warehouses: [{ warehouseName: "Коледино", quantity: 5 }] },
    { nmId: 42, warehouses: null },
    { nmId: 43, warehouses: [{ warehouseName: "  ", quantity: 5 }] },
  ]);
  assert.deepEqual(rows, []);
});

test("задачный цикл: создание → статус → скачивание одним токеном", async () => {
  const calls: string[] = [];
  const waits: number[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).Authorization, "test-token");
    if (calls.length === 1) return Response.json({ data: { taskId: "task-1" } });
    if (calls.length === 2) return Response.json({ data: { id: "task-1", status: "processing" } });
    if (calls.length === 3) return Response.json({ data: { id: "task-1", status: "done" } });
    return Response.json(SAMPLE);
  };

  const report = await fetchWarehouseRemains({
    token: "test-token",
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); },
    pollIntervalMs: 5_000,
  });

  assert.deepEqual(calls, [
    `${WB_WAREHOUSE_REMAINS_URL}?groupByNm=true`,
    `${WB_WAREHOUSE_REMAINS_URL}/tasks/task-1/status`,
    `${WB_WAREHOUSE_REMAINS_URL}/tasks/task-1/status`,
    `${WB_WAREHOUSE_REMAINS_URL}/tasks/task-1/download`,
  ]);
  assert.deepEqual(waits, [5_000, 5_000]);
  assert.deepEqual(report, SAMPLE);
});

test("повторяет один 429 по Retry-After — лимит задач общий на аккаунт", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response("too many requests", { status: 429, headers: { "retry-after": "30" } });
    if (calls === 2) return Response.json({ data: { taskId: "task-2" } });
    if (calls === 3) return Response.json({ data: { id: "task-2", status: "done" } });
    return Response.json([]);
  };

  const report = await fetchWarehouseRemains({
    token: "test-token",
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); },
  });

  assert.equal(calls, 4);
  assert.deepEqual(waits, [30_000, 5_000]);
  assert.deepEqual(report, []);
});

test("429 без Retry-After ждёт по X-RateLimit-Retry, а не слепые 60с", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response("too many requests", { status: 429, headers: { "x-ratelimit-retry": "17" } });
    if (calls === 2) return Response.json({ data: { taskId: "task-4" } });
    if (calls === 3) return Response.json({ data: { id: "task-4", status: "done" } });
    return Response.json([]);
  };

  await fetchWarehouseRemains({
    token: "test-token",
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); },
  });

  assert.deepEqual(waits, [17_000, 5_000]);
});

test("нежданный статус задачи — ошибка, а не вечный цикл", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    if (String(input).includes("/status")) return Response.json({ data: { status: "canceled" } });
    return Response.json({ data: { taskId: "task-3" } });
  };

  await assert.rejects(
    fetchWarehouseRemains({ token: "t", fetchImpl, sleep: async () => {} }),
    /статусом «canceled»/,
  );
});
