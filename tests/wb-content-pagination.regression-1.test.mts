import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbCardPages } from "../lib/wb/cardPagination";

test("Content API pagination continues beyond the old 30-page ceiling", async () => {
  let calls = 0;
  const result = await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    pageSize: 1,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { settings: { cursor: { nmID?: number } } };
      const previous = body.settings.cursor.nmID ?? 0;
      if (previous >= 31) return Response.json({ cards: [] });
      return Response.json({ cards: [{ nmID: previous + 1 }], cursor: { updatedAt: "2026-07-14T00:00:00Z", nmID: previous + 1 } });
    },
  });

  assert.equal(result.rows.length, 31);
  assert.equal(result.caughtUp, true);
  assert.equal(calls, 32);
});
