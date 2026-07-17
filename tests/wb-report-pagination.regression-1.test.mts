import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbReportPages } from "../lib/wb/reportPagination";

test("WB financial report uses the current Finance API until 204 and deduplicates rows", async () => {
  const requested: number[] = [];
  const pages = new Map<number, Array<{ rrdId: number; nmId: number; vendorCode: string; retailPriceWithDisc: string }>>([
    [0, [
      { rrdId: 1, nmId: 101, vendorCode: "SKU-1", retailPriceWithDisc: "10.50" },
      { rrdId: 2, nmId: 102, vendorCode: "SKU-2", retailPriceWithDisc: "20.50" },
    ]],
    [2, [
      { rrdId: 2, nmId: 102, vendorCode: "SKU-2", retailPriceWithDisc: "20.50" },
      { rrdId: 3, nmId: 103, vendorCode: "SKU-3", retailPriceWithDisc: "30.50" },
    ]],
  ]);

  const result = await fetchWbReportPages<{
    rrdId?: number; rrd_id?: number; nm_id?: number; sa_name?: string; retail_price_withdisc_rub?: string;
  }>({
    token: "test-token",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    limit: 2,
    fields: ["rrdId", "nmId", "vendorCode", "retailPriceWithDisc"],
    retryBaseMs: 0,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
      const body = JSON.parse(String(init?.body)) as { dateFrom: string; dateTo: string; limit: number; rrdId: number; period: string; fields: string[] };
      requested.push(body.rrdId);
      assert.equal(body.dateFrom, "2026-07-01");
      assert.equal(body.dateTo, "2026-07-14");
      assert.equal(body.limit, 2);
      assert.equal(body.period, "weekly");
      assert.deepEqual(body.fields, ["rrdId", "nmId", "vendorCode", "retailPriceWithDisc"]);
      const page = pages.get(body.rrdId);
      return page ? Response.json(page) : new Response(null, { status: 204 });
    },
  });

  assert.deepEqual(requested, [0, 2, 3]);
  assert.deepEqual(result.rows.map((row) => row.rrd_id), [1, 2, 3]);
  assert.deepEqual(result.rows.map((row) => row.nm_id), [101, 102, 103]);
  assert.equal(result.rows[0]?.sa_name, "SKU-1");
  assert.equal(result.rows[0]?.retail_price_withdisc_rub, "10.50");
  assert.equal(result.lastRrdId, 3);
  assert.equal(result.complete, true);
});

test("WB financial report treats an initial 204 as a successful empty report", async () => {
  let calls = 0;
  const result = await fetchWbReportPages({
    token: "test-token",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    retryBaseMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.rows, []);
  assert.equal(result.complete, true);
});

test("WB financial report obeys X-Ratelimit-Retry without losing its cursor", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await fetchWbReportPages<{ rrd_id: number }>({
    token: "test-token",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    limit: 2,
    retryBaseMs: 1,
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("rate limited", { status: 429, headers: { "x-ratelimit-retry": "2" } });
      if (calls === 2) return Response.json([{ rrdId: 7 }]);
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2_000]);
});
