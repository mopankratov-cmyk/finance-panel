export type ExperimentalProvider = "pixverse" | "veo" | "runway" | "heygen" | "argil" | "creatomate";

export interface ProviderEvalInput {
  provider: unknown;
  pass_rate?: unknown;
  baseline_pass_rate?: unknown;
  cost_per_pass?: unknown;
  baseline_cost_per_pass?: unknown;
  latency_ms?: unknown;
  baseline_latency_ms?: unknown;
  sample_size?: unknown;
}

export interface ProviderEvalDecision {
  provider: ExperimentalProvider | "unknown";
  enabled: boolean;
  paid_allowed: boolean;
  decision: "disabled" | "candidate" | "promote_candidate";
  reason: string;
  evidence: {
    sample_size: number;
    pass_rate: number | null;
    baseline_pass_rate: number | null;
    cost_per_pass: number | null;
    latency_ms: number | null;
  };
}

export const EXPERIMENTAL_PROVIDER_FLAGS: Record<ExperimentalProvider, string> = {
  pixverse: "FACTORY_PROVIDER_PIXVERSE_ENABLED",
  veo: "FACTORY_PROVIDER_VEO_ENABLED",
  runway: "FACTORY_PROVIDER_RUNWAY_ENABLED",
  heygen: "FACTORY_PROVIDER_HEYGEN_ENABLED",
  argil: "FACTORY_PROVIDER_ARGIL_ENABLED",
  creatomate: "FACTORY_PROVIDER_CREATOMATE_ENABLED",
};

function providerId(value: unknown): ExperimentalProvider | "unknown" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pixverse" || raw === "veo" || raw === "runway" || raw === "heygen" || raw === "argil" || raw === "creatomate") return raw;
  return "unknown";
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isExperimentalProviderEnabled(provider: unknown, env: Record<string, string | undefined> = process.env): boolean {
  const id = providerId(provider);
  if (id === "unknown") return false;
  return truthy(env[EXPERIMENTAL_PROVIDER_FLAGS[id]]);
}

export function evaluateExperimentalProvider(input: ProviderEvalInput, env: Record<string, string | undefined> = process.env): ProviderEvalDecision {
  const provider = providerId(input.provider);
  const enabled = provider !== "unknown" && isExperimentalProviderEnabled(provider, env);
  const sampleSize = Math.max(0, Math.floor(Number(input.sample_size) || 0));
  const passRate = num(input.pass_rate);
  const baselinePassRate = num(input.baseline_pass_rate);
  const costPerPass = num(input.cost_per_pass);
  const baselineCostPerPass = num(input.baseline_cost_per_pass);
  const latencyMs = num(input.latency_ms);
  const baselineLatencyMs = num(input.baseline_latency_ms);
  const evidence = {
    sample_size: sampleSize,
    pass_rate: passRate,
    baseline_pass_rate: baselinePassRate,
    cost_per_pass: costPerPass,
    latency_ms: latencyMs,
  };

  if (provider === "unknown") {
    return { provider, enabled: false, paid_allowed: false, decision: "disabled", reason: "unknown provider", evidence };
  }
  if (!enabled) {
    return { provider, enabled: false, paid_allowed: false, decision: "disabled", reason: `${provider} is behind feature flag ${EXPERIMENTAL_PROVIDER_FLAGS[provider]}`, evidence };
  }
  if (sampleSize < 10 || passRate == null || baselinePassRate == null) {
    return { provider, enabled: true, paid_allowed: true, decision: "candidate", reason: "insufficient evidence; evaluation traffic only", evidence };
  }

  const passRateWins = passRate >= baselinePassRate + 0.1;
  const costOk = costPerPass == null || baselineCostPerPass == null || costPerPass <= baselineCostPerPass * 1.2;
  const latencyOk = latencyMs == null || baselineLatencyMs == null || latencyMs <= baselineLatencyMs * 1.35;
  if (passRateWins && costOk && latencyOk) {
    return { provider, enabled: true, paid_allowed: true, decision: "promote_candidate", reason: "better pass-rate with acceptable cost/latency; still requires owner rollout", evidence };
  }

  return { provider, enabled: true, paid_allowed: true, decision: "candidate", reason: "not better than current provider stack", evidence };
}
