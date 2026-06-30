export type ReelsBrainOutcomeSignal = {
  id: string;
  niche: string;
  platform: "tiktok" | "instagram" | "youtube" | "unknown";
  source_pattern_id?: string | null;
  creative_brief_id?: string | null;
  recipe_id?: number | null;
  publication_id?: string | null;
  views: number;
  saves?: number | null;
  completion_rate?: number | null;
  watch_rate?: number | null;
  ctr?: number | null;
  orders?: number | null;
  revenue?: number | null;
  outcome_score: number;
  verdict: "winner" | "promising" | "neutral" | "weak";
  learned_at: string;
  source: "manual" | "post_metrics" | "api";
  notes?: string | null;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value: unknown, max = 240): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizePlatform(value: unknown): ReelsBrainOutcomeSignal["platform"] {
  const raw = clean(value, 40).toLowerCase();
  if (raw.includes("inst")) return "instagram";
  if (raw.includes("youtube") || raw.includes("short")) return "youtube";
  if (raw.includes("tiktok") || raw.includes("tik")) return "tiktok";
  return "unknown";
}

export function outcomeScore(input: {
  views?: unknown;
  saves?: unknown;
  completion_rate?: unknown;
  watch_rate?: unknown;
  ctr?: unknown;
  orders?: unknown;
  revenue?: unknown;
}): number {
  const views = Math.max(0, num(input.views));
  const saves = Math.max(0, num(input.saves));
  const completion = Math.max(0, Math.min(1, num(input.completion_rate)));
  const watch = Math.max(0, Math.min(1, num(input.watch_rate)));
  const ctr = Math.max(0, Math.min(1, num(input.ctr)));
  const orders = Math.max(0, num(input.orders));
  const revenue = Math.max(0, num(input.revenue));
  return Math.round(Math.min(100,
    Math.log10(Math.max(views, 1)) * 14
    + Math.min(16, saves * 1.2)
    + completion * 18
    + watch * 12
    + ctr * 12
    + Math.min(18, orders * 4)
    + Math.min(12, revenue / 1000)
  ));
}

export function verdictFromScore(score: number): ReelsBrainOutcomeSignal["verdict"] {
  if (score >= 78) return "winner";
  if (score >= 58) return "promising";
  if (score >= 35) return "neutral";
  return "weak";
}

export function buildOutcomeSignal(input: {
  niche?: unknown;
  platform?: unknown;
  source_pattern_id?: unknown;
  creative_brief_id?: unknown;
  recipe_id?: unknown;
  publication_id?: unknown;
  views?: unknown;
  saves?: unknown;
  completion_rate?: unknown;
  watch_rate?: unknown;
  ctr?: unknown;
  orders?: unknown;
  revenue?: unknown;
  source?: unknown;
  notes?: unknown;
}): ReelsBrainOutcomeSignal {
  const score = outcomeScore(input);
  const recipeId = Math.floor(num(input.recipe_id)) || null;
  return {
    id: [
      clean(input.niche, 80) || "default",
      clean(input.source_pattern_id || input.creative_brief_id || recipeId || "outcome", 120),
      Date.now(),
    ].join(":"),
    niche: clean(input.niche, 80) || "default",
    platform: normalizePlatform(input.platform),
    source_pattern_id: clean(input.source_pattern_id, 160) || null,
    creative_brief_id: clean(input.creative_brief_id, 180) || null,
    recipe_id: recipeId,
    publication_id: clean(input.publication_id, 120) || null,
    views: Math.max(0, Math.floor(num(input.views))),
    saves: input.saves == null ? null : Math.max(0, Math.floor(num(input.saves))),
    completion_rate: input.completion_rate == null ? null : Math.max(0, Math.min(1, num(input.completion_rate))),
    watch_rate: input.watch_rate == null ? null : Math.max(0, Math.min(1, num(input.watch_rate))),
    ctr: input.ctr == null ? null : Math.max(0, Math.min(1, num(input.ctr))),
    orders: input.orders == null ? null : Math.max(0, num(input.orders)),
    revenue: input.revenue == null ? null : Math.max(0, num(input.revenue)),
    outcome_score: score,
    verdict: verdictFromScore(score),
    learned_at: new Date().toISOString(),
    source: clean(input.source, 40) === "post_metrics" ? "post_metrics" : clean(input.source, 40) === "api" ? "api" : "manual",
    notes: clean(input.notes, 500) || null,
  };
}

export function feedbackSignals(playbook: unknown): ReelsBrainOutcomeSignal[] {
  return arr(rec(rec(playbook).reels_brain_feedback).outcomes)
    .filter((row) => row && typeof row === "object")
    .map((row) => row as ReelsBrainOutcomeSignal)
    .filter((row) => row.id && row.niche)
    .sort((a, b) => String(b.learned_at).localeCompare(String(a.learned_at)));
}

export function rememberFeedbackOutcome(playbook: unknown, signal: ReelsBrainOutcomeSignal): Record<string, unknown> {
  const base = rec(playbook);
  const root = rec(base.reels_brain_feedback);
  const outcomes = [signal, ...feedbackSignals(base).filter((row) => row.id !== signal.id)].slice(0, 300);
  return {
    ...base,
    reels_brain_feedback: {
      ...root,
      version: 1,
      updated_at: new Date().toISOString(),
      outcomes,
    },
  };
}

export function buildFeedbackSummary(rows: { niche?: string; playbook?: unknown }[]) {
  const signals = rows.flatMap((row) => feedbackSignals(row.playbook).map((signal) => ({
    ...signal,
    niche: signal.niche || row.niche || "default",
  })));
  const winners = signals.filter((signal) => signal.verdict === "winner");
  const promising = signals.filter((signal) => signal.verdict === "promising");
  const weak = signals.filter((signal) => signal.verdict === "weak");
  const byPattern = new Map<string, { pattern_id: string; outcomes: number; winners: number; avg_score: number; views: number }>();
  for (const signal of signals) {
    const patternId = signal.source_pattern_id || signal.creative_brief_id || "unknown";
    const current = byPattern.get(patternId) || { pattern_id: patternId, outcomes: 0, winners: 0, avg_score: 0, views: 0 };
    current.avg_score = ((current.avg_score * current.outcomes) + signal.outcome_score) / Math.max(1, current.outcomes + 1);
    current.outcomes += 1;
    current.views += signal.views;
    if (signal.verdict === "winner") current.winners += 1;
    byPattern.set(patternId, current);
  }
  return {
    total_outcomes: signals.length,
    winners: winners.length,
    promising: promising.length,
    weak: weak.length,
    avg_outcome_score: signals.length ? Math.round(signals.reduce((sum, row) => sum + row.outcome_score, 0) / signals.length) : 0,
    top_patterns: Array.from(byPattern.values())
      .map((row) => ({ ...row, avg_score: Math.round(row.avg_score) }))
      .sort((a, b) => b.winners - a.winners || b.avg_score - a.avg_score || b.views - a.views)
      .slice(0, 10),
    recent_outcomes: signals.slice(0, 12),
    next_actions: [
      signals.length < 5 ? "Собрать первые 5 outcome-сигналов по опубликованным роликам." : "Использовать winning pattern outcomes при выборе следующих creative briefs.",
      weak.length ? "Слабые outcomes пометить как anti-signal для похожих briefs." : "Пока нет слабых outcomes: продолжать публикационные тесты.",
      winners.length ? "Паттерны с winner outcome поднять в генераторе выше обычных OP hooks." : "Winner outcomes пока нет: не усиливать Pattern Brain рыночными данными.",
    ],
  };
}

