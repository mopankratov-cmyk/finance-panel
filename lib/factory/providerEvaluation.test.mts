import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateExperimentalProvider, EXPERIMENTAL_PROVIDER_FLAGS, isExperimentalProviderEnabled } from "./providerEvaluation";

{
  const decision = evaluateExperimentalProvider({ provider: "veo", pass_rate: 0.9, baseline_pass_rate: 0.5, sample_size: 99 }, {});
  equal(decision.decision, "disabled", "new providers are disabled without feature flag");
  equal(decision.paid_allowed, false, "disabled providers cannot enter paid path");
  ok(decision.reason.includes(EXPERIMENTAL_PROVIDER_FLAGS.veo), "disabled reason names the flag");
}

{
  const env = { FACTORY_PROVIDER_RUNWAY_ENABLED: "true" };
  equal(isExperimentalProviderEnabled("runway", env), true, "truthy env flag enables candidate evaluation");
  const decision = evaluateExperimentalProvider({ provider: "runway", sample_size: 3, pass_rate: 0.8, baseline_pass_rate: 0.6 }, env);
  equal(decision.decision, "candidate", "small samples stay candidates");
  equal(decision.paid_allowed, true, "flagged providers can receive limited evaluation traffic");
}

{
  const env = { FACTORY_PROVIDER_PIXVERSE_ENABLED: "1" };
  const decision = evaluateExperimentalProvider({
    provider: "pixverse",
    sample_size: 20,
    pass_rate: 0.66,
    baseline_pass_rate: 0.5,
    cost_per_pass: 1.1,
    baseline_cost_per_pass: 1,
    latency_ms: 110000,
    baseline_latency_ms: 100000,
  }, env);

  equal(decision.decision, "promote_candidate", "better pass-rate can only become a promote candidate");
  ok(decision.reason.includes("owner rollout"), "promotion still requires owner rollout");
}

{
  const env = { FACTORY_PROVIDER_HEYGEN_ENABLED: "true" };
  const decision = evaluateExperimentalProvider({
    provider: "heygen",
    sample_size: 20,
    pass_rate: 0.52,
    baseline_pass_rate: 0.5,
    cost_per_pass: 2,
    baseline_cost_per_pass: 1,
  }, env);

  equal(decision.decision, "candidate", "provider stays candidate when it does not clearly beat current stack");
}

{
  const route = readFileSync("app/api/factory/provider-evaluation/route.ts", "utf8");
  ok(/provider_evaluation_shadow/.test(route), "provider evaluation route is shadow/diagnostic only");
  ok(/owner rollout required/.test(route), "route does not make promote candidates primary");
}

console.log("providerEvaluation: passed");
