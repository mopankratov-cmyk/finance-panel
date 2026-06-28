type Row = Record<string, unknown>;

export type FeedbackQueueAction = "winner" | "reject";

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

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
