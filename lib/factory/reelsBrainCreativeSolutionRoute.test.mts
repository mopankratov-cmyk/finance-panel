import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyCreativeSolution } from "./reelsBrainLegacyCreativeSolutionGuard";

test("normalizeLegacyCreativeSolution downgrades legacy fallback to validation-only exact-proof guard", () => {
  const result = normalizeLegacyCreativeSolution({
    ok: true,
    source: "legacy_creative_brief",
    niche: "ru_cosmetics",
    platform: "youtube",
    quality_gate: {
      status: "ready",
      allowed_generation_modes: ["decision_ready", "control_ready"],
      blocked_reasons: ["legacy source"],
    },
    content_decision: {
      decision: "scale",
      execution_note: "Можно публиковать.",
    },
  }, {
    niche: "ru_toys",
    platform: "instagram",
  });

  assert.equal(result.route, "creative_solution");
  assert.equal(result.requested_segment.niche, "ru_toys");
  assert.equal(result.fit_summary.mode, "broad_transfer");
  assert.equal(result.fit_summary.is_exact_match, false);
  assert.equal(result.quality_gate.status, "needs_validation");
  assert.equal(result.quality_gate.exact_segment_ready, false);
  assert.deepEqual(result.quality_gate.allowed_generation_modes, ["control_ready", "brief_only"]);
  assert.match(String(result.fit_summary.transfer_note), /exact segment ru_toys × instagram/i);
  assert.match(String(result.content_decision.execution_note), /Exact-proof пока не закрыт/i);
  assert.ok((result.quality_gate.blocked_reasons as string[]).some((item) => item.includes("exact segment ru_toys × instagram")));
});

console.log("reelsBrainCreativeSolutionRoute.test: ok");
