import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyCreativeBrief } from "./reelsBrainLegacyCreativeBriefGuard";

test("normalizeLegacyCreativeBrief downgrades legacy decision-pack to validation-only exact-proof guard", () => {
  const result = normalizeLegacyCreativeBrief({
    source: "reels_brain_best_pattern",
    niche: "ru_cosmetics",
    platform: "youtube",
    pattern_id: "hook:demo:proof",
    hook_type: "demo",
    structure_type: "review",
    retention_mechanism: "proof",
    quality_label: "generator_ready",
    creative_brief: {
      hook: "До и после",
      retention_mechanic: "proof frame",
    },
    evidence: {
      trust_decision: {
        selected_scope: "meta",
      },
    },
    decision_pack: {
      strategy_note: "Use as research/control ladder.",
    },
    quality_reasons: ["mixed_or_non_ru_examples"],
  }, {
    niche: "ru_toys",
    platform: "instagram",
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "reels_brain_best_pattern");
  assert.equal(result.requested_segment.niche, "ru_toys");
  assert.equal(result.fit_summary.mode, "broad_transfer");
  assert.equal(result.fit_summary.is_exact_match, false);
  assert.equal(result.selected_pattern.trust_scope, "meta");
  assert.equal(result.quality_gate.status, "needs_validation");
  assert.equal(result.quality_gate.exact_segment_ready, false);
  assert.deepEqual(result.quality_gate.allowed_generation_modes, ["control_ready", "brief_only"]);
  assert.match(String(result.fit_summary.transfer_note), /exact segment ru_toys × instagram/i);
  assert.match(String(result.content_decision.execution_note), /control\/brief ladder/i);
  assert.ok((result.quality_gate.blocked_reasons as string[]).some((item) => item.includes("exact segment ru_toys × instagram")));
});

console.log("reelsBrainCreativeBriefRoute.test: ok");
