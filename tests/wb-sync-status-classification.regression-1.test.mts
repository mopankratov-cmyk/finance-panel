import assert from "node:assert/strict";
import test from "node:test";

import { wbCacheProgressReadiness } from "../lib/sync/wbCacheReadiness";
import { wbSyncHealthStatus } from "../lib/sync/wbSyncHealthStatus";
import { isWbGlobalRateLimitMessage } from "../lib/wb/rateLimit";

const wb429 = 'WB 429: { "title": "too many requests", "detail": "Limited by global limiter, per seller 493a" }';

test("stored WB global-limiter 429 is a deferred sync state, not a red health error", () => {
  assert.equal(isWbGlobalRateLimitMessage(wb429), true);
  assert.deepEqual(
    wbSyncHealthStatus({
      progressStatus: "error",
      stateLastError: wb429,
      stale: false,
      hasLastSyncedAt: true,
    }),
    { status: "running", lastError: null },
  );
});

test("health status still surfaces real source errors even near an old WB 429", () => {
  assert.deepEqual(
    wbSyncHealthStatus({
      sourceError: "relation wb_funnel_daily does not exist",
      progressStatus: "error",
      stateLastError: wb429,
      stale: false,
      hasLastSyncedAt: true,
    }),
    { status: "error", lastError: "relation wb_funnel_daily does not exist" },
  );
});

test("cache progress treats stored WB global-limiter 429 as incomplete instead of failed", () => {
  const readiness = wbCacheProgressReadiness(
    [
      { cabinet_id: "optima", job: "advert-stats", status: "caught_up", last_error: null },
      { cabinet_id: "optima", job: "funnel", status: "error", last_error: wb429 },
      { cabinet_id: "optima", job: "feedbacks", status: "caught_up", last_error: null },
    ],
    [{ id: "optima", scoped: false }],
  );
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.failed, []);
  assert.deepEqual(readiness.incomplete, ["optima:funnel"]);
});
