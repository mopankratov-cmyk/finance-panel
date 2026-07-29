import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbCardPages } from "../lib/wb/cardPagination";

test("full WB Content API pagination retries a transient global 429", async () => {
  let calls = 0;
  const slept: number[] = [];

  const result = await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("Limited by global limiter", {
          status: 429,
          headers: { "x-ratelimit-retry": "2" },
        });
      }
      return Response.json({ cards: [] });
    },
  });

  assert.equal(result.caughtUp, true);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [2_000]);
});

test("full WB Content API pagination survives two consecutive global 429 responses", async () => {
  let calls = 0;
  const slept: number[] = [];
  const result = await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 2) {
        return new Response("Limited by global limiter", {
          status: 429,
          headers: { "x-ratelimit-retry": "1" },
        });
      }
      return Response.json({ cards: [] });
    },
  });

  assert.equal(result.caughtUp, true);
  assert.equal(calls, 3);
  assert.deepEqual(slept, [1_000, 1_000]);
});

test("full WB Content API pagination respects the documented 600 ms interval", async () => {
  const slept: number[] = [];
  let calls = 0;
  await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    pageSize: 1,
    minIntervalMs: 600,
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ cards: [{ nmID: 1 }], cursor: { nmID: 1 } })
        : Response.json({ cards: [] });
    },
  });

  assert.deepEqual(slept, [600]);
});
