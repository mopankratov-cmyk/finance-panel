import assert from "node:assert/strict";
import test from "node:test";

import {
  WB_WAREHOUSE_STOCKS_URL,
  wbWarehouseStockPages,
  type WbWarehouseStock,
} from "../lib/wb/stocksApi";

function stock(nmId: number, warehouseName = "Коледино"): WbWarehouseStock {
  return {
    nmId,
    chrtId: nmId + 1,
    warehouseId: 507,
    warehouseName,
    regionName: "Центральный",
    quantity: 3,
    inWayToClient: 1,
    inWayFromClient: 2,
  };
}

test("uses the new WB analytics endpoint and sends scoped nmIds", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return Response.json({ data: { items: [stock(1244157227)] } });
  };

  const pages: WbWarehouseStock[][] = [];
  for await (const page of wbWarehouseStockPages({
    token: "test-token",
    nmIds: [1244157227, 1239272673],
    fetchImpl,
    minIntervalMs: 0,
  })) pages.push(page);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, WB_WAREHOUSE_STOCKS_URL);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "test-token");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    nmIds: [1244157227, 1239272673],
    chrtIds: [],
    limit: 250000,
    offset: 0,
  });
  assert.deepEqual(pages, [[stock(1244157227)]]);
});

test("paginates with offset and respects the WB request interval", async () => {
  const offsets: number[] = [];
  const waits: number[] = [];
  const responses = [[stock(1), stock(2)], [stock(3)]];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    offsets.push(JSON.parse(String(init?.body)).offset);
    return Response.json({ data: { items: responses.shift() ?? [] } });
  };

  const pages: WbWarehouseStock[][] = [];
  for await (const page of wbWarehouseStockPages({
    token: "test-token",
    limit: 2,
    fetchImpl,
    minIntervalMs: 20_000,
    sleep: async (ms) => { waits.push(ms); },
  })) pages.push(page);

  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(waits, [20_000]);
  assert.deepEqual(pages.map((page) => page.map((item) => item.nmId)), [[1, 2], [3]]);
});

test("retries one 429 response using Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response("too many requests", { status: 429, headers: { "retry-after": "2" } });
    return Response.json({ data: { items: [] } });
  };

  for await (const _page of wbWarehouseStockPages({
    token: "test-token",
    fetchImpl,
    minIntervalMs: 20_000,
    sleep: async (ms) => { waits.push(ms); },
  })) {
    // consume generator
  }

  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});
