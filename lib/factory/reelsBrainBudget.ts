import type { ReelsBrainProvider } from "./reelsBrainSources";

export type ReelsBrainBudgetDecision = {
  provider: ReelsBrainProvider;
  allowed: boolean;
  cost_units: number;
  reason?: string;
};

export type ReelsBrainBudgetPlan = {
  max_provider_calls: number;
  max_cost_units: number;
  used_provider_calls: number;
  used_cost_units: number;
  decisions: ReelsBrainBudgetDecision[];
};

const PROVIDER_COST_UNITS: Partial<Record<ReelsBrainProvider, number>> = {
  youtube: 1,
  virlo: 2,
  ensemble_tiktok: 2,
  ensemble_instagram: 2,
  ensemble_youtube: 2,
  apify: 3,
  apify_tiktok: 3,
  apify_instagram: 3,
  apify_youtube: 3,
  bright_tiktok: 4,
  bright_instagram: 4,
  bright_youtube: 4,
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function providerCostUnits(provider: ReelsBrainProvider): number {
  return Math.max(1, PROVIDER_COST_UNITS[provider] || 3);
}

export function reelsBrainBudgetLimits(input?: {
  max_provider_calls?: unknown;
  max_cost_units?: unknown;
}) {
  return {
    max_provider_calls: Math.max(1, Math.min(50, num(input?.max_provider_calls ?? process.env.REELS_BRAIN_MAX_PROVIDER_CALLS_PER_TICK, 6))),
    max_cost_units: Math.max(1, Math.min(200, num(input?.max_cost_units ?? process.env.REELS_BRAIN_MAX_COST_UNITS_PER_TICK, 12))),
  };
}

export function buildReelsBrainBudgetPlan(
  providers: ReelsBrainProvider[],
  limits = reelsBrainBudgetLimits(),
): ReelsBrainBudgetPlan {
  let usedProviderCalls = 0;
  let usedCostUnits = 0;
  const decisions = providers.map((provider) => {
    const cost = providerCostUnits(provider);
    const overCalls = usedProviderCalls + 1 > limits.max_provider_calls;
    const overCost = usedCostUnits + cost > limits.max_cost_units;
    if (overCalls || overCost) {
      return {
        provider,
        allowed: false,
        cost_units: cost,
        reason: overCalls ? "provider_call_budget_exceeded" : "cost_unit_budget_exceeded",
      };
    }
    usedProviderCalls += 1;
    usedCostUnits += cost;
    return { provider, allowed: true, cost_units: cost };
  });

  return {
    ...limits,
    used_provider_calls: usedProviderCalls,
    used_cost_units: usedCostUnits,
    decisions,
  };
}
