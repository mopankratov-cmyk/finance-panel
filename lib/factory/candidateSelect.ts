import { QA_THRESHOLD } from "./standard";

export type CandidateBatchRole = "control" | "experiment" | "none";
export type CandidateChangeAxis = "none" | "hook_angle" | "proof_density" | "cta_shape" | "format";

export interface RenderCandidateInput {
  id?: unknown;
  hook?: unknown;
  hook_text?: unknown;
  angle?: unknown;
  concept?: unknown;
  scenario?: unknown;
  retention?: unknown;
  caption?: unknown;
  format?: unknown;
  score?: unknown;
  verdict?: unknown;
  fix?: unknown;
  batch_role?: unknown;
  change_axis?: unknown;
  scenario_quality_score?: unknown;
  scenario_quality?: unknown;
}

export interface CandidateSelectOptions {
  top_k?: unknown;
  threshold?: unknown;
  max_paid?: unknown;
}

export interface CandidateSelection {
  id: string;
  source_index: number;
  hook: string;
  concept: string;
  format: string;
  score: number;
  verdict: "approved" | "rework";
  batch_role: CandidateBatchRole;
  change_axis: CandidateChangeAxis;
  reasons: string[];
  reject_reasons: string[];
  rationale: string;
  candidate: RenderCandidateInput;
}

export interface CandidateSelectResult {
  ok: boolean;
  threshold: number;
  top_k: number;
  max_paid: number;
  paid_candidate_count: number;
  selected: CandidateSelection[];
  rejected: CandidateSelection[];
  blocked_reason: string | null;
  rationale: string[];
}

const GENERIC_HOOK_PATTERNS = [
  "привет",
  "сегодня расскажу",
  "хочу показать",
  "давайте разбер",
  "в современном мире",
  "это не просто",
  "идеальное решение",
  "представляем",
  "успей купить",
  "купите",
  "рекомендую",
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function scoreOf(candidate: RenderCandidateInput): number {
  const direct = Number(candidate.score);
  if (Number.isFinite(direct) && direct > 0) return clamp(direct, 1, 10);
  const scenarioQuality = Number(candidate.scenario_quality_score);
  if (Number.isFinite(scenarioQuality) && scenarioQuality > 0) return clamp(scenarioQuality, 1, 10);
  if (candidate.scenario_quality && typeof candidate.scenario_quality === "object") {
    const score = Number((candidate.scenario_quality as Record<string, unknown>).score);
    if (Number.isFinite(score) && score > 0) return clamp(score, 1, 10);
  }
  return 0;
}

function normalizeRole(value: unknown): CandidateBatchRole {
  const raw = text(value).toLowerCase();
  if (raw === "control" || raw === "experiment") return raw;
  return "none";
}

function normalizeAxis(value: unknown): CandidateChangeAxis {
  const raw = text(value).toLowerCase();
  if (raw === "none" || raw === "hook_angle" || raw === "proof_density" || raw === "cta_shape" || raw === "format") return raw;
  return "none";
}

function conceptOf(candidate: RenderCandidateInput): string {
  return text(candidate.concept || candidate.scenario || candidate.angle || candidate.retention || candidate.caption);
}

function formatOf(candidate: RenderCandidateInput): string {
  return text(candidate.format) || "unknown";
}

function hookOf(candidate: RenderCandidateInput): string {
  return text(candidate.hook || candidate.hook_text);
}

function hookRejectReasons(hook: string): string[] {
  const lower = hook.toLowerCase();
  const reasons: string[] = [];
  if (!hook) reasons.push("missing_hook");
  if (hook && hook.split(/\s+/).filter(Boolean).length < 4) reasons.push("hook_too_short");
  if (GENERIC_HOOK_PATTERNS.some((pattern) => lower.includes(pattern))) reasons.push("generic_or_ad_hook");
  if (hook.length > 140) reasons.push("hook_too_long");
  return reasons;
}

function candidateReasons(input: {
  score: number;
  verdict: "approved" | "rework";
  batch_role: CandidateBatchRole;
  change_axis: CandidateChangeAxis;
  format: string;
}): string[] {
  const reasons = [`score_${input.score}`];
  reasons.push(`verdict_${input.verdict}`);
  if (input.batch_role !== "none") reasons.push(`role_${input.batch_role}`);
  if (input.change_axis !== "none") reasons.push(`axis_${input.change_axis}`);
  if (input.format !== "unknown") reasons.push(`format_${input.format}`);
  return reasons;
}

function makeSelection(candidate: RenderCandidateInput, sourceIndex: number, threshold: number): CandidateSelection {
  const id = text(candidate.id) || `candidate-${sourceIndex + 1}`;
  const hook = hookOf(candidate);
  const concept = conceptOf(candidate);
  const format = formatOf(candidate);
  const score = scoreOf(candidate);
  const rawVerdict = text(candidate.verdict).toLowerCase();
  const verdict = rawVerdict === "rework" || score < threshold ? "rework" : "approved";
  const batch_role = normalizeRole(candidate.batch_role);
  const change_axis = normalizeAxis(candidate.change_axis);
  const reject_reasons = [
    ...hookRejectReasons(hook),
    ...concept ? [] : ["missing_concept"],
    ...verdict === "rework" ? [`score_below_${threshold}`] : [],
  ];
  const reasons = candidateReasons({ score, verdict, batch_role, change_axis, format });
  const rationaleParts = [
    `${id}: ${verdict}`,
    `score ${score}/${threshold}`,
    batch_role !== "none" ? `role ${batch_role}` : "",
    change_axis !== "none" ? `axis ${change_axis}` : "",
    format !== "unknown" ? `format ${format}` : "",
    hook ? `hook "${hook.slice(0, 90)}"` : "no hook",
  ].filter(Boolean);

  return {
    id,
    source_index: sourceIndex,
    hook,
    concept,
    format,
    score,
    verdict,
    batch_role,
    change_axis,
    reasons,
    reject_reasons,
    rationale: rationaleParts.join("; "),
    candidate,
  };
}

function compareCandidates(a: CandidateSelection, b: CandidateSelection): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.batch_role !== b.batch_role) {
    if (a.batch_role === "control") return -1;
    if (b.batch_role === "control") return 1;
  }
  return a.source_index - b.source_index;
}

export function selectRenderCandidates(candidates: RenderCandidateInput[], options: CandidateSelectOptions = {}): CandidateSelectResult {
  const threshold = clamp(Number(options.threshold ?? QA_THRESHOLD) || QA_THRESHOLD, 1, 10);
  const maxPaid = clamp(Math.floor(Number(options.max_paid ?? 2) || 2), 1, 2);
  const topK = clamp(Math.floor(Number(options.top_k ?? 1) || 1), 1, maxPaid);
  const normalized = candidates.map((candidate, index) => makeSelection(candidate, index, threshold));
  const approved = normalized
    .filter((candidate) => candidate.verdict === "approved" && candidate.reject_reasons.length === 0)
    .sort(compareCandidates);
  const selected = approved.slice(0, topK);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const rejected = normalized
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => {
      if (candidate.reject_reasons.length) return candidate;
      return {
        ...candidate,
        reject_reasons: ["not_in_top_k"],
      };
    })
    .sort(compareCandidates);
  const blockedReason = selected.length ? null : (normalized.length ? "no_candidate_passed_pre_render_gate" : "no_candidates");

  return {
    ok: selected.length > 0,
    threshold,
    top_k: topK,
    max_paid: maxPaid,
    paid_candidate_count: selected.length,
    selected,
    rejected,
    blocked_reason: blockedReason,
    rationale: selected.map((candidate) => candidate.rationale),
  };
}
