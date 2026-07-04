import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainSegmentSolutions } from "./reelsBrainSegmentSolutions";

test("buildReelsBrainSegmentSolutions maps decision snapshot into operator-ready solutions", () => {
  const result = buildReelsBrainSegmentSolutions({
    decisionSnapshot: {
      summary: { filtered_total: 2 },
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          lane: "ship",
          label: "ru_toys × instagram",
          readiness_score: 91,
          trust: {
            corpus_score: 86,
            market_score: 71,
            stable_pattern_count: 4,
            evidence_refs: 5,
          },
          brief: {
            title: "UGC reveal",
            hook: "Смотри что внутри",
            retention: "open loop",
            structure: "before_after",
            second_by_second: ["0-2 hook", "2-5 reveal"],
            visual_recipe: ["macro", "hands", "packaging"],
            audio_strategy: ["fast voice", "light bed"],
            product_fit: ["toys"],
            copy_as_mechanic: ["reveal timing"],
            do_not_copy: ["original text"],
          },
          hypothesis: {
            title: "Reveal beats static demo",
            text: "Если показать распаковку сразу, retention вырастет.",
            success_metric: "higher hold rate",
          },
          content_solution: {
            action_title: "Launch reveal series",
            action_decision: "scale",
            success_metric: "retain 3s hold",
            guardrails: ["no direct copy"],
            execution_note: "ship it",
          },
          next_step: "Снять 3 вариации",
          audit: {
            verdict: "ship",
            strong_signals: ["trust score уже проходит gate"],
            blockers: [],
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          lane: "research",
          readiness_score: 44,
          brief: { hook: "До/после за 5 сек" },
          hypothesis: { text: "Нужен более сильный social proof" },
          content_solution: { action_title: "Hold in research" },
          audit: {
            verdict: "research",
            strong_signals: [],
            blockers: ["мало stable patterns"],
          },
        },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ready_now, 1);
  assert.equal(result.items[0]?.production_state, "ready_now");
  assert.equal(result.items[0]?.trust_band, "high");
  assert.equal(result.items[0]?.trust_summary.evidence_band, "stable");
  assert.deepEqual(result.items[0]?.creative_brief.second_by_second, ["0-2 hook", "2-5 reveal"]);
  assert.equal(result.items[1]?.production_state, "research_only");
  assert.ok(result.items[1]?.trust_summary.blockers.includes("trust floor below 85"));
  assert.ok(result.items[1]?.trust_summary.blockers.includes("fewer than 3 stable patterns"));
});

test("buildReelsBrainSegmentSolutions keeps lane buckets", () => {
  const result = buildReelsBrainSegmentSolutions({
    decisionSnapshot: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          lane: "ship",
          readiness_score: 90,
          trust: { corpus_score: 90, market_score: 70, stable_pattern_count: 4, evidence_refs: 4 },
          brief: { hook: "A" },
          content_solution: { action_title: "A" },
          audit: { verdict: "ship" },
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          lane: "validate",
          readiness_score: 69,
          trust: { corpus_score: 70, market_score: 56, stable_pattern_count: 2, evidence_refs: 2 },
          brief: { hook: "B" },
          content_solution: { action_title: "B" },
          audit: { verdict: "validate" },
        },
        {
          niche: "ru_toys",
          platform: "tiktok",
          lane: "research",
          readiness_score: 42,
          trust: { corpus_score: 42, market_score: 21, stable_pattern_count: 1, evidence_refs: 1 },
          brief: { hook: "C" },
          content_solution: { action_title: "C" },
          audit: { verdict: "research" },
        },
      ],
    },
  });

  assert.equal(result.ship_now.length, 1);
  assert.equal(result.validate_next.length, 1);
  assert.equal(result.research_queue.length, 1);
});
