import type { ReelsPatternMemory } from "./reelsBrainPatterns";
import type { ReelsBrainCorpusQualityGate, ReelsBrainTrainingReadiness } from "./reelsBrainPlaybook";
import type { ReelsPlatform } from "./reelsBrain";
import type { ReelsBrainMetricRow } from "./reelsBrainOperatingSystem";

export interface ReelsBrainPatternTrust {
  score: number;
  status: "ready" | "warming" | "weak";
  confidence: "high" | "medium" | "low";
  generator_ready_patterns: number;
  total_patterns: number;
  anti_patterns: number;
  high_risk_anti_patterns: number;
  medium_risk_anti_patterns: number;
  avg_relevance_score: number;
  ready_pattern_rate: number;
  risk_pressure: number;
  why_ready: string[];
  why_not_yet: string[];
  top_risks: string[];
  note: string;
}

export interface ReelsBrainNicheTrustSummary extends ReelsBrainPatternTrust {
  niche: string;
  covered_platforms: ReelsPlatform[];
  strong_platforms: ReelsPlatform[];
  weak_platforms: ReelsPlatform[];
}

export interface ReelsBrainOutcomeSignal {
  platform: ReelsPlatform | "all";
  total_posts: number;
  winners: number;
  losers: number;
  avg_completion_rate: number;
  avg_ctr: number;
  total_orders: number;
  total_revenue: number;
  score: number;
  confidence: "high" | "medium" | "low";
  status: "proven" | "promising" | "weak" | "no_feedback";
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function avg(rows: number[]): number {
  const clean = rows.filter((row) => Number.isFinite(row) && row > 0);
  return clean.length ? Math.round((clean.reduce((sum, row) => sum + row, 0) / clean.length) * 1000) / 1000 : 0;
}

function normalizePlatform(value: unknown): ReelsPlatform | "unknown" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("inst") || raw.includes("reels")) return "instagram";
  if (raw.includes("you") || raw.includes("short")) return "youtube";
  if (raw.includes("tik")) return "tiktok";
  return raw === "tiktok" || raw === "instagram" || raw === "youtube" ? raw : "unknown";
}

function topRiskLabels(brain: ReelsPatternMemory | null | undefined) {
  const antiPatterns = Array.isArray(brain?.anti_patterns) ? brain!.anti_patterns : [];
  return antiPatterns
    .slice()
    .sort((a, b) => {
      const left = (a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1) * 1000 + num(a.total_frequency);
      const right = (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1) * 1000 + num(b.total_frequency);
      return right - left;
    })
    .slice(0, 3)
    .map((item) => String(item.label || "").trim())
    .filter(Boolean);
}

export function buildPatternTrustSummary(
  brain: ReelsPatternMemory | null | undefined,
  readiness?: ReelsBrainTrainingReadiness | null,
  gates?: ReelsBrainCorpusQualityGate | null,
  outcome?: ReelsBrainOutcomeSignal | null,
): ReelsBrainPatternTrust {
  const row = brain || null;
  const generatorReady = Array.isArray(row?.generator_ready_patterns) ? row!.generator_ready_patterns.length : 0;
  const patterns = Array.isArray(row?.patterns) ? row!.patterns.length : 0;
  const antiPatterns = Array.isArray(row?.anti_patterns) ? row!.anti_patterns : [];
  const avgRelevance = num(row?.quality_summary?.avg_relevance_score);
  const analyzed = num(row?.analyzed_videos);
  const videos = num(row?.total_videos);
  const winners = num(readiness?.winners);
  const gate = gates || readiness?.gates || null;
  const minAnalyzed = Math.max(1, num(gate?.min_analyzed) || 1);
  const minPatterns = Math.max(1, num(gate?.min_patterns) || 1);
  const minWinners = Math.max(1, num(gate?.min_winners) || 1);
  const minReadyPatterns = Math.max(1, Math.ceil(minPatterns / 2));
  const highRisk = antiPatterns.filter((item) => item.severity === "high").length;
  const mediumRisk = antiPatterns.filter((item) => item.severity === "medium").length;
  const riskPressure = clamp((highRisk * 18) + (mediumRisk * 9) + Math.max(0, antiPatterns.length - highRisk - mediumRisk) * 4);
  const readyRate = pct(generatorReady, Math.max(1, patterns));
  const coverageScore = Math.min(24, (analyzed / minAnalyzed) * 24);
  const patternScore = Math.min(24, (patterns / minPatterns) * 24);
  const readyScore = Math.min(22, (generatorReady / minReadyPatterns) * 22);
  const winnerScore = Math.min(14, (winners / minWinners) * 14);
  const relevanceScore = Math.min(16, (avgRelevance / 75) * 16);
  const outcomeScore = outcome?.status === "proven"
    ? 14
    : outcome?.status === "promising"
      ? 7
      : outcome?.status === "weak"
        ? -8
        : 0;
  const rawScore = coverageScore + patternScore + readyScore + winnerScore + relevanceScore + outcomeScore - Math.min(22, riskPressure * 0.45);
  const score = clamp(rawScore);
  const readyState = readiness?.ready || false;
  const status: ReelsBrainPatternTrust["status"] = score >= 76 && readyState
    ? "ready"
    : score >= 48
      ? "warming"
      : "weak";
  const confidence: ReelsBrainPatternTrust["confidence"] = score >= 82 && generatorReady >= minReadyPatterns
    ? "high"
    : score >= 56
      ? "medium"
      : "low";

  const whyReady: string[] = [];
  const whyNotYet: string[] = [];

  if (analyzed >= minAnalyzed) whyReady.push(`разобрано ${analyzed}/${minAnalyzed}+ видео`);
  else whyNotYet.push(`анализ ещё тонкий: ${analyzed}/${minAnalyzed}`);

  if (patterns >= minPatterns) whyReady.push(`паттернов уже ${patterns}`);
  else whyNotYet.push(`паттернов пока ${patterns}, нужно ${minPatterns}+`);

  if (generatorReady >= minReadyPatterns) whyReady.push(`generator-ready слой уже ${generatorReady}`);
  else whyNotYet.push(`generator-ready слой пока ${generatorReady}, цель ${minReadyPatterns}+`);

  if (winners >= minWinners) whyReady.push(`есть победители: ${winners}`);
  else whyNotYet.push(`мало winner-feedback: ${winners}/${minWinners}`);

  if (avgRelevance >= 60) whyReady.push(`средняя niche relevance ${avgRelevance}`);
  else whyNotYet.push(`niche relevance ещё слабая: ${avgRelevance}`);

  if (outcome?.status === "proven") whyReady.push(`market feedback подтверждает слой: ${outcome.winners}/${outcome.total_posts} winner-posts`);
  if (outcome?.status === "promising") whyReady.push(`уже есть первые market сигналы: ${outcome.total_posts} публикаций`);
  if (outcome?.status === "weak") whyNotYet.push(`market feedback пока слабый: ${outcome.losers}/${outcome.total_posts} loser-posts`);

  if (highRisk > 0) whyNotYet.push(`есть ${highRisk} high-risk anti-pattern`);
  if (!antiPatterns.length) whyReady.push("существенных anti-pattern hotspot'ов пока нет");

  const topRisks = topRiskLabels(row);
  const note = status === "ready"
    ? `Можно строить briefs и hypotheses на этом слое, но держать anti-pattern guardrails активными.`
    : status === "warming"
      ? `Сегмент уже полезен для control-briefs, но не для слепого масштабирования.`
      : `Сегмент ещё учится: использовать только как разведку, не как главный источник решений.`;

  return {
    score,
    status,
    confidence,
    generator_ready_patterns: generatorReady,
    total_patterns: patterns,
    anti_patterns: antiPatterns.length,
    high_risk_anti_patterns: highRisk,
    medium_risk_anti_patterns: mediumRisk,
    avg_relevance_score: avgRelevance,
    ready_pattern_rate: readyRate,
    risk_pressure: riskPressure,
    why_ready: whyReady,
    why_not_yet: whyNotYet,
    top_risks: topRisks,
    note,
  };
}

