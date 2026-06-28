type Row = Record<string, unknown>;

export type FeedbackQueueAction = "winner" | "reject";
export type AutoFeedbackAction = "winner" | "trash" | "keep";

export interface FeedbackCandidate {
  asset_id: number;
  name: string;
  url: string;
  niche: string | null;
  article: string | null;
  created_at: string | null;
  memory_label: "winner" | "usable" | "trash" | "unlabeled";
  memory_score: number | null;
  otk_score: number | null;
  views: number | null;
  priority_score: number;
  reasons: string[];
  suggested_action: "review_for_winner" | "review_for_reject" | "skip";
}

export interface AutoFeedbackDecision {
  asset_id: number;
  action: AutoFeedbackAction;
  confidence: "high" | "medium" | "low";
  label: "winner" | "usable" | "trash";
  score: number;
  reason: string;
}

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPlayableVideoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

function labelFromAnalysis(analysis: Row): FeedbackCandidate["memory_label"] {
  const label = text(analysis.memory_label, 20).toLowerCase();
  if (label === "winner" || label === "usable" || label === "trash") return label;
  return "unlabeled";
}

function scoreCandidate(row: Row): FeedbackCandidate {
  const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Row : {};
  const label = labelFromAnalysis(analysis);
  const otk = num(analysis.otk ?? analysis.otk_score);
  const memoryScore = num(analysis.memory_score);
  const views = num(analysis.views ?? analysis.market_views ?? analysis.winner_views);
  const reasons: string[] = [];
  let priority = 0;

  if (label === "usable") {
    priority += 40;
    reasons.push("usable memory");
  }
  if (label === "unlabeled") {
    priority += 25;
    reasons.push("unlabeled playable video");
  }
  if (otk != null) {
    priority += Math.max(0, Math.min(35, otk * 4));
    reasons.push(`otk ${otk}`);
  }
  if (memoryScore != null) {
    priority += Math.max(0, Math.min(25, memoryScore / 4));
    reasons.push(`memory score ${memoryScore}`);
  }
  if (views != null) {
    priority += Math.min(35, Math.log10(Math.max(views, 1)) * 10);
    reasons.push(`${views} views`);
  }
  if (label === "trash") {
    priority -= 60;
    reasons.push("currently trash");
  }
  if (row.is_winner || row.winner_at || label === "winner") {
    priority -= 100;
    reasons.push("already winner");
  }

  const suggested_action = label === "trash"
    ? "review_for_reject"
    : priority >= 45
      ? "review_for_winner"
      : "skip";

  return {
    asset_id: Number(row.id) || 0,
    name: text(row.name, 160),
    url: text(row.url, 600),
    niche: text(row.niche, 80) || null,
    article: text(row.article, 80) || null,
    created_at: text(row.created_at, 40) || null,
    memory_label: label,
    memory_score: memoryScore,
    otk_score: otk,
    views,
    priority_score: Math.round(priority),
    reasons: reasons.slice(0, 6),
    suggested_action,
  };
}

export function buildFeedbackQueue(rows: Row[], options?: { includeTrash?: boolean; limit?: number }): FeedbackCandidate[] {
  const includeTrash = options?.includeTrash === true;
  const limit = Math.max(1, Math.min(100, Number(options?.limit) || 20));
  return rows
    .map(scoreCandidate)
    .filter((item) => item.asset_id && item.url)
    .filter((item) => includeTrash || item.memory_label !== "trash")
    .filter((item) => item.memory_label !== "winner")
    .sort((a, b) => b.priority_score - a.priority_score || String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, limit);
}

export function nextAnalysisForFeedback(
  current: Row | null | undefined,
  action: FeedbackQueueAction,
  reason: string,
): Row {
  const now = new Date().toISOString();
  const base = current && typeof current === "object" ? current : {};
  const label = action === "winner" ? "winner" : "trash";
  return {
    ...base,
    memory_label: label,
    memory_score: action === "winner" ? 100 : 0,
    memory_confidence: "high",
    memory_reasons: [reason || (action === "winner" ? "operator marked winner" : "operator rejected")],
    memory_reviewed_at: now,
    memory_review_source: "operator_feedback_queue",
    operator_feedback: action,
    operator_feedback_reason: reason || null,
    operator_feedback_at: now,
  };
}

export function decideAutoFeedback(row: Row): AutoFeedbackDecision {
  const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Row : {};
  const assetId = Number(row.id) || 0;
  const url = text(row.url, 600);
  const kind = text(row.kind, 40).toLowerCase();
  const currentLabel = labelFromAnalysis(analysis);
  const status = text(analysis.status || analysis.result_status || analysis.source_status || analysis.verdict, 80).toLowerCase();
  const otk = num(analysis.otk ?? analysis.otk_score);
  const views = num(analysis.views ?? analysis.market_views ?? analysis.winner_views);
  const saves = num(analysis.saves ?? analysis.market_saves);
  const basis = text(analysis.basis ?? analysis.otk_basis, 40).toLowerCase();
  const artifactOk = analysis.artifact_ok !== false;
  const framesGroundedOtkPass = otk != null && otk >= 7 && artifactOk && !["text", "fallback", "storyboard"].includes(basis);
  const marketSignal = (views != null && views >= 2500) || (saves != null && saves >= 5);

  if (row.is_winner || row.winner_at || currentLabel === "winner") {
    return { asset_id: assetId, action: "keep", confidence: "high", label: "winner", score: 100, reason: "already explicit winner" };
  }
  if (!url || !isPlayableVideoUrl(url) || (kind && kind !== "video")) {
    return { asset_id: assetId, action: "trash", confidence: "high", label: "trash", score: 0, reason: "not a playable video" };
  }
  if (status === "rejected" || status === "artifact_fail" || status === "run_fail") {
    return { asset_id: assetId, action: "trash", confidence: "high", label: "trash", score: 5, reason: `bad status: ${status}` };
  }
  if (otk != null && otk < 6) {
    return { asset_id: assetId, action: "trash", confidence: "high", label: "trash", score: Math.max(0, Math.round(otk * 10)), reason: `OTK below usable threshold: ${otk}` };
  }
  if (framesGroundedOtkPass && marketSignal) {
    const signal = views != null && views >= 2500 ? `market views >= 2500: ${views}` : `market saves >= 5: ${saves}`;
    return { asset_id: assetId, action: "winner", confidence: "high", label: "winner", score: Math.min(98, Math.max(90, Math.round(otk * 10))), reason: `OTK pass + ${signal}` };
  }
  if (otk != null && otk >= 6) {
    const suffix = marketSignal ? "market signal present but OTK is not winner-safe" : `OTK ${otk}`;
    return { asset_id: assetId, action: "keep", confidence: "medium", label: "usable", score: Math.round(otk * 10), reason: `usable but not auto-winner: ${suffix}` };
  }
  if (currentLabel === "trash") {
    return { asset_id: assetId, action: "keep", confidence: "medium", label: "trash", score: 0, reason: "already trash" };
  }
  return { asset_id: assetId, action: "keep", confidence: "low", label: "usable", score: 55, reason: "playable video without reliable winner signal" };
}
