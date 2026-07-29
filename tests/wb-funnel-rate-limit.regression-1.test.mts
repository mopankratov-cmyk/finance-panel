import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isWbAdvertRateLimit } from "../lib/wb/advertRateLimit";
import { fetchWbFunnelHistory } from "../lib/wb/funnelRequest";
import { isWbGlobalRateLimit } from "../lib/wb/rateLimit";
import { fetchWbStatistics } from "../lib/wb/statisticsRequest";

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

test("WB advert fullstats global limiter is recognized as a deferred retry", () => {
  assert.equal(
    isWbAdvertRateLimit(429, '{ "title": "too many requests", "detail": "Limited by global limiter, per seller 493a" }'),
    true,
  );
  assert.equal(isWbAdvertRateLimit(403, "Limited by global limiter"), false);
  assert.equal(isWbAdvertRateLimit(429, '{ "title": "validation error" }'), false);
});

test("WB funnel global limiter is recognized as a deferred retry", () => {
  assert.equal(
    isWbGlobalRateLimit(429, '{ "title": "too many requests", "detail": "Limited by global limiter, per seller 493a" }'),
    true,
  );
  assert.equal(isWbGlobalRateLimit(403, "Limited by global limiter"), false);
  assert.equal(isWbGlobalRateLimit(429, '{ "title": "validation error" }'), false);
});

test("funnel route defers WB 429 without writing a fatal sync error", () => {
  const source = readFileSync(new URL("../app/api/sync/funnel/route.ts", import.meta.url), "utf8");
  assert.match(source, /isWbGlobalRateLimit\(res\.status, message\)/);
  assert.match(source, /status: "rate_limited"/);
  assert.match(source, /cursor: String\(startB\), status: "pending"/);
  assert.match(source, /errors\.length \? \(errors\.join\("; "\) \+ note\)\.trim\(\) : null/);
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

test("WB statistics retries one global-limiter 429 using Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await fetchWbStatistics({
    url: "https://statistics-api.wildberries.ru/api/v1/supplier/sales",
    token: "test-token",
    deadline: 10_000,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("global limiter", { status: 429, headers: { "retry-after": "2" } })
        : Response.json([]);
    },
    sleep: async (ms) => { waits.push(ms); },
    now: () => 1_000,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test("WB statistics retries one transient provider 500 within the function budget", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await fetchWbStatistics({
    url: "https://advert-api.wildberries.ru/adv/v3/fullstats",
    token: "test-token",
    deadline: 10_000,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("repository.GetAtbsDailyNmStats failed", { status: 500 })
        : Response.json([]);
    },
    sleep: async (ms) => { waits.push(ms); },
    now: () => 1_000,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});
