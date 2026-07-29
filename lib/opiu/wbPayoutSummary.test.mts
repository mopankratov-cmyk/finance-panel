import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { deriveWbPayoutSummary } = await import("./forecast");

test("WB payout keeps report accrual separate from unavailable bank fact", () => {
  assert.deepEqual(deriveWbPayoutSummary(1_000, 400), {
    reportAccruedPayout: 400,
    actualPayout: null,
    remainingPayout: 1_000,
  });
});

test("WB payout never exposes an invalid or negative forecast remainder", () => {
  assert.equal(deriveWbPayoutSummary(-1, 400).remainingPayout, 0);
  assert.equal(deriveWbPayoutSummary(Number.NaN, 400).remainingPayout, 0);
});
