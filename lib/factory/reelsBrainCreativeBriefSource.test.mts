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
          trust_summary: { evidence_band: "stable", stability_score: 88, signals: ["4 stable patterns"], blockers: [] },
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
  });

  assert.equal(result?.source, "segment_solution");
  assert.equal(result?.creative_brief.hook, "Смотри что внутри");
  assert.equal(result?.trust_summary.evidence_band, "stable");
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
            trust_summary: { evidence_band: "forming", stability_score: 61, blockers: ["need more winners"] },
            trust_why: ["platform signal exists"],
          },
        },
      ],
      by_niche: [],
    },
  });
  assert.equal(platformResult?.source, "platform_matrix");
  assert.equal(platformResult?.platform, "youtube");

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
});
