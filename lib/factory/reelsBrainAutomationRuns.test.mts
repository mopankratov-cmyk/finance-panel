import test from "node:test";
import assert from "node:assert/strict";
import { summarizeReelsBrainAutomationRuns } from "./reelsBrainAutomationRuns";

test("summarizeReelsBrainAutomationRuns aggregates pattern gain proxies", () => {
  const result = summarizeReelsBrainAutomationRuns({
    mode: "bulk",
    strategy: "bulk_raw_ingest",
    platforms: ["tiktok"],
    runs: [
      {
        platform: "tiktok",
        provider: "apify_tiktok",
        found: 40,
        inserted: 12,
        relevant: 12,
        analyzed: 12,
        cost_units: 3,
        pattern_gain_proxy: 9.5,
        high_trust_gain_proxy: 3,
      },
      {
        platform: "tiktok",
        provider: "virlo",
        found: 20,
        inserted: 6,
        relevant: 6,
        analyzed: 6,
        cost_units: 2,
        pattern_gain_proxy: 4,
        high_trust_gain_proxy: 1.5,
      },
    ],
    ok: true,
  });

  assert.equal(result.pattern_gain_proxy, 13.5);
  assert.equal(result.high_trust_gain_proxy, 4.5);
  assert.equal(result.cost_units, 5);
});
