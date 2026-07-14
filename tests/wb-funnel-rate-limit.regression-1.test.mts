import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbFunnelHistory } from "../lib/wb/funnelRequest";

// Regression test for QA ISSUE-004: https://finance-panel-two.vercel.app/sync
test("WB funnel retries one 429 using Retry-After while time remains", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "2" } });
    return Response.json([]);
  };

  const response = await fetchWbFunnelHistory({
    url: "https://seller-analytics-api.wildberries.ru/history",
    token: "test-token",
    body: "{}",
    deadline: 10_000,
    reserveMs: 1_000,
    fallbackWaitMs: 21_000,
    fetchImpl,
    sleep: async (ms) => { waits.push(ms); },
    now: () => 1_000,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test("WB funnel returns 429 without sleeping when the function budget is exhausted", async () => {
  let calls = 0;
  const response = await fetchWbFunnelHistory({
    url: "https://seller-analytics-api.wildberries.ru/history",
    token: "test-token",
    body: "{}",
    deadline: 5_000,
    reserveMs: 1_000,
    fallbackWaitMs: 21_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "5" } });
    },
    sleep: async () => { throw new Error("must not sleep"); },
    now: () => 1_000,
  });

  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});
