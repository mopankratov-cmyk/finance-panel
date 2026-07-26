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
