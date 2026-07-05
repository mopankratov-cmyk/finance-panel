import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainGenerationPolicy } from "./reelsBrainGenerationPolicy";

test("buildReelsBrainGenerationPolicy maps solution matrix into generation modes", () => {
  const result = buildReelsBrainGenerationPolicy({
    segmentSolutionMatrix: {
      summary: {
        total_segments: 3,
        ready_now: 1,
        controlled_test: 1,
        research_only: 1,
        high_trust_segments: 1,
        generation_ready_segments: 1,
        publishable_exact_segments: 1,
      },
      by_niche: [
        {
          niche: "ru_toys",
          label: "ru_toys",
          high_trust_generation_ready: true,
          publishable_exact: true,
          coverage_labels: ["instagram", "tiktok"],
          next_gap: { label: "ru_toys × youtube" },
          next_upgrade: {
            unlocked_output: "publishable_visual_brief",
            projected_trust_gain_score: 22,
            projected_production_state: "near_publishable",
            recommended_loop: "media_backfill",
          },
          primary: {
            label: "ru_toys × instagram",
            readiness_score: 90,
            high_trust_generation_ready: true,
            trust_band: "high",
            production_state: "ready_now",
            trust_why: ["stable corpus"],
            trust_summary: { evidence_band: "stable", stability_score: 84, blockers: [], proof_quality: "exact_segment" },
            creative_brief: { title: "Reveal brief", hook: "Смотри что внутри", retention: "open loop", structure: "reveal", do_not_copy: ["text"] },
            hypothesis: { title: "Reveal wins", text: "Reveal boosts hold", success_metric: "3s hold" },
            content_decision: { title: "Scale reveal", decision: "scale", success_metric: "3s hold", guardrails: ["no direct copy"] },
          },
        },
      ],
      by_platform: [
        {
          platform: "instagram",
          label: "instagram",
          coverage_labels: ["ru_toys", "ru_cosmetics"],
          next_gap: { label: "ru_cosmetics × instagram" },
          primary: {
            label: "ru_toys × instagram",
            readiness_score: 68,
            trust_band: "medium",
            production_state: "controlled_test",
            trust_why: ["forming signal"],
            trust_summary: { evidence_band: "forming", stability_score: 61, blockers: ["need more winners"] },
            creative_brief: { hook: "Proof first", retention: "context + payoff", structure: "demo" },
            hypothesis: { title: "Demo wins", text: "Need one more validation" },
            content_decision: { title: "Control batch", decision: "validate", guardrails: ["control only"] },
          },
        },
      ],
      by_segment: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 90,
          high_trust_generation_ready: true,
          trust_band: "high",
          production_state: "ready_now",
          trust_summary: { evidence_band: "stable", proof_quality: "exact_segment" },
          upgrade_forecast: {
            unlocked_output: "publishable_visual_brief",
            projected_trust_gain_score: 22,
            projected_production_state: "near_publishable",
            recommended_loop: "media_backfill",
          },
          creative_brief: { hook: "Segment hook" },
          hypothesis: { text: "Segment hypothesis" },
          content_decision: { decision: "scale" },
        },
      ],
    },
  });

  assert.equal(result.summary.primary_niches, 1);
  assert.equal(result.summary.generation_ready_segments, 1);
  assert.equal(result.summary.publishable_exact_segments, 1);
  assert.equal(result.summary.primary_generation_ready_niches, 1);
  assert.equal(result.summary.primary_exact_niches, 1);
  assert.equal(result.summary.primary_platforms, 0);
  assert.equal(result.global_default?.high_trust_generation_ready, true);
  assert.equal(result.global_default?.policy_mode, "primary");
  assert.equal(result.global_default?.publishable_exact, true);
  assert.equal(result.by_niche[0]?.policy_mode, "primary");
  assert.equal(result.by_niche[0]?.high_trust_generation_ready, true);
  assert.equal(result.by_niche[0]?.publishable_exact, true);
  assert.equal(result.by_niche[0]?.brief_hook, "Смотри что внутри");
  assert.match(String(result.by_niche[0]?.policy_reason), /generation-ready policy/i);
  assert.match(String(result.by_niche[0]?.policy_reason), /generation-ready policy/i);
  assert.match(String(result.by_niche[0]?.policy_reason), /Следующий лучший апгрейд: publishable_visual_brief/i);
  assert.equal((result.by_niche[0]?.next_upgrade as Record<string, unknown> | undefined)?.projected_trust_gain_score, 22);
  assert.equal(result.by_platform[0]?.policy_mode, "control_only");
  assert.equal(result.by_segment[0]?.policy_mode, "primary");
  assert.equal(result.by_segment[0]?.automation_allowed, true);
  assert.equal(result.by_segment[0]?.decision_priority_score, 100);
  assert.equal((result.by_segment[0]?.next_upgrade as Record<string, unknown> | undefined)?.projected_trust_gain_score, 22);
  assert.match(String(result.by_segment[0]?.policy_reason), /publishable exact segment/i);
});

