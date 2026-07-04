import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainPortfolioReadiness } from "./reelsBrainPortfolioReadiness";

test("buildReelsBrainPortfolioReadiness summarizes matrix coverage", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["tiktok", "instagram"],
    segmentStabilityAudit: {
      items: [
        { niche: "ru_toys", platform: "tiktok", evidence_band: "stable", stability_score: 90, high_trust_segment: true },
        { niche: "ru_toys", platform: "instagram", evidence_band: "forming", stability_score: 68, high_trust_segment: false },
        { niche: "ru_cosmetics", platform: "tiktok", evidence_band: "thin", stability_score: 42, high_trust_segment: false },
      ],
    },
  });

  assert.equal(result.summary.expected_segments, 4);
  assert.equal(result.summary.stable_segments, 1);
  assert.equal(result.summary.forming_segments, 1);
  assert.equal(result.summary.thin_segments, 1);
  assert.equal(result.summary.missing_segments, 1);
  assert.equal(result.summary.high_trust_coverage_pct, 25);
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.by_platform[0]?.platform, "tiktok");
});

test("buildReelsBrainPortfolioReadiness marks fully stable matrix as ready", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys"],
    platforms: ["tiktok", "instagram"],
    segmentStabilityAudit: {
      items: [
        { niche: "ru_toys", platform: "tiktok", evidence_band: "stable", stability_score: 91, high_trust_segment: true },
        { niche: "ru_toys", platform: "instagram", evidence_band: "stable", stability_score: 88, high_trust_segment: true },
      ],
    },
  });

  assert.equal(result.summary.verdict, "ready_for_high_trust_generation");
  assert.equal(result.summary.high_trust_coverage_pct, 100);
  assert.equal(result.missing_segments.length, 0);
});
