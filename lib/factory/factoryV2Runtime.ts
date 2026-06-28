import { createHash } from "node:crypto";
import type { RunNode, RunPlan } from "./graphTypes";

export type DlqAction = "retry" | "replay_from_step" | "hold_for_operator" | "stop_budget";
export type PromotionDecision = "promote" | "keep_learning" | "reject";
export type PlannerDecision = "run_next_batch" | "hold_for_feedback" | "hold_for_budget" | "hold_for_quality";

function text(value: unknown, max = 200): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildRunIdempotencyKey(recipeId: number | string, nodes: Pick<RunNode, "ordinal" | "tool" | "prompt" | "asset_url" | "params">[]): string {
  const payload = {
    recipe_id: String(recipeId),
    nodes: nodes.map((node) => ({
      ordinal: node.ordinal,
      tool: node.tool || "",
      prompt_hash: createHash("sha1").update(text(node.prompt, 5000)).digest("hex").slice(0, 12),
      asset_url: node.asset_url || "",
      image_url: text((node.params || {}).image_url, 1200),
      lane: text((node.params || {}).lane, 40),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export function classifyDlqAction(input: { step?: unknown; attempts?: unknown; error?: unknown; budgetRemaining?: unknown }): DlqAction {
  const step = text(input.step, 80);
  const error = text(input.error, 300).toLowerCase();
  const attempts = num(input.attempts) ?? 0;
  const budgetRemaining = num(input.budgetRemaining);
  if (budgetRemaining != null && budgetRemaining <= 0) return "stop_budget";
  if (/balance|exhausted|locked|лимит|budget|стоп для бюджета/.test(error)) return "stop_budget";
  if (attempts >= 3) return "hold_for_operator";
  if (["render-poll", "gen-poll", "clip-qa", "otk"].includes(step)) return "replay_from_step";
  return "retry";
}

export function budgetGuard(input: { estimatedUsd?: unknown; budgetUsd?: unknown; spentUsd?: unknown; worstCaseMultiplier?: unknown }): { ok: boolean; remainingUsd: number; reason: string } {
  const budget = Math.max(0, num(input.budgetUsd) ?? 0);
  const spent = Math.max(0, num(input.spentUsd) ?? 0);
  const estimate = Math.max(0, num(input.estimatedUsd) ?? 0);
  const multiplier = Math.max(1, num(input.worstCaseMultiplier) ?? 1);
  const worstCase = estimate * multiplier;
  const remaining = Math.max(0, Math.round((budget - spent) * 100) / 100);
  if (budget <= 0) return { ok: false, remainingUsd: 0, reason: "budget_not_set" };
  if (worstCase > remaining) return { ok: false, remainingUsd: remaining, reason: "worst_case_exceeds_remaining_budget" };
  return { ok: true, remainingUsd: remaining, reason: "within_budget" };
}

export function shouldPromoteWinner(input: { otkScore?: unknown; basis?: unknown; artifactOk?: unknown; views?: unknown; saves?: unknown; status?: unknown }): { decision: PromotionDecision; reason: string } {
  const score = num(input.otkScore);
  const basis = text(input.basis, 40).toLowerCase();
  const views = num(input.views) ?? 0;
  const saves = num(input.saves) ?? 0;
  const status = text(input.status, 40);
  if (input.artifactOk === false) return { decision: "reject", reason: "artifact_failed" };
  if (basis === "text" || basis === "fallback" || basis === "storyboard") return { decision: "keep_learning", reason: "not_frames_grounded" };
  if (status && status !== "otk_pass" && status !== "approved") return { decision: "keep_learning", reason: "not_approved_status" };
  if (score != null && score >= 8 && (views >= 500 || saves >= 5)) return { decision: "promote", reason: "quality_and_market_signal" };
  if (score != null && score >= 7) return { decision: "keep_learning", reason: "quality_pass_waiting_market_signal" };
  return { decision: "reject", reason: "quality_below_promotion_bar" };
}

export function planNextSeriesBatch(input: { completedRuns?: unknown; feedbackItems?: unknown; budgetOk?: unknown; latestPassRate?: unknown; targetRuns?: unknown }): { decision: PlannerDecision; nextCount: number; reason: string } {
  const completed = Math.max(0, num(input.completedRuns) ?? 0);
  const feedback = Math.max(0, num(input.feedbackItems) ?? 0);
  const target = Math.max(1, num(input.targetRuns) ?? 50);
  const passRate = num(input.latestPassRate);
  if (input.budgetOk === false) return { decision: "hold_for_budget", nextCount: 0, reason: "budget_guard_blocked" };
  if (completed >= target) return { decision: "hold_for_feedback", nextCount: 0, reason: "series_target_complete" };
  if (completed > 0 && completed % 5 === 0 && feedback < 3) return { decision: "hold_for_feedback", nextCount: 0, reason: "batch_feedback_required" };
  if (passRate != null && completed >= 10 && passRate < 0.1) return { decision: "hold_for_quality", nextCount: 0, reason: "pass_rate_below_m3_floor" };
  return { decision: "run_next_batch", nextCount: Math.min(5, target - completed), reason: "ready" };
}

export function workerHandoffPayload(plan: RunPlan): { run_id: string | null; idempotency_key: string | null; step: string; lane: string; budget: number | null } {
  return {
    run_id: plan.run_id || null,
    idempotency_key: plan.idempotency_key || null,
    step: plan.step,
    lane: plan.lane || "product",
    budget: plan.lane_budget ?? null,
  };
}
