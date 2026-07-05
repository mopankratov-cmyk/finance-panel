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
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
  });

  assert.equal(result.summary.expected_segments, 4);
  assert.equal(result.summary.stable_segments, 1);
  assert.equal(result.summary.forming_segments, 1);
  assert.equal(result.summary.thin_segments, 1);
  assert.equal(result.summary.missing_segments, 1);
  assert.equal(result.summary.high_trust_coverage_pct, 25);
  assert.equal(result.summary.generation_ready_segments, 1);
  assert.equal(result.summary.generation_ready_coverage_pct, 25);
  assert.equal(result.summary.publishable_exact_segments, 1);
  assert.equal(result.summary.publishable_exact_coverage_pct, 25);
  assert.equal(result.by_niche[0]?.generation_ready_pct, 50);
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
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", publishable_exact: true, high_trust_generation_ready: true },
        { niche: "ru_toys", platform: "instagram", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
  });

  assert.equal(result.summary.verdict, "ready_for_publishable_exact_generation");
  assert.equal(result.summary.high_trust_coverage_pct, 100);
  assert.equal(result.summary.generation_ready_coverage_pct, 100);
  assert.equal(result.summary.publishable_exact_coverage_pct, 100);
  assert.equal(result.missing_segments.length, 0);
});

test("buildReelsBrainPortfolioReadiness keeps weak-outcome stable segments out of high-trust coverage", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys"],
    platforms: ["tiktok", "instagram"],
    segmentStabilityAudit: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          evidence_band: "stable",
          stability_score: 90,
          high_trust_segment: false,
          outcome_status: "weak",
          blockers: ["market outcome remains weak"],
        },
        {
          niche: "ru_toys",
          platform: "instagram",
          evidence_band: "stable",
          stability_score: 88,
          high_trust_segment: true,
          outcome_status: "proven",
        },
      ],
    },
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "instagram", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
  });

  assert.equal(result.summary.stable_segments, 2);
  assert.equal(result.summary.market_confirmed_segments, 1);
  assert.equal(result.summary.weak_outcome_segments, 1);
  assert.equal(result.summary.high_trust_coverage_pct, 50);
  assert.equal(result.summary.generation_ready_coverage_pct, 50);
  assert.equal(result.summary.publishable_exact_coverage_pct, 50);
  assert.equal(result.summary.verdict, "still_building");
  assert.equal(result.missing_segments[0]?.platform, "tiktok");
});

test("buildReelsBrainPortfolioReadiness distinguishes high trust from publishable exact coverage", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys"],
    platforms: ["tiktok", "instagram"],
    segmentStabilityAudit: {
      items: [
        { niche: "ru_toys", platform: "tiktok", evidence_band: "stable", stability_score: 91, high_trust_segment: true },
        { niche: "ru_toys", platform: "instagram", evidence_band: "stable", stability_score: 88, high_trust_segment: true },
      ],
    },
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
  });

  assert.equal(result.summary.high_trust_coverage_pct, 100);
  assert.equal(result.summary.generation_ready_coverage_pct, 50);
  assert.equal(result.summary.publishable_exact_coverage_pct, 50);
  assert.equal(result.summary.verdict, "high_trust_but_exact_gaps");
  assert.equal(result.publishable_exact_gaps[0]?.platform, "instagram");
});

test("buildReelsBrainPortfolioReadiness prioritizes exact gaps that are closest to publishable exact", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["tiktok", "instagram"],
    segmentStabilityAudit: {
      items: [
        { niche: "ru_toys", platform: "tiktok", evidence_band: "stable", stability_score: 93, high_trust_segment: true },
        { niche: "ru_toys", platform: "instagram", evidence_band: "stable", stability_score: 88, high_trust_segment: true },
        { niche: "ru_cosmetics", platform: "tiktok", evidence_band: "forming", stability_score: 55, high_trust_segment: false },
      ],
    },
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
  });

  assert.equal(result.publishable_exact_gaps[0]?.niche, "ru_toys");
  assert.equal(result.publishable_exact_gaps[0]?.platform, "instagram");
  assert.equal(result.publishable_exact_gaps[1]?.niche, "ru_cosmetics");
});

test("buildReelsBrainPortfolioReadiness prioritizes high-payoff exact gaps", () => {
  const result = buildReelsBrainPortfolioReadiness({
    niches: ["ru_toys", "ru_cosmetics"],
    platforms: ["youtube", "tiktok"],
    segmentStabilityAudit: {
      items: [
        { niche: "ru_toys", platform: "youtube", evidence_band: "stable", stability_score: 92, high_trust_segment: true },
        { niche: "ru_cosmetics", platform: "tiktok", evidence_band: "forming", stability_score: 61, high_trust_segment: false },
      ],
    },
    segmentSolutionMatrix: {
      by_segment: [
        { niche: "ru_toys", platform: "youtube", publishable_exact: true, high_trust_generation_ready: true },
      ],
    },
    segmentPriorityQueue: {
      items: [
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          decision_priority_score: 97,
          policy_mode: "primary",
          ready_for_generation: true,
        },
        {
          niche: "ru_toys",
          platform: "tiktok",
          decision_priority_score: 41,
          policy_mode: "research_only",
        },
      ],
    },
  });

  assert.equal(result.publishable_exact_gaps[0]?.platform, "tiktok");
  assert.equal(result.publishable_exact_gaps[0]?.segment_priority_mode, "primary");
  assert.equal(result.by_niche[0]?.niche, "ru_cosmetics");
  assert.equal(result.by_niche[0]?.primary_priority_segments, 1);
});