export function buildOutcomeSignal(
  rows: ReelsBrainMetricRow[],
  platform: ReelsPlatform | "all" = "all",
): ReelsBrainOutcomeSignal {
  const filtered = rows.filter((row) => platform === "all" || normalizePlatform(row.platform) === platform);
  const winners = filtered.filter((row) =>
    num(row.views) >= 10000
    || num(row.marketplace_orders) > 0
    || num(row.revenue) > 0
    || num(row.saves) >= 50
    || num(row.completion_rate) >= 0.45
  );
  const losers = filtered.filter((row) =>
    num(row.views) > 0
    && num(row.views) < 1000
    && (!num(row.completion_rate) || num(row.completion_rate) < 0.2)
    && (!num(row.ctr_card) || num(row.ctr_card) < 0.01)
  );
  const avgCompletion = avg(filtered.map((row) => num(row.completion_rate)));
  const avgCtr = avg(filtered.map((row) => num(row.ctr_card)));
  const totalOrders = filtered.reduce((sum, row) => sum + num(row.marketplace_orders), 0);
  const totalRevenue = Math.round(filtered.reduce((sum, row) => sum + num(row.revenue), 0) * 100) / 100;
  const rawScore = filtered.length === 0
    ? 0
    : (winners.length * 18) + Math.min(20, avgCompletion * 40) + Math.min(14, avgCtr * 400) + Math.min(18, totalOrders * 4) - (losers.length * 12);
  const score = clamp(rawScore);
  const status: ReelsBrainOutcomeSignal["status"] = filtered.length === 0
    ? "no_feedback"
    : score >= 68
      ? "proven"
      : score >= 38
        ? "promising"
        : "weak";
  const confidence: ReelsBrainOutcomeSignal["confidence"] = filtered.length >= 5
    ? "high"
    : filtered.length >= 2
      ? "medium"
      : filtered.length >= 1
        ? "low"
        : "low";
  return {
    platform,
    total_posts: filtered.length,
    winners: winners.length,
    losers: losers.length,
    avg_completion_rate: avgCompletion,
    avg_ctr: avgCtr,
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    score,
    confidence,
    status,
  };
}

export function buildNicheTrustSummary(input: {
  niche: string;
  meta_brain: ReelsPatternMemory | null | undefined;
  platforms: Array<{ platform: ReelsPlatform; trust: ReelsBrainPatternTrust }>;
  readiness?: ReelsBrainTrainingReadiness | null;
  gates?: ReelsBrainCorpusQualityGate | null;
  outcome?: ReelsBrainOutcomeSignal | null;
}): ReelsBrainNicheTrustSummary {
  const base = buildPatternTrustSummary(input.meta_brain, input.readiness, input.gates, input.outcome);
  const coveredPlatforms = input.platforms.filter((row) => row.trust.total_patterns > 0 || row.trust.generator_ready_patterns > 0).map((row) => row.platform);
  const strongPlatforms = input.platforms.filter((row) => row.trust.status === "ready").map((row) => row.platform);
  const weakPlatforms = input.platforms.filter((row) => row.trust.status === "weak").map((row) => row.platform);
  return {
    niche: input.niche,
    covered_platforms: coveredPlatforms,
    strong_platforms: strongPlatforms,
    weak_platforms: weakPlatforms,
    ...base,
  };
}
