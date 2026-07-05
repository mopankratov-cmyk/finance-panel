import test from "node:test";
import assert from "node:assert/strict";
import { selectCreativeBriefFromSegmentLayers } from "./reelsBrainCreativeBriefSource";

test("selectCreativeBriefFromSegmentLayers prefers exact segment solution over grouped fallbacks", () => {
  const result = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "instagram",
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 91,
          trust_band: "high",
          production_state: "ready_now",
          creative_brief: {
            title: "Reveal brief",
            hook: "Смотри что внутри",
            retention: "open loop",
            structure: "before_after",
            second_by_second: ["0-2 hook"],
          },
          hypothesis: { title: "Reveal wins", text: "Reveal grows hold", success_metric: "3s hold" },
          content_decision: { title: "Launch reveal", decision: "scale", success_metric: "3s hold", guardrails: ["no direct copy"] },
          trust_summary: {
            evidence_band: "stable",
            stability_score: 88,
            signals: ["4 stable patterns"],
            blockers: [],
            outcome_status: "proven",
            outcome_confidence: "high",
            outcome_posts: 6,
            outcome_winners: 3,
            outcome_losers: 0,
          },
          trust_why: ["stable corpus", "market signal present"],
        },
      ],
    },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "instagram",
          primary: {
            niche: "ru_cosmetics",
            platform: "instagram",
            creative_brief: { hook: "platform fallback" },
          },
        },
      ],
    },
    segmentGenerationPacks: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          quality_gate: {
            status: "ready",
            allowed_generation_modes: ["decision_ready"],
            blocked_reasons: [],
            min_trust_score: 82,
          },
        },
      ],
    },
  });

  assert.equal(result?.source, "segment_solution");
  assert.equal(result?.creative_brief.hook, "Смотри что внутри");
  assert.equal(result?.trust_summary.evidence_band, "stable");
  assert.equal(result?.trust_summary.outcome_status, "proven");
  assert.equal(result?.fit_summary?.mode, "exact_segment");
  assert.equal(result?.quality_gate?.status, "ready");
  assert.equal(result?.quality_gate?.exact_segment_ready, true);
  assert.equal(result?.source_trace?.[0]?.source, "segment_solution");
});

test("selectCreativeBriefFromSegmentLayers falls back to platform then niche matrix", () => {
  const platformResult = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "youtube",
    segmentSolutions: { items: [] },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "youtube",
          primary: {
            niche: "ru_cosmetics",
            platform: "youtube",
            label: "ru_cosmetics × youtube",
            readiness_score: 66,
            trust_band: "medium",
            production_state: "controlled_test",
            creative_brief: { hook: "YouTube proof", retention: "context + payoff" },
            hypothesis: { text: "Need more context" },
            content_decision: { title: "Control batch", decision: "validate" },
            trust_summary: {
              evidence_band: "forming",
              stability_score: 61,
              blockers: ["need more winners"],
              outcome_status: "weak",
              outcome_confidence: "medium",
              outcome_posts: 3,
              outcome_winners: 0,
              outcome_losers: 2,
            },
            trust_why: ["platform signal exists"],
          },
        },
      ],
      by_niche: [],
    },
  });
  assert.equal(platformResult?.source, "platform_matrix");
  assert.equal(platformResult?.platform, "youtube");
  assert.equal(platformResult?.fit_summary?.mode, "platform_transfer");
  assert.equal(platformResult?.quality_gate?.status, "needs_validation");
  assert.equal(platformResult?.quality_gate?.exact_segment_ready, false);
  assert.match(String(platformResult?.fit_summary?.transfer_note || ""), /exact segment/i);
  assert.ok(platformResult?.content_decision.guardrails.some((item) => item.includes("Не пускать текущую механику")));
  assert.equal(platformResult?.anti_patterns?.[0]?.label, "Weak segment outcome");
  assert.equal(platformResult?.source_trace?.[0]?.source, "platform_matrix");

  const nicheResult = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "tiktok",
    segmentSolutions: { items: [] },
    segmentSolutionMatrix: {
      by_platform: [],
      by_niche: [
        {
          niche: "ru_toys",
          primary: {
            niche: "ru_toys",
            platform: "instagram",
            label: "ru_toys × instagram",
            readiness_score: 74,
            trust_band: "medium",
            production_state: "controlled_test",
            creative_brief: { hook: "Niche fallback", retention: "proof first" },
            hypothesis: { text: "Need one more test" },
            content_decision: { title: "Validate", decision: "validate" },
            trust_summary: { evidence_band: "forming", stability_score: 58, blockers: [] },
            trust_why: ["niche has one strong segment"],
          },
        },
      ],
    },
  });
  assert.equal(nicheResult?.source, "niche_matrix");
  assert.equal(nicheResult?.creative_brief.hook, "Niche fallback");
  assert.equal(nicheResult?.fit_summary?.mode, "niche_transfer");
  assert.equal(nicheResult?.quality_gate?.status, "needs_validation");
  assert.equal(nicheResult?.source_trace?.[0]?.source, "niche_matrix");
});

