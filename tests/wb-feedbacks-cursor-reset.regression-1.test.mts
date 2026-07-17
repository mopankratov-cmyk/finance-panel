import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchWbFeedbacksPage, WbFeedbacksCursorError } from "../lib/wb/feedbacksApi";

test("WB feedbacks 422 on a saved skip is classified as a stale cursor", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () => new Response(
    '{"data":null,"error":true,"errorText":"Не удалось получить отзывы по skip"}',
    { status: 422 },
  )) as typeof fetch;

  await assert.rejects(
    () => fetchWbFeedbacksPage("test-token", false, 5_000, 5_000),
    (error) => {
      assert.ok(error instanceof WbFeedbacksCursorError);
      assert.equal(error.status, 422);
      assert.match(error.message, /WB 422/);
      return true;
    },
  );
});

test("feedbacks sync route resets a stale WB feedback cursor before failing red", () => {
  const source = readFileSync(new URL("../app/api/sync/feedbacks/route.ts", import.meta.url), "utf8");

  assert.match(source, /instanceof WbFeedbacksCursorError/);
  assert.match(source, /unansweredSkip = 0/);
  assert.match(source, /answeredSkip = 0/);
  assert.match(source, /cursorResets/);
  assert.match(source, /export const maxDuration = 300/);
  assert.match(source, /MAX_PAGES_PER_RUN = 30/);
  assert.match(source, /orderedCabs/);
});
