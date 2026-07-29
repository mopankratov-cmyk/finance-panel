import assert from "node:assert/strict";
import test from "node:test";

import { syncDeferredMessage, syncErrorMessage, syncPayloadOk } from "../lib/sync/result";

test("HTTP 200 with a downstream ok=false is still a failed sync", () => {
  assert.equal(syncPayloadOk(true, { ok: false, errors: ["WB 401"] }), false);
  assert.equal(syncPayloadOk(true, { ok: true, errors: ["WB 401"] }), false);
  assert.equal(syncErrorMessage({ ok: false, errors: ["WB 401"] }), "WB 401");
});

test("aggregate sync surfaces the failing nested job", () => {
  const payload = {
    ok: false,
    result: {
      ok: false,
      results: {
        orders: { ok: true, status: 200 },
        sales: { ok: false, status: 502, error: "WB timeout" },
      },
    },
  };
  assert.equal(syncErrorMessage(payload), "sales: WB timeout");
});

test("deferred sync retries are visible to the operator", () => {
  assert.match(
    syncDeferredMessage({ ok: true, result: { rotated: ["COSMOS: уже выполняется"] } }) ?? "",
    /COSMOS: уже выполняется/,
  );
  assert.match(
    syncDeferredMessage({ ok: true, result: { progress: [{ status: "rate_limited" }] } }) ?? "",
    /автоматически продолжат/,
  );
  assert.equal(syncDeferredMessage({ ok: true, result: { rotated: ["COSMOS: срез 2\/4"] } }), null);
});
