import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbReportPages } from "../lib/wb/reportPagination";

test("WB financial report follows rrdid until an empty page and deduplicates rows", async () => {
  const requested: number[] = [];
  const pages = new Map<number, Array<{ rrd_id: number; amount: number }>>([
    [0, [{ rrd_id: 1, amount: 10 }, { rrd_id: 2, amount: 20 }]],
    [2, [{ rrd_id: 2, amount: 20 }, { rrd_id: 3, amount: 30 }]],
    [3, []],
  ]);

  const result = await fetchWbReportPages<{ rrd_id: number; amount: number }>({
    token: "test-token",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-14",
    limit: 2,
    retryBaseMs: 0,
    fetchImpl: async (input) => {
      const rrdid = Number(new URL(String(input)).searchParams.get("rrdid"));
      requested.push(rrdid);
      return Response.json(pages.get(rrdid) ?? []);
    },
  });

  assert.deepEqual(requested, [0, 2, 3]);
  assert.deepEqual(result.rows.map((row) => row.rrd_id), [1, 2, 3]);
  assert.equal(result.lastRrdId, 3);
  assert.equal(result.complete, true);
});

test("WB financial report retries a temporary 429 without losing its cursor", async () => {
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
      if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      if (calls === 2) return Response.json([{ rrd_id: 7 }]);
      return Response.json([]);
    },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [0]);
});