test("buildReelsBrainGenerationPolicy downgrades weak and promising market outcomes", () => {
  const result = buildReelsBrainGenerationPolicy({
    segmentSolutionMatrix: {
      by_niche: [
        {
          niche: "ru_cosmetics",
          label: "ru_cosmetics",
          primary: {
            label: "ru_cosmetics × instagram",
            readiness_score: 88,
            trust_band: "high",
            production_state: "ready_now",
            trust_summary: {
              evidence_band: "stable",
              outcome_status: "promising",
              outcome_confidence: "medium",
            },
            creative_brief: { hook: "A" },
            content_decision: { decision: "scale" },
          },
        },
      ],
      by_platform: [
        {
          platform: "youtube",
          label: "youtube",
          primary: {
            label: "ru_toys × youtube",
            readiness_score: 79,
            trust_band: "medium",
            production_state: "controlled_test",
            trust_summary: {
              evidence_band: "forming",
              outcome_status: "weak",
              outcome_confidence: "medium",
            },
            creative_brief: { hook: "B" },
            content_decision: { decision: "validate" },
          },
        },
      ],
      by_segment: [],
    },
  });

  assert.equal(result.by_niche[0]?.policy_mode, "control_only");
  assert.equal(result.by_niche[0]?.outcome_status, "promising");
  assert.equal(result.by_platform[0]?.policy_mode, "research_only");
  assert.equal(result.by_platform[0]?.automation_allowed, false);
});

test("buildReelsBrainGenerationPolicy downgrades segment-level policy by outcome and preserves upgrade guidance", () => {
  const result = buildReelsBrainGenerationPolicy({
    segmentSolutionMatrix: {
      by_niche: [],
      by_platform: [],
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          label: "ru_clothing × instagram",
          readiness_score: 88,
          high_trust_generation_ready: true,
          trust_band: "high",
          production_state: "ready_now",
          trust_summary: {
            evidence_band: "stable",
            proof_quality: "exact_segment",
            outcome_status: "promising",
            outcome_confidence: "medium",
          },
          upgrade_forecast: {
            unlocked_output: "publishable_visual_brief",
            projected_trust_gain_score: 31,
            projected_trust_gain_band: "high",
            projected_production_state: "publishable_exact",
            recommended_loop: "media_backfill",
          },
          creative_brief: { hook: "Segment hook" },
          hypothesis: { text: "Segment hypothesis" },
          content_decision: { decision: "scale" },
        },
      ],
    },
  });

  assert.equal(result.by_segment[0]?.policy_mode, "control_only");
  assert.equal(result.by_segment[0]?.high_trust_generation_ready, true);
  assert.equal(result.by_segment[0]?.publishable_exact, true);
  assert.equal(result.by_segment[0]?.automation_allowed, true);
  assert.equal(result.by_segment[0]?.decision_priority_score, 100);
  assert.equal((result.by_segment[0]?.next_upgrade as Record<string, unknown> | undefined)?.unlocked_output, "publishable_visual_brief");
  assert.match(String(result.by_segment[0]?.policy_reason), /high-trust generation-ready segment/i);
  assert.match(String(result.by_segment[0]?.policy_reason), /Следующий лучший апгрейд: publishable_visual_brief/i);
  assert.match(String(result.by_segment[0]?.policy_reason), /segment policy понижен до control_only/i);
});

test("buildReelsBrainGenerationPolicy prefers generation-ready segment as global default", () => {
  const result = buildReelsBrainGenerationPolicy({
    segmentSolutionMatrix: {
      by_niche: [],
      by_platform: [],
      by_segment: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          readiness_score: 96,
          trust_band: "high",
          production_state: "ready_now",
          trust_summary: {
            evidence_band: "stable",
            proof_quality: "exact_segment",
            outcome_status: "proven",
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          label: "ru_cosmetics × instagram",
          readiness_score: 72,
          high_trust_generation_ready: true,
          trust_band: "medium",
          production_state: "controlled_test",
          trust_summary: {
            evidence_band: "forming",
            proof_quality: "traced_transfer_only",
            outcome_status: "proven",
          },
        },
      ],
    },
  });

  assert.equal(result.global_default?.label, "ru_cosmetics × instagram");
  assert.equal(result.global_default?.high_trust_generation_ready, true);
});
