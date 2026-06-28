import type { SupabaseClient } from "@supabase/supabase-js";
import { inferHookType } from "./reelsBrainPatterns";
import { normalizeWarningReason } from "./observability";

type Row = Record<string, unknown>;

interface ImprovementMetricRow {
  recipe_id: number;
  views: number | null;
  watch_rate: number | null;
  ctr_card: number | null;
  saves: number | null;
}

interface ImprovementSignalSummary {
  status: "winner" | "approved" | "rejected" | "none";
  reject_reason: string;
}

interface ImprovementAssetMeta {
  is_winner: boolean;
  memory_label: "winner" | "usable" | "trash" | "unlabeled";
  batch_role: "control" | "experiment" | "none";
  change_axis: "none" | "hook_angle" | "proof_density" | "cta_shape" | "format";
}

export interface ImprovementRun {
  recipe_id: number | null;
  created_at: string;
  niche: string;
  article: string;
  mode: string;
  format: string;
  status: string;
  output_url: string | null;
  otk_score: number | null;
  warnings_count: number;
  warning_reason: string;
  hook_text: string;
  hook_type: string;
  visual_tool: string;
  market_views: number | null;
  watch_rate: number | null;
  ctr_card: number | null;
  saves: number | null;
  feedback_status: "winner" | "approved" | "rejected" | "none";
  memory_label: "winner" | "usable" | "trash" | "unlabeled";
  reject_reason: string;
  batch_run_id: string | null;
  batch_role: "control" | "experiment" | "none";
  change_axis: "none" | "hook_angle" | "proof_density" | "cta_shape" | "format";
  verdict: "winner" | "salvageable" | "loser";
  pattern_key: string;
}

export interface ImprovementPattern {
  pattern_key: string;
  hook_type: string;
  format: string;
  visual_tool: string;
  runs: number;
  winners: number;
  quality_wins: number;
  salvageable: number;
  losers: number;
  avg_otk: number | null;
  avg_market_views: number | null;
  market_wins: number;
  dominant_warning_reason: string | null;
  success_rate: number;
  winner_rate: number;
}

export interface ImprovementBatch {
  index: number;
  batch_run_id: string | null;
  from_run: number;
  to_run: number;
  total_runs: number;
  winners: number;
  quality_wins: number;
  salvageable: number;
  losers: number;
  avg_otk: number | null;
  avg_market_views: number | null;
  market_wins: number;
  explicit_feedback: number;
  dominant_warning_reason: string | null;
  success_rate: number;
  improved_vs_prev: boolean | null;
  dominant_hook_type: string | null;
  dominant_pattern_key: string | null;
}

export interface ImprovementAxisInsight {
  change_axis: "hook_angle" | "proof_density" | "cta_shape" | "format";
  runs: number;
  control_runs: number;
  experiment_runs: number;
  winners: number;
  quality_wins: number;
  salvageable: number;
  losers: number;
  avg_otk: number | null;
  avg_market_views: number | null;
  market_wins: number;
  success_rate: number;
  winner_rate: number;
}

export interface ImprovementSnapshot {
  niche: string | null;
  target_runs: number;
  batch_size: number;
  series_start_at: string | null;
  total_runs: number;
  analyzed_runs: ImprovementRun[];
  feedback_queue: ImprovementRun[];
  batches: ImprovementBatch[];
  top_patterns: ImprovementPattern[];
  axis_insights: ImprovementAxisInsight[];
  latest_batch: ImprovementBatch | null;
  previous_batch: ImprovementBatch | null;
  series_state: ImprovementSeriesState;
  progress: {
    runs_completed: number;
    batches_completed: number;
    target_runs_met: boolean;
    latest_batch_improved: boolean | null;
  };
  next_batch_gate: ImprovementNextBatchGate;
  batch_plan: ImprovementBatchPlan | null;
  next_actions: string[];
  warnings: string[];
}

export interface ImprovementSeriesState {
  target_batches: number;
  completed_batches: number;
  current_batch_index: number;
  next_batch_index: number | null;
  remaining_runs: number;
  remaining_batches: number;
  current_batch_complete: boolean;
  target_met: boolean;
}

export interface ImprovementNextBatchGate {
  ready: boolean;
  reason: string;
  current_feedback: number;
  required_feedback: number;
}

export interface ImprovementBatchPlan {
  control_count: number;
  experiment_count: number;
  control_pattern: string | null;
  primary_change_axis: "hook_angle" | "proof_density" | "cta_shape" | "format" | "none";
  experiment_note: string;
}

