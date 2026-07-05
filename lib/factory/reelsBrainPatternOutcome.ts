import type { ReelsBrainMetricRow } from "./reelsBrainOperatingSystem";
import { buildOutcomeSignal, type ReelsBrainOutcomeSignal } from "./reelsBrainTrust";

export type PatternOutcomeInput = {
  id: string;
  title?: string;
  quality_gate?: string;
  confidence?: "high" | "medium" | "low";
  platforms?: string[];
  niches?: string[];
};

export type PatternOutcomeResult = {
  pattern_id: string;
  status: "proven" | "promising" | "weak" | "no_feedback";
  confidence: "high" | "medium" | "low";
  score: number;
  best_platform: string | null;
  best_segment: string | null;
  platform_signals: Array<{
    platform: string;
    status: ReelsBrainOutcomeSignal["status"];
    confidence: ReelsBrainOutcomeSignal["confidence"];
    score: number;
    total_posts: number;
    winners: number;
    losers: number;
  }>;
  segment_signals: Array<{
    niche: string;
    platform: string;
    segment: string;
    status: ReelsBrainOutcomeSignal["status"];
    confidence: ReelsBrainOutcomeSignal["confidence"];
    score: number;
    total_posts: number;
    winners: number;
    losers: number;
  }>;
  final_decision: "scale" | "control" | "watch";
  why: string[];
};

function scoreRank(status: ReelsBrainOutcomeSignal["status"]) {
  if (status === "proven") return 4;
  if (status === "promising") return 3;
  if (status === "weak") return 2;
  return 1;
}

function normalizePlatforms(platforms: string[]): string[] {
  return Array.from(new Set(platforms.map((row) => String(row || "").trim().toLowerCase()).filter(Boolean)))
    .filter((row) => row === "tiktok" || row === "instagram" || row === "youtube");
}

function normalizeNiches(niches: string[]): string[] {
  return Array.from(new Set(niches.map((row) => String(row || "").trim().toLowerCase()).filter(Boolean)));
}

function rowPlatform(row: ReelsBrainMetricRow) {
  const value = String(row.target_platform || row.platform || "").trim().toLowerCase();
  return value === "tiktok" || value === "instagram" || value === "youtube" ? value : "";
}

function rowNiche(row: ReelsBrainMetricRow) {
  return String(row.niche || "").trim().toLowerCase();
}

function filterFeedbackRows(
  rows: ReelsBrainMetricRow[],
  input: { platform?: string; niche?: string },
) {
  const platform = String(input.platform || "").trim().toLowerCase();
  const niche = String(input.niche || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (platform && rowPlatform(row) !== platform) return false;
    if (niche && rowNiche(row) !== niche) return false;
    return true;
  });
}

export function buildPatternOutcomeLayer(
  patterns: PatternOutcomeInput[],
  feedbackRows: ReelsBrainMetricRow[],
): PatternOutcomeResult[] {
  return patterns.map((pattern) => {
    const platforms = normalizePlatforms(Array.isArray(pattern.platforms) ? pattern.platforms : []);
    const niches = normalizeNiches(Array.isArray(pattern.niches) ? pattern.niches : []);
    const segmentSignals = niches.flatMap((niche) => platforms.map((platform) => {
      const scopedRows = filterFeedbackRows(feedbackRows, { niche, platform });
      const signal = buildOutcomeSignal(scopedRows, "all");
      return {
        niche,
        platform,
        segment: `${niche} × ${platform}`,
        status: signal.status,
        confidence: signal.confidence,
        score: signal.score,
        total_posts: signal.total_posts,
        winners: signal.winners,
        losers: signal.losers,
      };
    })).sort((a, b) => scoreRank(b.status) - scoreRank(a.status) || b.score - a.score);

    const platformSignals = platforms.map((platform) => {
      const scopedRows = niches.length
        ? feedbackRows.filter((row) => rowPlatform(row) === platform && niches.includes(rowNiche(row)))
        : filterFeedbackRows(feedbackRows, { platform });
      const signal = buildOutcomeSignal(scopedRows, "all");
      return {
        platform,
        status: signal.status,
        confidence: signal.confidence,
        score: signal.score,
        total_posts: signal.total_posts,
        winners: signal.winners,
        losers: signal.losers,
      };
    }).sort((a, b) => scoreRank(b.status) - scoreRank(a.status) || b.score - a.score);

    const bestSegment = segmentSignals[0] || null;
    const best = bestSegment || platformSignals[0] || {
      platform: null,
      segment: null,
      status: "no_feedback" as const,
      confidence: "low" as const,
      score: 0,
      total_posts: 0,
      winners: 0,
      losers: 0,
    };
    const quality = String(pattern.quality_gate || "");
    const finalDecision: PatternOutcomeResult["final_decision"] =
      best.status === "weak"
        ? "watch"
        : best.status === "proven" && (quality === "high_confidence" || quality === "medium_confidence")
          ? "scale"
          : quality === "high_confidence" || quality === "medium_confidence"
            ? "control"
            : "watch";

    const why: string[] = [];
    if (platformSignals.length) {
      why.push(`паттерн виден на платформах: ${platforms.join(", ")}`);
      if (best.platform) why.push(`лучший market signal сейчас у ${best.platform}: ${best.status}`);
    } else {
      why.push("у паттерна пока нет platform mapping, поэтому нет точного outcome-routing");
    }
    if (bestSegment?.segment) why.push(`лучший подтверждённый сегмент: ${bestSegment.segment}`);
    if (niches.length && !segmentSignals.length) why.push(`по сегментам ${niches.join(", ")} market feedback ещё не накоплен`);
    if (best.status === "weak") why.push(`feedback слабый: ${best.losers}/${best.total_posts} loser-posts`);
    if (best.status === "proven") why.push(`feedback подтверждён: ${best.winners}/${best.total_posts} winner-posts`);
    if (best.status === "no_feedback") why.push("market feedback по этому паттерну ещё не накоплен");

    return {
      pattern_id: pattern.id,
      status: best.status,
      confidence: best.confidence,
      score: best.score,
      best_platform: best.platform,
      best_segment: bestSegment?.segment || null,
      platform_signals: platformSignals,
      segment_signals: segmentSignals,
      final_decision: finalDecision,
      why,
    };
  });
}