test("selectCreativeBriefFromSegmentLayers exposes alternative fallback ladder when multiple candidates exist", () => {
  const result = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "instagram",
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 88,
          trust_band: "high",
          production_state: "ready_now",
          creative_brief: { hook: "Exact" },
          trust_summary: { evidence_band: "stable", stability_score: 84 },
        },
      ],
    },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "instagram",
          primary: {
            niche: "ru_cosmetics",
            platform: "instagram",
            label: "ru_cosmetics × instagram",
            readiness_score: 63,
            trust_band: "medium",
            production_state: "controlled_test",
            creative_brief: { hook: "Platform alt" },
            trust_summary: { evidence_band: "forming", stability_score: 58 },
          },
        },
      ],
      by_niche: [
        {
          niche: "ru_toys",
          primary: {
            niche: "ru_toys",
            platform: "youtube",
            label: "ru_toys × youtube",
            readiness_score: 57,
            trust_band: "medium",
            production_state: "controlled_test",
            creative_brief: { hook: "Niche alt" },
            trust_summary: { evidence_band: "forming", stability_score: 51 },
          },
        },
      ],
    },
  });

  assert.equal(result?.alternatives?.length, 2);
  assert.equal(result?.alternatives?.[0]?.source, "platform_matrix");
  assert.equal(result?.alternatives?.[0]?.fit_mode, "platform_transfer");
  assert.equal(result?.alternatives?.[1]?.source, "niche_matrix");
  assert.equal(result?.alternatives?.[1]?.fit_mode, "niche_transfer");
});

test("selectCreativeBriefFromSegmentLayers prioritizes publishable exact brief over stronger transfer fallback", () => {
  const result = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "instagram",
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 79,
          trust_band: "medium",
          production_state: "ready_now",
          creative_brief: { hook: "Exact publishable" },
          trust_summary: {
            evidence_band: "stable",
            stability_score: 71,
            outcome_status: "promising",
            outcome_confidence: "medium",
          },
        },
      ],
    },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "instagram",
          primary: {
            niche: "ru_cosmetics",
            platform: "instagram",
            label: "ru_cosmetics × instagram",
            readiness_score: 92,
            trust_band: "high",
            production_state: "ready_now",
            creative_brief: { hook: "Transfer winner" },
            trust_summary: {
              evidence_band: "stable",
              stability_score: 89,
              outcome_status: "proven",
              outcome_confidence: "high",
            },
          },
        },
      ],
      by_niche: [],
    },
    segmentGenerationPacks: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          proof_quality: "exact_segment",
          quality_gate: {
            status: "ready",
            allowed_generation_modes: ["decision_ready"],
            blocked_reasons: [],
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          proof_quality: "exact_segment",
          quality_gate: {
            status: "ready",
            allowed_generation_modes: ["decision_ready"],
            blocked_reasons: [],
          },
        },
      ],
    },
  });

  assert.equal(result?.source, "segment_solution");
  assert.equal(result?.creative_brief.hook, "Exact publishable");
  assert.equal(result?.quality_gate.exact_segment_ready, true);
  assert.equal(result?.source_trace?.[0]?.publishable_exact, true);
  assert.equal(result?.source_trace?.[1]?.source, "platform_matrix");
  assert.equal(result?.alternatives?.[0]?.source, "platform_matrix");
});

test("selectCreativeBriefFromSegmentLayers avoids exact weak segment when healthier fallback exists", () => {
  const result = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "instagram",
    segmentSolutions: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          label: "ru_toys × instagram",
          readiness_score: 92,
          trust_band: "high",
          production_state: "ready_now",
          creative_brief: { hook: "Weak exact" },
          trust_summary: {
            evidence_band: "stable",
            stability_score: 89,
            outcome_status: "weak",
            outcome_confidence: "medium",
            outcome_posts: 4,
            outcome_winners: 0,
            outcome_losers: 3,
          },
        },
      ],
    },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "instagram",
          primary: {
            niche: "ru_cosmetics",
            platform: "instagram",
            label: "ru_cosmetics × instagram",
            readiness_score: 74,
            trust_band: "medium",
            production_state: "controlled_test",
            creative_brief: { hook: "Healthy fallback" },
            trust_summary: {
              evidence_band: "forming",
              stability_score: 67,
              outcome_status: "proven",
              outcome_confidence: "high",
              outcome_posts: 6,
              outcome_winners: 3,
              outcome_losers: 0,
            },
          },
        },
      ],
      by_niche: [],
    },
  });

  assert.equal(result?.source, "platform_matrix");
  assert.equal(result?.creative_brief.hook, "Healthy fallback");
  assert.equal(result?.fit_summary?.mode, "platform_transfer");
  assert.equal(result?.quality_gate?.status, "needs_validation");
  assert.ok((result?.quality_gate?.blocked_reasons || []).some((item: string) => item.includes("exact segment")));
  assert.equal(result?.source_trace?.[0]?.outcome_status, "proven");
  assert.equal(result?.alternatives?.[0]?.outcome_status, "weak");
});

test("selectCreativeBriefFromSegmentLayers returns null in strict-exact mode when only transfer fallback exists", () => {
  const result = selectCreativeBriefFromSegmentLayers({
    niche: "ru_toys",
    platform: "youtube",
    strictExact: true,
    segmentSolutions: { items: [] },
    segmentSolutionMatrix: {
      by_platform: [
        {
          platform: "youtube",
          primary: {
            niche: "ru_cosmetics",
            platform: "youtube",
            label: "ru_cosmetics × youtube",
            readiness_score: 79,
            trust_band: "high",
            production_state: "ready_now",
            creative_brief: { hook: "Borrowed winner" },
            trust_summary: {
              evidence_band: "stable",
              stability_score: 82,
              outcome_status: "proven",
            },
          },
        },
      ],
      by_niche: [],
    },
  });

  assert.equal(result, null);
});
