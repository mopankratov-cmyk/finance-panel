import { rememberAutomationRun, type ReelsBrainAutomationRunHistoryEntry } from "./reelsBrainPlaybook";

type AutomationRunLike = {
  niche?: string;
  platform?: string;
  ok?: boolean;
  found?: number;
  inserted?: number;
  normalized?: number;
  relevant?: number;
  analyzed?: number;
  provider?: string;
  cost_units?: number;
  estimated_spend_usd?: number;
  actual_spend_usd?: number | null;
  spend_source?: "estimated" | "actual";
  error?: string | null;
  metrics?: {
    found?: number;
    inserted?: number;
    relevant?: number;
    analyzed?: number;
    retries?: number;
  };
  loop?: {
    ok?: boolean;
    error?: string | null;
    metrics?: {
      found?: number;
      inserted?: number;
      relevant?: number;
      analyzed?: number;
      retries?: number;
    };
  };
  bake_off?: {
    best_provider?: string | null;
    stable_provider?: string | null;
    error?: string | null;
  };
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimatedUsdFromCostUnits(costUnits: number): number {
  const usdPerUnit = Number(process.env.REELS_BRAIN_COST_UNIT_USD || 0.035);
  const safeUsdPerUnit = Number.isFinite(usdPerUnit) && usdPerUnit > 0 ? usdPerUnit : 0.035;
  return Math.round(costUnits * safeUsdPerUnit * 10000) / 10000;
}

export function summarizeReelsBrainAutomationRuns(input: {
  mode: ReelsBrainAutomationRunHistoryEntry["mode"];
  strategy?: string;
  niche?: string;
  runs?: AutomationRunLike[];
  platforms?: string[];
  ok?: boolean;
  created_at?: string;
}): Omit<ReelsBrainAutomationRunHistoryEntry, "id"> {
  const providerCounts = new Map<string, number>();
  const platforms = new Set<"tiktok" | "instagram" | "youtube">();
  let found = 0;
  let inserted = 0;
  let analyzed = 0;
  let relevant = 0;
  let retries = 0;
  let errors = 0;
  let costUnits = 0;
  let estimatedSpendUsd = 0;
  let actualSpendUsd = 0;
  let hasActualSpend = false;

  for (const platform of input.platforms || []) {
    if (platform === "tiktok" || platform === "instagram" || platform === "youtube") platforms.add(platform);
  }

  for (const run of input.runs || []) {
    if (run.platform === "tiktok" || run.platform === "instagram" || run.platform === "youtube") platforms.add(run.platform);
    const metrics = run.loop?.metrics || run.metrics;
    found += num(metrics?.found ?? run.found);
    inserted += num(metrics?.inserted ?? run.inserted);
    analyzed += num(metrics?.analyzed ?? run.analyzed ?? run.normalized);
    relevant += num(metrics?.relevant ?? run.relevant);
    retries += num(metrics?.retries);
    const runCostUnits = num(run.cost_units);
    costUnits += runCostUnits;
    estimatedSpendUsd += num(run.estimated_spend_usd) || estimatedUsdFromCostUnits(runCostUnits);
    if (run.actual_spend_usd != null) {
      actualSpendUsd += num(run.actual_spend_usd);
      hasActualSpend = true;
    }
    if (run.error || run.loop?.error || run.bake_off?.error || run.ok === false || run.loop?.ok === false) errors += 1;
    const provider = run.bake_off?.stable_provider || run.bake_off?.best_provider || run.provider;
    if (provider) providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);
  }

  const bestProvider = Array.from(providerCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    mode: input.mode,
    strategy: input.strategy,
    created_at: input.created_at || new Date().toISOString(),
    niche: input.niche,
    platforms: Array.from(platforms),
    ok: input.ok !== false && errors === 0,
    found,
    inserted,
    analyzed,
    relevant,
    retries,
    errors,
    best_provider: bestProvider,
    cost_units: costUnits || undefined,
    estimated_spend_usd: estimatedSpendUsd ? Math.round(estimatedSpendUsd * 10000) / 10000 : undefined,
    actual_spend_usd: hasActualSpend ? Math.round(actualSpendUsd * 10000) / 10000 : null,
    spend_source: hasActualSpend ? "actual" : costUnits > 0 ? "estimated" : undefined,
  };
}

export async function persistReelsBrainAutomationRun(input: {
  db: any;
  niches: string[];
  summary: Omit<ReelsBrainAutomationRunHistoryEntry, "id">;
}) {
  const niches = Array.from(new Set(input.niches.map((row) => String(row || "").trim()).filter(Boolean))).slice(0, 20);
  if (!input.db || !niches.length) return { persisted: 0, errors: [] as string[] };

  const { data, error } = await input.db
    .from("niche_playbooks")
    .select("niche,playbook")
    .in("niche", niches);
  if (error) return { persisted: 0, errors: [error.message] };

  const existing = new Map<string, unknown>();
  for (const row of (data as { niche?: string; playbook?: unknown }[] | null) || []) {
    if (row.niche) existing.set(row.niche, row.playbook);
  }

  let persisted = 0;
  const errors: string[] = [];
  for (const niche of niches) {
    const playbook = rememberAutomationRun(existing.get(niche) || { niche }, {
      ...input.summary,
      niche,
      id: `${input.summary.mode}:${niche}:${input.summary.created_at}`,
    });
    const { error: upsertError } = await input.db
      .from("niche_playbooks")
      .upsert({ niche, playbook, updated_at: new Date().toISOString() }, { onConflict: "niche" });
    if (upsertError) errors.push(`${niche}: ${upsertError.message}`);
    else persisted += 1;
  }
  return { persisted, errors };
}
