import type { ReelsBrainProvider } from "./reelsBrainSources";
import type { ReelsBrainCronExecutionIntent } from "./reelsBrainCronExecutionIntent";

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function focusSegment(intent: ReelsBrainCronExecutionIntent | null | undefined) {
  const label = text(intent?.focus_segment);
  const [niche = "", platform = ""] = label.split("×").map((part) => part.trim());
  return { niche, platform };
}

function sameSegment(
  intent: ReelsBrainCronExecutionIntent | null | undefined,
  lane: { niche: string; platform: string },
) {
  const focus = focusSegment(intent);
  return Boolean(focus.niche && focus.platform && focus.niche === lane.niche && focus.platform === lane.platform);
}

function uniqueProviders(list: ReelsBrainProvider[]) {
  return Array.from(new Set(list));
}

export function parseBulkExecutionIntent(value: unknown): ReelsBrainCronExecutionIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const task = text(row.task);
  if (task !== "bulk" && task !== "analyze") return null;
  const policyMode = text(row.policy_mode, "research_only");
  return {
    mode: text(row.mode, "generic_bulk") as ReelsBrainCronExecutionIntent["mode"],
    task,
    focus_segment: text(row.focus_segment) || null,
    policy_mode: policyMode === "primary" || policyMode === "control_only" ? policyMode : "research_only",
    explanation: text(row.explanation),
    preferred_provider: text(row.preferred_provider) || null,
    source_discovery_mode: text(row.source_discovery_mode) || null,
    source_provider_reason: text(row.source_provider_reason) || null,
    bulk_overrides: row.bulk_overrides && typeof row.bulk_overrides === "object" && !Array.isArray(row.bulk_overrides)
      ? row.bulk_overrides as NonNullable<ReelsBrainCronExecutionIntent["bulk_overrides"]>
      : undefined,
    analyze_overrides: row.analyze_overrides && typeof row.analyze_overrides === "object" && !Array.isArray(row.analyze_overrides)
      ? row.analyze_overrides as NonNullable<ReelsBrainCronExecutionIntent["analyze_overrides"]>
      : undefined,
  };
}

export function tuneBulkLaneByExecutionIntent(input: {
  intent: ReelsBrainCronExecutionIntent | null;
  lane: { niche: string; platform: "tiktok" | "instagram" | "youtube"; progress_pct: number };
  queries: string[];
  providers: ReelsBrainProvider[];
  preferredProvider: ReelsBrainProvider | null;
  recommendedProvider?: ReelsBrainProvider | null;
  providersPerLane: number;
  queryVariantsPerLane: number;
  limit: number;
  providerTimeoutMs: number;
}) {
  const intent = input.intent;
  const focused = sameSegment(intent, input.lane);
  const queryCapBase = Math.max(1, input.queryVariantsPerLane);
  const providerCapBase = Math.max(1, input.providersPerLane);
  let queries = [...input.queries];
  let providers = [...input.providers];
  let queryCap = queryCapBase;
  let providerCap = providerCapBase;
  let limit = input.limit;
  let providerTimeoutMs = input.providerTimeoutMs;
  let strategy = "generic_bulk";
  const pinnedProvider = input.recommendedProvider && providers.includes(input.recommendedProvider)
    ? input.recommendedProvider
    : input.preferredProvider && providers.includes(input.preferredProvider)
      ? input.preferredProvider
      : null;

  if (intent?.mode === "support_primary_segment" && focused) {
    strategy = "support_primary_segment";
    queryCap = 1;
    providerCap = pinnedProvider ? 1 : Math.min(1, providerCapBase);
    limit = Math.max(10, Math.min(limit, 18));
    providerTimeoutMs = Math.min(providerTimeoutMs, 14000);
    queries = queries.slice(0, 1);
    providers = pinnedProvider
      ? [pinnedProvider]
      : providers.slice(0, 1);
  } else if (intent?.mode === "support_control_segment" && focused) {
    strategy = "support_control_segment";
    queryCap = Math.min(2, queryCapBase);
    providerCap = Math.min(2, providerCapBase);
    limit = Math.max(12, Math.min(limit, 22));
    queries = queries.slice(0, queryCap);
    providers = pinnedProvider
      ? uniqueProviders([pinnedProvider, ...providers]).slice(0, providerCap)
      : providers.slice(0, providerCap);
  } else if (intent?.mode === "close_exact_segment_gap" && focused) {
    strategy = intent.source_discovery_mode
      ? `close_exact_segment_gap:${intent.source_discovery_mode}`
      : "close_exact_segment_gap";
    queryCap = 1;
    providerCap = 1;
    limit = Math.max(10, Math.min(limit, 18));
    providerTimeoutMs = Math.min(providerTimeoutMs, 14000);
    queries = queries.slice(0, 1);
    providers = pinnedProvider
      ? [pinnedProvider]
      : providers.slice(0, 1);
  } else if (intent?.mode === "close_portfolio_gap" && focused) {
    strategy = "close_portfolio_gap";
    queryCap = 1;
    providerCap = 1;
    limit = Math.max(12, Math.min(limit, 24));
    queries = queries.slice(0, 1);
    providers = pinnedProvider
      ? [pinnedProvider]
      : providers.slice(0, 1);
  } else if (intent?.mode === "explore_research_segment" || intent?.policy_mode === "research_only") {
    strategy = "explore_research_segment";
    queryCap = Math.min(3, Math.max(2, queryCapBase));
    providerCap = Math.min(3, Math.max(2, providerCapBase));
    limit = input.lane.progress_pct >= 70 ? Math.max(10, Math.min(limit, 18)) : Math.max(14, limit);
  }

  return {
    strategy,
    queries: queries.slice(0, queryCap),
    providers: providers.slice(0, providerCap),
    query_cap: queryCap,
    provider_cap: providerCap,
    limit,
    provider_timeout_ms: providerTimeoutMs,
  };
}

export function tuneBulkBudgetByExecutionIntent(input: {
  intent: ReelsBrainCronExecutionIntent | null;
  maxProviderCalls: number;
  maxCostUnits: number;
}) {
  if (input.intent?.mode === "support_primary_segment" || input.intent?.mode === "close_exact_segment_gap") {
    return {
      max_provider_calls: Math.max(1, Math.min(input.maxProviderCalls, 2)),
      max_cost_units: Math.max(1, Math.min(input.maxCostUnits, 6)),
    };
  }
  if (input.intent?.mode === "support_control_segment" || input.intent?.mode === "close_portfolio_gap") {
    return {
      max_provider_calls: Math.max(1, Math.min(input.maxProviderCalls, 3)),
      max_cost_units: Math.max(1, Math.min(input.maxCostUnits, 8)),
    };
  }
  if (input.intent?.mode === "explore_research_segment") {
    return {
      max_provider_calls: Math.max(2, input.maxProviderCalls),
      max_cost_units: Math.max(8, input.maxCostUnits),
    };
  }
  return {
    max_provider_calls: input.maxProviderCalls,
    max_cost_units: input.maxCostUnits,
  };
}

export function summarizeBulkExecutionIntent(intent: ReelsBrainCronExecutionIntent | null) {
  return intent
    ? {
      mode: intent.mode,
      policy_mode: intent.policy_mode,
      focus_segment: intent.focus_segment,
      explanation: intent.explanation,
      preferred_provider: intent.preferred_provider || null,
      source_discovery_mode: intent.source_discovery_mode || null,
      bulk_overrides: intent.bulk_overrides || null,
    }
    : null;
}
