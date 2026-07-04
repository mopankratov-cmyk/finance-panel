import type { ReelsPatternMemory } from "./reelsBrainPatterns";
import type { ReelsBrainCorpusQualityGate, ReelsBrainTrainingReadiness } from "./reelsBrainPlaybook";
import type { ReelsPlatform } from "./reelsBrain";

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
  const rawScore = coverageScore + patternScore + readyScore + winnerScore + relevanceScore - Math.min(22, riskPressure * 0.45);
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

export function buildNicheTrustSummary(input: {
  niche: string;
  meta_brain: ReelsPatternMemory | null | undefined;
  platforms: Array<{ platform: ReelsPlatform; trust: ReelsBrainPatternTrust }>;
  readiness?: ReelsBrainTrainingReadiness | null;
  gates?: ReelsBrainCorpusQualityGate | null;
}): ReelsBrainNicheTrustSummary {
  const base = buildPatternTrustSummary(input.meta_brain, input.readiness, input.gates);
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