function toText(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function roundInt(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function runWarnings(runPlan: unknown): string[] {
  if (!runPlan || typeof runPlan !== "object") return [];
  const warnings = (runPlan as Record<string, unknown>).warnings;
  return Array.isArray(warnings) ? warnings.map((v) => normalizeWarningReason(toText(v, 120))).filter(Boolean) : [];
}

function hookTextFromPlan(runPlan: unknown): string {
  if (!runPlan || typeof runPlan !== "object") return "";
  const nodes = Array.isArray((runPlan as Record<string, unknown>).nodes) ? ((runPlan as Record<string, unknown>).nodes as Row[]) : [];
  const hookNode = nodes.find((node) => String((node.params as Record<string, unknown> | undefined)?.role || node.slot || "").toLowerCase() === "hook")
    || nodes[0];
  if (!hookNode) return "";
  const params = (hookNode.params && typeof hookNode.params === "object") ? hookNode.params as Record<string, unknown> : {};
  return toText(hookNode.onscreen_text || params.onscreen_text || hookNode.prompt || "", 160);
}

function visualToolFromPlan(runPlan: unknown): string {
  if (!runPlan || typeof runPlan !== "object") return "unknown";
  const nodes = Array.isArray((runPlan as Record<string, unknown>).nodes) ? ((runPlan as Record<string, unknown>).nodes as Row[]) : [];
  const visual = nodes.find((node) => {
    const tool = String(node.tool || "").toLowerCase();
    return tool && !["shotstack", "sound", "music", "sharp", "captions", "elevenlabs"].includes(tool);
  });
  return toText(visual?.tool || "unknown", 40).toLowerCase() || "unknown";
}

function batchRunIdFromPlan(runPlan: unknown): string | null {
  if (!runPlan || typeof runPlan !== "object") return null;
  return toText((runPlan as Record<string, unknown>).batch_run_id, 80) || null;
}

function metricLookup(metrics: ImprovementMetricRow[]): Map<number, ImprovementMetricRow> {
  const best = new Map<number, ImprovementMetricRow>();
  for (const row of metrics) {
    const recipeId = Number(row.recipe_id) || 0;
    if (!recipeId) continue;
    const prev = best.get(recipeId);
    if (!prev || (Number(row.views) || 0) > (Number(prev.views) || 0)) best.set(recipeId, row);
  }
  return best;
}

function signalLookup(rows: Row[]): Map<number, ImprovementSignalSummary> {
  const map = new Map<number, ImprovementSignalSummary>();
  for (const row of rows) {
    const recipeId = Number(row.recipe_id) || 0;
    if (!recipeId) continue;
    const event = toText(row.event, 40).toLowerCase();
    const reason = toText(row.reason_chip, 120);
    const prev = map.get(recipeId) || { status: "none" as const, reject_reason: "" };
    if (event === "rejected") {
      map.set(recipeId, { status: "rejected", reject_reason: reason || prev.reject_reason });
      continue;
    }
    if (event === "approved" && prev.status !== "rejected") {
      map.set(recipeId, { status: "approved", reject_reason: prev.reject_reason });
    }
  }
  return map;
}

function assetWinnerLookup(rows: Row[]): Map<string, ImprovementAssetMeta> {
  const map = new Map<string, ImprovementAssetMeta>();
  for (const row of rows) {
    const url = toText(row.url, 300);
    if (!url) continue;
    const analysis = row.analysis && typeof row.analysis === "object" ? row.analysis as Record<string, unknown> : {};
    const rawRole = toText(analysis.batch_role, 20).toLowerCase();
    const rawAxis = toText(analysis.change_axis, 40).toLowerCase();
    const rawMemory = toText(analysis.memory_label, 20).toLowerCase();
    map.set(url, {
      is_winner: Boolean(row.is_winner),
      memory_label: rawMemory === "winner" || rawMemory === "usable" || rawMemory === "trash" ? rawMemory : "unlabeled",
      batch_role: rawRole === "control" || rawRole === "experiment" ? rawRole : "none",
      change_axis: ["none", "hook_angle", "proof_density", "cta_shape", "format"].includes(rawAxis) ? rawAxis as ImprovementRun["change_axis"] : "none",
    });
  }
  return map;
}

function classifyVerdict(run: Pick<ImprovementRun, "status" | "otk_score" | "output_url" | "warnings_count" | "market_views" | "watch_rate" | "feedback_status" | "memory_label">): ImprovementRun["verdict"] {
  const s = String(run.status || "").toLowerCase();
  if (run.memory_label === "trash") return "loser";
  if (run.memory_label === "winner") return "winner";
  if (run.feedback_status === "rejected") return "loser";
  if (s === "run_fail" || s === "rejected" || s === "failed") return "loser";
  if (!run.output_url) return "loser";
  if (run.feedback_status === "winner") return "winner";
  if (run.market_views != null && run.market_views >= 5000) return "winner";
  if (run.market_views != null && run.market_views >= 2500 && (run.watch_rate == null || run.watch_rate >= 0.22)) return "winner";
  if (run.otk_score != null && run.otk_score >= 8 && run.warnings_count <= 1) return "winner";
  if (run.feedback_status === "approved") return run.otk_score != null && run.otk_score >= 6 ? "winner" : "salvageable";
  if (run.market_views != null && run.market_views >= 600) return "salvageable";
  if (run.otk_score != null && run.otk_score < 6) return "loser";
  if (s === "warning" || run.warnings_count > 1) return "salvageable";
  if (s === "otk_pass" || s === "approved" || s === "done") return run.otk_score != null && run.otk_score >= 7 ? "winner" : "salvageable";
  return "salvageable";
}

export function deriveImprovementRun(
  row: Row,
  context?: {
    metricsByRecipe?: Map<number, ImprovementMetricRow>;
    signalsByRecipe?: Map<number, ImprovementSignalSummary>;
    winnerByUrl?: Map<string, ImprovementAssetMeta>;
  }
): ImprovementRun {
  const otkScore = num(row.otk_score);
  const warnings = runWarnings(row.run_plan);
  const warningReason = warnings[0] || "";
  const hookText = hookTextFromPlan(row.run_plan);
  const hookType = inferHookType(hookText);
  const visualTool = visualToolFromPlan(row.run_plan);
  const format = toText(row.format_detected || row.mode || "unknown", 40).toLowerCase() || "unknown";
  const recipeId = num(row.id);
  const outputUrl = row.output_url ? String(row.output_url) : null;
  const metric = recipeId != null ? context?.metricsByRecipe?.get(recipeId) : undefined;
  const signal = recipeId != null ? context?.signalsByRecipe?.get(recipeId) : undefined;
  const assetMeta = outputUrl ? context?.winnerByUrl?.get(outputUrl) : undefined;
  const feedbackStatus: ImprovementRun["feedback_status"] = assetMeta?.is_winner ? "winner" : (signal?.status || "none");
  const memoryLabel = assetMeta?.memory_label || "unlabeled";
  const base: ImprovementRun = {
    recipe_id: recipeId,
    created_at: String(row.created_at || ""),
    niche: toText(row.niche || "default", 60) || "default",
    article: toText(row.article || "", 80),
    mode: toText(row.mode || "", 40),
    format,
    status: toText(row.status || "", 40).toLowerCase(),
    output_url: outputUrl,
    otk_score: otkScore,
    warnings_count: warnings.length,
    warning_reason: warningReason,
    hook_text: hookText,
    hook_type: hookType,
    visual_tool: visualTool,
    market_views: metric?.views ?? null,
    watch_rate: metric?.watch_rate ?? null,
    ctr_card: metric?.ctr_card ?? null,
    saves: metric?.saves ?? null,
    feedback_status: feedbackStatus,
    memory_label: memoryLabel,
    reject_reason: signal?.reject_reason || "",
    batch_run_id: batchRunIdFromPlan(row.run_plan),
    batch_role: assetMeta?.batch_role || "none",
    change_axis: assetMeta?.change_axis || "none",
    verdict: "salvageable",
    pattern_key: "",
  };
  const patternKey = [hookType, format, visualTool].join("|");
  return {
    ...base,
    verdict: classifyVerdict(base),
    pattern_key: patternKey,
  };
}

function dominant<T>(rows: T[], pick: (row: T) => string | null): string | null {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] || null;
}

function avgScore(rows: ImprovementRun[]): number | null {
  const vals = rows.map((row) => row.otk_score).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return round1(vals.reduce((sum, value) => sum + value, 0) / vals.length);
}

function avgMarketViews(rows: ImprovementRun[]): number | null {
  const vals = rows.map((row) => row.market_views).filter((v): v is number => v != null && v > 0);
  if (!vals.length) return null;
  return roundInt(vals.reduce((sum, value) => sum + value, 0) / vals.length);
}

function successRate(rows: ImprovementRun[]): number {
  if (!rows.length) return 0;
  const successful = rows.filter((row) => row.verdict !== "loser").length;
  return Math.round((successful / rows.length) * 100);
}

function marketWins(rows: ImprovementRun[]): number {
  return rows.filter(isMarketWin).length;
}

function isMarketWin(row: ImprovementRun): boolean {
  return row.feedback_status === "winner" || ((row.market_views || 0) >= 2500);
}

function qualityWins(rows: ImprovementRun[]): number {
  return rows.filter((row) => row.verdict === "winner" && !isMarketWin(row)).length;
}

function explicitFeedbackCount(rows: ImprovementRun[]): number {
  return rows.filter((row) => row.feedback_status !== "none" || (row.market_views || 0) > 0).length;
}

function hasExplicitFeedback(run: ImprovementRun): boolean {
  return run.feedback_status !== "none" || (run.market_views || 0) > 0;
}

function buildFeedbackQueue(runs: ImprovementRun[], batchSize: number): ImprovementRun[] {
  if (!runs.length) return [];
  const latestBatchRuns = runs.slice(Math.max(0, runs.length - batchSize));
  return latestBatchRuns
    .slice()
    .sort((a, b) => Number(hasExplicitFeedback(a)) - Number(hasExplicitFeedback(b)) || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, batchSize);
}

function buildSeriesState(totalRuns: number, batchSize: number, targetRuns: number): ImprovementSeriesState {
  const targetBatches = Math.ceil(targetRuns / batchSize);
  const completedBatches = Math.floor(totalRuns / batchSize);
  const targetMet = totalRuns >= targetRuns;
  const currentBatchIndex = targetMet ? targetBatches : Math.min(targetBatches, completedBatches + 1);
  const remainingRuns = Math.max(0, targetRuns - totalRuns);
  return {
    target_batches: targetBatches,
    completed_batches: completedBatches,
    current_batch_index: currentBatchIndex,
    next_batch_index: targetMet ? null : currentBatchIndex,
    remaining_runs: remainingRuns,
    remaining_batches: Math.ceil(remainingRuns / batchSize),
    current_batch_complete: totalRuns > 0 && totalRuns % batchSize === 0,
    target_met: targetMet,
  };
}

function requiredFeedbackForBatch(batch: ImprovementBatch | null): number {
  if (!batch) return 0;
  return Math.max(2, Math.ceil(batch.total_runs / 2));
}

function buildBatches(runs: ImprovementRun[], batchSize: number): ImprovementBatch[] {
  const ordered = [...runs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const batches: ImprovementBatch[] = [];
  for (let i = 0; i < ordered.length; i += batchSize) {
    const chunk = ordered.slice(i, i + batchSize);
    if (!chunk.length) continue;
    const winners = chunk.filter((row) => row.verdict === "winner").length;
    const qualityWinCount = qualityWins(chunk);
    const salvageable = chunk.filter((row) => row.verdict === "salvageable").length;
    const losers = chunk.filter((row) => row.verdict === "loser").length;
    const avg = avgScore(chunk);
    const avgViews = avgMarketViews(chunk);
    const marketWinCount = marketWins(chunk);
    const feedbackCount = explicitFeedbackCount(chunk);
    const prev = batches[batches.length - 1];
    const improved = prev
      ? (
        (avg != null && prev.avg_otk != null && avg > prev.avg_otk + 0.2)
        || successRate(chunk) > prev.success_rate
        || marketWinCount > prev.market_wins
        || (avgViews != null && prev.avg_market_views != null && avgViews > Math.round(prev.avg_market_views * 1.15))
      )
      : null;
    batches.push({
      index: batches.length + 1,
      batch_run_id: dominant(chunk, (row) => row.batch_run_id),
      from_run: i + 1,
      to_run: i + chunk.length,
      total_runs: chunk.length,
      winners,
      quality_wins: qualityWinCount,
      salvageable,
      losers,
      avg_otk: avg,
      avg_market_views: avgViews,
      market_wins: marketWinCount,
      explicit_feedback: feedbackCount,
      dominant_warning_reason: dominant(chunk, (row) => row.warning_reason || null),
      success_rate: successRate(chunk),
      improved_vs_prev: improved,
      dominant_hook_type: dominant(chunk, (row) => row.hook_type),
      dominant_pattern_key: dominant(chunk, (row) => row.pattern_key),
    });
  }
  return batches;
}

function buildPatterns(runs: ImprovementRun[]): ImprovementPattern[] {
  const map = new Map<string, ImprovementPattern>();
  for (const run of runs) {
    const existing = map.get(run.pattern_key) || {
      pattern_key: run.pattern_key,
      hook_type: run.hook_type,
      format: run.format,
      visual_tool: run.visual_tool,
      runs: 0,
      winners: 0,
      quality_wins: 0,
      salvageable: 0,
      losers: 0,
      avg_otk: null,
      avg_market_views: null,
      market_wins: 0,
      dominant_warning_reason: null,
      success_rate: 0,
      winner_rate: 0,
    };
    existing.runs += 1;
    if (run.verdict === "winner") {
      existing.winners += 1;
      if (!isMarketWin(run)) existing.quality_wins += 1;
    } else if (run.verdict === "salvageable") existing.salvageable += 1;
    else existing.losers += 1;
    existing.avg_otk = round1((((existing.avg_otk || 0) * (existing.runs - 1)) + (run.otk_score || 0)) / existing.runs);
    existing.avg_market_views = roundInt((((existing.avg_market_views || 0) * (existing.runs - 1)) + (run.market_views || 0)) / existing.runs);
    existing.market_wins += isMarketWin(run) ? 1 : 0;
    existing.dominant_warning_reason = dominant(runs.filter((row) => row.pattern_key === run.pattern_key), (row) => row.warning_reason || null);
    existing.success_rate = Math.round(((existing.winners + existing.salvageable) / existing.runs) * 100);
    existing.winner_rate = Math.round((existing.winners / existing.runs) * 100);
    map.set(run.pattern_key, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.market_wins - a.market_wins || b.winner_rate - a.winner_rate || (b.avg_market_views || 0) - (a.avg_market_views || 0) || (b.avg_otk || 0) - (a.avg_otk || 0) || b.runs - a.runs)
    .slice(0, 8);
}

function buildAxisInsights(runs: ImprovementRun[]): ImprovementAxisInsight[] {
  const map = new Map<string, ImprovementAxisInsight>();
  for (const run of runs) {
    if (!run.change_axis || run.change_axis === "none") continue;
    const existing = map.get(run.change_axis) || {
      change_axis: run.change_axis,
      runs: 0,
      control_runs: 0,
      experiment_runs: 0,
      winners: 0,
      quality_wins: 0,
      salvageable: 0,
      losers: 0,
      avg_otk: null,
      avg_market_views: null,
      market_wins: 0,
      success_rate: 0,
      winner_rate: 0,
    };
    existing.runs += 1;
    if (run.batch_role === "control") existing.control_runs += 1;
    if (run.batch_role === "experiment") existing.experiment_runs += 1;
    if (run.verdict === "winner") {
      existing.winners += 1;
      if (!isMarketWin(run)) existing.quality_wins += 1;
    } else if (run.verdict === "salvageable") existing.salvageable += 1;
    else existing.losers += 1;
    existing.avg_otk = round1((((existing.avg_otk || 0) * (existing.runs - 1)) + (run.otk_score || 0)) / existing.runs);
    existing.avg_market_views = roundInt((((existing.avg_market_views || 0) * (existing.runs - 1)) + (run.market_views || 0)) / existing.runs);
    existing.market_wins += isMarketWin(run) ? 1 : 0;
    existing.success_rate = Math.round(((existing.winners + existing.salvageable) / existing.runs) * 100);
    existing.winner_rate = Math.round((existing.winners / existing.runs) * 100);
    map.set(run.change_axis, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => b.market_wins - a.market_wins || b.winner_rate - a.winner_rate || (b.avg_market_views || 0) - (a.avg_market_views || 0) || (b.avg_otk || 0) - (a.avg_otk || 0) || b.runs - a.runs)
    .slice(0, 6);
}

function nextActions(snapshot: {
  latest: ImprovementBatch | null;
  previous: ImprovementBatch | null;
  topPatterns: ImprovementPattern[];
  axisInsights: ImprovementAxisInsight[];
  totalRuns: number;
  batchSize: number;
  targetRuns: number;
}): string[] {
  const actions: string[] = [];
  const latest = snapshot.latest;
  const best = snapshot.topPatterns[0] || null;
  const bestAxis = snapshot.axisInsights[0] || null;
  if (best) {
    actions.push(`Держать control-pattern ${best.hook_type} / ${best.format} / ${best.visual_tool} как базу следующего батча`);
  }
  if (bestAxis && bestAxis.experiment_runs >= 2) {
    actions.push(`Из осей лучше всего пока работает ${bestAxis.change_axis}: ${bestAxis.market_wins} market wins / ${bestAxis.runs} прогонов`);
  }
  if (latest && latest.losers >= Math.ceil(latest.total_runs / 2)) {
    actions.push("В следующем батче менять только hook angle, не трогая visual pattern и format одновременно");
  }
  if (latest && latest.explicit_feedback < Math.max(2, Math.ceil(latest.total_runs / 2))) {
    actions.push("Для этой пятёрки не хватает рынка: занести просмотры или winner/reject хотя бы по 2-3 роликам");
  }
  if (latest && latest.salvageable > latest.winners) {
    actions.push("Поднять порог доказательности: больше proof/demo, меньше общих обещаний в opening");
  }
  if (latest && latest.market_wins === 0 && latest.total_runs >= snapshot.batchSize) {
    actions.push("Следующую пятёрку строить вокруг 1 сильного control и 1 proof-heavy варианта, пока не появится market winner");
  }
  if (latest && latest.improved_vs_prev === false) {
    actions.push("Остановить широкие вариации: оставить 1 control + 2 эксперимента максимум на батч из 5 роликов");
  }
  if (snapshot.totalRuns < snapshot.targetRuns) {
    const left = snapshot.targetRuns - snapshot.totalRuns;
    actions.push(`Продолжать сериями по ${snapshot.batchSize}: до цели осталось ${left} роликов`);
  }
  return actions.slice(0, 5);
}

export function buildNextBatchGate(snapshot: Pick<ImprovementSnapshot, "latest_batch" | "batch_size" | "target_runs" | "total_runs" | "progress">): ImprovementNextBatchGate {
  const latest = snapshot.latest_batch;
  const required = requiredFeedbackForBatch(latest);
  if (snapshot.progress.target_runs_met || snapshot.total_runs >= snapshot.target_runs) {
    return { ready: false, reason: "50-run цель уже закрыта: перед новым циклом зафиксировать выводы", current_feedback: latest?.explicit_feedback || 0, required_feedback: required };
  }
  if (!latest) {
    return { ready: true, reason: "первый batch можно запускать после preflight", current_feedback: 0, required_feedback: 0 };
  }
  if (latest.total_runs < snapshot.batch_size) {
    return { ready: false, reason: "последняя пятёрка ещё неполная: дождаться завершения текущего batch", current_feedback: latest.explicit_feedback || 0, required_feedback: required };
  }
  if ((latest.explicit_feedback || 0) < required) {
    return { ready: false, reason: `сначала закрыть market feedback ${latest.explicit_feedback || 0}/${required} по прошлой пятёрке`, current_feedback: latest.explicit_feedback || 0, required_feedback: required };
  }
  return { ready: true, reason: "можно запускать следующую пятёрку после preflight", current_feedback: latest.explicit_feedback || 0, required_feedback: required };
}

export function buildBatchPlan(snapshot: ImprovementSnapshot): ImprovementBatchPlan {
  const latest = snapshot.latest_batch;
  const best = snapshot.top_patterns[0] || null;
  const bestAxis = snapshot.axis_insights[0] || null;
  const total = Math.max(2, Math.min(5, latest?.total_runs || snapshot.batch_size || 5));
  const controlCount = total >= 5 ? 2 : 1;
  let primaryChangeAxis: ImprovementBatchPlan["primary_change_axis"] = "hook_angle";
  let experimentNote = "Менять только угол хука, сохраняя format и visual pattern.";

  if (latest?.salvageable && latest.salvageable > latest.winners) {
    primaryChangeAxis = "proof_density";
    experimentNote = "Добавить больше demo/proof в opening и середину, не меняя базовый format.";
  } else if (latest?.market_wins === 0 && latest?.total_runs && latest.total_runs >= snapshot.batch_size) {
    primaryChangeAxis = "cta_shape";
    experimentNote = "Проверить 1-2 новые формы CTA, не меняя хук и visual одновременно.";
  } else if (latest?.losers && latest.losers >= Math.ceil(latest.total_runs / 2)) {
    primaryChangeAxis = "hook_angle";
    experimentNote = "Сузить вариативность и тестировать только новые углы входа.";
  } else if (!best) {
    primaryChangeAxis = "format";
    experimentNote = "Control еще не стабилен: ищем формат с минимальным изменением visual pattern.";
  } else if (bestAxis && bestAxis.experiment_runs >= 2) {
    primaryChangeAxis = bestAxis.change_axis;
    experimentNote = `Последние серии лучше отвечают на ось ${bestAxis.change_axis}: держим control и проверяем только этот сдвиг.`;
  }

  return {
    control_count: controlCount,
    experiment_count: Math.max(1, total - controlCount),
    control_pattern: best ? `${best.hook_type} | ${best.format} | ${best.visual_tool}` : null,
    primary_change_axis: best ? primaryChangeAxis : (primaryChangeAxis === "format" ? "format" : "none"),
    experiment_note: experimentNote,
  };
}

export function summarizeImprovementRuns(
  rows: Row[],
  options?: {
    niche?: string | null;
    target_runs?: number;
    batch_size?: number;
    series_after?: string | null;
    metrics?: ImprovementMetricRow[];
    signals?: Row[];
    winners?: Row[];
  }
): ImprovementSnapshot {
  const targetRuns = Math.max(5, Math.min(200, Number(options?.target_runs) || 50));
  const batchSize = Math.max(2, Math.min(10, Number(options?.batch_size) || 5));
  const niche = options?.niche || null;
  const seriesStartAt = toText(options?.series_after, 40) || null;
  const metricsByRecipe = metricLookup(options?.metrics || []);
  const signalsByRecipe = signalLookup(options?.signals || []);
  const winnerByUrl = assetWinnerLookup(options?.winners || []);
  const filtered = rows
    .filter((row) => !niche || String(row.niche || "") === niche)
    .filter((row) => !seriesStartAt || String(row.created_at || "") >= seriesStartAt)
    .filter((row) => String(row.status || "").toLowerCase() !== "draft")
    .map((row) => deriveImprovementRun(row, { metricsByRecipe, signalsByRecipe, winnerByUrl }))
    .filter((run) => run.recipe_id != null)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, targetRuns);
  const analyzedRuns = [...filtered].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const batches = buildBatches(analyzedRuns, batchSize);
  const feedbackQueue = buildFeedbackQueue(analyzedRuns, batchSize);
  const topPatterns = buildPatterns(analyzedRuns);
  const axisInsights = buildAxisInsights(analyzedRuns);
  const latestBatch = batches[batches.length - 1] || null;
  const previousBatch = batches.length > 1 ? batches[batches.length - 2] : null;
  const seriesState = buildSeriesState(analyzedRuns.length, batchSize, targetRuns);
  const progress = {
    runs_completed: analyzedRuns.length,
    batches_completed: batches.length,
    target_runs_met: analyzedRuns.length >= targetRuns,
    latest_batch_improved: latestBatch?.improved_vs_prev ?? null,
  };
  const nextBatchGate = buildNextBatchGate({
    latest_batch: latestBatch,
    batch_size: batchSize,
    target_runs: targetRuns,
    total_runs: analyzedRuns.length,
    progress,
  });
  return {
    niche,
    target_runs: targetRuns,
    batch_size: batchSize,
    series_start_at: seriesStartAt,
    total_runs: analyzedRuns.length,
    analyzed_runs: analyzedRuns,
    feedback_queue: feedbackQueue,
    batches,
    top_patterns: topPatterns,
    axis_insights: axisInsights,
    latest_batch: latestBatch,
    previous_batch: previousBatch,
    series_state: seriesState,
    progress,
    next_batch_gate: nextBatchGate,
    batch_plan: analyzedRuns.length ? buildBatchPlan({
      niche,
      target_runs: targetRuns,
      batch_size: batchSize,
      series_start_at: seriesStartAt,
      total_runs: analyzedRuns.length,
      analyzed_runs: analyzedRuns,
      feedback_queue: feedbackQueue,
      batches,
      top_patterns: topPatterns,
      axis_insights: axisInsights,
      latest_batch: latestBatch,
      previous_batch: previousBatch,
      series_state: seriesState,
      progress: {
        runs_completed: analyzedRuns.length,
        batches_completed: batches.length,
        target_runs_met: analyzedRuns.length >= targetRuns,
        latest_batch_improved: latestBatch?.improved_vs_prev ?? null,
      },
      next_batch_gate: nextBatchGate,
      batch_plan: null,
      next_actions: [],
      warnings: [],
    }) : null,
    next_actions: nextActions({ latest: latestBatch, previous: previousBatch, topPatterns, axisInsights, totalRuns: analyzedRuns.length, batchSize, targetRuns }),
    warnings: analyzedRuns.length < batchSize ? ["Недостаточно run history для устойчивого improvement loop"] : [],
  };
}

export async function loadImprovementSnapshot(
  db: SupabaseClient,
  options?: {
    niche?: string | null;
    target_runs?: number;
    batch_size?: number;
    series_after?: string | null;
  }
): Promise<ImprovementSnapshot> {
  const targetRuns = Math.max(5, Math.min(200, Number(options?.target_runs) || 50));
  const niche = options?.niche || null;
  const seriesStartAt = toText(options?.series_after, 40) || null;
  let q = db
    .from("node_recipes")
    .select("id,article,niche,mode,status,otk_score,output_url,format_detected,created_at,run_plan")
    .order("created_at", { ascending: false })
    .limit(Math.max(targetRuns, 80));
  if (niche) q = q.eq("niche", niche);
  if (seriesStartAt) q = q.gte("created_at", seriesStartAt);
  const { data, error } = await q;
  if (error) throw error;
  const recipeRows = (data as Row[]) || [];
  const recipeIds = recipeRows.map((row) => Number(row.id) || 0).filter(Boolean);
  const outputUrls = recipeRows.map((row) => toText(row.output_url, 300)).filter(Boolean);

  let metrics: ImprovementMetricRow[] = [];
  let signals: Row[] = [];
  let winners: Row[] = [];

  if (recipeIds.length) {
    try {
      const { data: metricRows, error: metricError } = await db
        .from("post_metrics")
        .select("recipe_id,views,watch_rate,ctr_card,saves,posted_at")
        .in("recipe_id", recipeIds)
        .order("posted_at", { ascending: false })
        .limit(Math.max(recipeIds.length * 3, 20));
      if (!metricError) metrics = (metricRows as ImprovementMetricRow[]) || [];
    } catch { /* post_metrics optional */ }

    try {
      const { data: signalRows, error: signalError } = await db
        .from("cf_signals")
        .select("recipe_id,event,reason_chip,created_at")
        .in("recipe_id", recipeIds)
        .order("created_at", { ascending: false })
        .limit(Math.max(recipeIds.length * 4, 20));
      if (!signalError) signals = (signalRows as Row[]) || [];
    } catch { /* cf_signals optional */ }
  }

  if (outputUrls.length) {
    try {
      const { data: winnerRows, error: winnerError } = await db
        .from("content_assets")
        .select("url,is_winner,winner_at,analysis")
        .in("url", outputUrls);
      if (!winnerError) winners = (winnerRows as Row[]) || [];
    } catch { /* content_assets optional */ }
  }

  return summarizeImprovementRuns(recipeRows, { ...options, series_after: seriesStartAt, metrics, signals, winners });
}

export function renderImprovementHints(snapshot: ImprovementSnapshot): string {
  if (!snapshot.total_runs) return "";
  const parts: string[] = [];
  const latest = snapshot.latest_batch;
  const best = snapshot.top_patterns[0] || null;
  parts.push(`\nУЛУЧШЕНИЕ ПО СЕРИЯМ (${snapshot.total_runs}/${snapshot.target_runs} прогонов, батчи по ${snapshot.batch_size}):`);
  if (latest) {
    parts.push(`последний батч #${latest.index}: avg_otk ${latest.avg_otk ?? "?"}, winners ${latest.winners}/${latest.total_runs}, market_wins ${latest.market_wins}/${latest.total_runs}, improved_vs_prev=${latest.improved_vs_prev == null ? "n/a" : latest.improved_vs_prev ? "yes" : "no"}`);
  }
  if (best) {
    parts.push(`текущий control-pattern: hook=${best.hook_type}, format=${best.format}, visual=${best.visual_tool}, winner_rate=${best.winner_rate}%, avg_views=${best.avg_market_views ?? "?"}`);
  }
  if (snapshot.axis_insights[0]) {
    const axis = snapshot.axis_insights[0];
    parts.push(`лучшая ось эксперимента сейчас: ${axis.change_axis} (market_wins=${axis.market_wins}, winner_rate=${axis.winner_rate}%)`);
  }
  if (snapshot.next_actions.length) {
    parts.push(`следующий ход: ${snapshot.next_actions.slice(0, 3).join(" | ")}`);
  }
  return parts.join(" ");
}

export function renderBatchPlanHint(snapshot: ImprovementSnapshot): string {
  if (!snapshot.total_runs) return "";
  const plan = buildBatchPlan(snapshot);
  const total = plan.control_count + plan.experiment_count;
  return [
    `\nBATCH PLAN НА СЛЕДУЮЩУЮ ПЯТЁРКУ (${total} идей):`,
    `control=${plan.control_count}, experiment=${plan.experiment_count}`,
    `control-pattern=${plan.control_pattern || "ещё не найден"}`,
    `change_axis=${plan.primary_change_axis}`,
    `правило: одновременно менять только один фактор; ${plan.experiment_note}`,
  ].join(" ");
}
